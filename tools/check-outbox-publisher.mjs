import assert from "node:assert/strict";
import { publishOneOutboxMessage } from "../apps/worker/dist/outbox-publisher.js";

const message = {
  jobId: "job_outbox_publisher_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "publisher-test", requestHash: "publisher-request" },
  tenant: { organizationId: "org_publisher_test", actorId: "actor_publisher_test", correlationId: "corr_publisher_test" },
  payload: { inputAssetVersionId: "assetv_publisher_test", sourceType: "pdf", blobKey: "org_publisher_test/manual.pdf", sha256: "hash" }
};

function fakeOutbox(item) {
  const calls = { published: [], failed: [] };
  return {
    calls,
    async claim() { return item; },
    async markPublished(outboxId, workerId) { calls.published.push({ outboxId, workerId }); return true; },
    async markFailed(outboxId, workerId, failure) { calls.failed.push({ outboxId, workerId, failure }); return true; }
  };
}

const outbox = fakeOutbox({
  outboxId: "outbox_publisher_test",
  jobId: message.jobId,
  tenant: message.tenant,
  message,
  state: "CLAIMED",
  attempt: 1,
  maxAttempts: 10,
  availableAt: new Date(0).toISOString()
});
const sent = [];
const published = await publishOneOutboxMessage({
  outbox,
  dispatcher: { async enqueue(job) { sent.push(job); return { jobId: job.jobId }; } },
  workerId: "publisher-1"
});
assert.deepEqual(published, { status: "PUBLISHED", outboxId: "outbox_publisher_test", jobId: message.jobId });
assert.deepEqual(sent, [message]);
assert.deepEqual(outbox.calls.published, [{ outboxId: "outbox_publisher_test", workerId: "publisher-1" }]);

const failedOutbox = fakeOutbox({
  outboxId: "outbox_publisher_failure",
  jobId: message.jobId,
  tenant: message.tenant,
  message,
  state: "CLAIMED",
  attempt: 1,
  maxAttempts: 10,
  availableAt: new Date(0).toISOString()
});
const failed = await publishOneOutboxMessage({
  outbox: failedOutbox,
  dispatcher: { async enqueue() { throw new Error("SERVICE_BUS_UNAVAILABLE"); } },
  workerId: "publisher-2"
});
assert.deepEqual(failed, { status: "FAILED", outboxId: "outbox_publisher_failure", jobId: message.jobId });
assert.equal(failedOutbox.calls.failed.length, 1);
assert.equal(failedOutbox.calls.failed[0].failure.code, "OUTBOX_PUBLISH_FAILED");

const empty = await publishOneOutboxMessage({
  outbox: { async claim() { return null; }, async markPublished() { return false; }, async markFailed() { return false; } },
  dispatcher: { async enqueue() { throw new Error("NOT_CALLED"); } },
  workerId: "publisher-3"
});
assert.deepEqual(empty, { status: "EMPTY" });

console.log("Outbox publisher passed: publish, retry recording, and empty-queue behavior.");
