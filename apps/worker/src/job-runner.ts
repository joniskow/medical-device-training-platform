import type {
  AssetProcessingRequest,
  AssetProcessorPort,
  AssetLifecyclePort,
  AssetScannerPort,
  FailureDetail,
  JobRecord,
  JobStorePort,
  PrivateObjectStoragePort,
  TenantContext
} from "@medical-device/contracts";

const DEFAULT_LEASE_SECONDS = 300;

const tenantMismatch = (job: JobRecord<AssetProcessingRequest>): FailureDetail => ({
  class: "UNAUTHORIZED",
  code: "BLOB_TENANT_MISMATCH",
  message: `Blob key is outside organization ${job.tenant.organizationId}`
});

const retryable = (code: string, message: string): FailureDetail => ({
  class: "RETRYABLE",
  code,
  message,
  retryAfterSeconds: 30
});

async function quarantineThenFail(input: {
  jobStore: JobStorePort;
  storage: PrivateObjectStoragePort;
  job: JobRecord<AssetProcessingRequest>;
  tenant: TenantContext;
  workerId: string;
  blobKey: string;
  reason: string;
  failure: FailureDetail;
  now?: string;
}): Promise<JobRecord<AssetProcessingRequest> | null> {
  try {
    await input.storage.quarantine({ blobKey: input.blobKey, reason: input.reason });
  } catch {
    return input.jobStore.fail(
      input.tenant,
      input.job.jobId,
      input.workerId,
      input.job.leaseGeneration ?? 0,
      retryable("QUARANTINE_FAILED", "The source could not be quarantined; processing will be retried"),
      input.now
    );
  }
  return input.jobStore.fail(input.tenant, input.job.jobId, input.workerId, input.job.leaseGeneration ?? 0, input.failure, input.now);
}

export async function processAssetJob(input: {
  jobStore: JobStorePort;
  storage: PrivateObjectStoragePort;
  processor: AssetProcessorPort;
  tenant: TenantContext;
  jobId: string;
  workerId: string;
  lifecycleStore?: AssetLifecyclePort;
  scanner?: AssetScannerPort;
  now?: string;
}): Promise<JobRecord<AssetProcessingRequest> | null> {
  const job = await input.jobStore.claim<AssetProcessingRequest>(input.tenant, input.jobId, input.workerId, input.now, DEFAULT_LEASE_SECONDS);
  if (!job) return null;

  const request = job.payload;
  await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "PROCESSING" });
  if (!request.blobKey.startsWith(`${job.tenant.organizationId}/`)) {
    await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "QUARANTINED", reason: "BLOB_TENANT_MISMATCH" });
    return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, tenantMismatch(job), input.now);
  }

  let checksumMatches: boolean;
  try {
    checksumMatches = await input.storage.verifyChecksum({ blobKey: request.blobKey, expectedSha256: request.sha256, maxBytes: request.sizeBytes });
  } catch {
    return input.jobStore.fail(
      input.tenant,
      job.jobId,
      input.workerId,
      job.leaseGeneration ?? 0,
      retryable("STORAGE_CHECKSUM_READ_FAILED", "The source could not be read for checksum verification"),
      input.now
    );
  }

  if (!checksumMatches) {
    await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "QUARANTINED", reason: "CHECKSUM_MISMATCH" });
    return quarantineThenFail({
      jobStore: input.jobStore,
      storage: input.storage,
      job,
      tenant: input.tenant,
      workerId: input.workerId,
      blobKey: request.blobKey,
      reason: "CHECKSUM_MISMATCH",
      failure: {
        class: "VALIDATION",
        code: "CHECKSUM_MISMATCH",
        message: "Source checksum does not match the immutable asset version"
      },
      now: input.now
    });
  }

  if (input.scanner) {
    let scan: Awaited<ReturnType<AssetScannerPort["scan"]>>;
    try {
      scan = await input.scanner.scan({ request, storage: input.storage });
    } catch {
      await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "SCAN_FAILED", reason: "SCANNER_EXCEPTION" });
      return input.jobStore.fail(
        input.tenant,
        job.jobId,
        input.workerId,
        job.leaseGeneration ?? 0,
        retryable("ASSET_SCAN_FAILED", "The asset scan failed and will be retried"),
        input.now
      );
    }
    if (scan.status === "QUARANTINE") {
      const reason = scan.reasons.join(",") || "SCAN_REJECTED";
      await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "QUARANTINED", reason });
      return quarantineThenFail({
        jobStore: input.jobStore,
        storage: input.storage,
        job,
        tenant: input.tenant,
        workerId: input.workerId,
        blobKey: request.blobKey,
        reason,
        failure: {
          class: "VALIDATION",
          code: "ASSET_SCAN_REJECTED",
          message: reason
        },
        now: input.now
      });
    }
  }

  let inspection: Awaited<ReturnType<AssetProcessorPort["inspect"]>>;
  try {
    inspection = await input.processor.inspect(request);
  } catch {
    return input.jobStore.fail(
      input.tenant,
      job.jobId,
      input.workerId,
      job.leaseGeneration ?? 0,
      retryable("WORKER_INSPECTION_EXCEPTION", "The asset inspection step failed and will be retried"),
      input.now
    );
  }

  if (!inspection.supported) {
    await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "QUARANTINED", reason: inspection.reasons.join(",") || "UNSUPPORTED_INPUT" });
    return quarantineThenFail({
      jobStore: input.jobStore,
      storage: input.storage,
      job,
      tenant: input.tenant,
      workerId: input.workerId,
      blobKey: request.blobKey,
      reason: inspection.reasons.join(",") || "UNSUPPORTED_INPUT",
      failure: {
        class: "UNSUPPORTED_INPUT",
        code: "UNSUPPORTED_INPUT",
        message: inspection.reasons.join(",") || "Asset source type is not supported"
      },
      now: input.now
    });
  }

  try {
    const result = await input.processor.process(request, job);
    if (result.status === "FAILED") {
      await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "PROCESSING_FAILED", reason: result.failure?.code ?? "PROCESSING_FAILED" });
      return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, result.failure ?? {
        class: "TERMINAL",
        code: "PROCESSING_FAILED",
        message: "Asset processor returned FAILED without a failure detail"
      }, input.now, result);
    }
    await input.lifecycleStore?.transition({ tenant: input.tenant, assetVersionId: request.inputAssetVersionId, state: "READY_FOR_REVIEW", reason: result.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : undefined });
    return input.jobStore.succeed(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, result, input.now);
  } catch (error) {
    return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, {
      class: "RETRYABLE",
      code: "WORKER_PROCESSING_EXCEPTION",
      message: error instanceof Error ? error.message : "Unknown worker processing exception",
      retryAfterSeconds: 30
    }, input.now);
  }
}
