import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { TenantContext } from '@medical-device/contracts';
import { validReleaseChange } from '@medical-device/simulation-schema';
import { withTenantTransaction } from './tenant-transaction.js';
import { assignEnrollmentInTransaction } from './enrollment-assignment.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createCourseChangeNotificationStore(pool:Pool){return {
  async process(tenant:TenantContext,eventId:string){return withTenantTransaction(pool,tenant,async client=>{
    const event=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type IN ('course.change.notify','course.change.assign') AND state='PENDING' AND available_at<=now() FOR UPDATE SKIP LOCKED`,[tenant.organizationId,eventId])).rows[0];
    if(!event)return {state:'SKIPPED',delivered:0};
    await client.query('SAVEPOINT notification_batch');
    try{
      const release=(await client.query(`SELECT r.*,now() AS observed_at,s.course_version_id AS source_version FROM release_manifests r JOIN release_manifests s ON s.organization_id=r.organization_id AND s.release_id=r.manifest->'content'->'_lineage'->>'sourceReleaseId'
        AND s.release_hash=r.manifest->'content'->'_lineage'->>'sourceReleaseHash'
        WHERE r.organization_id=$1 AND r.release_id=$2 AND r.release_hash=$3 AND r.status='PUBLISHED'`,[tenant.organizationId,event.payload.releaseId,event.payload.releaseHash])).rows[0];
      const content=release?.manifest?.content,change=content?.releaseChange;
      if(!release||!validReleaseChange(change,content.modules??[]))throw Error('COURSE_CHANGE_INVALID');
      const assigning=event.event_type==='course.change.assign';
      if(assigning&&!['full_retake','supersede_on_completion','update_modules'].includes(change.decision))throw Error('COURSE_CHANGE_INVALID');
      if(assigning&&Date.parse(change.effectiveAt)>new Date(release.observed_at).getTime()){
        await client.query(`UPDATE outbox_events SET available_at=$3 WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,change.effectiveAt]);
        return {state:'SCHEDULED',delivered:0};
      }
      const recipients=(await client.query(`SELECT learner_id FROM (
        SELECT learner_id FROM enrollments WHERE organization_id=$1 AND course_version_id=$2 AND created_at<=$3
        UNION SELECT learner_id FROM credentials WHERE organization_id=$1 AND course_version_id=$2 AND created_at<=$3
      ) recipients WHERE ($4::text IS NULL OR learner_id>$4) ORDER BY learner_id LIMIT 51`,[tenant.organizationId,release.source_version,event.created_at,event.payload.afterRecipient??null])).rows;
      let delivered=0,skipped=0;
      for(const {learner_id} of recipients.slice(0,50)){
        if(assigning){
          let enrollmentId:string|undefined,skipReason:string|undefined;
          try{enrollmentId=(await assignEnrollmentInTransaction(client,tenant,learner_id,release.release_id)).enrollmentId;}
          catch(error){const code=error instanceof Error?error.message:'';if(!['ENROLLMENT_MEMBER_REQUIRED','ENROLLMENT_INACTIVE'].includes(code))throw error;skipReason=code;}
          const key=digest(['assignment',release.release_id,learner_id]);
          await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,$4,'release_manifest',$5,$6::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`,['requalification:'+key,tenant.organizationId,tenant.actorId??'requalification-worker',skipReason?'COURSE_REQUALIFICATION_SKIPPED':'COURSE_REQUALIFICATION_ASSIGNED',release.release_id,JSON.stringify({learnerId:learner_id,enrollmentId,skipReason,sourceReleaseId:content._lineage.sourceReleaseId,decision:change.decision})]);
          if(skipReason){skipped++;continue;}
          const inserted=await client.query(`INSERT INTO notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at) VALUES($1,$2,$3,'COURSE_RETRAINING_ASSIGNMENT',$4::jsonb,$5,now()) ON CONFLICT(organization_id,idempotency_key) DO NOTHING RETURNING notification_id`,['notice:'+key,tenant.organizationId,learner_id,JSON.stringify({title:content.title,releaseId:release.release_id,enrollmentId,releaseNotes:change.releaseNotes,message:change.learnerMessage,effectiveAt:change.effectiveAt,decision:change.decision}),`course-assignment:${key}`]);
          delivered+=inserted.rowCount??0;continue;
        }
        const key=digest([release.release_id,learner_id]);
        const inserted=await client.query(`INSERT INTO notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at)
          VALUES($1,$2,$3,'COURSE_CHANGE',$4::jsonb,$5,now()) ON CONFLICT(organization_id,idempotency_key) DO NOTHING RETURNING notification_id`,['notice:'+key,tenant.organizationId,learner_id,JSON.stringify({title:content.title,releaseId:release.release_id,sourceReleaseId:content._lineage.sourceReleaseId,releaseNotes:change.releaseNotes,message:change.learnerMessage,effectiveAt:change.effectiveAt,decision:change.decision}),`course-change:${key}`]);
        delivered+=inserted.rowCount??0;
      }
      const state=recipients.length>50?'PENDING':'PUBLISHED';
      const payload={...event.payload,...(recipients.length?{afterRecipient:recipients[Math.min(recipients.length,50)-1].learner_id}:{}),deliveredCount:(event.payload.deliveredCount??0)+delivered,skippedCount:(event.payload.skippedCount??0)+skipped};
      await client.query(`UPDATE outbox_events SET state=$3,payload=$4::jsonb,attempt_count=0,last_error_code=NULL,available_at=now(),updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,state,JSON.stringify(payload)]);
      if(state==='PUBLISHED')await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,$6,'release_manifest',$4,$5::jsonb,now())`,['notice-audit:'+digest(eventId),tenant.organizationId,tenant.actorId??'notification-worker',release.release_id,JSON.stringify({deliveredCount:payload.deliveredCount,skippedCount:payload.skippedCount,sourceReleaseId:content._lineage.sourceReleaseId}),assigning?'COURSE_REQUALIFICATION_APPLIED':'COURSE_CHANGE_NOTICES_DELIVERED']);
      await client.query('RELEASE SAVEPOINT notification_batch');return {state,delivered};
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT notification_batch');
      const code=error instanceof Error&&error.message==='COURSE_CHANGE_INVALID'?'COURSE_CHANGE_INVALID':'NOTIFICATION_DELIVERY_FAILED';
      const changed=await client.query(`UPDATE outbox_events SET attempt_count=attempt_count+1,state=CASE WHEN attempt_count>=4 THEN 'FAILED' ELSE 'PENDING' END,last_error_code=$3,available_at=now()+interval '30 seconds',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2 RETURNING state`,[tenant.organizationId,eventId,code]);
      return {state:changed.rows[0].state,delivered:0,errorCode:code};
    }
  });}
};}
