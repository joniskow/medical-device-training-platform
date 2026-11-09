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
  lifecycleStore?: AssetLifecyclePort;
  now?: string;
}): Promise<JobRecord<AssetProcessingRequest> | null> {
  try {
    // The store acquires the current job fence before quarantine I/O. A stale
    // worker cannot delete the source, and failed quarantine rolls back state.
    return await input.jobStore.fail(input.tenant, input.job.jobId, input.workerId, input.job.leaseGeneration ?? 0, input.failure, input.now, undefined, {
      ...(input.lifecycleStore ? {assetTransition:{assetVersionId:input.job.payload.inputAssetVersionId,state:'QUARANTINED' as const,reason:input.reason}} : {}),
      beforeCommit:()=>input.storage.quarantine({blobKey:input.blobKey,reason:input.reason})
    });
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
  signal?:AbortSignal;
}): Promise<JobRecord<AssetProcessingRequest> | null> {
  input.signal?.throwIfAborted();
  const job = await input.jobStore.claim<AssetProcessingRequest>(input.tenant, input.jobId, input.workerId, input.now, DEFAULT_LEASE_SECONDS);
  if (!job) return null;

  const request = job.payload;
  const assetTransition=(state: Parameters<AssetLifecyclePort['transition']>[0]['state'],reason?:string)=>input.lifecycleStore?{assetTransition:{assetVersionId:request.inputAssetVersionId,state,reason}}:undefined;
  if(input.lifecycleStore&&!await input.lifecycleStore.transition({tenant:input.tenant,assetVersionId:request.inputAssetVersionId,state:'PROCESSING',jobLease:{jobId:job.jobId,workerId:input.workerId,leaseGeneration:job.leaseGeneration??0}}))return null;
  if (!request.blobKey.startsWith(`${job.tenant.organizationId}/`)) {
    return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, tenantMismatch(job), input.now, undefined, assetTransition('QUARANTINED','BLOB_TENANT_MISMATCH'));
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
      lifecycleStore:input.lifecycleStore,
      now: input.now
    });
  }

  if (input.scanner) {
    let scan: Awaited<ReturnType<AssetScannerPort["scan"]>>;
    try {
      scan = await input.scanner.scan({ request, storage: input.storage });
    } catch {
      return input.jobStore.fail(
        input.tenant,
        job.jobId,
        input.workerId,
        job.leaseGeneration ?? 0,
        retryable("ASSET_SCAN_FAILED", "The asset scan failed and will be retried"),
        input.now, undefined, assetTransition('SCAN_FAILED','SCANNER_EXCEPTION')
      );
    }
    if (scan.status === "QUARANTINE") {
      const reason = scan.reasons.join(",") || "SCAN_REJECTED";
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
        lifecycleStore:input.lifecycleStore,
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
      lifecycleStore:input.lifecycleStore,
      now: input.now
    });
  }

  try {
    input.signal?.throwIfAborted();
    const result = await input.processor.process(request, job);
    input.signal?.throwIfAborted();
    if (result.status === "FAILED") {
      return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, result.failure ?? {
        class: "TERMINAL",
        code: "PROCESSING_FAILED",
        message: "Asset processor returned FAILED without a failure detail"
      }, input.now, result, assetTransition('PROCESSING_FAILED',result.failure?.code??'PROCESSING_FAILED'));
    }
    return input.jobStore.succeed(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, result, input.now, assetTransition('READY_FOR_REVIEW',result.status==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':undefined));
  } catch (error) {
    if(input.signal?.aborted)throw error;
    return input.jobStore.fail(input.tenant, job.jobId, input.workerId, job.leaseGeneration ?? 0, {
      class: "RETRYABLE",
      code: "WORKER_PROCESSING_EXCEPTION",
      message: "The asset processing step failed and will be retried",
      retryAfterSeconds: 30
    }, input.now);
  }
}
