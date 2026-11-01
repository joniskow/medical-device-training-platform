import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresJobStore, createPostgresOutboxStore } from "../packages/db/dist/index.js";

const adminConnectionString = process.env.DATABASE_ADMIN_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device";
const runtimeConnectionString = process.env.DATABASE_URL ?? "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device";
const publisherConnectionString = process.env.DATABASE_OUTBOX_URL ?? "postgresql://medical_device_outbox_publisher:local_outbox_only_change_me@127.0.0.1:54329/medical_device";
const adminPool = new Pool({ connectionString: adminConnectionString });
let runtimePool;
let publisherPool;
const tenant = { organizationId: "org_outbox_test", actorId: "actor_outbox_test", correlationId: "corr_outbox_test" };
const job = {
  jobId: "job_outbox_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "outbox-test-idempotency", requestHash: "outbox-test-request" },
  tenant,
  payload: { inputAssetVersionId: "assetv_outbox_test", sourceType: "pdf", blobKey: "org_outbox_test/manual.pdf", sha256: "outbox-hash" }
};

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medical_device_outbox_publisher') THEN
        CREATE ROLE medical_device_outbox_publisher LOGIN PASSWORD 'local_outbox_only_change_me' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$;
  `);
  await adminPool.query("ALTER ROLE medical_device_outbox_publisher WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'local_outbox_only_change_me'");
  await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO medical_device_outbox_publisher");
  await adminPool.query("GRANT USAGE ON SCHEMA public TO medical_device_outbox_publisher");
  await adminPool.query("GRANT SELECT, UPDATE ON TABLE processing_job_outbox TO medical_device_outbox_publisher");
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE processing_job_outbox TO local_runtime");
  await adminPool.query("DELETE FROM processing_job_outbox WHERE outbox_id = $1 OR job_id IN ('job_db_test', 'job_db_retry_test', $2)", [`outbox:${job.jobId}`, job.jobId]);
  await adminPool.query("DELETE FROM processing_jobs WHERE job_id IN ('job_db_test', 'job_db_retry_test', $1)", [job.jobId]);

  runtimePool = new Pool({ connectionString: runtimeConnectionString });
  publisherPool = new Pool({ connectionString: publisherConnectionString });
  const jobs = createPostgresJobStore(runtimePool);
  const outbox = createPostgresOutboxStore(publisherPool);

  const queued = await jobs.enqueue(job);
  assert.equal(queued.state, "QUEUED");
  const claimed = await outbox.claim("publisher-a", undefined, 60);
  assert.equal(claimed.message.jobId, job.jobId);
  assert.equal(await outbox.claim("publisher-b"), null);
  assert.equal(await outbox.markPublished(claimed.outboxId, "publisher-b"), false);
  assert.equal(await outbox.markPublished(claimed.outboxId, "publisher-a"), true);
  assert.equal(await outbox.claim("publisher-a"), null);
  assert.deepEqual(await jobs.enqueue(job), queued);

  console.log("Job outbox passed: atomic enqueue, single publisher claim, owner-checked publish, and idempotent enqueue.");
} finally {
  await adminPool.query("DELETE FROM processing_job_outbox WHERE outbox_id = $1 OR job_id IN ('job_db_test', 'job_db_retry_test', $2)", [`outbox:${job.jobId}`, job.jobId]).catch(() => {});
  await adminPool.query("DELETE FROM processing_jobs WHERE job_id IN ('job_db_test', 'job_db_retry_test', $1)", [job.jobId]).catch(() => {});
  await runtimePool?.end();
  await publisherPool?.end();
  await adminPool.end();
}
