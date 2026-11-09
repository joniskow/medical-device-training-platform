import {createHash} from 'node:crypto';
import {validateHostedLessonRequest,validateHostedCorrectedTakeRequest,type HostedLessonStore,type HostedLessonPayload,type JobStorePort,type PrivateObjectStoragePort,type TenantContext,type LessonRenderManifest} from '@medical-device/contracts';

export function createLessonRenderService(input:{store:HostedLessonStore;jobs:JobStorePort;storage:PrivateObjectStoragePort}){
  const get=async(tenant:TenantContext,jobId:string)=>{
    const job=await input.jobs.get<HostedLessonPayload>(tenant,jobId);
    return job?.jobType==='lesson.render'&&job.tenant.organizationId===tenant.organizationId?job:null;
  };
  return {
    async promoteCorrectedTake(tenant:TenantContext,request:unknown){return input.store.promoteCorrectedTake(tenant,validateHostedCorrectedTakeRequest(request));},
    async create(tenant:TenantContext,request:unknown){const job=await input.store.admit(tenant,validateHostedLessonRequest(request));return {jobId:job.jobId,state:job.state};},
    async get(tenant:TenantContext,jobId:string){
      const job=await get(tenant,jobId);if(!job)return null;
      const manifest=job.outcome?.details?.manifest as LessonRenderManifest|undefined;
      if(job.state==='SUCCEEDED'&&manifest)await input.store.assertArtifactCurrent(tenant,job.payload,manifest);
      return {jobId:job.jobId,state:job.state,attempt:job.attempt,failure:job.lastFailure,...(manifest?{manifest,assetVersionId:job.outcome?.details?.assetVersionId}:{}),courseVersionId:job.payload.courseVersionId,lessonId:job.payload.lessonId};
    },
    async cancel(tenant:TenantContext,jobId:string,reason?:string){return input.store.cancel(tenant,jobId,reason);},
    async retry(tenant:TenantContext,jobId:string,reason:string){
      const job=await get(tenant,jobId);if(!job)return null;
      if(!tenant.actorId||job.operatorMetadata?.cancelled===true)throw Error('LESSON_RENDER_CANCELLED');
      await input.store.assertCurrent(tenant,job.payload);
      return input.jobs.retry(tenant,jobId,{actorId:tenant.actorId,reason});
    },
    async content(tenant:TenantContext,jobId:string,kind:'video'|'captions'|'manifest'){
      const job=await get(tenant,jobId);
      const manifest=job?.outcome?.details?.manifest as LessonRenderManifest|undefined;
      if(job?.state!=='SUCCEEDED'||!manifest)return null;
      await input.store.assertArtifactCurrent(tenant,job.payload,manifest);
      const prefix=`${tenant.organizationId}/derived/lessons/${encodeURIComponent(job.jobId)}/lease-${job.leaseGeneration}`;
      const blobKey=kind==='video'?`${prefix}/lesson.mp4`:kind==='captions'?`${prefix}/captions.vtt`:`${prefix}/manifest.json`;
      if(manifest.outputPath!==`${prefix}/lesson.mp4`||manifest.captionsPath!==`${prefix}/captions.vtt`)throw Error('LESSON_RENDER_ARTIFACT_BINDING_INVALID');
      const result=await input.storage.readObject({blobKey,maxBytes:kind==='video'?128*1024*1024:1024*1024});
      const expected=kind==='video'?manifest.sha256:kind==='captions'?manifest.captionsSha256:job.outcome?.details?.manifestSha256;
      if(createHash('sha256').update(result.bytes).digest('hex')!==expected)throw Error('LESSON_RENDER_CONTENT_HASH_MISMATCH');
      await input.store.assertArtifactCurrent(tenant,job.payload,manifest);
      return {bytes:result.bytes,contentType:kind==='video'?'video/mp4':kind==='captions'?'text/vtt':'application/json'};
    }
  };
}
export type LessonRenderService=ReturnType<typeof createLessonRenderService>;
