import type { Pool, PoolClient } from "pg";
import type { FailureDetail, JobEnvelope, JobOutboxPort, JobOutboxRecord } from "@medical-device/contracts";

interface JobOutboxRow {
  outbox_id: string;
  job_id: string;
  organization_id: string;
  tenant: JobEnvelope<unknown>["tenant"];
  message: JobEnvelope<unknown>;
  state: JobOutboxRecord["state"];
  attempt: number;
  max_attempts: number;
  available_at: Date;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  last_failure: FailureDetail | null;
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const nowIso = (value?: string): string => value ?? new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

function recordFromRow(row: JobOutboxRow): JobOutboxRecord {
  return {
    outboxId: row.outbox_id,
    jobId: row.job_id,
    tenant: row.tenant,
    message: row.message,
    state: row.state,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: iso(row.available_at),
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : undefined,
    lastFailure: row.last_failure ?? undefined
  };
}

const rowColumns = `
  outbox_id, job_id, organization_id, tenant, message, state, attempt,
  max_attempts, available_at, claimed_by, lease_expires_at, last_failure
`;
const returningColumns = `
  outbox.outbox_id, outbox.job_id, outbox.organization_id, outbox.tenant,
  outbox.message, outbox.state, outbox.attempt, outbox.max_attempts,
  outbox.available_at, outbox.claimed_by, outbox.lease_expires_at, outbox.last_failure
`;

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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

export function createPostgresOutboxStore(pool: Pool, scope?: { organizationId?: string }): JobOutboxPort {
  const organizationFilter = scope?.organizationId ? " AND organization_id = $4" : "";
  return {
    async claim(workerId: string, now?: string, leaseSeconds = 60) {
      const timestamp = nowIso(now);
      return transaction(pool, async (client) => {
        const result = await client.query<JobOutboxRow>(
           `WITH candidate AS (
             SELECT outbox_id
             FROM processing_job_outbox
             WHERE available_at <= $2::timestamptz
               AND (
                 state = 'PENDING'
                 OR (state = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $2::timestamptz)
               )
               ${organizationFilter}
             ORDER BY created_at, outbox_id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE processing_job_outbox AS outbox
           SET state = 'CLAIMED',
               claimed_by = $1,
               lease_expires_at = $2::timestamptz + ($3::text || ' seconds')::interval,
               updated_at = $2::timestamptz
           FROM candidate
           WHERE outbox.outbox_id = candidate.outbox_id
           RETURNING ${returningColumns}`,
          scope?.organizationId ? [workerId, timestamp, leaseSeconds, scope.organizationId] : [workerId, timestamp, leaseSeconds]
        );
        return result.rows[0] ? recordFromRow(result.rows[0]) : null;
      });
    },

    async markPublished(outboxId: string, workerId: string, now?: string) {
      const result = await pool.query(
        `UPDATE processing_job_outbox
         SET state = 'PUBLISHED', claimed_by = NULL, lease_expires_at = NULL, updated_at = $3::timestamptz
         WHERE outbox_id = $1 AND state = 'CLAIMED' AND claimed_by = $2`,
        [outboxId, workerId, nowIso(now)]
      );
      return result.rowCount === 1;
    },

    async markFailed(outboxId: string, workerId: string, failure: FailureDetail, now?: string) {
      const result = await pool.query(
        `UPDATE processing_job_outbox
         SET state = CASE WHEN attempt + 1 >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
             attempt = attempt + 1,
             available_at = CASE
               WHEN attempt + 1 >= max_attempts THEN available_at
               ELSE $3::timestamptz + (($4::text || ' seconds')::interval)
             END,
             last_failure = $5::jsonb,
             claimed_by = NULL,
             lease_expires_at = NULL,
             updated_at = $3::timestamptz
         WHERE outbox_id = $1 AND state = 'CLAIMED' AND claimed_by = $2`,
        [outboxId, workerId, nowIso(now), failure.retryAfterSeconds ?? 30, json(failure)]
      );
      return result.rowCount === 1;
    }
  };
}
