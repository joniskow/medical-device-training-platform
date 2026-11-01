import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {issueCredentialInTransaction} from './credential-service.js';

export function createScheduledQualificationStore(pool:Pool){return {
  async process(tenant:TenantContext,eventId:string){return withTenantTransaction(pool,tenant,async client=>{
    const event=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type='credential.qualify' AND state='PENDING' AND available_at<=now() FOR UPDATE SKIP LOCKED`,[tenant.organizationId,eventId])).rows[0];
    if(!event)return {state:'SKIPPED'};
    await client.query('SAVEPOINT scheduled_qualification');
    try{
      const {learnerId,enrollmentId,releaseId,releaseHash}=event.payload;
      if(![learnerId,enrollmentId,releaseId,releaseHash].every(v=>typeof v==='string'&&v.length>0))throw Error('QUALIFICATION_EVENT_INVALID');
      const bound=(await client.query(`SELECT r.manifest FROM enrollments e JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
        WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status='ACTIVE' AND r.status='PUBLISHED' AND r.release_id=$4 AND r.release_hash=$5 FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,enrollmentId,learnerId,releaseId,releaseHash])).rows[0];
      let result:unknown=null;
      if(bound){
        const change=bound.manifest?.content?.releaseChange;
        if(!['supersede_on_completion','update_modules'].includes(change?.decision))throw Error('QUALIFICATION_EVENT_INVALID');
        const due=(await client.query(`SELECT $1::timestamptz<=now() AS due`,[change.effectiveAt])).rows[0].due;
        if(!due){await client.query(`UPDATE outbox_events SET available_at=$3 WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,change.effectiveAt]);return {state:'SCHEDULED'};}
        const member=await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND subject=$2 AND status='ACTIVE'`,[tenant.organizationId,learnerId]);
        if(member.rowCount){
          if(!(await client.query('SELECT public.has_verified_account($1) AS verified',[learnerId])).rows[0].verified){
            await client.query(`UPDATE outbox_events SET available_at=now()+interval '1 hour',last_error_code='CREDENTIAL_EMAIL_VERIFICATION_REQUIRED',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);
            return {state:'WAITING_FOR_VERIFICATION'};
          }
          result=await issueCredentialInTransaction(client,{...tenant,actorId:learnerId},enrollmentId,true);
        }
      }
      await client.query(`UPDATE outbox_events SET state='PUBLISHED',attempt_count=0,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
        VALUES($1,$2,$3,'SCHEDULED_QUALIFICATION_PROCESSED','enrollment',$4,$5::jsonb,now())`,[`qualification:${eventId}`,tenant.organizationId,tenant.actorId,enrollmentId,JSON.stringify({releaseId,learnerId,credentialId:(result as any)?.credentialId??null,outcome:result?'ISSUED_OR_EXISTING':'NO_LONGER_ELIGIBLE'})]);
      return {state:'PUBLISHED'};
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT scheduled_qualification');
      const attempts=event.attempt_count+1,state=attempts>=5?'FAILED':'PENDING';
      const code=error instanceof Error&&['QUALIFICATION_EVENT_INVALID','CREDENTIAL_CHANGE_INVALID'].includes(error.message)?error.message:'QUALIFICATION_PROCESSING_FAILED';
      await client.query(`UPDATE outbox_events SET state=$3,attempt_count=$4,last_error_code=$5,available_at=now()+interval '30 seconds',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,state,attempts,code]);
      return {state,errorCode:code};
    }
  });}
};}
