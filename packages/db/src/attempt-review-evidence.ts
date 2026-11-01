import type { PoolClient } from 'pg';
import type { TenantContext } from '@medical-device/contracts';

export async function reviewedAttempts(client:PoolClient,tenant:TenantContext,enrollmentId:string,releaseId:string,releaseHash:string,policy:Record<string,any>,resetOnly=false) {
  const rows=await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND (event_type='ATTEMPT_ALLOWANCE_RESET' OR (NOT $5 AND event_type='ATTEMPT_REVIEW_RESOLVED'))
    AND details->>'releaseId'=$3 AND details->>'releaseHash'=$4`,[tenant.organizationId,enrollmentId,releaseId,releaseHash,resetOnly]);
  const result:Record<string,number>=Object.create(null);
  for(const {details} of rows.rows)if(details.policyId===policy?.policyId && details.policyVersion===policy?.version && Number.isSafeInteger(details.throughAttempt) && details.throughAttempt>0)
    result[details.activityId]=Math.max(result[details.activityId]??0,details.throughAttempt);
  return result;
}
