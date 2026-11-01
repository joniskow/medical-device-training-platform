import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {PrivateObjectStoragePort,ReconstructionArtifacts,ReconstructionMode,ReconstructionRequestInput,TenantContext} from '@medical-device/contracts';
import {createReconstructionStore,validateReconstructionInput} from '@medical-device/db';

export function readReconstructionModes(value:string|undefined):ReconstructionMode[]{
  const modes=(value??'').split(',').map(mode=>mode.trim()).filter(Boolean);
  if(modes.some(mode=>!['single-image','multi-view','video'].includes(mode))||new Set(modes).size!==modes.length)throw Error('RECONSTRUCTION_MODES_INVALID');
  return modes as ReconstructionMode[];
}
export function createReconstructionService(pool:Pool,storage:PrivateObjectStoragePort,modes:readonly ReconstructionMode[]){
  const store=createReconstructionStore(pool);
  async function get(tenant:TenantContext,id:string){
    const job=await store.get(tenant,id);if(!job)return null;
    const completed=job.state==='SUCCEEDED'&&job.outcome?.status==='REVIEW_REQUIRED';
    if(completed)await store.assertSourcesCurrent(tenant,job.payload);
    const views=(job.outcome?.details?.artifacts as ReconstructionArtifacts|undefined)?.views;
    if(views!==undefined&&(!Array.isArray(views)||views.length>8))throw Error('RECONSTRUCTION_ARTIFACT_INVALID');
    return {jobId:job.jobId,mode:job.payload.mode,state:job.state,createdAt:job.createdAt,attempt:job.attempt,maxAttempts:job.maxAttempts,
      sources:job.payload.sources.map(({assetVersionId,sourceHash,fileName,sourceType,sizeBytes})=>({assetVersionId,sourceHash,fileName,sourceType,sizeBytes})),
      ...(job.lastFailure?{failureCode:job.lastFailure.code}:{}),
      ...(completed?{candidateUrl:`/api/v1/reconstructions/${encodeURIComponent(id)}/candidate`,qualityUrl:`/api/v1/reconstructions/${encodeURIComponent(id)}/quality`}:{}),
      ...(completed&&views?{views:views.map((view,index)=>({index,sourceName:view.sourceName,timestampSeconds:view.timestampSeconds,sha256:view.sha256,bytes:view.bytes,contentUrl:`/api/v1/reconstructions/${encodeURIComponent(id)}/views?index=${index}`}))}:{}),
      reviewRequired:true,approvedForScoredUse:false};
  }
  return {
    list:async(tenant:TenantContext,after='')=>({...await store.list(tenant,after),enabledModes:modes}),
    sources:store.availableSources,
    get,
    async create(tenant:TenantContext,input:ReconstructionRequestInput){
      validateReconstructionInput(input);
      if(!modes.includes(input.mode))throw Error('RECONSTRUCTION_MODE_UNAVAILABLE');
      const job=await store.create(tenant,input);return {jobId:job.jobId,state:job.state};
    },
    async artifact(tenant:TenantContext,id:string,name:'candidate'|'quality'|'foreground'|'conditioning-image'|'views',index?:number){
      if(name==='views'&&(!Number.isSafeInteger(index)||index!<0||index!>7))throw Error('RECONSTRUCTION_REQUEST_INVALID');
      const job=await store.get(tenant,id);if(!job||job.state!=='SUCCEEDED'||job.outcome?.status!=='REVIEW_REQUIRED')return null;
      await store.assertSourcesCurrent(tenant,job.payload);
      const artifacts=job.outcome.details?.artifacts as ReconstructionArtifacts|undefined;
      const artifact=name==='views'?artifacts?.views?.[index!]:artifacts?.[name==='conditioning-image'?'conditioningImage':name];
      if(!artifact)return null;
      const prefix=`${tenant.organizationId}/derived/reconstruction/${encodeURIComponent(id)}/attempt-${job.attempt}/lease-${job.leaseGeneration}/`;
      const expectedType=name==='candidate'?'model/gltf-binary':name==='quality'?'application/json':'image/png';
      const file=name==='candidate'?'candidate.glb':name==='quality'?'quality.json':name==='foreground'?'foreground.png':name==='views'?`view-${index}.png`:'input.png';
      const limit=name==='candidate'?64*1024*1024:name==='quality'?256*1024:name==='views'?25*1024*1024:32*1024*1024;
      if(artifacts?.schemaVersion!=='reconstruction-artifacts.v1'||artifact.blobKey!==prefix+file||artifact.contentType!==expectedType||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1||artifact.bytes>limit||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw Error('RECONSTRUCTION_ARTIFACT_INVALID');
      const object=await storage.readObject({blobKey:artifact.blobKey,maxBytes:limit});
      if(object.bytes.length!==artifact.bytes||createHash('sha256').update(object.bytes).digest('hex')!==artifact.sha256)throw Error('RECONSTRUCTION_CONTENT_MISMATCH');
      await store.assertSourcesCurrent(tenant,job.payload);
      return {bytes:object.bytes,contentType:expectedType};
    }
  };
}
