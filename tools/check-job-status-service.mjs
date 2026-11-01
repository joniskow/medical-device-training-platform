import assert from "node:assert/strict";
import { createJobStatusService } from "../apps/api/dist/job-status-service.js";

const tenant = { organizationId: "org_status_service", actorId: "actor_status_service", correlationId: "corr_status_service" };
const base = {
  jobId: "job_status_service",
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 3,
  idempotency: { key: "status-service-key", requestHash: "status-service-hash" },
  tenant,
  payload: { inputAssetVersionId: "assetv_status_service" },
  createdAt: "2026-10-22T20:00:00.000Z",
  updatedAt: "2026-10-22T20:00:00.000Z",
  availableAt: "2026-10-22T20:00:00.000Z"
};

let current = { ...base, state: "DEAD_LETTERED", errorClass: "RETRYABLE", lastFailure: { class: "RETRYABLE", code: "TEMPORARY", message: "temporary" } };
const store = {
  async get() { return current; },
  async retry(_tenant, _jobId, _request) {
    current = { ...current, state: "QUEUED", attempt: 1, errorClass: undefined, lastFailure: undefined };
    return current;
  }
};
const service = createJobStatusService(store);

const retryStatus = await service.get(tenant, current.jobId);
assert.equal(retryStatus.canRetry, true);
assert.equal(retryStatus.nextAction, "RETRY");
assert.equal("payload" in retryStatus, false);

const queuedStatus = await service.retry(tenant, current.jobId, { actorId: "operator-1", reason: "retry after provider recovery" });
assert.equal(queuedStatus.state, "QUEUED");
assert.equal(queuedStatus.canRetry, false);
assert.equal(queuedStatus.nextAction, "WAIT");

current = { ...base, state: "SUCCEEDED", outcome: { adapter: "pilot", adapterVersion: "1", outputArtifactIds: [], status: "REVIEW_REQUIRED", warnings: [], metrics: {} } };
const reviewStatus = await service.get(tenant, current.jobId);
assert.equal(reviewStatus.nextAction, "REVIEW");

console.log("Job status service passed: safe status projection, retry eligibility, next-action guidance, and operator retry mapping.");
