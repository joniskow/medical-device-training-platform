import assert from "node:assert/strict";
import { createBackgroundProcessingRuntime } from "../apps/worker/dist/worker-runtime.js";

const message = {
  jobId: "job_runtime_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "runtime-test", requestHash: "runtime-request" },
  tenant: { organizationId: "org_runtime_test", actorId: "actor_runtime_test", correlationId: "corr_runtime_test" },
  payload: { inputAssetVersionId: "assetv_runtime_test", sourceType: "pdf", blobKey: "org_runtime_test/manual.pdf", sha256: "hash" }
};
const published = [];
let consumerClosed = false;
let dispatcherClosed = false;
let claims = 0;
let maintenanceCalls=0;
const runtime = createBackgroundProcessingRuntime({
  outbox: {
    async claim() {
      claims += 1;
      return claims === 1 ? {
        outboxId: "outbox_runtime_test",
        jobId: message.jobId,
        tenant: message.tenant,
        message,
        state: "CLAIMED",
        attempt: 1,
        maxAttempts: 3,
        availableAt: new Date(0).toISOString()
      } : null;
    },
    async markPublished() { return true; },
    async markFailed() { return false; }
  },
  dispatcher: {
    async enqueue(job) { published.push(job); return { jobId: job.jobId }; },
    async close() { dispatcherClosed = true; }
  },
  consumer: { async close() { consumerClosed = true; } },
  workerId: "runtime-worker",
  publishIntervalMs: 10
  ,maintenance:async()=>{maintenanceCalls++;}
});

await runtime.start();
await runtime.start();
assert.deepEqual(published, [message]);
await runtime.close();
assert.equal(consumerClosed, true);
assert.equal(dispatcherClosed, true);
assert.equal(maintenanceCalls,1);
const errors=[];let recoveredMaintenance=0;
const failingRuntime=createBackgroundProcessingRuntime({outbox:{claim:async()=>{throw Error('asset outbox unavailable');}},dispatcher:{enqueue:async()=>({jobId:'unused'})},consumer:{close:async()=>{}},workerId:'maintenance-test',publishIntervalMs:10000,onError:async error=>{errors.push(error.message);},maintenance:async()=>{recoveredMaintenance++;}});
await failingRuntime.start();await failingRuntime.close();assert.equal(recoveredMaintenance,1);assert.deepEqual(errors,['asset outbox unavailable']);

console.log("Worker runtime passed: initial outbox drain and graceful shutdown.");
