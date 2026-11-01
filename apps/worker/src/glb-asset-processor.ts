import {createHash} from 'node:crypto';
import {createGlbModelManifest} from '@medical-device/model-runtime';
import type {AssetProcessorPort,PrivateObjectStoragePort} from '@medical-device/contracts';
import type {createModelImportStore} from '@medical-device/db';

export function createGlbAssetProcessor(input:{storage:PrivateObjectStoragePort;models:ReturnType<typeof createModelImportStore>;fallback:AssetProcessorPort}):AssetProcessorPort{
 return {
  inspect:request=>request.sourceType==='glb'?Promise.resolve({supported:(request.sizeBytes??0)<=64*1024*1024,reasons:(request.sizeBytes??0)>64*1024*1024?['GLB_SIZE_LIMIT']:[]}):input.fallback.inspect(request),
  canProcess:request=>request.sourceType==='glb'?Promise.resolve(true):input.fallback.canProcess(request),
  async process(request,job){
   if(request.sourceType!=='glb')return input.fallback.process(request,job);
   const start=Date.now();
   const fail=(code:string)=>({adapter:'glb-import',adapterVersion:'1',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[],status:'FAILED' as const,warnings:[],metrics:{durationMs:Date.now()-start},failure:{class:'VALIDATION' as const,code,message:'The GLB could not be imported: '+code}});
   if(!request.blobKey.startsWith(job.tenant.organizationId+'/'))return fail('BLOB_TENANT_MISMATCH');
   const object=await input.storage.readObject({blobKey:request.blobKey,maxBytes:64*1024*1024});
   if(createHash('sha256').update(object.bytes).digest('hex')!==request.sha256)return fail('CHECKSUM_MISMATCH');
   let manifest;
   try{
    manifest=createGlbModelManifest(object.bytes,request.sha256,image=>createHash('sha256').update(image).digest('hex'));
    // Self-contained models cannot make the learner fetch external resources.
    const bytes=Buffer.from(object.bytes),length=bytes.readUInt32LE(12);
    const document=JSON.parse(bytes.subarray(20,20+length).toString('utf8'));
    if([...document.buffers??[],...document.images??[]].some(resource=>resource.uri))return fail('GLB_EXTERNAL_RESOURCES_UNSUPPORTED');
    if(manifest.components.some(c=>typeof c.componentId!=='string'||!c.componentId.trim()||c.componentId.length>128))return fail('GLB_COMPONENT_IDS_INVALID');
   }catch{return fail('GLB_MANIFEST_INVALID');}
   const modelVersionId='model:'+request.inputAssetVersionId;
   manifest.modelVersionId=modelVersionId;
   try{const lineage=await input.models.reconstructionLineage(job.tenant,{...manifest});if(lineage)manifest.reconstructionLineage=lineage;}
   catch(error){if(error instanceof Error&&error.message.startsWith('RECONSTRUCTION_'))return fail(error.message);throw error;}
   const manifestBlobKey=job.tenant.organizationId+'/derived/models/'+encodeURIComponent(request.inputAssetVersionId)+'/manifest.json';
   const output=Buffer.from(JSON.stringify(manifest));
   await input.storage.putObject({blobKey:manifestBlobKey,bytes:output,contentType:'application/json'});
   try{await input.models.save(job.tenant,{assetVersionId:request.inputAssetVersionId,modelVersionId,blobKey:request.blobKey,manifestBlobKey,manifest:{...manifest},components:manifest.components});}
   catch(error){if(error instanceof Error&&error.message.startsWith('RECONSTRUCTION_'))return fail(error.message);throw error;}
   return {adapter:'glb-import',adapterVersion:'1',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[modelVersionId],status:'REVIEW_REQUIRED',warnings:[{code:'MODEL_REVIEW_REQUIRED',severity:'warning' as const,message:'Review component names, scale, orientation and interaction capabilities before approving this model.'}],metrics:{durationMs:Date.now()-start,inputBytes:object.bytes.length,outputBytes:output.length},details:{modelVersionId,manifestBlobKey,componentCount:manifest.components.length,normalizationStatus:manifest.normalizationStatus}};
  }
 };
}
