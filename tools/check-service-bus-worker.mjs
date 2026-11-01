import assert from "node:assert/strict";
import { createAzureServiceBusDispatcher } from "../apps/worker/dist/messaging/azure-service-bus-dispatcher.js";
import { handleAzureServiceBusJobMessage, verifyAzureServiceBusJobMessage } from "../apps/worker/dist/messaging/azure-service-bus-consumer.js";
import {
  createDeterministicAssetProcessor,
  createInMemoryJobStore,
  createInMemoryObjectStorage
} from "../tests/doubles/deterministic-adapters.mjs";

const signingSecret = "local-test-signing-secret-that-is-long-enough";
const tenant = { organizationId: "org_worker_test", actorId: "actor_worker_test", correlationId: "corr_worker_test" };
const job = {
  jobId: "job_worker_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "worker-test", requestHash: "worker-request" },
  tenant,
  payload: { inputAssetVersionId: "assetv_worker_test", sourceType: "pdf", blobKey: "org_worker_test/manual.pdf", sha256: "" }
};
const storage = createInMemoryObjectStorage();
await storage.putObject({ blobKey: job.payload.blobKey, bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" });
job.payload.sha256 = storage.objects.get(job.payload.blobKey).sha256;
const messages = [];
const dispatcher = createAzureServiceBusDispatcher({
  client: {
    createSender() {
      return { async sendMessages(message) { messages.push(message); }, async close() {} };
    }
  },
  queueName: "asset-processing",
  signingSecret
});
await dispatcher.enqueue(job);
await dispatcher.close();

const jobs = createInMemoryJobStore();
await jobs.enqueue(job);

const settle = () => {
  const calls = { complete: 0, abandon: 0, deadLetter: 0 };
  return {
    calls,
    settle: {
      async complete() { calls.complete += 1; },
      async abandon() { calls.abandon += 1; },
      async deadLetter() { calls.deadLetter += 1; }
    }
  };
};

const first = settle();
assert.equal(await handleAzureServiceBusJobMessage({
  message: messages[0],
  signingSecret,
  jobStore: jobs,
  storage,
  processor: createDeterministicAssetProcessor(),
  workerId: "worker-1",
  settle: first.settle
}), "COMPLETED");
assert.deepEqual(first.calls, { complete: 1, abandon: 0, deadLetter: 0 });

const duplicate = settle();
assert.equal(await handleAzureServiceBusJobMessage({
  message: messages[0],
  signingSecret,
  jobStore: jobs,
  storage,
  processor: createDeterministicAssetProcessor(),
  workerId: "worker-2",
  settle: duplicate.settle
}), "COMPLETED");
assert.deepEqual(duplicate.calls, { complete: 1, abandon: 0, deadLetter: 0 });

const tampered = { ...messages[0], body: { ...messages[0].body, envelope: { ...messages[0].body.envelope, tenant: { ...tenant, organizationId: "org_other" } } } };
const invalid = settle();
assert.equal(await handleAzureServiceBusJobMessage({
  message: tampered,
  signingSecret,
  jobStore: jobs,
  storage,
  processor: createDeterministicAssetProcessor(),
  workerId: "worker-3",
  settle: invalid.settle
}), "DEAD_LETTERED");
assert.deepEqual(invalid.calls, { complete: 0, abandon: 0, deadLetter: 1 });

console.log("Service Bus worker passed: verified processing, duplicate completion, and tamper dead-lettering.");

const retryJob = { ...job, jobId: "job_worker_retry_test", idempotency: { key: "worker-retry-test", requestHash: "worker-retry-request" } };
const retryMessages = [];
await dispatcher.enqueue(retryJob);
retryMessages.push(messages.at(-1));
const retryEnvelope = { ...retryJob, attempt: 2 };
await dispatcher.enqueueAt(retryEnvelope, new Date(Date.now() + 30_000).toISOString());
const scheduledMessage = messages.at(-1);
assert.equal(scheduledMessage.messageId, `${retryJob.jobId}:retry:2`);
assert.equal(verifyAzureServiceBusJobMessage(scheduledMessage, signingSecret).jobId, retryJob.jobId);
const retryJobs = createInMemoryJobStore();
await retryJobs.enqueue(retryJob);
const scheduled = [];
const retrySettled = settle();
const retryResult = await handleAzureServiceBusJobMessage({
  message: retryMessages[0],
  signingSecret,
  dispatcher: { async enqueueAt(envelope, availableAt) { scheduled.push({ envelope, availableAt }); } },
  jobStore: retryJobs,
  storage,
  processor: { async inspect() { throw new Error("rehearsal"); }, async process() { throw new Error("unreachable"); } },
  workerId: "worker-retry",
  settle: retrySettled.settle
});
assert.equal(retryResult, "COMPLETED");
assert.equal(scheduled.length, 1);
assert.equal(scheduled[0].envelope.jobId, retryJob.jobId);
assert.equal(retrySettled.calls.complete, 1);
assert.equal(retrySettled.calls.abandon, 0);

console.log("Service Bus worker retry scheduling passed: retryable failures are re-enqueued at their available time.");
