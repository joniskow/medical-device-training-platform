import type { PoolClient } from 'pg';
import type { TenantContext } from '@medical-device/contracts';

// Only server-recorded acknowledgements of supported reading and media activities count.
export async function contentAcknowledgements(client:PoolClient,tenant:TenantContext,enrollmentId:string,releaseId:string,releaseHash:string,content:Record<string,any>) {
  const rows=await client.query(`SELECT progress_event_id,payload,created_at FROM progress_events
    WHERE organization_id=$1 AND learner_id=$2 AND enrollment_id=$3 AND event_type='content.acknowledged'
      AND payload->>'releaseId'=$4 AND payload->>'releaseHash'=$5`,[tenant.organizationId,tenant.actorId,enrollmentId,releaseId,releaseHash]);
  const activities=(content.modules??[]).flatMap((module:Record<string,any>)=>module.activities??[]);
  return rows.rows.filter(row=>activities.some((activity:Record<string,any>)=>activity.activityId===row.payload.activityId && ['text','rich_text','image','video','3d_viewer','hotspot'].includes(activity.type))
    && row.payload.policyId===(content.policy?.policyId??null) && row.payload.policyVersion===(content.policy?.version??null));
}
