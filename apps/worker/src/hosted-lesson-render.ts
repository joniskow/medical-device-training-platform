import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type JobStorePort,type HostedLessonPayload,type HostedLessonStore,type TenantContext,type PrivateObjectStoragePort,type SpeechSynthesisPort,type LessonRenderManifest,isCurrentLessonRenderManifest} from '@medical-device/contracts';
import {renderLessonJob} from './lesson-render-job.js';
import type {LessonSoundAsset} from './lesson-audio.js';
import {createCachedLessonSpeech} from './lesson-speech-cache.js';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Per-attempt paths prevent an expired worker from overwriting the winner's objects. */
export async function processHostedLessonRenderJob(input:{jobStore:JobStorePort;store:HostedLessonStore;storage:PrivateObjectStoragePort;speech:SpeechSynthesisPort;tenant:TenantContext;jobId:string;workerId:string;ffmpeg?:string;ffprobe?:string;render?:typeof renderLessonJob;signal?:AbortSignal}){
  const stored=await input.jobStore.get<HostedLessonPayload>(input.tenant,input.jobId);
  if(stored?.jobType!=='lesson.render'||stored.tenant.organizationId!==input.tenant.organizationId)return null;
  const job=await input.jobStore.claim<HostedLessonPayload>(input.tenant,input.jobId,input.workerId,undefined,900);
  if(!job)return null;
  const lease=job.leaseGeneration??0,controller=new AbortController();
  const signal=input.signal?AbortSignal.any([controller.signal,input.signal]):controller.signal;
  const deadline=setTimeout(()=>controller.abort(Error('LESSON_RENDER_TIMEOUT')),840_000);
  let directory:string|undefined,polling=false;
  const checkpoint=async()=>{
    signal.throwIfAborted();
    const current=await input.jobStore.get(input.tenant,input.jobId);
    if(current?.state!=='RUNNING'||current.leaseOwner!==input.workerId||current.leaseGeneration!==lease||current.operatorMetadata?.cancelled===true)throw Error('LESSON_RENDER_LEASE_LOST');
  };
  const poll=setInterval(()=>{if(!polling){polling=true;void checkpoint().catch(error=>controller.abort(error)).finally(()=>{polling=false;});}},2_000);
  try{
    if(job.operatorMetadata?.cancelled===true)throw Error('LESSON_RENDER_CANCELLED');
    await input.store.assertCurrent(job.tenant,job.payload);
    directory=await mkdtemp(join(tmpdir(),'hosted-lesson-'));
    const assets:Record<string,LessonSoundAsset>={};
    for(const [index,asset]of job.payload.assets.entries()){
      await checkpoint();
      if(!asset.blobKey.startsWith(job.tenant.organizationId+'/')||asset.sizeBytes>128*1024*1024)throw Error('LESSON_RENDER_ASSET_INVALID');
      const object=await input.storage.readObject({blobKey:asset.blobKey,maxBytes:asset.sizeBytes});
      if(object.bytes.length!==asset.sizeBytes||sha(object.bytes)!==asset.sha256||object.contentType!==asset.contentType)throw Error('LESSON_RENDER_ASSET_HASH_MISMATCH');
      if(asset.sourceType==='image'||asset.sourceType==='video'){
        const path=join(directory,`asset-${index}.${asset.sourceType==='image'?'image':'mp4'}`);
        await writeFile(path,object.bytes);assets[asset.assetVersionId]={path,approved:true};
      }
    }
    const outputs=join(directory,'output');await mkdir(outputs);
    const narrationEvidence:Array<Record<string,unknown>>=[];
    const speech=createCachedLessonSpeech({speech:input.speech,storage:input.storage,organizationId:job.tenant.organizationId,courseVersionId:job.payload.courseVersionId,
      providerRevision:JSON.stringify({endpoint:process.env.AZURE_SPEECH_ENDPOINT??'configured-provider',revision:process.env.LESSON_SPEECH_CACHE_REVISION??'azure-speech-v1'}),checkpoint,
      onResult:({request,result,reused})=>narrationEvidence.push({requestId:request.requestId,provider:result.provider.name,voice:result.provider.voice,scriptSha256:sha(Buffer.from(request.text)),deliverySha256:sha(Buffer.from(JSON.stringify(request.delivery??{}))),audioSha256:sha(result.audio.bytes),reused})});
    const manifest=await (input.render??renderLessonJob)({lesson:structuredClone(job.payload.lesson),mode:job.payload.mode,assets,speech,outputDirectory:outputs,ffmpeg:input.ffmpeg,ffprobe:input.ffprobe,signal,checkpoint});
    await checkpoint();await input.store.assertCurrent(job.tenant,job.payload);
    if(!isCurrentLessonRenderManifest(manifest,job.payload.lesson)||manifest.mode!==job.payload.mode)throw Error('LESSON_RENDER_MANIFEST_INVALID');
    const [video,captions]=await Promise.all([readFile(manifest.outputPath),readFile(manifest.captionsPath)]);
    if(!video.length||video.length>128*1024*1024||captions.length>1024*1024||sha(video)!==manifest.sha256||sha(captions)!==manifest.captionsSha256)throw Error('LESSON_RENDER_OUTPUT_INVALID');
    const prefix=`${job.tenant.organizationId}/derived/lessons/${encodeURIComponent(job.jobId)}/lease-${lease}`;
    const saved:LessonRenderManifest={...manifest,outputPath:`${prefix}/lesson.mp4`,captionsPath:`${prefix}/captions.vtt`};
    const manifestBytes=Buffer.from(JSON.stringify(saved));
    await checkpoint();
    await input.storage.putObject({blobKey:saved.outputPath,bytes:video,contentType:'video/mp4'});
    await checkpoint();
    await input.storage.putObject({blobKey:saved.captionsPath,bytes:captions,contentType:'text/vtt'});
    await checkpoint();
    await input.storage.putObject({blobKey:`${prefix}/manifest.json`,bytes:manifestBytes,contentType:'application/json'});
    await checkpoint();
    const outcome={adapter:'lesson-compositor',adapterVersion:'hosted-lesson-render.v1',status:'REVIEW_REQUIRED' as const,outputArtifactIds:[saved.outputPath,saved.captionsPath,`${prefix}/manifest.json`],warnings:[{code:'LESSON_RENDER_REVIEW_REQUIRED',severity:'warning' as const,message:'Review the complete rendered video and narration independently before publication.'}],metrics:{outputBytes:video.length+captions.length+manifestBytes.length,narrationCacheHits:narrationEvidence.filter(e=>e.reused===true).length,narrationSyntheses:narrationEvidence.filter(e=>e.reused===false).length},details:{manifest:saved,manifestSha256:sha(manifestBytes),videoBytes:video.length,narrationEvidence,courseVersionId:job.payload.courseVersionId,lessonId:job.payload.lessonId,assetVersionId:`assetv_lesson_${sha(Buffer.from(job.jobId+':'+lease))}`}};
    if(!await input.store.complete(job.tenant,job.jobId,input.workerId,lease,saved,outcome))return null;
    return input.jobStore.get(job.tenant,job.jobId);
  }catch(error){
    const message=error instanceof Error?error.message:'LESSON_RENDER_FAILED';
    const code=/^LESSON_RENDER_[A-Z_]+/.exec(message)?.[0]??'LESSON_RENDER_FAILED';
    const retryable=['LESSON_RENDER_PROCESS_FAILED','LESSON_RENDER_FAILED'].includes(code)&&!signal.aborted;
    return input.jobStore.fail(job.tenant,job.jobId,input.workerId,lease,{class:retryable?'RETRYABLE':'VALIDATION',code,message:'Lesson rendering failed; no artifact was approved.',...(retryable?{retryAfterSeconds:30}:{})});
  }finally{
    clearTimeout(deadline);clearInterval(poll);controller.abort();
    if(directory)await rm(directory,{recursive:true,force:true});
  }
}
