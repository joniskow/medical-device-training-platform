import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {currentPreviewAccepted,hostedLessonAssetIds,isCurrentLessonRenderManifest,lessonRenderRevision,validateHostedLessonRequest,type HostedLessonPayload,type HostedLessonStore,type HostedLessonRequest,type TenantContext,type HostedLessonAsset} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {enqueuePostgresJob} from './job-store.js';
import {promotePrivateLessonTake} from './lesson-corrected-take.js';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
async function snapshot(client:PoolClient,tenant:TenantContext,request:Omit<HostedLessonRequest,'idempotencyKey'>):Promise<HostedLessonPayload>{
  const row=(await client.query(`SELECT revision,status,content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR SHARE`,[tenant.organizationId,request.courseVersionId])).rows[0];
  if(!row||row.revision!==request.revision||!['DRAFT','IN_REVIEW'].includes(row.status))throw Error('LESSON_RENDER_REVISION_STALE');
  const lessons=row.content.videoLessons;
  const found=Array.isArray(lessons)?lessons.filter((v:unknown)=>object(v)&&v.lessonId===request.lessonId):[];
  if(found.length!==1||!object(found[0]))throw Error('LESSON_RENDER_LESSON_NOT_FOUND');
  const lesson=found[0];
  if(request.mode==='final'&&!currentPreviewAccepted(lesson))throw Error('LESSON_RENDER_CURRENT_PREVIEW_REQUIRED');
  const ids=hostedLessonAssetIds(lesson);
  // Withdrawal takes an exclusive row lock; hold rights rows until admission/completion commits.
  await client.query(`SELECT attestation_id FROM asset_rights_attestations WHERE organization_id=$1 AND asset_version_id=ANY($2::text[]) FOR SHARE`,[tenant.organizationId,ids]);
  const rows=(await client.query(`SELECT a.asset_version_id,a.blob_key,a.sha256,a.content_type,a.size_bytes,a.source_type FROM asset_versions a
    WHERE a.organization_id=$1 AND a.asset_version_id=ANY($2::text[]) AND a.state='APPROVED'
    AND EXISTS(SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=a.organization_id AND r.asset_version_id=a.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed)
    AND NOT EXISTS(SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=a.organization_id AND r.asset_version_id=a.asset_version_id AND r.status IN ('WITHDRAWN','EXPIRED'))
    ORDER BY a.asset_version_id FOR SHARE OF a`,[tenant.organizationId,ids])).rows;
  if(rows.length!==ids.length)throw Error('LESSON_RENDER_ASSET_NOT_APPROVED');
  const assets:HostedLessonAsset[]=rows.map(a=>({assetVersionId:a.asset_version_id,blobKey:a.blob_key,sha256:a.sha256,contentType:a.content_type,sizeBytes:Number(a.size_bytes),sourceType:a.source_type}));
  for(const asset of assets)if(!asset.blobKey.startsWith(tenant.organizationId+'/')||asset.blobKey.includes('\\')||asset.blobKey.split('/').some(p=>p==='..'||p==='.')||!Number.isSafeInteger(asset.sizeBytes)||asset.sizeBytes<1||asset.sizeBytes>128*1024*1024)throw Error('LESSON_RENDER_ASSET_INVALID');
  if(assets.reduce((sum,a)=>sum+a.sizeBytes,0)>256*1024*1024)throw Error('LESSON_RENDER_ASSET_BUDGET_EXCEEDED');
  return {schemaVersion:'hosted-lesson-render.v1',...request,lesson,assets};
}
async function assertSnapshot(client:PoolClient,tenant:TenantContext,payload:HostedLessonPayload){
  const current=await snapshot(client,tenant,payload);
  if(lessonRenderRevision(current.lesson)!==lessonRenderRevision(payload.lesson)||hash(current.assets)!==hash(payload.assets))throw Error('LESSON_RENDER_REVISION_STALE');
  return current;
}
/** Job, input snapshot and outbox admission commit together. Completion fences the lease and edits atomically. */
export function createLessonRenderStore(pool:Pool):HostedLessonStore {
  return {
    promoteCorrectedTake:(tenant,request)=>promotePrivateLessonTake(pool,tenant,request),
    async admit(tenant,value){
      if(!tenant.actorId)throw Error('LESSON_RENDER_ACTOR_REQUIRED');
      const request=validateHostedLessonRequest(value);
      return withTenantTransaction(pool,tenant,async client=>{
        const key=`lesson-render:${tenant.organizationId}:${request.idempotencyKey}`,requestHash=hash(request);
        const existing=(await client.query(`SELECT request_hash FROM processing_jobs WHERE organization_id=$1 AND idempotency_key=$2`,[tenant.organizationId,key])).rows[0];
        if(existing&&existing.request_hash!==requestHash)throw Error('IDEMPOTENCY_KEY_REUSED');
        // A replay after completion must return the original job even though completion increments the course revision.
        const prior=(await client.query(`SELECT payload FROM processing_jobs WHERE organization_id=$1 AND idempotency_key=$2`,[tenant.organizationId,key])).rows[0];
        const payload=prior?.payload??await snapshot(client,tenant,request);
        return enqueuePostgresJob(client,{jobId:`job_lesson_${hash(key)}`,jobType:'lesson.render',tenant,payload,attempt:1,maxAttempts:3,idempotency:{key,requestHash},timeoutSeconds:900,codeVersion:'hosted-lesson-render.v1'});
      });
    },
    async assertCurrent(tenant,payload){await withTenantTransaction(pool,tenant,client=>assertSnapshot(client,tenant,payload));},
    async assertArtifactCurrent(tenant,payload,manifest){
      await withTenantTransaction(pool,tenant,async client=>{
        const row=(await client.query(`SELECT revision FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR SHARE`,[tenant.organizationId,payload.courseVersionId])).rows[0];
        if(!row)throw Error('LESSON_RENDER_REVISION_STALE');
        const current=await snapshot(client,tenant,{...payload,revision:row.revision});
        const attached=current.lesson[payload.mode==='rough-cut'?'roughCut':'renderArtifact'];
        if(!object(attached)||attached.sha256!==manifest.sha256||!isCurrentLessonRenderManifest(manifest,current.lesson)||hash(current.assets)!==hash(payload.assets))throw Error('LESSON_RENDER_REVISION_STALE');
      });
    },
    async complete(tenant,jobId,workerId,lease,manifest,outcome){
      return withTenantTransaction(pool,tenant,async client=>{
        const job=(await client.query(`SELECT payload FROM processing_jobs WHERE organization_id=$1 AND job_id=$2 AND job_type='lesson.render' AND state='RUNNING' AND lease_owner=$3 AND lease_generation=$4 AND lease_expires_at>now() AND NOT COALESCE((operator_metadata->>'cancelled')::boolean,false) FOR UPDATE`,[tenant.organizationId,jobId,workerId,lease])).rows[0];
        if(!job)return false;
        const payload=job.payload as HostedLessonPayload;
        // Lock the editable course before all approval checks to prevent lost edits.
        const course=(await client.query(`SELECT content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR UPDATE`,[tenant.organizationId,payload.courseVersionId])).rows[0];
        await assertSnapshot(client,tenant,payload);
        if(!isCurrentLessonRenderManifest(manifest,payload.lesson)||manifest.mode!==payload.mode)throw Error('LESSON_RENDER_MANIFEST_INVALID');
        const content=course.content;
        const videoBytes=outcome.details?.videoBytes,assetVersionId=outcome.details?.assetVersionId;
        const expectedAssetId=`assetv_lesson_${createHash('sha256').update(jobId+':'+lease).digest('hex')}`;
        const prefix=`${tenant.organizationId}/derived/lessons/${encodeURIComponent(jobId)}/lease-${lease}`;
        if(assetVersionId!==expectedAssetId||!Number.isSafeInteger(videoBytes)||Number(videoBytes)<1||Number(videoBytes)>128*1024*1024||manifest.outputPath!==`${prefix}/lesson.mp4`||manifest.captionsPath!==`${prefix}/captions.vtt`)throw Error('LESSON_RENDER_ARTIFACT_BINDING_INVALID');
        const assetId=`asset_lesson_${createHash('sha256').update(jobId+':'+lease).digest('hex')}`;
        await client.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'video','READY_FOR_REVIEW',$3,$3,now(),now())`,[assetId,tenant.organizationId,tenant.actorId??workerId]);
        await client.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'video',$4,'lesson.mp4','video/mp4',$5,$6,'READY_FOR_REVIEW',$7,now(),now())`,[assetVersionId,assetId,tenant.organizationId,manifest.outputPath,videoBytes,manifest.sha256,tenant.actorId??workerId]);
        const lesson=content.videoLessons.find((v:Record<string,unknown>)=>v.lessonId===payload.lessonId);
        delete lesson.finalReview;delete lesson.publishBinding;
        if(payload.mode==='rough-cut'){lesson.roughCut=manifest;delete lesson.previewAcceptance;delete lesson.renderArtifact;}else lesson.renderArtifact=manifest;
        await client.query(`UPDATE course_versions SET content=$3::jsonb,revision=revision+1,status='DRAFT',updated_at=now() WHERE organization_id=$1 AND course_version_id=$2`,[tenant.organizationId,payload.courseVersionId,JSON.stringify(content)]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'LESSON_RENDER_ATTACHED','course_version',$4,$5::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId??workerId,payload.courseVersionId,JSON.stringify({jobId,lessonId:payload.lessonId,revision:payload.revision,mode:payload.mode,sha256:manifest.sha256,captionsSha256:manifest.captionsSha256})]);
        await client.query(`UPDATE processing_jobs SET state='SUCCEEDED',outcome=$3::jsonb,output_artifact_ids=$4,adapter_version='hosted-lesson-render.v1',lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND job_id=$2`,[tenant.organizationId,jobId,JSON.stringify(outcome),outcome.outputArtifactIds]);
        return true;
      });
    },
    async cancel(tenant,jobId,reason='Author requested cancellation'){
      if(!tenant.actorId||typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('LESSON_RENDER_CANCEL_REASON_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`UPDATE processing_jobs SET state='FAILED',lease_generation=lease_generation+1,lease_expires_at=NULL,error_class='TERMINAL',last_failure=$3::jsonb,operator_metadata=COALESCE(operator_metadata,'{}'::jsonb)||'{"cancelled":true}'::jsonb,updated_at=now() WHERE organization_id=$1 AND job_id=$2 AND job_type='lesson.render' AND state IN ('QUEUED','RUNNING','RETRY_SCHEDULED')`,[tenant.organizationId,jobId,JSON.stringify({class:'TERMINAL',code:'LESSON_RENDER_CANCELLED',message:'Rendering was cancelled by an authorized author.'})]);
        if(result.rowCount)await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'LESSON_RENDER_CANCELLED','processing_job',$4,$5::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,jobId,JSON.stringify({reason:reason.trim(),correlationId:tenant.correlationId})]);
        return result.rowCount===1;
      });
    }
  };
}
