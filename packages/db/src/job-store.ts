import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type {
  FailureDetail,
  JobEnvelope,
  JobOutcome,
  JobRecord,
  JobStorePort,
  JobCompletionOptions,
  OperatorRetryRequest,
  TenantContext
} from "@medical-device/contracts";
import {transitionPostgresAsset} from './asset-lifecycle-store.js';

async function completeAsset(client: PoolClient, row: ProcessingJobRow, completion?: JobCompletionOptions) {
  if (completion?.assetTransition) {
    const payload=row.payload as {inputAssetVersionId?: unknown}|null;
    if(row.job_type!=='asset.process'||payload?.inputAssetVersionId!==completion.assetTransition.assetVersionId)throw Error('ASSET_JOB_BINDING_INVALID');
    if(!await transitionPostgresAsset(client,completion.assetTransition))throw Error('ASSET_TRANSITION_REJECTED');
  }
  await completion?.beforeCommit?.();
}

interface ProcessingJobRow {
  job_id: string;
  job_type: string;
  organization_id: string;
  tenant: TenantContext;
  attempt: number;
  max_attempts: number;
  idempotency_key: string;
  request_hash: string;
  payload: unknown;
  state: JobRecord<unknown>["state"];
  created_at: Date;
  updated_at: Date;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  lease_generation: number;
  correlation_id: string;
  timeout_seconds: number | null;
  deadline_at: Date | null;
  input_asset_version_id: string | null;
  code_version: string;
  adapter_version: string | null;
  error_class: JobRecord<unknown>["errorClass"] | null;
  operator_metadata: Record<string, unknown> | null;
  last_failure: FailureDetail | null;
  output_artifact_ids: string[];
  outcome: JobOutcome | null;
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const nowIso = (value?: string): string => value ?? new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

function organizationId(tenant: TenantContext): string {
  if (!tenant?.organizationId?.trim()) throw new Error("TENANT_CONTEXT_REQUIRED");
  return tenant.organizationId;
}

async function withTenantTransaction<T>(pool: Pool, tenant: TenantContext, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId(tenant)]);
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function recordFromRow<TPayload>(row: ProcessingJobRow): JobRecord<TPayload> {
  return {
    jobId: row.job_id,
    jobType: row.job_type,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    idempotency: { key: row.idempotency_key, requestHash: row.request_hash },
    tenant: row.tenant,
    payload: row.payload as TPayload,
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    availableAt: iso(row.available_at),
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : undefined,
    leaseGeneration: Number(row.lease_generation),
    inputAssetVersionId: row.input_asset_version_id ?? undefined,
    timeoutSeconds: row.timeout_seconds ?? undefined,
    deadlineAt: row.deadline_at ? iso(row.deadline_at) : undefined,
    codeVersion: row.code_version,
    adapterVersion: row.adapter_version ?? undefined,
    errorClass: row.error_class ?? undefined,
    operatorMetadata: row.operator_metadata ?? undefined,
    lastFailure: row.last_failure ?? undefined,
    outputArtifactIds: row.output_artifact_ids ?? [],
    outcome: row.outcome ?? undefined
  };
}

const rowColumns = `
  job_id, job_type, organization_id, tenant, attempt, max_attempts,
  idempotency_key, request_hash, payload, state, created_at, updated_at,
  available_at, lease_owner, lease_expires_at, last_failure,
  lease_generation, correlation_id, timeout_seconds, deadline_at,
  input_asset_version_id, code_version, adapter_version, error_class,
  operator_metadata, output_artifact_ids, outcome
`;

/** Caller supplies a transaction with the matching tenant already set. */
export async function enqueuePostgresJob<TPayload>(client: PoolClient, job: JobEnvelope<TPayload>): Promise<JobRecord<TPayload>> {
  const timestamp = nowIso();
  const inserted = await client.query<ProcessingJobRow>(
    `INSERT INTO processing_jobs (
      job_id, job_type, organization_id, tenant, attempt, max_attempts,
      idempotency_key, request_hash, payload, state, created_at, updated_at, available_at,
      correlation_id, timeout_seconds, deadline_at, input_asset_version_id,
      code_version, operator_metadata
    ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, 'QUEUED', $10, $10, $10, $11, $12, $13::timestamptz, $14, $15, $16::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING ${rowColumns}`,
    [
      job.jobId,
      job.jobType,
      job.tenant.organizationId,
      json(job.tenant),
      job.attempt,
      job.maxAttempts,
      job.idempotency.key,
      job.idempotency.requestHash,
      json(job.payload),
      timestamp,
      job.tenant.correlationId,
      job.timeoutSeconds ?? null,
      job.deadlineAt ?? null,
      job.inputAssetVersionId ?? (typeof job.payload === "object" && job.payload !== null && "inputAssetVersionId" in job.payload ? String((job.payload as { inputAssetVersionId?: unknown }).inputAssetVersionId ?? "") || null : null),
      job.codeVersion ?? "unknown",
      job.operatorMetadata ? json(job.operatorMetadata) : null
    ]
  );
  if (inserted.rows[0]) {
    await client.query(
      `INSERT INTO processing_job_outbox (
        outbox_id, job_id, organization_id, tenant, message, state,
        attempt, max_attempts, available_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'PENDING', 0, $6, $7, $7, $7)
      ON CONFLICT (job_id) DO NOTHING`,
      [
        `outbox:${job.jobId}`,
        job.jobId,
        job.tenant.organizationId,
        json(job.tenant),
        json(job),
        job.maxAttempts,
        timestamp
      ]
    );
    return recordFromRow<TPayload>(inserted.rows[0]);
  }

  const existing = await client.query<ProcessingJobRow>(
    `SELECT ${rowColumns} FROM processing_jobs WHERE idempotency_key = $1`,
    [job.idempotency.key]
  );
  const row = existing.rows[0];
  if (!row) throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
  if (row.request_hash !== job.idempotency.requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
  return recordFromRow<TPayload>(row);
}

export function createPostgresJobStore(pool: Pool): JobStorePort {
  return {
    async enqueue<TPayload>(job: JobEnvelope<TPayload>) {
      return withTenantTransaction(pool, job.tenant, client => enqueuePostgresJob(client, job));
    },

    async get<TPayload>(tenant: TenantContext, jobId: string) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ProcessingJobRow>(
          `SELECT ${rowColumns} FROM processing_jobs WHERE job_id = $1`,
          [jobId]
        );
        return result.rows[0] ? recordFromRow<TPayload>(result.rows[0]) : null;
      });
    },

    async retry<TPayload>(tenant: TenantContext, jobId: string, request: OperatorRetryRequest) {
      const actorId = request.actorId?.trim();
      const reason = request.reason?.trim();
      if (!actorId) throw new Error("OPERATOR_ACTOR_REQUIRED");
      if (!reason) throw new Error("OPERATOR_RETRY_REASON_REQUIRED");
      const timestamp = nowIso(request.now);
      const auditId = `audit:${randomUUID()}`;
      return withTenantTransaction(pool, tenant, async (client) => {
        const current = await client.query<ProcessingJobRow>(
          `SELECT ${rowColumns}
           FROM processing_jobs
           WHERE job_id = $1
             AND state IN ('FAILED', 'DEAD_LETTERED')
             AND error_class = 'RETRYABLE'
             AND operator_metadata->>'cancelled' IS DISTINCT FROM 'true'
             AND last_failure IS NOT NULL`,
          [jobId]
        );
        const existing = current.rows[0];
        if (!existing) return null;

        const details = {
          auditId,
          originalState: existing.state,
          originalAttempt: existing.attempt,
          originalRequestHash: existing.request_hash,
          jobVersion: existing.code_version,
          originalErrorClass: existing.error_class,
          originalFailure: existing.last_failure
        };
        const updated = await client.query<ProcessingJobRow>(
          `UPDATE processing_jobs
           SET state = 'QUEUED',
               attempt = 1,
               available_at = $2::timestamptz,
               updated_at = $2::timestamptz,
               lease_owner = NULL,
               lease_expires_at = NULL,
               operator_metadata = COALESCE(operator_metadata, '{}'::jsonb) || $3::jsonb
           WHERE job_id = $1
             AND state IN ('FAILED', 'DEAD_LETTERED')
             AND error_class = 'RETRYABLE'
             AND operator_metadata->>'cancelled' IS DISTINCT FROM 'true'
           RETURNING ${rowColumns}`,
          [jobId, timestamp, json({ lastOperatorRetry: { actorId, reason, at: timestamp, ...details } })]
        );
        if (!updated.rows[0]) return null;

        await client.query(
          `INSERT INTO processing_job_audit (
             audit_id, job_id, organization_id, actor_id, event_type, reason, details, created_at
           ) VALUES ($1, $2, $3, $4, 'OPERATOR_RETRY', $5, $6::jsonb, $7::timestamptz)`,
          [auditId, jobId, tenant.organizationId, actorId, reason, json(details), timestamp]
        );

        const outbox = await client.query(
          `UPDATE processing_job_outbox
           SET state = 'PENDING',
               attempt = 0,
               available_at = $2::timestamptz,
               claimed_by = NULL,
               lease_expires_at = NULL,
               last_failure = NULL,
               updated_at = $2::timestamptz
           WHERE job_id = $1
           RETURNING outbox_id`,
          [jobId, timestamp]
        );
        if (!outbox.rows[0]) throw new Error("JOB_OUTBOX_MISSING");
        return recordFromRow<TPayload>(updated.rows[0]);
      });
    },

    async claim<TPayload>(tenant: TenantContext, jobId: string, workerId: string, now?: string, leaseSeconds = 300) {
      const timestamp = nowIso(now);
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ProcessingJobRow>(
          `UPDATE processing_jobs
           SET state = 'RUNNING',
               lease_owner = $2,
               lease_expires_at = $3::timestamptz + ($4::text || ' seconds')::interval,
               updated_at = $3::timestamptz,
               attempt = CASE WHEN state = 'RUNNING' THEN attempt + 1 ELSE attempt END,
               lease_generation = lease_generation + 1
           WHERE job_id = $1
             AND state NOT IN ('SUCCEEDED', 'FAILED', 'DEAD_LETTERED')
             AND (
               (state IN ('QUEUED', 'RETRY_SCHEDULED') AND available_at <= $3::timestamptz)
               OR (state = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $3::timestamptz)
             )
           RETURNING ${rowColumns}`,
          [jobId, workerId, timestamp, leaseSeconds]
        );
        return result.rows[0] ? recordFromRow<TPayload>(result.rows[0]) : null;
      });
    },

    async succeed<TPayload>(tenant: TenantContext, jobId: string, workerId: string, leaseGeneration: number, outcome: JobOutcome, now?: string, completion?: JobCompletionOptions) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ProcessingJobRow>(
          `UPDATE processing_jobs
           SET state = 'SUCCEEDED',
               output_artifact_ids = $4::text[],
               outcome = $5::jsonb,
               adapter_version = $6,
               updated_at = $7::timestamptz,
               lease_expires_at = NULL
           WHERE job_id = $1 AND state = 'RUNNING' AND lease_owner = $2 AND lease_generation = $3
           RETURNING ${rowColumns}`,
          [jobId, workerId, leaseGeneration, outcome.outputArtifactIds, json(outcome), outcome.adapterVersion, nowIso(now)]
        );
        if(result.rows[0])await completeAsset(client,result.rows[0],completion);
        return result.rows[0] ? recordFromRow<TPayload>(result.rows[0]) : null;
      });
    },

    async fail<TPayload>(tenant: TenantContext, jobId: string, workerId: string, leaseGeneration: number, failure: FailureDetail, now?: string, outcome?: JobOutcome, completion?: JobCompletionOptions) {
      const timestamp = nowIso(now);
      const isRetryable = failure.class === "RETRYABLE";
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ProcessingJobRow>(
          `UPDATE processing_jobs
           SET state = CASE
                 WHEN $4 = 'RETRYABLE' AND attempt < max_attempts THEN 'RETRY_SCHEDULED'
                 WHEN $4 = 'RETRYABLE' THEN 'DEAD_LETTERED'
                 ELSE 'FAILED'
               END,
               attempt = CASE
                 WHEN $4 = 'RETRYABLE' AND attempt < max_attempts THEN attempt + 1
                 ELSE attempt
               END,
               available_at = CASE
                 WHEN $4 = 'RETRYABLE' AND attempt < max_attempts
                   THEN $6::timestamptz + ($5::text || ' seconds')::interval
                 ELSE available_at
               END,
               error_class = $7,
               last_failure = $8::jsonb,
               outcome = COALESCE($9::jsonb, outcome),
               output_artifact_ids = COALESCE($10::text[], output_artifact_ids),
               updated_at = $6::timestamptz,
               lease_expires_at = NULL
           WHERE job_id = $1 AND state = 'RUNNING' AND lease_owner = $2 AND lease_generation = $3
           RETURNING ${rowColumns}`,
          [
            jobId,
            workerId,
            leaseGeneration,
            failure.class,
            isRetryable ? failure.retryAfterSeconds ?? 0 : 0,
            timestamp,
            failure.class,
            json(failure),
            outcome ? json(outcome) : null,
            outcome?.outputArtifactIds ?? null
          ]
        );
        if(result.rows[0])await completeAsset(client,result.rows[0],completion);
        return result.rows[0] ? recordFromRow<TPayload>(result.rows[0]) : null;
      });
    }
  };
}
