import type { TenantContext } from "@medical-device/contracts";

export interface LearnerModelAssetResponse {
  releaseId: string;
  releaseHash: string;
  modelVersionId: string;
  releaseBindingId: string;
  variantId: string;
  manifestHash: string;
  manifestUrl: string;
  modelUrl: string;
  /**
   * Release-bound metadata used to keep the equivalent interaction path
   * usable when the private manifest URL is unavailable. It never contains
   * model bytes or a client-authoritative score/completion value.
   */
  fallbackManifest: Record<string, unknown>;
  cacheControl: "private, max-age=60";
}

/**
 * The API owns the release/model binding. Implementations must resolve both
 * identifiers inside the tenant and issue short-lived private URLs only for
 * an approved, immutable release snapshot.
 */
export interface ModelAssetService {
  getLearnerContent?(tenant:TenantContext,input:{releaseId:string;modelVersionId:string;variantId?:string;content:'model'|'manifest'}):Promise<{bytes:Uint8Array;contentType:string}|null>;
  getAuthorPreview?(tenant:TenantContext,input:{courseVersionId:string;revision:number}):Promise<{courseVersionId:string;revision:number;modelVersionId:string;manifest:Record<string,unknown>;modelUrl:string;expiresInSeconds:number}|null>;
  getLearnerModel(tenant: TenantContext, input: { releaseId: string; modelVersionId: string; variantId?: string }): Promise<LearnerModelAssetResponse | null>;
}
