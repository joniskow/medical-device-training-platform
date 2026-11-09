import type {
  JobOutcome,
  JobRecord,
  JobState,
  JobStorePort,
  OperatorRetryRequest,
  TenantContext
} from "@medical-device/contracts";

export type JobNextAction = "WAIT" | "REVIEW" | "RETRY" | "CONTACT_OPERATOR" | "NONE";

export interface JobStatusResponse {
  jobId: string;
  jobType: string;
  state: JobState;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  leaseExpiresAt?: string;
  errorClass?: JobRecord<unknown>["errorClass"];
  lastFailure?: JobRecord<unknown>["lastFailure"];
  outcome?: JobOutcome;
  canRetry: boolean;
  nextAction: JobNextAction;
}

function nextAction<TPayload>(job: JobRecord<TPayload>, canRetry: boolean): JobNextAction {
  if (canRetry) return "RETRY";
  if (job.state === "QUEUED" || job.state === "RUNNING" || job.state === "RETRY_SCHEDULED") return "WAIT";
  if (job.state === "SUCCEEDED" && job.outcome?.status === "REVIEW_REQUIRED") return "REVIEW";
  if (job.state === "FAILED" || job.state === "DEAD_LETTERED") return "CONTACT_OPERATOR";
  return "NONE";
}

export function toJobStatus<TPayload>(job: JobRecord<TPayload>): JobStatusResponse {
  const canRetry = job.operatorMetadata?.cancelled !== true && (job.state === "FAILED" || job.state === "DEAD_LETTERED") && job.errorClass === "RETRYABLE";
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    state: job.state,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    availableAt: job.availableAt,
    leaseExpiresAt: job.leaseExpiresAt,
    errorClass: job.errorClass,
    // Older records may contain provider exception text; never return it verbatim.
    lastFailure: safeFailure(job.lastFailure),
    outcome: job.outcome ? {...job.outcome, failure: safeFailure(job.outcome.failure)} : undefined,
    canRetry,
    nextAction: nextAction(job, canRetry)
  };
}

function safeFailure(failure: JobRecord<unknown>['lastFailure']) {
  return failure ? {...failure, message: 'Processing could not complete. Refer to the failure code for the next action.'} : undefined;
}

export function createJobStatusService(store: JobStorePort) {
  return {
    async get(tenant: TenantContext, jobId: string): Promise<JobStatusResponse | null> {
      const job = await store.get(tenant, jobId);
      return job ? toJobStatus(job) : null;
    },

    async retry(tenant: TenantContext, jobId: string, request: OperatorRetryRequest): Promise<JobStatusResponse | null> {
      const current = await store.get(tenant, jobId);
      if (current?.operatorMetadata?.cancelled === true) return null;
      const job = await store.retry(tenant, jobId, request);
      return job ? toJobStatus(job) : null;
    }
  };
}
