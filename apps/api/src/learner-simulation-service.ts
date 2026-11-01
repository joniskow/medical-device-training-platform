import {assertStoryActivityAccess} from '@medical-device/db';
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "@medical-device/db";
import type { ModelSessionService, ModelSessionStartRequest } from "./model-session-service.js";
import { reviewedAttempts } from './attempt-review-evidence.js';

export interface LearnerSimulationService { launch(tenant: TenantContext, enrollmentId: string, activityId: string): Promise<unknown> }
export function createLearnerSimulationService(pool: Pool, sessions: ModelSessionService): LearnerSimulationService {
  return { async launch(tenant,enrollmentId,activityId) {
    if (!tenant.actorId || ![enrollmentId,activityId].every(value=>/^[A-Za-z0-9._:-]{1,128}$/.test(value))) throw new Error("SIMULATION_REQUEST_INVALID");
    const request = await withTenantTransaction(pool,tenant,async client => {
      const result=await client.query(`SELECT r.release_id,r.release_hash,r.manifest FROM enrollments e JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
        WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status='ACTIVE' AND r.status='PUBLISHED' FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,enrollmentId,tenant.actorId]);
      if (!result.rows[0]) throw new Error("SIMULATION_NOT_FOUND");
      const row=result.rows[0], content=row.manifest.content;
      await assertStoryActivityAccess(client,tenant,enrollmentId,row.release_id,activityId);
      const bindings=content.runtimeBindings?.activities;
      const matches=Array.isArray(bindings)?bindings.filter((item:Record<string,unknown>)=>item.activityId===activityId):[];
      const binding=matches[0],policy=content.policy;
      if(matches.length!==1 || !binding.simulationDefinitionId || !binding.policyId || !content.model?.modelVersionId) throw new Error("SIMULATION_NOT_FOUND");
      if(!Number.isSafeInteger(policy?.maxAttempts) || policy.maxAttempts<1 || policy.maxAttempts>100
        || !Number.isSafeInteger(policy.cooldownSeconds) || policy.cooldownSeconds<0 || policy.cooldownSeconds>604800
        || !Number.isSafeInteger(policy.attemptTtlSeconds) || policy.attemptTtlSeconds<60 || policy.attemptTtlSeconds>86400) throw new Error("SIMULATION_POLICY_INVALID");
      const history=await client.query(`SELECT *, started_at+$5*interval '1 second'>CURRENT_TIMESTAMP AS unexpired,
        COALESCE(completed_at,started_at+$5*interval '1 second')+$6*interval '1 second'>CURRENT_TIMESTAMP AS cooling
        FROM simulation_attempts WHERE organization_id=$1 AND enrollment_id=$2 AND release_id=$3 AND activity_id=$4 ORDER BY attempt_number DESC`,[tenant.organizationId,enrollmentId,row.release_id,binding.runtimeActivityId,policy.attemptTtlSeconds,policy.cooldownSeconds]);
      const latest=history.rows[0];
      if(Number.isSafeInteger(policy.repeatedFailureReviewAfter) && policy.repeatedFailureReviewAfter>0){
        const reviewed=await reviewedAttempts(client,tenant,enrollmentId,row.release_id,row.release_hash,policy);
        const failures=await client.query(`SELECT count(*)::int AS count FROM simulation_attempts a JOIN progress_events p ON p.organization_id=a.organization_id AND p.progress_event_id='progress:'||a.simulation_attempt_id
          WHERE a.organization_id=$1 AND a.enrollment_id=$2 AND a.release_id=$3 AND a.activity_id=$4 AND a.attempt_number>$5 AND a.status='COMPLETED' AND p.payload->>'passed'='false'`,[tenant.organizationId,enrollmentId,row.release_id,binding.runtimeActivityId,reviewed[activityId]??0]);
        if(failures.rows[0].count>=policy.repeatedFailureReviewAfter)throw new Error("SIMULATION_REVIEW_REQUIRED");
      }
      let attemptId=latest?.simulation_attempt_id;
      if(!latest || latest.status!=="ACTIVE" || !latest.unexpired) {
        if(latest?.status==="ACTIVE") await client.query(`UPDATE simulation_attempts SET status='EXPIRED',updated_at=now() WHERE organization_id=$1 AND simulation_attempt_id=$2`,[tenant.organizationId,attemptId]);
        const resets=await reviewedAttempts(client,tenant,enrollmentId,row.release_id,row.release_hash,policy,true);
        if((latest?.attempt_number??0)-(resets[activityId]??0)>=policy.maxAttempts) throw new Error("SIMULATION_ATTEMPT_LIMIT");
        if(latest?.cooling) throw new Error("SIMULATION_COOLDOWN");
        attemptId=`attempt:${randomUUID()}`;
        await client.query(`INSERT INTO simulation_attempts(simulation_attempt_id,organization_id,enrollment_id,learner_id,release_id,activity_id,simulation_definition_id,model_version_id,policy_id,attempt_number,status,started_at,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',now(),now(),now())`,[attemptId,tenant.organizationId,enrollmentId,tenant.actorId,row.release_id,binding.runtimeActivityId,binding.simulationDefinitionId,content.model.modelVersionId,binding.policyId,(latest?.attempt_number??0)+1]);
      }
      return {releaseId:row.release_id,activityId:binding.runtimeActivityId,simulationDefinitionId:binding.simulationDefinitionId,modelVersionId:content.model.modelVersionId,enrollmentId,attemptId,policyId:binding.policyId,expiresInSeconds:policy.attemptTtlSeconds} satisfies ModelSessionStartRequest;
    });
    // A failed start can retry the same durable attempt and session key after the transaction commits.
    const key=`launch:${createHash("sha256").update(request.attemptId).digest("hex")}`;
    return sessions.start(tenant,request,key);
  }};
}
