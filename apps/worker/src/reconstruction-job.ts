import {createHash} from 'node:crypto';
import type {JobStorePort,PrivateObjectStoragePort,ReconstructionArtifacts,ReconstructionEngine,ReconstructionPayload,ReconstructionSourceStore,TenantContext} from '@medical-device/contracts';
import {inspectReconstructionCandidate} from '@medical-device/model-runtime';
import {assertPhotogrammetryReport} from './photogrammetry-report.js';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function processReconstructionJob(input:{jobStore:JobStorePort;storage:PrivateObjectStoragePort;sources:ReconstructionSourceStore;engine?:ReconstructionEngine;tenant:TenantContext;jobId:string;workerId:string;signal?:AbortSignal}){
  const stored=await input.jobStore.get(input.tenant,input.jobId);if(stored?.jobType!=='reconstruction.generate')return null;
  const job=await input.jobStore.claim<ReconstructionPayload>(input.tenant,input.jobId,input.workerId,undefined,3600);if(!job)return null;
  const generation=job.leaseGeneration??0;
  let phase:'reading'|'engine'|'publishing'='reading';
  try{
    input.signal?.throwIfAborted();
    if(job.payload.schemaVersion!=='reconstruction-request.v1'||!input.engine?.modes.includes(job.payload.mode))throw Error('RECONSTRUCTION_ENGINE_UNAVAILABLE');
    await input.sources.assertSourcesCurrent(job.tenant,job.payload);
    const sources:Parameters<ReconstructionEngine['generate']>[0]['sources']=[];
    for(const source of job.payload.sources){
      input.signal?.throwIfAborted();
      if(!source.blobKey.startsWith(job.tenant.organizationId+'/'))throw Error('RECONSTRUCTION_SOURCE_CHANGED');
      const object=await input.storage.readObject({blobKey:source.blobKey,maxBytes:source.sizeBytes});
      if(object.bytes.length!==source.sizeBytes||sha(object.bytes)!==source.sourceHash)throw Error('RECONSTRUCTION_SOURCE_CONTENT_MISMATCH');
      sources.push({source,bytes:object.bytes});
    }
    phase='engine';
    const output=await input.engine!.generate({job,sources,signal:input.signal});
    input.signal?.throwIfAborted();
    if(output.candidate.length<28||output.candidate.length>64*1024*1024||output.quality.length>256*1024)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
    const quality=JSON.parse(Buffer.from(output.quality).toString('utf8')),geometry=inspectReconstructionCandidate(output.candidate);
    if(quality.schemaVersion!=='reconstruction-quality.v1'||quality.status!=='REVIEW_REQUIRED'||quality.candidate?.sha256!==sha(output.candidate)||quality.candidate?.triangles!==geometry.triangleCount||quality.candidate?.bytes!==output.candidate.length)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
    if(job.payload.mode==='video'){
      if(quality.sourceVideo?.sourceSha256!==job.payload.sources[0].sourceHash||quality.sourceVideo?.sourceBytes!==job.payload.sources[0].sizeBytes)throw Error('RECONSTRUCTION_OUTPUT_SOURCE_MISMATCH');
    }else if(!Array.isArray(quality.inputImages)||quality.inputImages.length!==sources.length||quality.inputImages.some((image:any,index:number)=>image.sha256!==sources[index].source.sourceHash||image.bytes!==sources[index].bytes.length))throw Error('RECONSTRUCTION_OUTPUT_SOURCE_MISMATCH');
    if(job.payload.mode!=='video'&&(quality.sourceVideo!==undefined||output.sourceViews!==undefined))throw Error('RECONSTRUCTION_OUTPUT_SOURCE_MISMATCH');
    if(job.payload.mode!=='single-image'){
      assertPhotogrammetryReport(quality,job.payload.mode);
      quality.method=job.payload.mode==='video'?'video-photogrammetry':'multi-view-photogrammetry';
      quality.accuracy={...quality.accuracy,metricScaleVerified:false,hiddenGeometryVerified:false,deviceDetailsVerified:false,surfaceErrorMeasured:false};
    }
    quality.approvedForScoredUse=false;quality.reviewRequired=true;
    if(job.payload.mode==='single-image'){
      quality.method='single-image-generative-hypothesis';
      quality.accuracy={...quality.accuracy,metricScaleVerified:false,hiddenGeometryVerified:false,deviceDetailsVerified:false,surfaceErrorMeasured:false,generatedViewsAreAdditionalEvidence:false};
      quality.warnings=[...new Set([...(Array.isArray(quality.warnings)?quality.warnings.filter((warning:unknown)=>typeof warning==='string'):[]),'SINGLE_IMAGE_INFERRED_GEOMETRY','HIDDEN_SURFACES_UNVERIFIED','SCALE_UNVERIFIED','COMPONENT_MAPPING_REQUIRED'])];
    }
    quality.serverLineage={schemaVersion:'reconstruction-lineage.v1',jobId:job.jobId,requestSignature:job.payload.requestSignature,
      sources:job.payload.sources.map(({assetVersionId,sourceHash,reviewEventId,rightsAttestationId})=>({assetVersionId,sourceHash,reviewEventId,rightsAttestationId}))};
    if(job.payload.mode==='video'){
      if(!Array.isArray(output.sourceViews)||output.sourceViews.length<1||output.sourceViews.length>8||new Set(output.sourceViews.map(view=>view.sourceName)).size!==output.sourceViews.length)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
      quality.reviewViews=output.sourceViews.map((view,index)=>{
        const frame=quality.sourceVideo.frames.find((frame:{name:string})=>frame.name===view.sourceName),bytes=Buffer.from(view.bytes),hash=sha(bytes);
        if(!frame||frame.sha256!==hash||frame.bytes!==bytes.length||frame.timestampSeconds!==view.timestampSeconds||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==quality.captureProfile.width||bytes.readUInt32BE(20)!==quality.captureProfile.height)throw Error('RECONSTRUCTION_OUTPUT_SOURCE_MISMATCH');
        return {index,sourceName:view.sourceName,timestampSeconds:view.timestampSeconds,sha256:hash,bytes:bytes.length};
      });
    }
    const report=Buffer.from(JSON.stringify(quality));if(report.length>256*1024)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
    await input.sources.assertSourcesCurrent(job.tenant,job.payload);
    phase='publishing';
    const prefix=`${job.tenant.organizationId}/derived/reconstruction/${encodeURIComponent(job.jobId)}/attempt-${job.attempt}/lease-${generation}/`;
    async function put(file:string,bytes:Uint8Array,contentType:string,limit:number){
      input.signal?.throwIfAborted();
      if(bytes.length<1||bytes.length>limit)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
      if(contentType==='image/png'&&Buffer.from(bytes.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a')throw Error('RECONSTRUCTION_OUTPUT_INVALID');
      const artifact={blobKey:prefix+file,sha256:sha(bytes),bytes:bytes.length,contentType};
      await input.storage.putObject({blobKey:artifact.blobKey,bytes,contentType});return artifact;
    }
    const artifacts:ReconstructionArtifacts={schemaVersion:'reconstruction-artifacts.v1',
      candidate:await put('candidate.glb',output.candidate,'model/gltf-binary',64*1024*1024),quality:await put('quality.json',report,'application/json',256*1024)};
    if(output.foreground)artifacts.foreground=await put('foreground.png',output.foreground,'image/png',32*1024*1024);
    if(output.conditioningImage)artifacts.conditioningImage=await put('input.png',output.conditioningImage,'image/png',32*1024*1024);
    if(output.sourceViews){artifacts.views=[];for(let index=0;index<output.sourceViews.length;index++){const view=output.sourceViews[index];artifacts.views.push({...await put(`view-${index}.png`,view.bytes,'image/png',25*1024*1024),sourceName:view.sourceName,timestampSeconds:view.timestampSeconds});}}
    await input.sources.assertSourcesCurrent(job.tenant,job.payload);
    input.signal?.throwIfAborted();
    return input.jobStore.succeed(job.tenant,job.jobId,input.workerId,generation,{adapter:'reconstruction',adapterVersion:'reconstruction-workflow.v1',status:'REVIEW_REQUIRED',
      outputArtifactIds:[artifacts.candidate.blobKey,artifacts.quality.blobKey],warnings:[{code:'RECONSTRUCTION_REVIEW_REQUIRED',severity:'warning',message:'Scale, component mapping and device fidelity require review.'}],
      metrics:{inputBytes:sources.reduce((sum,source)=>sum+source.bytes.length,0),outputBytes:output.candidate.length+report.length},details:{artifacts,approvedForScoredUse:false,sourceImageHashes:quality.inputImages.map((image:{sha256:string})=>image.sha256),sourceVideoHash:quality.sourceVideo?.sourceSha256}});
  }catch(error){
    const message=error instanceof Error?error.message:'',sourceFailure=/^RECONSTRUCTION_(?:SOURCE_|REQUEST_INVALID)/.test(message),outputFailure=/^RECONSTRUCTION_OUTPUT_/.test(message);
    const permanent=sourceFailure||outputFailure||message==='RECONSTRUCTION_ENGINE_UNAVAILABLE'||phase==='engine';
    return input.jobStore.fail(job.tenant,job.jobId,input.workerId,generation,{class:permanent?'VALIDATION':'RETRYABLE',code:sourceFailure||outputFailure||message==='RECONSTRUCTION_ENGINE_UNAVAILABLE'?message:phase==='engine'?'RECONSTRUCTION_ENGINE_FAILED':'RECONSTRUCTION_STORAGE_FAILED',message:permanent?'The reconstruction inputs or engine require attention.':'Reconstruction storage was temporarily unavailable.',...(permanent?{}:{retryAfterSeconds:30})});
  }
}
