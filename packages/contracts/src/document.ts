import type { FailureDetail, JobEnvelope, OpaqueId, UsageMetrics, Warning } from "./common.js";

export interface DocumentExtractionRequest {
  inputAssetVersionId: OpaqueId;
  blobKey: string;
  sha256: string;
  maxPages: number;
}

export interface SourceCitation {
  assetVersionId: OpaqueId;
  page: number;
  section?: string;
  charStart?: number;
  charEnd?: number;
}

export interface DocumentChunk {
  chunkId: OpaqueId;
  text: string;
  citation: SourceCitation;
  heading?: string;
}

export interface DocumentExtractionResult {
  inputAssetVersionId: OpaqueId;
  status: "READY" | "REVIEW_REQUIRED" | "FAILED";
  pageCount: number;
  chunks: DocumentChunk[];
  warnings: Warning[];
  metrics: UsageMetrics;
  failure?: FailureDetail;
}

export interface DocumentExtractionPort {
  extract(request: DocumentExtractionRequest, job: JobEnvelope<DocumentExtractionRequest>): Promise<DocumentExtractionResult>;
}
