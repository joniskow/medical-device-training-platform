import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenantTransaction } from '@medical-device/db';
import type { ModelSessionDebrief, TenantContext } from '@medical-device/contracts';
import type { SimulationDefinition, SimulationState } from '@medical-device/simulation-schema';
import type { ModelSessionActionRequest, ModelSessionActionResult } from './model-session-service.js';

export function rejectedActionId(tenant: TenantContext, sessionId: string, actionId: string): string {
  return `model-rejected:${createHash('sha256').update(JSON.stringify([tenant.organizationId, sessionId, actionId])).digest('hex')}`;
}

export async function recordRejectedModelAction(client: PoolClient, tenant: TenantContext, sessionId: string, action: ModelSessionActionRequest, response: ModelSessionActionResult): Promise<ModelSessionActionResult> {
  await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
    VALUES($1,$2,$3,'SIMULATION_ACTION_REJECTED','simulation_session',$4,$5::jsonb,clock_timestamp())`,
  [rejectedActionId(tenant, sessionId, action.clientActionId), tenant.organizationId, tenant.actorId, sessionId, JSON.stringify({ request: action, result: response })]);
  return response;
}

/** Historical results remain readable after expiry, but never after ownership/enrollment/release access is lost. */
export async function readModelSessionDebrief(pool: Pool, tenant: TenantContext, sessionId: string): Promise<ModelSessionDebrief | null> {
  if (!tenant.actorId) return null;
  return withTenantTransaction(pool, tenant, async client => {
    type State = { completed: boolean; scorePoints: number; simulationState?: SimulationState };
    const session = await client.query<{
      release_id: string; model_version_id: string; status: string; expired: boolean;
      state: State & { modelState?: State }; definition: SimulationDefinition;
    }>(`SELECT s.release_id,s.model_version_id,CASE WHEN a.status='INVALIDATED' THEN 'INVALIDATED' ELSE s.status END AS status,
        (s.expires_at<=CURRENT_TIMESTAMP OR a.started_at+COALESCE((p.policy->>'attemptTtlSeconds')::integer,86400)*interval '1 second'<=CURRENT_TIMESTAMP) AS expired,
        s.state,d.definition
      FROM simulation_sessions s
      JOIN enrollments e ON e.organization_id=s.organization_id AND e.enrollment_id=s.enrollment_id AND e.learner_id=s.learner_id
      JOIN simulation_attempts a ON a.organization_id=s.organization_id AND a.simulation_attempt_id=s.attempt_id AND a.learner_id=s.learner_id AND a.enrollment_id=s.enrollment_id AND a.release_id=s.release_id
      JOIN release_manifests r ON r.organization_id=s.organization_id AND r.release_id=s.release_id AND r.course_version_id=e.course_version_id
      JOIN certification_policies p ON p.organization_id=s.organization_id AND p.policy_id=s.policy_id AND p.version=s.policy_version AND p.course_version_id=e.course_version_id
      JOIN simulation_definitions d ON d.organization_id=s.organization_id AND d.simulation_definition_id=s.simulation_definition_id
      WHERE s.organization_id=$1 AND s.simulation_session_id=$2 AND s.learner_id=$3 AND e.status IN ('ACTIVE','COMPLETED') AND r.status='PUBLISHED' AND p.status='PUBLISHED' AND d.status='PUBLISHED'
      FOR SHARE OF s,e,a,r,p,d`, [tenant.organizationId, sessionId, tenant.actorId]);
    const row = session.rows[0];
    if (!row) return null;
    const state = row.state.modelState ?? row.state;
    const history = await client.query<{
      payload: { request: ModelSessionActionRequest; result: ModelSessionActionResult }; created_at: Date;
      event_count: string; hints: string; rejected: string;
    }>(`WITH history AS (
      SELECT payload,created_at,sequence,nonce AS action_id,1 AS accepted_order FROM simulation_actions WHERE organization_id=$1 AND simulation_session_id=$2
      UNION ALL
      SELECT details,created_at,(details->'request'->>'expectedSequence')::integer,details->'request'->>'clientActionId',0
      FROM audit_events WHERE organization_id=$1 AND resource_type='simulation_session' AND resource_id=$2 AND event_type='SIMULATION_ACTION_REJECTED'
    ) SELECT payload,created_at,count(*) OVER() AS event_count,
      count(*) FILTER(WHERE payload->'request'->>'type'='request_hint' AND payload->'result'->>'status'='accepted') OVER() AS hints,
      count(*) FILTER(WHERE payload->'result'->>'status'='invalid_precondition') OVER() AS rejected
      FROM history ORDER BY sequence,accepted_order,created_at,action_id LIMIT 500`, [tenant.organizationId, sessionId]);
    return {
      sessionId, releaseId: row.release_id, modelVersionId: row.model_version_id,
      status: row.status === 'INVALIDATED' ? 'INVALIDATED' : state.completed ? 'COMPLETED' : row.expired || row.status !== 'ACTIVE' ? 'EXPIRED' : 'ACTIVE',
      completed: state.completed && row.status !== 'INVALIDATED', scorePoints: state.scorePoints,
      steps: row.definition.steps.map(step => ({ stepId: step.stepId, title: step.title,
        completed: state.simulationState?.completedStepIds.includes(step.stepId) ?? false,
        explanation: row.definition.equivalentPath.instructions.find(instruction => instruction.stepId === step.stepId)?.text ?? step.title })),
      events: history.rows.map(({ payload: { request, result }, created_at }) => ({
        actionId: request.clientActionId, sequence: request.expectedSequence, occurredAt: created_at.toISOString(), type: request.type,
        ...(request.componentId ? { componentId: request.componentId } : {}), ...(request.targetId ? { targetId: request.targetId } : {}),
        ...(request.stepId ? { stepId: request.stepId } : {}),
        outcome: result.status === 'accepted' ? 'accepted' as const : result.status === 'expired_session' ? 'invalidated' as const : 'rejected' as const,
        feedback: result.feedback
      })),
      hintsUsed: Number(history.rows[0]?.hints ?? 0), rejectedAttempts: Number(history.rows[0]?.rejected ?? 0), eventsTruncated: Number(history.rows[0]?.event_count ?? 0) > 500
    };
  });
}
