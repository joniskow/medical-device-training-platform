import {assertStoryActivityAccess} from '@medical-device/db';
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "@medical-device/db";
import { learnerAssessment, scoreAssessment, validateAssessmentDefinition, type AssessmentDefinition } from "@medical-device/simulation-schema";
import { issueCredentialInTransaction } from "./credential-service.js";
import { reviewedAttempts } from './attempt-review-evidence.js';

export interface AssessmentStart { enrollmentId: string; releaseId: string; activityId: string; idempotencyKey: string }
export interface AssessmentSessionService {
  start(tenant: TenantContext, request: AssessmentStart): Promise<unknown>;
  get(tenant: TenantContext, sessionId: string): Promise<unknown>;
  submit(tenant: TenantContext, sessionId: string, answers: unknown): Promise<unknown>;
}
type Row = Record<string, any>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

async function binding(client: PoolClient, tenant: TenantContext, enrollmentId: string, releaseId: string) {
  const result = await client.query(
    `SELECT r.manifest, r.release_hash FROM enrollments e JOIN release_manifests r
     ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
     WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status='ACTIVE'
       AND r.release_id=$4 AND r.status='PUBLISHED' FOR UPDATE OF e FOR SHARE OF r`,
    [tenant.organizationId, enrollmentId, tenant.actorId, releaseId]
  );
  if (!result.rows[0]) throw new Error("ASSESSMENT_ACCESS_DENIED");
  return result.rows[0];
}
function projection(row: Row) {
  return { sessionId: row.session_id, enrollmentId: row.enrollment_id, releaseId: row.release_id,
    activityId: row.activity_id, attemptNumber: row.attempt_number, status: row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
    assessment: learnerAssessment(row.definition), ...(row.result && row.status!=='INVALIDATED' ? { result: row.result } : {}) };
}
async function findSession(client: PoolClient, tenant: TenantContext, sessionId: string) {
  const result = await client.query(`SELECT * FROM assessment_sessions WHERE organization_id=$1 AND learner_id=$2 AND session_id=$3`, [tenant.organizationId, tenant.actorId, sessionId]);
  if (!result.rows[0]) throw new Error("ASSESSMENT_NOT_FOUND");
  return result.rows[0];
}
async function lockedSession(client: PoolClient, tenant: TenantContext, sessionId: string) {
  const initial = await findSession(client, tenant, sessionId);
  const release = await binding(client, tenant, initial.enrollment_id, initial.release_id);
  await assertStoryActivityAccess(client,tenant,initial.enrollment_id,initial.release_id,initial.activity_id);
  const row = await findSession(client, tenant, sessionId);
  if (release.release_hash !== row.release_hash) throw new Error("ASSESSMENT_RELEASE_CHANGED");
  return row;
}

export function createPostgresAssessmentSessionService(pool: Pool): AssessmentSessionService {
  return {
    async start(tenant, request) {
      if (!tenant.actorId || ![request.enrollmentId,request.releaseId,request.activityId,request.idempotencyKey].every(identifier)) throw new Error("ASSESSMENT_REQUEST_INVALID");
      return withTenantTransaction(pool, tenant, async client => {
        const release = await binding(client, tenant, request.enrollmentId, request.releaseId);
        await assertStoryActivityAccess(client,tenant,request.enrollmentId,request.releaseId,request.activityId);
        const startHash = hash([request.enrollmentId,request.releaseId,request.activityId]);
        const prior = await client.query(`SELECT * FROM assessment_sessions WHERE organization_id=$1 AND learner_id=$2 AND start_key=$3`, [tenant.organizationId,tenant.actorId,request.idempotencyKey]);
        if (prior.rows[0]) {
          if (prior.rows[0].start_hash !== startHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          if (prior.rows[0].release_hash !== release.release_hash) throw new Error("ASSESSMENT_RELEASE_CHANGED");
          return projection(prior.rows[0]);
        }
        const content = release.manifest?.content;
        const activities: Row[] = Array.isArray(content?.modules) ? content.modules.flatMap((module: Row) => Array.isArray(module.activities) ? module.activities : []) : [];
        const matches = activities.filter(activity => activity.activityId === request.activityId);
        if (matches.length !== 1 || !validateAssessmentDefinition(matches[0].assessment).valid) throw new Error("ASSESSMENT_INVALID");
        const definition = matches[0].assessment as AssessmentDefinition;
        const policy = content.policy;
        if (!policy || !identifier(policy.policyId) || !Number.isSafeInteger(policy.version) || policy.version < 1 || !policy.requiredEvidence?.includes("assessment.passed")
          || !Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 100
          || !Number.isSafeInteger(policy.cooldownSeconds) || policy.cooldownSeconds < 0 || policy.cooldownSeconds > 604800
          || !Number.isSafeInteger(policy.attemptTtlSeconds) || policy.attemptTtlSeconds < 60 || policy.attemptTtlSeconds > 86400) throw new Error("ASSESSMENT_POLICY_INVALID");
        const history = await client.query(`SELECT *, expires_at > CURRENT_TIMESTAMP AS unexpired,
          COALESCE(submitted_at,expires_at) + $5 * interval '1 second' > CURRENT_TIMESTAMP AS cooling
          FROM assessment_sessions WHERE organization_id=$1 AND enrollment_id=$2 AND release_id=$3 AND activity_id=$4 ORDER BY attempt_number DESC`,
          [tenant.organizationId,request.enrollmentId,request.releaseId,request.activityId,policy.cooldownSeconds]);
        const latest = history.rows[0];
        const reviewed=await reviewedAttempts(client,tenant,request.enrollmentId,request.releaseId,release.release_hash,policy);
        if(Number.isSafeInteger(policy.repeatedFailureReviewAfter) && policy.repeatedFailureReviewAfter>0 && history.rows.filter(row=>row.status==='FAILED'&&row.attempt_number>(reviewed[request.activityId]??0)).length>=policy.repeatedFailureReviewAfter) throw new Error("ASSESSMENT_REVIEW_REQUIRED");
        if (latest?.status === "IN_PROGRESS" && latest.unexpired) throw new Error("ASSESSMENT_ALREADY_ACTIVE");
        if (latest?.status === "IN_PROGRESS") await client.query(`UPDATE assessment_sessions SET status='EXPIRED' WHERE session_id=$1 AND organization_id=$2`,[latest.session_id,tenant.organizationId]);
        const resets=await reviewedAttempts(client,tenant,request.enrollmentId,request.releaseId,release.release_hash,policy,true);
        if ((latest?.attempt_number??0)-(resets[request.activityId]??0) >= policy.maxAttempts) throw new Error("ASSESSMENT_ATTEMPT_LIMIT");
        if (latest?.cooling) throw new Error("ASSESSMENT_COOLDOWN");
        const result = await client.query(
          `INSERT INTO assessment_sessions (session_id,organization_id,learner_id,enrollment_id,release_id,release_hash,activity_id,
             assessment_id,assessment_version,policy_id,policy_version,definition,policy_snapshot,attempt_number,start_key,start_hash,status,started_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,'IN_PROGRESS',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+$17*interval '1 second') RETURNING *`,
          [`assessment-session:${randomUUID()}`,tenant.organizationId,tenant.actorId,request.enrollmentId,request.releaseId,release.release_hash,request.activityId,
            definition.assessmentId,definition.version,policy.policyId,policy.version,JSON.stringify(definition),JSON.stringify(policy),(latest?.attempt_number ?? 0)+1,request.idempotencyKey,startHash,policy.attemptTtlSeconds]
        );
        return projection(result.rows[0]);
      });
    },
    async get(tenant, sessionId) {
      return withTenantTransaction(pool,tenant,async client => {
        const row = await lockedSession(client,tenant,sessionId);
        const expired = await client.query(`UPDATE assessment_sessions SET status='EXPIRED' WHERE organization_id=$1 AND session_id=$2 AND status='IN_PROGRESS' AND expires_at <= CURRENT_TIMESTAMP RETURNING *`,[tenant.organizationId,sessionId]);
        return projection(expired.rows[0] ?? row);
      });
    },
    async submit(tenant,sessionId,answers) {
      return withTenantTransaction(pool,tenant,async client => {
        const row = await lockedSession(client,tenant,sessionId);
        // Canonicalize question order; option order is meaningful for ordered-step questions.
        const normalized = Array.isArray(answers) ? [...answers].sort((a,b) => String(a?.questionId).localeCompare(String(b?.questionId))) : answers;
        const answerHash = hash(normalized);
        if (["PASSED","FAILED"].includes(row.status)) {
          if (row.answer_hash !== answerHash) throw new Error("ASSESSMENT_ALREADY_SUBMITTED");
          return projection(row);
        }
        const eligible = await client.query(`SELECT 1 FROM assessment_sessions WHERE organization_id=$1 AND session_id=$2 AND status='IN_PROGRESS' AND expires_at > CURRENT_TIMESTAMP`,[tenant.organizationId,sessionId]);
        if (!eligible.rowCount) throw new Error("ASSESSMENT_NOT_ACTIVE");
        const result = scoreAssessment(row.definition,normalized);
        const updated = await client.query(`UPDATE assessment_sessions SET answers=$3::jsonb,answer_hash=$4,result=$5::jsonb,status=$6,submitted_at=CURRENT_TIMESTAMP
          WHERE organization_id=$1 AND session_id=$2 RETURNING *`,[tenant.organizationId,sessionId,JSON.stringify(normalized),answerHash,JSON.stringify(result),result.passed ? "PASSED" : "FAILED"]);
        await client.query(`INSERT INTO progress_events (progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at)
          VALUES ($1,$2,$3,$4,'assessment.submitted',$5::jsonb,CURRENT_TIMESTAMP)`,[`progress:${randomUUID()}`,tenant.organizationId,row.enrollment_id,tenant.actorId,JSON.stringify({sessionId,releaseId:row.release_id,activityId:row.activity_id,assessmentId:row.assessment_id,assessmentVersion:row.assessment_version,policyId:row.policy_id,policyVersion:row.policy_version,...result})]);
        if(result.passed)await issueCredentialInTransaction(client,tenant,row.enrollment_id,true);
        return projection(updated.rows[0]);
      });
    }
  };
}
