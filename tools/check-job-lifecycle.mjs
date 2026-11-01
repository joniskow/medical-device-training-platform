import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { processAssetJob as processAssetJobImpl } from "../apps/worker/dist/job-runner.js";
import { createDeterministicAssetScanner } from "../apps/worker/dist/asset-scanner.js";
import {
  createDeterministicAssetProcessor,
  createInMemoryJobStore,
  createInMemoryObjectStorage
} from "../tests/doubles/deterministic-adapters.mjs";

const root = resolve(import.meta.dirname, "..");
const fixturePath = resolve(root, "fixtures/reference/manual/aurora-infusion-controller-manual.pdf");
const bytes = await readFile(fixturePath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const tenant = { organizationId: "org_fixture", actorId: "actor_fixture", correlationId: "corr_fixture" };
const processAssetJob = (input) => processAssetJobImpl({ tenant, ...input });
const claimJob = (store, jobId, workerId, now, leaseSeconds) => store.claim(tenant, jobId, workerId, now, leaseSeconds);
const succeedJob = (store, jobId, workerId, leaseGeneration, outcome, now) => store.succeed(tenant, jobId, workerId, leaseGeneration, outcome, now);
const basePayload = { inputAssetVersionId: "assetv_fixture", sourceType: "pdf", blobKey: "org_fixture/AIC-001/manual.pdf", sha256 };
const baseJob = (suffix, payloadOverrides = {}, options = {}) => ({
  jobId: `job_${suffix}`,
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: options.maxAttempts ?? 3,
  idempotency: { key: `asset-process:${suffix}`, requestHash: sha256 },
  tenant,
  payload: { ...basePayload, ...payloadOverrides }
});

const storage = createInMemoryObjectStorage();
const scanner = createDeterministicAssetScanner();
await storage.putObject({ blobKey: basePayload.blobKey, bytes, contentType: "application/pdf" });
const jobs = createInMemoryJobStore();
const first = await jobs.enqueue(baseJob("success"));
const success = await processAssetJob({ jobStore: jobs, storage, processor: createDeterministicAssetProcessor(), jobId: first.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(success.state, "SUCCEEDED");
assert.equal(success.outputArtifactIds.length, 1);
assert.equal(await processAssetJob({ jobStore: jobs, storage, processor: createDeterministicAssetProcessor(), jobId: first.jobId, workerId: "worker-2", now: "1970-01-01T00:00:01.000Z" }), null);

const concurrentJobs = createInMemoryJobStore();
const concurrentJob = await concurrentJobs.enqueue(baseJob("concurrent"));
let concurrentCalls = 0;
const concurrentProcessor = {
  ...createDeterministicAssetProcessor(),
  async process(request, job) {
    concurrentCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return createDeterministicAssetProcessor().process(request, job);
  }
};
const concurrentResults = await Promise.all([
  processAssetJob({ jobStore: concurrentJobs, storage, processor: concurrentProcessor, jobId: concurrentJob.jobId, workerId: "worker-a", now: "1970-01-01T00:00:00.000Z" }),
  processAssetJob({ jobStore: concurrentJobs, storage, processor: concurrentProcessor, jobId: concurrentJob.jobId, workerId: "worker-b", now: "1970-01-01T00:00:00.000Z" })
]);
assert.equal(concurrentCalls, 1);
assert.equal(concurrentResults.filter(Boolean).length, 1);
assert.equal(concurrentResults.find(Boolean).state, "SUCCEEDED");

const leaseJobs = createInMemoryJobStore();
const leaseJob = await leaseJobs.enqueue(baseJob("lease-recovery"));
const firstLease = await claimJob(leaseJobs, leaseJob.jobId, "worker-a", "1970-01-01T00:00:00.000Z", 10);
assert.equal(firstLease.leaseOwner, "worker-a");
assert.equal(await claimJob(leaseJobs, leaseJob.jobId, "worker-b", "1970-01-01T00:00:05.000Z", 10), null);
const recoveredLease = await claimJob(leaseJobs, leaseJob.jobId, "worker-a", "1970-01-01T00:00:11.000Z", 10);
assert.equal(recoveredLease.leaseOwner, "worker-a");
assert.notEqual(recoveredLease.leaseGeneration, firstLease.leaseGeneration);
assert.equal(await succeedJob(leaseJobs, leaseJob.jobId, "worker-a", firstLease.leaseGeneration, {
  adapter: "stale-worker",
  adapterVersion: "1",
  outputArtifactIds: ["stale-artifact"],
  status: "READY",
  warnings: [],
  metrics: {}
}, "1970-01-01T00:00:12.000Z"), null);

const badBytes = Uint8Array.from(bytes);
badBytes[badBytes.length - 1] ^= 1;
await storage.putObject({ blobKey: "org_fixture/AIC-001/bad.pdf", bytes: badBytes, contentType: "application/pdf" });
const checksumJob = await jobs.enqueue(baseJob("checksum", { blobKey: "org_fixture/AIC-001/bad.pdf" }));
const checksumFailure = await processAssetJob({ jobStore: jobs, storage, processor: createDeterministicAssetProcessor(), jobId: checksumJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(checksumFailure.state, "FAILED");
assert.equal(storage.objects.get("org_fixture/AIC-001/bad.pdf").quarantined, true);

const quarantineFailureStorage = createInMemoryObjectStorage();
await quarantineFailureStorage.putObject({ blobKey: "org_fixture/AIC-001/quarantine-failure.pdf", bytes: badBytes, contentType: "application/pdf" });
quarantineFailureStorage.quarantine = async () => { throw new Error("QUARANTINE_PROVIDER_DOWN"); };
const quarantineFailureJobs = createInMemoryJobStore();
const quarantineFailureJob = await quarantineFailureJobs.enqueue(baseJob("quarantine-failure", { blobKey: "org_fixture/AIC-001/quarantine-failure.pdf" }));
const quarantineFailure = await processAssetJob({ jobStore: quarantineFailureJobs, storage: quarantineFailureStorage, processor: createDeterministicAssetProcessor(), jobId: quarantineFailureJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(quarantineFailure.state, "RETRY_SCHEDULED");
assert.equal(quarantineFailure.lastFailure.code, "QUARANTINE_FAILED");

const storageOutage = createInMemoryObjectStorage();
storageOutage.verifyChecksum = async () => { throw new Error("BLOB_PROVIDER_UNAVAILABLE"); };
const storageOutageJobs = createInMemoryJobStore();
const storageOutageJob = await storageOutageJobs.enqueue(baseJob("storage-outage"));
const storageOutageFailure = await processAssetJob({ jobStore: storageOutageJobs, storage: storageOutage, processor: createDeterministicAssetProcessor(), jobId: storageOutageJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(storageOutageFailure.state, "RETRY_SCHEDULED");
assert.equal(storageOutageFailure.lastFailure.code, "STORAGE_CHECKSUM_READ_FAILED");

await storage.putObject({ blobKey: "org_fixture/AIC-001/unsupported.cad", bytes, contentType: "application/octet-stream" });
const unsupportedJob = await jobs.enqueue(baseJob("unsupported", { sourceType: "cad", blobKey: "org_fixture/AIC-001/unsupported.cad" }));
const unsupportedFailure = await processAssetJob({ jobStore: jobs, storage, processor: createDeterministicAssetProcessor(), jobId: unsupportedJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(unsupportedFailure.state, "FAILED");
assert.equal(storage.objects.get("org_fixture/AIC-001/unsupported.cad").quarantined, true);

const malwareBytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")]);
const malwareBlobKey = "org_fixture/AIC-001/malware.pdf";
await storage.putObject({ blobKey: malwareBlobKey, bytes: malwareBytes, contentType: "application/pdf" });
const malwareJob = await jobs.enqueue(baseJob("malware", {
  blobKey: malwareBlobKey,
  sha256: storage.objects.get(malwareBlobKey).sha256,
  sizeBytes: malwareBytes.length,
  contentType: "application/pdf"
}));
const malwareFailure = await processAssetJob({ jobStore: jobs, storage, processor: createDeterministicAssetProcessor(), scanner, jobId: malwareJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(malwareFailure.state, "FAILED");
assert.equal(malwareFailure.lastFailure.code, "ASSET_SCAN_REJECTED");
assert.equal(storage.objects.get(malwareBlobKey).quarantined, true);

const retryStorage = createInMemoryObjectStorage();
await retryStorage.putObject({ blobKey: basePayload.blobKey, bytes, contentType: "application/pdf" });
const retryJobs = createInMemoryJobStore();
const retryJob = await retryJobs.enqueue(baseJob("retry", {}, { maxAttempts: 2 }));
let calls = 0;
const retryProcessor = {
  ...createDeterministicAssetProcessor(),
  async process(request, job) {
    calls += 1;
    if (calls === 1) throw new Error("temporary provider outage");
    return createDeterministicAssetProcessor().process(request, job);
  }
};
const scheduled = await processAssetJob({ jobStore: retryJobs, storage: retryStorage, processor: retryProcessor, jobId: retryJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(scheduled.state, "RETRY_SCHEDULED");
assert.equal(scheduled.attempt, 2);
const retried = await processAssetJob({ jobStore: retryJobs, storage: retryStorage, processor: retryProcessor, jobId: retryJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:31.000Z" });
assert.equal(retried.state, "SUCCEEDED");
assert.equal(calls, 2);

const deadJobs = createInMemoryJobStore();
const deadJob = await deadJobs.enqueue(baseJob("dead", {}, { maxAttempts: 2 }));
const alwaysFails = { ...createDeterministicAssetProcessor(), async process() { throw new Error("provider unavailable"); } };
const deadFirst = await processAssetJob({ jobStore: deadJobs, storage: retryStorage, processor: alwaysFails, jobId: deadJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(deadFirst.state, "RETRY_SCHEDULED");
const deadSecond = await processAssetJob({ jobStore: deadJobs, storage: retryStorage, processor: alwaysFails, jobId: deadJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:31.000Z" });
assert.equal(deadSecond.state, "DEAD_LETTERED");

const boundaryJobs = createInMemoryJobStore();
const boundaryJob = await boundaryJobs.enqueue(baseJob("boundary", { blobKey: "org_other/AIC-001/manual.pdf" }));
const boundaryFailure = await processAssetJob({ jobStore: boundaryJobs, storage: retryStorage, processor: createDeterministicAssetProcessor(), jobId: boundaryJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(boundaryFailure.state, "FAILED");
assert.equal(boundaryFailure.lastFailure.code, "BLOB_TENANT_MISMATCH");

const reviewJobs = createInMemoryJobStore();
const reviewJob = await reviewJobs.enqueue(baseJob("review"));
const reviewProcessor = {
  inspect: async () => ({ supported: true, reasons: [] }),
  canProcess: async () => true,
  async process() {
    return {
      adapter: "fixture-review-processor",
      adapterVersion: "1",
      inputAssetVersionId: "assetv_fixture",
      outputArtifactIds: ["artifact_review"],
      status: "REVIEW_REQUIRED",
      warnings: [{ code: "LOW_QUALITY", severity: "warning", message: "Human review required" }],
      metrics: { durationMs: 4, inputBytes: 10, outputBytes: 20 },
      details: { qualityScore: 0.4 }
    };
  }
};
const reviewResult = await processAssetJob({ jobStore: reviewJobs, storage, processor: reviewProcessor, jobId: reviewJob.jobId, workerId: "worker-1", now: "1970-01-01T00:00:00.000Z" });
assert.equal(reviewResult.state, "SUCCEEDED");
assert.equal(reviewResult.outcome.status, "REVIEW_REQUIRED");
assert.equal(reviewResult.outcome.warnings[0].code, "LOW_QUALITY");
assert.equal(reviewResult.outcome.metrics.durationMs, 4);
assert.equal(reviewResult.outcome.details.qualityScore, 0.4);

console.log("Job lifecycle passed: success, duplicate suppression, quarantine, retry, dead letter, tenant boundary, and lease fencing.");
