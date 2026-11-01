import type { Pool } from 'pg';
import type { TenantContext } from '@medical-device/contracts';
import { withTenantTransaction } from '@medical-device/db';
import {createHash} from 'node:crypto';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const recoverableTypes=['course.change.assign','course.change.notify','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired','organization.invitation.deliver'];
const retryToken=(row:Record<string,any>)=>digest([row.outbox_event_id,row.state,row.attempt_count,row.updated_at,row.payload]);
export function createCourseChangeService(pool:Pool){return {
  async failedJobs(tenant:TenantContext,after?:string){
    if(after!==undefined&&!identifier(after))throw Error('COURSE_CHANGE_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const rows=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND event_type=ANY($2::text[]) AND state='FAILED' AND ($3::text IS NULL OR outbox_event_id>$3) ORDER BY outbox_event_id LIMIT 51`,[tenant.organizationId,recoverableTypes,after??null])).rows;
      const page=rows.slice(0,50);
      return {items:page.map(row=>({jobId:row.outbox_event_id,kind:row.event_type,state:row.state,attempts:row.attempt_count,errorCode:row.last_error_code,releaseId:typeof row.payload?.releaseId==='string'?row.payload.releaseId:null,processed:row.payload?.deliveredCount??0,skipped:row.payload?.skippedCount??0,retryToken:retryToken(row)})),nextCursor:rows.length>50?page[49].outbox_event_id:null};
    });
  },
  async retry(tenant:TenantContext,jobId:string,request:{reason:string;retryToken:string;idempotencyKey:string}){
    if(!identifier(jobId)||!identifier(request.idempotencyKey)||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>2000||!/^[a-f0-9]{64}$/.test(request.retryToken))throw Error('COURSE_CHANGE_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const eventId='job-retry:'+digest([tenant.organizationId,tenant.actorId,request.idempotencyKey]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[eventId]);
      const signature=digest([jobId,request.reason.trim(),request.retryToken]);
      const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,eventId])).rows[0];
      if(prior&&prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');
      const job=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type=ANY($3::text[]) FOR UPDATE`,[tenant.organizationId,jobId,recoverableTypes])).rows[0];
      if(!job)throw Error('COURSE_CHANGE_JOB_NOT_FOUND');
      if(prior)return {jobId,state:job.state,replayed:true};
      if(job.state!=='FAILED'||retryToken(job)!==request.retryToken)throw Error('COURSE_CHANGE_JOB_CHANGED');
      await client.query(`UPDATE outbox_events SET state='PENDING',attempt_count=0,last_error_code=NULL,available_at=now(),updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,jobId]);
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'COURSE_CHANGE_JOB_RETRIED','outbox_event',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,jobId,JSON.stringify({signature,reason:request.reason.trim(),previousAttempts:job.attempt_count,previousErrorCode:job.last_error_code,kind:job.event_type,retryToken:request.retryToken})]);
      return {jobId,state:'PENDING',replayed:false};
    });
  },
  async preview(tenant:TenantContext,releaseId:string,after?:string){
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(releaseId)||(after!==undefined&&(!after.length||after.length>256)))throw Error('COURSE_CHANGE_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const row=(await client.query(`SELECT r.*,s.course_version_id AS source_version FROM release_manifests r JOIN release_manifests s ON s.organization_id=r.organization_id AND s.release_id=r.manifest->'content'->'_lineage'->>'sourceReleaseId' AND s.release_hash=r.manifest->'content'->'_lineage'->>'sourceReleaseHash' WHERE r.organization_id=$1 AND r.release_id=$2 AND r.status='PUBLISHED'`,[tenant.organizationId,releaseId])).rows[0];
      if(!row)throw Error('COURSE_CHANGE_NOT_FOUND');
      const cohort=`SELECT learner_id FROM enrollments WHERE organization_id=$1 AND course_version_id=$2 AND created_at<=$3 UNION SELECT learner_id FROM credentials WHERE organization_id=$1 AND course_version_id=$2 AND created_at<=$3`;
      const parameters=[tenant.organizationId,row.source_version,row.created_at];
      const total=(await client.query(`SELECT count(*)::int total FROM (${cohort}) cohort`,parameters)).rows[0].total;
      const rows=(await client.query(`SELECT learner_id,
        EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=$1 AND m.subject=c.learner_id AND m.status='ACTIVE') active_member,
        (SELECT status FROM enrollments e WHERE e.organization_id=$1 AND e.learner_id=c.learner_id AND e.course_version_id=$4 ORDER BY (status='ACTIVE') DESC LIMIT 1) target_status,
        (SELECT count(*)::int FROM credentials cr WHERE cr.organization_id=$1 AND cr.learner_id=c.learner_id AND cr.course_version_id=$2) credential_count
        FROM (${cohort}) c WHERE ($5::text IS NULL OR learner_id>$5) ORDER BY learner_id LIMIT 51`,[...parameters,row.course_version_id,after??null])).rows;
      const jobs=(await client.query(`SELECT event_type,state,available_at,payload,attempt_count,last_error_code FROM outbox_events WHERE organization_id=$1 AND event_type IN ('course.change.assign','course.change.notify') AND payload->>'releaseId'=$2 ORDER BY event_type`,[tenant.organizationId,releaseId])).rows;
      return {releaseId,title:row.manifest.content.title,change:row.manifest.content.releaseChange,totalAffected:total,items:rows.slice(0,50).map(r=>({learnerId:r.learner_id,membershipActive:r.active_member,targetEnrollmentStatus:r.target_status,previousCredentialCount:r.credential_count})),nextCursor:rows.length>50?rows[49].learner_id:null,jobs:jobs.map(j=>({kind:j.event_type==='course.change.assign'?'assignments':'notices',state:j.state,nextAttemptAt:new Date(j.available_at).toISOString(),processed:j.payload.deliveredCount??0,skipped:j.payload.skippedCount??0,attempts:j.attempt_count,errorCode:j.last_error_code}))};
    });
  }
};}
