import assert from "node:assert/strict";
import { createBackgroundProcessingRuntime } from "../apps/worker/dist/worker-runtime.js";

const tenant = { organizationId: "org_recovery_test", actorId: "actor_recovery_test", correlationId: "corr_recovery_test" };
const message = {
  jobId: "job_recovery_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "recovery-test", requestHash: "recovery-request" },
  tenant,
  payload: { inputAssetVersionId: "assetv_recovery_test", sourceType: "pdf", blobKey: "org_recovery_test/manual.pdf", sha256: "hash" }
};

let state = "PENDING";
let claimCount = 0;
let failedCount = 0;
let publishedCount = 0;
const outbox = {
  async claim(workerId) {
    if (state !== "PENDING") return null;
    state = "CLAIMED";
    claimCount += 1;
    return {
      outboxId: "outbox:job_recovery_test",
      jobId: message.jobId,
      tenant,
      message,
      state: "CLAIMED",
      attempt: claimCount,
      maxAttempts: 3,
      availableAt: new Date(0).toISOString(),
      claimedBy: workerId
    };
  },
  async markPublished(outboxId, workerId) {
    if (outboxId !== "outbox:job_recovery_test" || state !== "CLAIMED" || !workerId) return false;
    state = "PUBLISHED";
    publishedCount += 1;
    return true;
  },
  async markFailed(outboxId, workerId) {
    if (outboxId !== "outbox:job_recovery_test" || state !== "CLAIMED" || !workerId) return false;
    state = "PENDING";
    failedCount += 1;
    return true;
  }
};

let firstConsumerClosed = false;
const firstRuntime = createBackgroundProcessingRuntime({
  outbox,
  dispatcher: {
    async enqueue() { throw new Error("simulated broker outage"); },
    async close() {}
  },
  consumer: { async close() { firstConsumerClosed = true; } },
  workerId: "worker-restarted-a",
  publishIntervalMs: 1_000
});
await firstRuntime.start();
await firstRuntime.close();
assert.equal(firstConsumerClosed, true);
assert.equal(state, "PENDING");
assert.equal(failedCount, 1);

let secondConsumerClosed = false;
const secondRuntime = createBackgroundProcessingRuntime({
  outbox,
  dispatcher: {
    async enqueue() {},
    async close() {}
  },
  consumer: { async close() { secondConsumerClosed = true; } },
  workerId: "worker-restarted-b",
  publishIntervalMs: 1_000
});
await secondRuntime.start();
await secondRuntime.close();
assert.equal(secondConsumerClosed, true);
assert.equal(state, "PUBLISHED");
assert.equal(publishedCount, 1);
assert.equal(claimCount, 2);

console.log("Worker recovery passed: failed outbox publication remained replayable across restart and was published exactly once.");
