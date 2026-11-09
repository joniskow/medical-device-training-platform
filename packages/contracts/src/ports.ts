import type {
  FailureDetail,
  JobOutcome,
  JobRecord,
  JobEnvelope,
  OpaqueId,
  OperatorRetryRequest,
  TenantContext,
  UsageMetrics,
  Warning
} from "./common.js";

export interface AssetProcessingRequest {
  inputAssetVersionId: OpaqueId;
  sourceType: AssetSourceType;
  blobKey: string;
  sha256: string;
  sizeBytes?: number;
  contentType?: string;
}

export type AssetSourceType = "pdf" | "image" | "video" | "gltf" | "glb";

export type AssetLifecycleState =
  | "UPLOADING"
  | "READY_FOR_SCAN"
  | "QUARANTINED"
  | "SCAN_FAILED"
  | "READY_FOR_PROCESSING"
  | "PROCESSING"
  | "PROCESSING_FAILED"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "RETIRED";

export interface UploadSessionRequest {
  productId?: OpaqueId;
  sourceType: AssetSourceType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  actorId: OpaqueId;
  tenant: TenantContext;
}

export interface UploadSessionRecord {
  uploadSessionId: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  productId?: OpaqueId;
  sourceType: AssetSourceType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  blobKey: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "EXPIRED";
  expiresAt: string;
  completedAssetVersionId?: OpaqueId;
}

export interface AssetVersionRecord {
  assetVersionId: OpaqueId;
  assetId: OpaqueId;
  organizationId: OpaqueId;
  productId?: OpaqueId;
  sourceType: AssetSourceType;
  blobKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  state: AssetLifecycleState;
  reason?: string;
}

export interface UploadSessionStore {
  create(input: UploadSessionRequest & { blobKey: string; expiresAt: string }): Promise<UploadSessionRecord>;
  get(tenant: TenantContext, uploadSessionId: OpaqueId): Promise<UploadSessionRecord | null>;
  complete(input: {
    tenant: TenantContext;
    uploadSessionId: OpaqueId;
    blobKey: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    now?: string;
  }): Promise<{ session: UploadSessionRecord; assetVersion: AssetVersionRecord } | null>;
  cancel(tenant: TenantContext, uploadSessionId: OpaqueId, now?: string): Promise<boolean>;
}

export interface KnowledgeChunkRecord {
  /** English lexical rank; zero explicitly reports no query term match, not complete relevance. */
  retrievalScore?: number;
  /** Hybrid ordering score, never evidence that a passage supports the instruction. */
  retrievalRankScore?:number;
  retrievalConfigurationId?:string;
  sourceChunkCount?: number;
  sourceHash?: string;
  chunkId: OpaqueId;
  organizationId: OpaqueId;
  assetVersionId: OpaqueId;
  text: string;
  citation: Record<string, unknown>;
  heading?: string;
}

export interface KnowledgeStorePort {
  reviewSource?(tenant: TenantContext, assetVersionId: string, input: {sourceHash:string; decision:'APPROVE'|'REJECT'; rationale:string; idempotencyKey:string}): Promise<{state:string}>;
  readSource(tenant: TenantContext, assetVersionId: OpaqueId, after?: string): Promise<{ assetVersionId: OpaqueId; fileName: string; sourceHash: string; items: KnowledgeChunkRecord[]; nextCursor?: string } | null>;
  listSources(tenant: TenantContext, after?: string): Promise<{ items: Array<{ assetVersionId: OpaqueId; fileName: string; state: string; chunkCount: number }>; nextCursor?: string }>;
  replaceForAssetVersion(tenant: TenantContext, assetVersionId: OpaqueId, chunks: readonly KnowledgeChunkRecord[]): Promise<void>;
  search(tenant: TenantContext, query: string, limit?: number): Promise<KnowledgeChunkRecord[]>;
  listForAssetVersions(tenant: TenantContext, assetVersionIds: readonly OpaqueId[], limit?: number, query?: string): Promise<KnowledgeChunkRecord[]>;
}

export interface AiRunStorePort {
  record(input: { tenant: TenantContext; request: AiGatewayRequest; result: AiGatewayResult; promptVersion: string; courseVersionId?: OpaqueId }): Promise<OpaqueId>;
}

export type ReviewTargetType = "COURSE" | "AI_DRAFT" | "SOURCE" | "MODEL" | "SIMULATION" | "ASSESSMENT" | "POLICY" | "VIDEO_LESSON";
export type ReviewDecision = "APPROVE" | "REJECT" | "NEEDS_CHANGES";

export interface CourseReviewDecisionRecord {
  decisionId: OpaqueId;
  organizationId: OpaqueId;
  courseVersionId: OpaqueId;
  targetType: ReviewTargetType;
  targetId: OpaqueId;
  decision: ReviewDecision;
  rationale: string;
  actorId: OpaqueId;
  revision: number;
  createdAt: string;
}

export interface ReleaseManifestRecord {
  releaseId: OpaqueId;
  organizationId: OpaqueId;
  courseVersionId: OpaqueId;
  status: "PUBLISHED" | "SUPERSEDED" | "RETIRED";
  releaseHash: string;
  manifest: Record<string, unknown>;
  publishedBy: OpaqueId;
  createdAt: string;
}

export interface CourseReviewSnapshot {
  courseVersion: {
    courseVersionId: OpaqueId;
    revision: number;
    status: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED";
    content: Record<string, unknown>;
    createdBy: OpaqueId;
    releaseManifestId?: OpaqueId;
  };
  decisions: CourseReviewDecisionRecord[];
  release?: ReleaseManifestRecord;
}

export interface CourseReviewStorePort {
  previewDraftHistory?(tenant:TenantContext,courseVersionId:string,eventId:string,side:'before'|'after'):Promise<{revision:number;status:string;current:Record<string,unknown>;selected:Record<string,unknown>}>;
  listDraftHistory?(tenant:TenantContext,courseVersionId:string,beforeRevision?:number):Promise<{items:Array<{eventId:string;eventType:string;actorId:string;createdAt:string;revision:number;nextRevision:number}>;nextBeforeRevision?:number}>;
  restoreDraftHistory?(input:{tenant:TenantContext;courseVersionId:string;revision:number;eventId:string;side:'before'|'after';reason:string;idempotencyKey:string}):Promise<{revision:number}>;
  getApprovedMediaForGeneration?(tenant:TenantContext,assetVersionIds:readonly string[]):Promise<Array<{assetVersionId:string;sourceType:string;contentType:string}>>;
  getApprovedModelForGeneration?(tenant:TenantContext,modelVersionId:string):Promise<{modelVersionId:string;manifestHash:string;manifest:Record<string,unknown>}>;
  getApprovedModelComponents?(tenant:TenantContext,modelVersionId:string):Promise<{components:Array<{componentId:string;displayName:string}>}>;
  listApprovedModels?(tenant: TenantContext, after?: string): Promise<{items:Array<{modelVersionId:string;componentCount:number}>;nextCursor?:string}>;
  createSimulation?(input:{tenant:TenantContext;courseVersionId:string;revision:number;modelVersionId:string;idempotencyKey:string}):Promise<{revision:number}>;
  bindModel?(input:{tenant:TenantContext;courseVersionId:string;revision:number;modelVersionId:string;idempotencyKey:string}):Promise<{revision:number}>;
  replaceModel?(input:{tenant:TenantContext;courseVersionId:string;revision:number;modelVersionId:string;idempotencyKey:string;componentMapping?:Array<{from:string;to:string|null}>}):Promise<{revision:number}>;
  createRevision(input: { tenant: TenantContext; courseVersionId: OpaqueId; reason: string; idempotencyKey: string }): Promise<{ courseId: OpaqueId; courseVersionId: OpaqueId }>;
  createDraft(input: { tenant: TenantContext; title: string; idempotencyKey: string }): Promise<{ courseId: OpaqueId; courseVersionId: OpaqueId }>;
  listDrafts(tenant: TenantContext, after?: string): Promise<{ items: Array<{ courseVersionId: OpaqueId; title: string; revision: number; status: string }>; nextCursor?: string }>;
  saveDraft(input: { tenant: TenantContext; courseVersionId: OpaqueId; revision: number; content: Record<string, unknown> }): Promise<{ revision: number } | null>;
  saveGeneratedDraft(input: { tenant: TenantContext; courseVersionId: OpaqueId; revision: number; aiRunId: OpaqueId; content: Record<string, unknown> }): Promise<boolean>;
  get(tenant: TenantContext, courseVersionId: OpaqueId): Promise<CourseReviewSnapshot | null>;
  recordDecision(input: {
    tenant: TenantContext;
    courseVersionId: OpaqueId;
    targetType: ReviewTargetType;
    targetId: OpaqueId;
    decision: ReviewDecision;
    rationale: string;
    revision: number;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CourseReviewDecisionRecord | null>;
  publish(input: { tenant: TenantContext; courseVersionId: OpaqueId; idempotencyKey: string; requestHash: string }): Promise<ReleaseManifestRecord | null>;
}

export interface ReleaseArtifactPublisherPort {
  releaseManifestBlobKey(input: { organizationId: OpaqueId; releaseId: OpaqueId }): string;
  materializeModelArtifacts(input: {
    organizationId: OpaqueId;
    releaseId: OpaqueId;
    modelVersionId: OpaqueId;
    releaseBindingId: string;
    modelBlobKey: string;
    manifestBlobKey: string;
    manifest: Record<string, unknown>;
  }): Promise<{
    modelBlobKey: string;
    manifestBlobKey: string;
    manifest: Record<string, unknown>;
  }>;
  materializeReleaseManifest(input: {
    blobKey: string;
    manifest: Record<string, unknown>;
    releaseHash: string;
  }): Promise<void>;
}

export interface AssetLifecyclePort {
  transition(input: {
    tenant: TenantContext;
    assetVersionId: OpaqueId;
    state: AssetLifecycleState;
    reason?: string;
    /** Worker transitions must hold this job's current lease while writing the asset. */
    jobLease?: {jobId: OpaqueId; workerId: string; leaseGeneration: number};
  }): Promise<boolean>;
}

export interface AssetScanResult {
  status: "CLEAN" | "QUARANTINE";
  reasons: string[];
}

export interface AssetScannerPort {
  scan(input: {
    request: AssetProcessingRequest;
    storage: PrivateObjectStoragePort;
  }): Promise<AssetScanResult>;
}

export interface ProcessingResult extends JobOutcome {
  inputAssetVersionId: OpaqueId;
}

export interface AssetProcessorPort {
  inspect(request: AssetProcessingRequest): Promise<{ supported: boolean; reasons: string[] }>;
  canProcess(request: AssetProcessingRequest): Promise<boolean>;
  process(request: AssetProcessingRequest, job: JobEnvelope<AssetProcessingRequest>): Promise<ProcessingResult>;
}

export type AiOperation =
  | "extract_document"
  | "summarize_source"
  | "generate_course_draft"
  | "generate_video_lesson"
  | "generate_assessment_draft"
  | "generate_simulation_draft"
  | "suggest_component_metadata"
  | "answer_author_question"
  | "generate_source_citations";

export interface AiGatewayRequest {
  operation: AiOperation;
  input: unknown;
  sourceArtifactIds: OpaqueId[];
  outputSchemaVersion: string;
  tokenBudget: number;
  tenant: TenantContext;
}

export interface AiGatewayResult {
  operation: AiOperation;
  status: "DRAFT" | "REJECTED" | "FAILED";
  output?: unknown;
  citations: OpaqueId[];
  warnings: Warning[];
  metrics: UsageMetrics;
  failure?: FailureDetail;
  providerMetadata: {
    provider: "azure-openai" | "foundry";
    deployment: string;
    model: string;
    apiVersion: string;
  };
}

export interface AiGatewayPort {
  execute(request: AiGatewayRequest): Promise<AiGatewayResult>;
}

export interface PrivateObjectStoragePort {
  /** Only lifecycle-controlled retention workflows may remove private source objects. */
  deleteObject?(input:{blobKey:string}):Promise<void>;
  createUploadUrl(input: { blobKey: string; contentType: string; expiresInSeconds: number }): Promise<string>;
  createDownloadUrl(input: { blobKey: string; expiresInSeconds: number }): Promise<string>;
  putObject(input: { blobKey: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  /** Commit only after the byte stream finishes successfully. */
  putObjectStream?(input: { blobKey: string; chunks: AsyncIterable<Uint8Array>; contentType: string }): Promise<void>;
  getObjectProperties(input: { blobKey: string }): Promise<{ contentType: string; contentLength: number; metadata: Record<string, string> }>;
  readObject(input: { blobKey: string; maxBytes?: number }): Promise<{ bytes: Uint8Array; contentType: string; sha256: string }>;
  verifyChecksum(input: { blobKey: string; expectedSha256: string; maxBytes?: number }): Promise<boolean>;
  quarantine(input: { blobKey: string; reason: string }): Promise<void>;
}

export interface JobDispatcherPort {
  enqueue<TPayload>(job: JobEnvelope<TPayload>): Promise<{ jobId: OpaqueId }>;
}

export interface JobCompletionOptions {
  /** Applied in the same transaction as the fenced job outcome. */
  assetTransition?: {assetVersionId: OpaqueId; state: AssetLifecycleState; reason?: string};
  /** Only invoked after acquiring the current job fence. Failure rolls back finalization. */
  beforeCommit?: () => Promise<void>;
}

export interface JobStorePort {
  enqueue<TPayload>(job: JobEnvelope<TPayload>): Promise<JobRecord<TPayload>>;
  get<TPayload>(tenant: TenantContext, jobId: OpaqueId): Promise<JobRecord<TPayload> | null>;
  retry<TPayload>(tenant: TenantContext, jobId: OpaqueId, request: OperatorRetryRequest): Promise<JobRecord<TPayload> | null>;
  claim<TPayload>(tenant: TenantContext, jobId: OpaqueId, workerId: string, now?: string, leaseSeconds?: number): Promise<JobRecord<TPayload> | null>;
  succeed<TPayload>(tenant: TenantContext, jobId: OpaqueId, workerId: string, leaseGeneration: number, outcome: JobOutcome, now?: string, completion?: JobCompletionOptions): Promise<JobRecord<TPayload> | null>;
  fail<TPayload>(tenant: TenantContext, jobId: OpaqueId, workerId: string, leaseGeneration: number, failure: FailureDetail, now?: string, outcome?: JobOutcome, completion?: JobCompletionOptions): Promise<JobRecord<TPayload> | null>;
}

export interface JobOutboxRecord {
  outboxId: OpaqueId;
  jobId: OpaqueId;
  tenant: TenantContext;
  message: JobEnvelope<unknown>;
  state: "PENDING" | "CLAIMED" | "PUBLISHED" | "FAILED";
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  claimedBy?: string;
  leaseExpiresAt?: string;
  lastFailure?: FailureDetail;
}

export interface JobOutboxPort {
  claim(workerId: string, now?: string, leaseSeconds?: number): Promise<JobOutboxRecord | null>;
  markPublished(outboxId: OpaqueId, workerId: string, now?: string): Promise<boolean>;
  markFailed(outboxId: OpaqueId, workerId: string, failure: FailureDetail, now?: string): Promise<boolean>;
}

export interface NotificationPort {
  create(input: {
    recipientId: OpaqueId;
    type: string;
    tenant: TenantContext;
    redactedPayload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ notificationId: OpaqueId }>;
}

export interface SimulationAction {
  actionId: string;
  sequence: number;
  nonce: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface SimulationResult {
  accepted: boolean;
  nextSequence: number;
  scoreDelta: number;
  redactedState: Record<string, unknown>;
  warnings: Warning[];
  failure?: FailureDetail;
}

export interface SimulationPort {
  applyAction(input: {
    sessionId: OpaqueId;
    releaseId: OpaqueId;
    action: SimulationAction;
    tenant: TenantContext;
  }): Promise<SimulationResult>;
}

export interface PolicyEvaluationPort {
  evaluate(input: {
    learnerId: OpaqueId;
    releaseId: OpaqueId;
    policyVersionId: OpaqueId;
    evidence: unknown;
    tenant: TenantContext;
  }): Promise<{ passed: boolean; score: number; reasons: string[] }>;
}
