import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresJobStore } from "../packages/db/dist/index.js";

const adminConnectionString = process.env.DATABASE_ADMIN_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device";
const runtimeConnectionString = process.env.DATABASE_URL ?? "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device";
const adminPool = new Pool({ connectionString: adminConnectionString });
const runtimePool = new Pool({ connectionString: runtimeConnectionString });
const tenant = { organizationId: "org_status_test", actorId: "actor_status_test", correlationId: "corr_status_test" };
const otherTenant = { organizationId: "org_status_other", actorId: "actor_other", correlationId: "corr_other" };
const retryJobId = "job_operator_retry_test";
const terminalJobId = "job_operator_terminal_test";
const jobPayload = { inputAssetVersionId: "assetv_status_test", sourceType: "pdf", blobKey: "org_status_test/AIC-001/manual.pdf", sha256: "status-test-hash" };

const makeJob = (jobId, idempotencyKey, maxAttempts = 1) => ({
  jobId,
  jobType: "asset.process",
  attempt: 1,
  maxAttempts,
  idempotency: { key: idempotencyKey, requestHash: `${idempotencyKey}-hash` },
  tenant,
  payload: jobPayload,
  codeVersion: "worker-status-test-v1"
});

async function cleanup() {
  await adminPool.query("DELETE FROM processing_job_audit WHERE job_id = ANY($1::text[])", [[retryJobId, terminalJobId]]);
  await adminPool.query("DELETE FROM processing_job_outbox WHERE job_id = ANY($1::text[])", [[retryJobId, terminalJobId]]);
  await adminPool.query("DELETE FROM processing_jobs WHERE job_id = ANY($1::text[])", [[retryJobId, terminalJobId]]);
}

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE processing_jobs, processing_job_outbox, processing_job_audit TO local_runtime");
  const store = createPostgresJobStore(runtimePool);
  await cleanup();

  const retryJob = makeJob(retryJobId, "operator-retry-idempotency");
  await store.enqueue(retryJob);
  const initialNow = new Date(Date.now() + 60_000).toISOString();
  const firstFailureAt = new Date(Date.parse(initialNow) + 1_000).toISOString();
  const retryAt = new Date(Date.parse(initialNow) + 5 * 60_000).toISOString();
  const claimed = await store.claim(tenant, retryJobId, "worker-status", initialNow, 60);
  assert.ok(claimed);
  const deadLettered = await store.fail(tenant, retryJobId, "worker-status", claimed.leaseGeneration, {
    class: "RETRYABLE",
    code: "TEMPORARY_PROVIDER_FAILURE",
    message: "temporary provider failure",
    retryAfterSeconds: 30
  }, firstFailureAt);
  assert.equal(deadLettered.state, "DEAD_LETTERED");

  const status = await store.get(tenant, retryJobId);
  assert.equal(status.state, "DEAD_LETTERED");
  assert.equal(status.lastFailure.code, "TEMPORARY_PROVIDER_FAILURE");
  assert.equal(await store.get(otherTenant, retryJobId), null);

  const retried = await store.retry(tenant, retryJobId, {
    actorId: "operator-1",
    reason: "Provider outage resolved; replay the source.",
    now: retryAt
  });
  assert.equal(retried.state, "QUEUED");
  assert.equal(retried.attempt, 1);
  assert.equal(retried.availableAt, retryAt);
  assert.equal(retried.operatorMetadata.lastOperatorRetry.actorId, "operator-1");
  assert.equal(retried.operatorMetadata.lastOperatorRetry.originalRequestHash, retryJob.idempotency.requestHash);
  assert.equal(retried.operatorMetadata.lastOperatorRetry.jobVersion, retryJob.codeVersion);
  assert.equal(await store.retry(otherTenant, retryJobId, { actorId: "operator-2", reason: "must not cross tenant" }), null);

  const audit = await adminPool.query(
    "SELECT actor_id, event_type, reason, details FROM processing_job_audit WHERE job_id = $1",
    [retryJobId]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor_id, "operator-1");
  assert.equal(audit.rows[0].event_type, "OPERATOR_RETRY");
  assert.equal(audit.rows[0].reason, "Provider outage resolved; replay the source.");
  assert.equal(audit.rows[0].details.originalAttempt, 1);

  const outbox = await adminPool.query(
    "SELECT state, attempt, claimed_by, lease_expires_at FROM processing_job_outbox WHERE job_id = $1",
    [retryJobId]
  );
  assert.equal(outbox.rows[0].state, "PENDING");
  assert.equal(outbox.rows[0].attempt, 0);
  assert.equal(outbox.rows[0].claimed_by, null);

  const terminalJob = makeJob(terminalJobId, "operator-terminal-idempotency", 3);
  await store.enqueue(terminalJob);
  const terminalClaim = await store.claim(tenant, terminalJobId, "worker-status", initialNow, 60);
  assert.ok(terminalClaim);
  await store.fail(tenant, terminalJobId, "worker-status", terminalClaim.leaseGeneration, {
    class: "TERMINAL",
    code: "INVALID_INPUT",
    message: "invalid input"
  }, firstFailureAt);
  assert.equal(await store.retry(tenant, terminalJobId, { actorId: "operator-1", reason: "must remain terminal" }), null);

  console.log("Job status and recovery passed: tenant-scoped reads, eligible operator retry, audit record, outbox replay, and terminal retry rejection.");
} finally {
  await cleanup().catch(() => {});
  await runtimePool.end();
  await adminPool.end();
}
