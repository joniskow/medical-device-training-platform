import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresJobStore } from "../packages/db/dist/index.js";

const adminConnectionString = process.env.DATABASE_ADMIN_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device";
const runtimeConnectionString = process.env.DATABASE_URL ?? "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device";
const adminPool = new Pool({ connectionString: adminConnectionString });
let pool;
const tenant = { organizationId: "org_db_test", actorId: "actor_db_test", correlationId: "corr_db_test" };
const payload = { inputAssetVersionId: "assetv_db_test", sourceType: "pdf", blobKey: "org_db_test/AIC-001/manual.pdf", sha256: "db-test-hash" };
const job = {
  jobId: "job_db_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "db-test-idempotency", requestHash: "db-test-request" },
  tenant,
  payload
};
const otherTenant = { organizationId: "org_db_other", actorId: "actor_other", correlationId: "corr_other" };
async function deleteTestJobs() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [tenant.organizationId]);
    await client.query("DELETE FROM processing_job_outbox WHERE job_id = ANY($1::text[])", [[job.jobId, "job_db_retry_test"]]);
    await client.query("DELETE FROM processing_jobs WHERE job_id = ANY($1::text[])", [[job.jobId, "job_db_retry_test"]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'local_runtime') THEN
        CREATE ROLE local_runtime LOGIN PASSWORD 'local_runtime_only_change_me' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$;
  `);
  await adminPool.query("ALTER ROLE local_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'local_runtime_only_change_me'");
  await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO local_runtime");
  await adminPool.query("GRANT USAGE ON SCHEMA public TO local_runtime");
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE processing_jobs TO local_runtime");
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE processing_job_outbox TO local_runtime");
  pool = new Pool({ connectionString: runtimeConnectionString });
  await deleteTestJobs();
  const store = createPostgresJobStore(pool);
  const claim = (tenantContext, jobId, workerId, now, leaseSeconds) => store.claim(tenantContext, jobId, workerId, now, leaseSeconds);
  const succeed = (tenantContext, jobId, workerId, outcome, now) => store.succeed(tenantContext, jobId, workerId, outcome, now);
  const fail = (tenantContext, jobId, workerId, failure, now, outcome) => store.fail(tenantContext, jobId, workerId, failure, now, outcome);

  const queued = await store.enqueue(job);
  assert.equal(queued.state, "QUEUED");
  assert.deepEqual(queued.payload, payload);
  assert.equal(queued.inputAssetVersionId, payload.inputAssetVersionId);
  assert.equal(queued.tenant.correlationId, tenant.correlationId);
  assert.equal(queued.codeVersion, "unknown");
  const hiddenWithoutContext = await pool.query("SELECT job_id FROM processing_jobs WHERE job_id = $1", [job.jobId]);
  assert.equal(hiddenWithoutContext.rowCount, 0);
  assert.deepEqual(await store.enqueue(job), queued);
  await assert.rejects(
    store.enqueue({ ...job, idempotency: { ...job.idempotency, requestHash: "different" } }),
    /IDEMPOTENCY_KEY_REUSED/
  );

  const claimed = await claim(tenant, job.jobId, "worker-a", undefined, 60);
  assert.equal(claimed.leaseOwner, "worker-a");
  assert.equal(claimed.leaseGeneration, 1);
  assert.equal(await claim(otherTenant, job.jobId, "worker-b", undefined, 60), null);
  assert.equal(await succeed(otherTenant, job.jobId, "worker-a", claimed.leaseGeneration, {
    adapter: "cross-tenant",
    adapterVersion: "1",
    outputArtifactIds: [],
    status: "READY",
    warnings: [],
    metrics: {}
  }), null);
  assert.equal(await fail(otherTenant, job.jobId, "worker-a", claimed.leaseGeneration, { class: "TERMINAL", code: "CROSS_TENANT", message: "must be rejected" }), null);
  await assert.rejects(claim(undefined, job.jobId, "worker-b", undefined, 60), /TENANT_CONTEXT_REQUIRED/);
  assert.equal(await claim(tenant, job.jobId, "worker-b", undefined, 60), null);

  const future = new Date(Date.now() + 61_000).toISOString();
  const recovered = await claim(tenant, job.jobId, "worker-a", future, 60);
  assert.equal(recovered.leaseOwner, "worker-a");
  assert.equal(recovered.leaseGeneration, 2);
  assert.notEqual(recovered.leaseGeneration, claimed.leaseGeneration);
  assert.equal(await succeed(tenant, job.jobId, "worker-a", claimed.leaseGeneration, {
    adapter: "stale",
    adapterVersion: "1",
    outputArtifactIds: ["stale"],
    status: "READY",
    warnings: [],
    metrics: {}
  }), null);

  const completed = await succeed(tenant, job.jobId, "worker-a", recovered.leaseGeneration, {
    adapter: "postgres-test",
    adapterVersion: "1",
    outputArtifactIds: ["artifact_db_test"],
    status: "REVIEW_REQUIRED",
    warnings: [{ code: "REVIEW", severity: "warning", message: "Review required" }],
    metrics: { durationMs: 7 },
    details: { fixture: true }
  });
  assert.equal(completed.state, "SUCCEEDED");
  assert.equal(completed.outcome.status, "REVIEW_REQUIRED");
  assert.equal(completed.outcome.details.fixture, true);
  assert.equal(completed.adapterVersion, "1");

  const retryJob = { ...job, jobId: "job_db_retry_test", idempotency: { key: "db-retry-idempotency", requestHash: "db-retry-request" } };
  await store.enqueue(retryJob);
  const retryClaimed = await claim(tenant, retryJob.jobId, "worker-a", undefined, 60);
  const scheduled = await fail(tenant, retryJob.jobId, "worker-a", retryClaimed.leaseGeneration, { class: "RETRYABLE", code: "TEMPORARY", message: "retry", retryAfterSeconds: 30 });
  assert.equal(scheduled.state, "RETRY_SCHEDULED");
  assert.equal(scheduled.errorClass, "RETRYABLE");
  assert.equal(await claim(tenant, retryJob.jobId, "worker-b"), null);
  const retryClaim = await claim(tenant, retryJob.jobId, "worker-b", new Date(Date.now() + 31_000).toISOString(), 60);
  assert.equal(retryClaim.leaseOwner, "worker-b");

  console.log("PostgreSQL job store passed: idempotency, tenant RLS, lease fencing, stale-worker protection, outcomes, and retry scheduling.");
} finally {
  await deleteTestJobs().catch(() => {});
  await pool.end();
  await adminPool.end();
}
