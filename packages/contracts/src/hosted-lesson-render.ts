import type {JobRecord, TenantContext, JobOutcome} from './common.js';
import type {LessonRenderManifest} from './lesson-render.js';

export interface HostedLessonRequest {courseVersionId:string; revision:number; lessonId:string; mode:'rough-cut'|'final'; idempotencyKey:string}
export interface HostedLessonCorrectedTakeRequest {courseVersionId:string;revision:number;lessonId:string;sceneId:string;assetVersionId:string;sourceHash:string;reason:string;idempotencyKey:string}
export interface HostedLessonAsset {assetVersionId:string; blobKey:string; sha256:string; contentType:string; sizeBytes:number; sourceType:string}
export interface HostedLessonPayload extends Omit<HostedLessonRequest,'idempotencyKey'> {schemaVersion:'hosted-lesson-render.v1'; lesson:Record<string,unknown>; assets:HostedLessonAsset[]}
export interface HostedLessonStore {
  admit(tenant:TenantContext, request:HostedLessonRequest):Promise<JobRecord<HostedLessonPayload>>;
  /** Rechecks saved revision and rights; called before expensive work and delivery. */
  assertCurrent(tenant:TenantContext,payload:HostedLessonPayload):Promise<void>;
  assertArtifactCurrent(tenant:TenantContext,payload:HostedLessonPayload,manifest:LessonRenderManifest):Promise<void>;
  complete(tenant:TenantContext,jobId:string,workerId:string,lease:number,manifest:LessonRenderManifest,outcome:JobOutcome):Promise<boolean>;
  cancel(tenant:TenantContext,jobId:string,reason?:string):Promise<boolean>;
  promoteCorrectedTake(tenant:TenantContext,request:HostedLessonCorrectedTakeRequest):Promise<{revision:number;assetVersionId:string}>;
}
export function validateHostedCorrectedTakeRequest(value:unknown):HostedLessonCorrectedTakeRequest {
 const v=value as Record<string,unknown>,id=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(s);
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(key=>!['courseVersionId','revision','lessonId','sceneId','assetVersionId','sourceHash','reason','idempotencyKey'].includes(key))||!['courseVersionId','lessonId','sceneId','assetVersionId','idempotencyKey'].every(key=>id(v[key]))||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceHash)||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>2000)throw Error('LESSON_TAKE_REQUEST_INVALID');
 return {...v,reason:v.reason.trim()} as unknown as HostedLessonCorrectedTakeRequest;
}
export function validateHostedLessonRequest(value:unknown):HostedLessonRequest {
  const v=value as Record<string,unknown>;
  const id=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(s);
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(key=>!['courseVersionId','revision','lessonId','mode','idempotencyKey'].includes(key))||!id(v.courseVersionId)||!id(v.lessonId)||!id(v.idempotencyKey)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||!['rough-cut','final'].includes(String(v.mode)))throw Error('LESSON_RENDER_REQUEST_INVALID');
  return {courseVersionId:String(v.courseVersionId),revision:Number(v.revision),lessonId:String(v.lessonId),mode:v.mode as HostedLessonRequest['mode'],idempotencyKey:String(v.idempotencyKey)};
}
/** Assets are resolved by the database, never by author-supplied filesystem paths. */
export function hostedLessonAssetIds(lesson:Record<string,unknown>):string[] {
  // Local scene-take files are developer artifacts. They must be uploaded and approved as private media first.
  if(lesson.sceneTakes!==undefined)throw Error('LESSON_RENDER_LOCAL_TAKES_FORBIDDEN');
  const ids=new Set<string>();
  const visit=(value:unknown):void=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    for(const [key,item]of Object.entries(value)){
      if(key==='assetVersionId'){
        if(typeof item!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(item))throw Error('LESSON_RENDER_ASSET_INVALID');
        ids.add(item);
      }else visit(item);
    }
  };
  for(const key of ['scenes','citations','referencePack','briefSnapshot'])visit(lesson[key]);
  if(!ids.size||ids.size>64)throw Error('LESSON_RENDER_ASSET_INVALID');
  return [...ids].sort();
}
