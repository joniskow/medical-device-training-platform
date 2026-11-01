export type OpaqueId = string;

export type FailureClass =
  | "RETRYABLE"
  | "TERMINAL"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_INPUT"
  | "VALIDATION";

export interface TenantContext {
  organizationId: OpaqueId;
  actorId?: OpaqueId;
  correlationId: string;
  releaseId?: OpaqueId;
  courseVersionId?: OpaqueId;
}

export interface IdempotencyContext {
  key: string;
  requestHash: string;
}

export interface JobEnvelope<TPayload> {
  jobId: OpaqueId;
  jobType: string;
  attempt: number;
  maxAttempts: number;
  idempotency: IdempotencyContext;
  tenant: TenantContext;
  payload: TPayload;
  inputAssetVersionId?: OpaqueId;
  timeoutSeconds?: number;
  deadlineAt?: string;
  codeVersion?: string;
  operatorMetadata?: Record<string, unknown>;
}

export type JobState = "QUEUED" | "RUNNING" | "RETRY_SCHEDULED" | "SUCCEEDED" | "FAILED" | "DEAD_LETTERED";

export interface JobRecord<TPayload> extends JobEnvelope<TPayload> {
  state: JobState;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  leaseGeneration?: number;
  adapterVersion?: string;
  errorClass?: FailureClass;
  lastFailure?: FailureDetail;
  outputArtifactIds?: OpaqueId[];
  outcome?: JobOutcome;
}

export interface Warning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface UsageMetrics {
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface JobOutcome {
  adapter: string;
  adapterVersion: string;
  outputArtifactIds: OpaqueId[];
  status: "READY" | "REVIEW_REQUIRED" | "FAILED";
  warnings: Warning[];
  metrics: UsageMetrics;
  failure?: FailureDetail;
  details?: Record<string, unknown>;
}

export interface FailureDetail {
  class: FailureClass;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface OperatorRetryRequest {
  actorId: OpaqueId;
  reason: string;
  now?: string;
}

export interface JobAuditEvent {
  auditId: OpaqueId;
  jobId: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  eventType: "OPERATOR_RETRY";
  reason: string;
  details: Record<string, unknown>;
  createdAt: string;
}
