import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {validateHostedCorrectedTakeRequest,type HostedLessonCorrectedTakeRequest,type TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Promote uploaded, decoded and independently approved private clips; never import a local path. */
export async function promotePrivateLessonTake(pool:Pool,tenant:TenantContext,value:HostedLessonCorrectedTakeRequest){
 const request=validateHostedCorrectedTakeRequest(value);
 if(!tenant.actorId)throw Error('LESSON_TAKE_ACTOR_REQUIRED');
 const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const eventId=`lesson-take:${digest([tenant.organizationId,tenant.actorId,request.idempotencyKey])}`,signature=digest([request.courseVersionId,request.revision,request.lessonId,request.sceneId,request.assetVersionId,request.sourceHash,request.reason]);
 return withTenantTransaction(pool,tenant,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[tenant.organizationId]);
  const previous=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,eventId])).rows[0];
  if(previous){if(previous.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return previous.details.result as {revision:number;assetVersionId:string};}
  const row=(await client.query(`SELECT revision,status,content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR UPDATE`,[tenant.organizationId,request.courseVersionId])).rows[0];
  if(!row||row.revision!==request.revision||!['DRAFT','IN_REVIEW'].includes(row.status))throw Error('LESSON_TAKE_REVISION_STALE');
  const content=structuredClone(row.content),lessons=Array.isArray(content.videoLessons)?content.videoLessons:[],matches=lessons.filter((v:unknown)=>object(v)&&v.lessonId===request.lessonId);
  if(matches.length!==1)throw Error('LESSON_TAKE_LESSON_NOT_FOUND');
  const lesson=matches[0],scenes=Array.isArray(lesson.scenes)?lesson.scenes:[],sceneMatches=scenes.filter((v:unknown)=>object(v)&&v.sceneId===request.sceneId);
  if(sceneMatches.length!==1)throw Error('LESSON_TAKE_SCENE_NOT_FOUND');
  const scene=sceneMatches[0],duration=scene.endSeconds-scene.startSeconds;
  if(!Number.isFinite(duration)||duration<=0||duration>300)throw Error('LESSON_TAKE_SCENE_INVALID');
  const asset=(await client.query(`SELECT a.asset_version_id,a.sha256,a.blob_key,a.created_by FROM asset_versions a JOIN assets parent ON parent.organization_id=a.organization_id AND parent.asset_id=a.asset_id
   WHERE a.organization_id=$1 AND a.asset_version_id=$2 AND a.sha256=$3 AND a.source_type='video' AND a.state='APPROVED' AND parent.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED') AND NOT public.lifecycle_asset_suppressed(a.asset_version_id)
    AND EXISTS(SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=a.organization_id AND r.asset_version_id=a.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed)
    AND NOT EXISTS(SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=a.organization_id AND r.asset_version_id=a.asset_version_id AND r.status<>'ACTIVE') FOR SHARE OF a,parent`,[tenant.organizationId,request.assetVersionId,request.sourceHash])).rows[0];
  if(!asset||!asset.blob_key.startsWith(tenant.organizationId+'/')||asset.blob_key.includes('\\')||asset.blob_key.split('/').some((p:string)=>p==='..'||p==='.'))throw Error('LESSON_TAKE_ASSET_NOT_APPROVED');
  const review=(await client.query(`SELECT audit_event_id,actor_id,details FROM audit_events WHERE organization_id=$1 AND resource_type='asset_version' AND resource_id=$2 AND event_type='SOURCE_REVIEW_DECISION' ORDER BY created_at DESC,audit_event_id DESC LIMIT 1`,[tenant.organizationId,request.assetVersionId])).rows[0];
  if(!review||review.actor_id===tenant.actorId||review.actor_id===asset.created_by||review.details.decision!=='APPROVE'||review.details.sourceHash!==request.sourceHash)throw Error('LESSON_TAKE_INDEPENDENT_REVIEW_REQUIRED');
  const inspection=(await client.query(`SELECT outcome->'details' AS report FROM processing_jobs WHERE organization_id=$1 AND input_asset_version_id=$2 AND state='SUCCEEDED' AND outcome->>'adapter'='media-inspection' AND outcome->'details'->>'sourceSha256'=$3 ORDER BY updated_at DESC LIMIT 1`,[tenant.organizationId,request.assetVersionId,request.sourceHash])).rows[0]?.report;
  if(!inspection||inspection.assetVersionId!==request.assetVersionId||inspection.decodeVerified!==true||typeof inspection.durationSeconds!=='number'||Math.abs(inspection.durationSeconds-duration)>0.1)throw Error('LESSON_TAKE_DECODE_OR_DURATION_INVALID');
  scene.visual={kind:'source_video',assetVersionId:request.assetVersionId,label:object(scene.visual)&&typeof scene.visual.label==='string'?scene.visual.label:'Reviewed corrected take',correctionEvidence:{sourceHash:request.sourceHash,reviewEventId:review.audit_event_id,startingCondition:lesson.direction?.beats?.find((b:Record<string,unknown>)=>b.sceneId===request.sceneId)?.startingCondition,result:lesson.direction?.beats?.find((b:Record<string,unknown>)=>b.sceneId===request.sceneId)?.result}};
  if(scene.audioMix?.speechOnly===false)delete scene.audioMix; // Old sound evidence cannot follow a different clip.
  for(const key of ['roughCut','previewAcceptance','renderArtifact','finalReview','render','renderOutput','audio','captions','directionReview','sceneTakes'])delete lesson[key];
  for(const variant of lessons)if(object(variant)&&variant.variantIdentity?.sourceLessonId===request.lessonId){
   variant.generationStatus='STALE';variant.staleReason='A corrected source take changed the parent lesson.';
   for(const key of ['roughCut','previewAcceptance','renderArtifact','finalReview','directionReview','sceneTakes','audio','captions'])delete variant[key];
  }
  const result={revision:request.revision+1,assetVersionId:request.assetVersionId};
  await client.query(`UPDATE course_versions SET content=$3::jsonb,revision=revision+1,status='DRAFT',updated_at=now() WHERE organization_id=$1 AND course_version_id=$2`,[tenant.organizationId,request.courseVersionId,JSON.stringify(content)]);
  await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'LESSON_CORRECTED_TAKE_PROMOTED','course_version',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,request.courseVersionId,JSON.stringify({signature,result,request,reviewEventId:review.audit_event_id,correlationId:tenant.correlationId,before:row.content,after:content,revision:request.revision,nextRevision:result.revision})]);
  return result;
 });
}
