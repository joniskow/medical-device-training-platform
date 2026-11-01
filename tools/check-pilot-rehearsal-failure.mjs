import assert from "node:assert/strict";
const request = {
  inputAssetVersionId: "assetv_rehearsal_test",
  sourceType: "pdf",
  blobKey: "org_rehearsal_test/manual.pdf",
  sha256: "rehearsal-hash",
  sizeBytes: 1
};

delete process.env.WORKER_REHEARSAL_FAILURE_ENABLED;
delete process.env.WORKER_REHEARSAL_FAILURE_MODE;
const normalProcessor = (await import("../apps/worker/dist/pilot-asset-processor.js?normal")).createAssetProcessor();
const result = await normalProcessor.inspect(request);
assert.equal(result.supported, true);

process.env.WORKER_REHEARSAL_FAILURE_ENABLED = "true";
process.env.WORKER_REHEARSAL_FAILURE_MODE = "retryable-inspect";
const rehearsalProcessor = (await import("../apps/worker/dist/pilot-asset-processor.js?rehearsal")).createAssetProcessor();
await assert.rejects(() => rehearsalProcessor.inspect(request), /REHEARSAL_RETRYABLE_INSPECTION_FAILURE/);

console.log("Pilot processor rehearsal passed: default inspection is healthy and explicit retryable injection is isolated.");
