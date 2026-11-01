import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createAzureServiceBusDispatcher, canonicalJobMessage } from "../apps/worker/dist/messaging/azure-service-bus-dispatcher.js";

const messages = [];
const client = {
  createSender(queueName) {
    assert.equal(queueName, "asset-processing");
    return {
      async sendMessages(batch) { messages.push(...(Array.isArray(batch) ? batch : [batch])); },
      async close() {}
    };
  }
};
const signingSecret = "local-test-signing-secret-that-is-long-enough";
const dispatcher = createAzureServiceBusDispatcher({ client, queueName: "asset-processing", signingSecret });
const job = {
  jobId: "job_bus_test",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "bus-test", requestHash: "bus-request" },
  tenant: { organizationId: "org_bus_test", correlationId: "corr_bus_test" },
  payload: { inputAssetVersionId: "assetv_bus_test", sourceType: "glb", blobKey: "org_bus_test/device.glb", sha256: "hash" }
};

assert.deepEqual(await dispatcher.enqueue(job), { jobId: job.jobId });
assert.equal(messages.length, 1);
const message = messages[0];
assert.equal(message.messageId, job.jobId);
assert.equal(message.subject, job.jobType);
assert.equal(message.correlationId, job.tenant.correlationId);
assert.equal(message.applicationProperties.tenantId, job.tenant.organizationId);
assert.equal(message.body.schemaVersion, "job-message.v1");
assert.equal(message.body.envelope.jobId, job.jobId);
assert.equal(message.body.integrity.algorithm, "HMAC-SHA256");
assert.equal(message.body.integrity.signature, createHmac("sha256", signingSecret).update(canonicalJobMessage(job)).digest("hex"));
await dispatcher.close();
console.log("Service Bus dispatcher passed: server-created envelope, tenant metadata, correlation, and HMAC integrity.");
