import type {JobRecord, TenantContext} from './common.js';

export type ReconstructionMode = 'single-image' | 'multi-view' | 'video';
export interface ReconstructionSourceReference {assetVersionId:string;sourceHash:string}
export interface ReconstructionRequestInput {mode:ReconstructionMode;sources:ReconstructionSourceReference[];idempotencyKey:string}
export interface ReconstructionSource extends ReconstructionSourceReference {
  blobKey:string;fileName:string;sourceType:'image'|'video';contentType:string;sizeBytes:number;
  reviewEventId:string;rightsAttestationId:string;
}
export interface ReconstructionPayload {
  schemaVersion:'reconstruction-request.v1';mode:ReconstructionMode;sources:ReconstructionSource[];
  requestedBy:string;requestSignature:string;
}
export interface ReconstructionArtifact {blobKey:string;sha256:string;bytes:number;contentType:string}
export interface ReconstructionArtifacts {
  schemaVersion:'reconstruction-artifacts.v1';candidate:ReconstructionArtifact;quality:ReconstructionArtifact;
  foreground?:ReconstructionArtifact;conditioningImage?:ReconstructionArtifact;
  views?:Array<ReconstructionArtifact&{sourceName:string;timestampSeconds:number}>;
}
export interface ReconstructionSourceStore {
  assertSourcesCurrent(tenant:TenantContext,payload:ReconstructionPayload):Promise<void>;
}
export interface ReconstructionEngine {
  modes:readonly ReconstructionMode[];
  generate(input:{job:JobRecord<ReconstructionPayload>;sources:Array<{source:ReconstructionSource;bytes:Uint8Array}>}):Promise<{
    candidate:Uint8Array;quality:Uint8Array;foreground?:Uint8Array;conditioningImage?:Uint8Array;
    sourceViews?:Array<{sourceName:string;timestampSeconds:number;bytes:Uint8Array}>;
  }>;
}
