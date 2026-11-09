import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { TenantContext } from '@medical-device/contracts';
import { withTenantTransaction } from '@medical-device/db';
import { enrollmentEligibility } from './certification-eligibility.js';

const joined=`SELECT e.enrollment_id,e.learner_id,r.release_id,r.release_hash,r.manifest FROM enrollments e JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
 WHERE e.organization_id=$1 AND e.status IN ('ACTIVE','COMPLETED') AND r.status='PUBLISHED'`;
export function createAttemptReviewService(pool:Pool){return {
  async list(tenant:TenantContext,learnerId:string,after?:string,mode:'review'|'reset'='review'){
    if(!learnerId || learnerId.length>256 || (after!==undefined && !/^[A-Za-z0-9._:-]{1,128}$/.test(after)))throw Error('REVIEW_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const rows=await client.query(`${joined} AND e.learner_id=$2 AND ($3::text IS NULL OR e.enrollment_id>$3) ORDER BY e.enrollment_id LIMIT 51`,[tenant.organizationId,learnerId,after??null]);
      const items=[];
      for(const row of rows.rows.slice(0,50)){
        const content=row.manifest.content;
        const eligibility=await enrollmentEligibility(client,{...tenant,actorId:learnerId},row.enrollment_id,row.release_id,row.release_hash,content);
        for(const activity of eligibility.activities)if(mode==='reset'?activity.canReset:activity.reviewRequired)items.push({enrollmentId:row.enrollment_id,activityId:activity.activityId,title:content.title,activityTitle:content.modules.flatMap((m:Record<string,any>)=>m.activities??[]).find((a:Record<string,any>)=>a.activityId===activity.activityId)?.title??activity.activityId,throughAttempt:activity.latestAttemptNumber,maxAttempts:activity.maxAttempts,attemptsUsed:activity.attemptsUsed});
      }
      return {items,nextCursor:rows.rows.length>50?rows.rows[49].enrollment_id:null};
    });
  },
  async resolve(tenant:TenantContext,enrollmentId:string,activityId:string,request:{reason:string;throughAttempt:number;idempotencyKey:string;action?:'reset'}){
    if(![enrollmentId,activityId,request.idempotencyKey].every(v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v)) || typeof request.reason!=='string' || !request.reason.trim() || request.reason.length>2000 || !Number.isSafeInteger(request.throughAttempt)||request.throughAttempt<1)throw Error('REVIEW_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify([tenant.organizationId,tenant.actorId,request.idempotencyKey])]);
      const row=(await client.query(`${joined} AND e.enrollment_id=$2 FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,enrollmentId])).rows[0];if(!row)throw Error('REVIEW_NOT_FOUND');
      const eventId='review:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,request.idempotencyKey])).digest('hex');
      const reset=request.action==='reset',status=reset?'ALLOWANCE_RESET':'REVIEWED';
      const signature=JSON.stringify([enrollmentId,activityId,request.reason,request.throughAttempt,...(reset?['reset']:[])]);
      const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,eventId])).rows[0];
      if(prior){if(prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return {status};}
      const content=row.manifest.content;
      const eligibility=await enrollmentEligibility(client,{...tenant,actorId:row.learner_id},enrollmentId,row.release_id,row.release_hash,content);
      const activity=eligibility.activities.find(a=>a.activityId===activityId);
      if(!(reset?activity?.canReset:activity?.reviewRequired) || activity?.latestAttemptNumber!==request.throughAttempt)throw Error('REVIEW_CONFLICT');
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
        VALUES($1,$2,$3,$6,'enrollment',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,enrollmentId,JSON.stringify({signature,activityId,learnerId:row.learner_id,releaseId:row.release_id,releaseHash:row.release_hash,policyId:content.policy.policyId,policyVersion:content.policy.version,throughAttempt:request.throughAttempt,reason:request.reason.trim(),...(reset?{grantedAttempts:content.policy.maxAttempts}: {})}),reset?'ATTEMPT_ALLOWANCE_RESET':'ATTEMPT_REVIEW_RESOLVED']);
      return {status};
    });
  }
};}
