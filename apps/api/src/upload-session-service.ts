import { createHash, randomUUID } from "node:crypto";
import type {
  AssetProcessingRequest,
  AssetVersionRecord,
  JobEnvelope,
  JobRecord,
  JobStorePort,
  AssetSourceType,
  PrivateObjectStoragePort,
  TenantContext,
  UploadSessionRecord,
  UploadSessionStore
} from "@medical-device/contracts";

export interface UploadSessionInput {
  productId?: string;
  sourceType: AssetSourceType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  actorId: string;
}

export interface UploadSessionService {
  uploadContent?(tenant: TenantContext, uploadSessionId: string, contentType: string, chunks: AsyncIterable<Uint8Array>): Promise<boolean>;
  create(tenant: TenantContext, request: UploadSessionInput): Promise<{
    session: UploadSessionRecord;
    uploadUrl: string;
    expiresInSeconds: number;
  }>;
  complete(tenant: TenantContext, uploadSessionId: string, input: {
    blobKey: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<{
    session: UploadSessionRecord;
    assetVersion: AssetVersionRecord;
    processingJob?: JobRecord<AssetProcessingRequest>;
  } | null>;
  get(tenant: TenantContext, uploadSessionId: string): Promise<UploadSessionRecord | null>;
  cancel(tenant: TenantContext, uploadSessionId: string): Promise<boolean>;
}

export const uploadLimits: Record<AssetSourceType, { maxBytes: number; contentTypes: readonly string[] }> = {
  pdf: { maxBytes: 100 * 1024 * 1024, contentTypes: ["application/pdf"] },
  image: { maxBytes: 25 * 1024 * 1024, contentTypes: ["image/png", "image/jpeg", "image/webp"] },
  video: { maxBytes: 2 * 1024 * 1024 * 1024, contentTypes: ["video/mp4", "video/webm", "video/quicktime"] },
  gltf: { maxBytes: 250 * 1024 * 1024, contentTypes: ["model/gltf+json", "application/json"] },
  glb: { maxBytes: 250 * 1024 * 1024, contentTypes: ["model/gltf-binary", "application/octet-stream"] }
};

function safeFileName(fileName: string): string {
  const normalized = fileName.trim().split(/[\\/]/).pop()?.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ?? "upload";
  if (!normalized || normalized.length > 160 || normalized === "." || normalized === "..") throw new Error("FILE_NAME_INVALID");
  return normalized;
}

function requireSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("SHA256_INVALID");
  return normalized;
}

export function validateUploadInput(input: UploadSessionInput): UploadSessionInput {
  const limits = uploadLimits[input.sourceType];
  if (!limits) throw new Error("SOURCE_TYPE_UNSUPPORTED");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > limits.maxBytes) throw new Error("FILE_SIZE_INVALID");
  if (!limits.contentTypes.includes(input.contentType.toLowerCase())) throw new Error("CONTENT_TYPE_UNSUPPORTED");
  return {
    ...input,
    fileName: safeFileName(input.fileName),
    contentType: input.contentType.toLowerCase(),
    sha256: requireSha256(input.sha256),
    actorId: input.actorId.trim()
  };
}

export function createUploadSessionService(input: {
  store: UploadSessionStore;
  storage: PrivateObjectStoragePort;
  jobStore?: JobStorePort;
  uploadTtlSeconds?: number;
  privateUpload?: boolean;
}) {
  const ttlSeconds = Math.min(Math.max(input.uploadTtlSeconds ?? 900, 60), 900);
  const service: UploadSessionService = {
    async create(tenant: TenantContext, request: UploadSessionInput) {
      const validated = validateUploadInput(request);
      const blobKey = `${tenant.organizationId}/uploads/${randomUUID()}/${validated.fileName}`;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      const session = await input.store.create({ ...validated, tenant, blobKey, expiresAt });
      try {
        const uploadUrl = input.privateUpload ? `/api/v1/upload-sessions/${encodeURIComponent(session.uploadSessionId)}/content` : await input.storage.createUploadUrl({
          blobKey,
          contentType: validated.contentType,
          expiresInSeconds: ttlSeconds
        });
        return { session, uploadUrl, expiresInSeconds: ttlSeconds };
      } catch (error) {
        await input.store.cancel(tenant, session.uploadSessionId);
        throw error;
      }
    },

    async uploadContent(tenant, uploadSessionId, contentType, chunks) {
      const session = await input.store.get(tenant, uploadSessionId);
      if (!session || session.actorId !== tenant.actorId || session.status !== 'ACTIVE' || Date.parse(session.expiresAt) <= Date.now()) return false;
      if (contentType !== session.contentType) throw Error('UPLOAD_CONTENT_INVALID');
      if (!input.storage.putObjectStream) throw Error('UPLOAD_STREAM_UNAVAILABLE');
      async function* checked() {
        let size = 0;
        const hash = createHash('sha256');
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > session!.sizeBytes || Date.parse(session!.expiresAt) <= Date.now()) throw Error('UPLOAD_CONTENT_INVALID');
          hash.update(chunk);
          yield chunk;
        }
        if (size !== session!.sizeBytes || hash.digest('hex') !== session!.sha256) throw Error('UPLOAD_CONTENT_INVALID');
        const current = await input.store.get(tenant, uploadSessionId);
        if (!current || current.status !== 'ACTIVE' || Date.parse(current.expiresAt) <= Date.now()) throw Error('UPLOAD_CONTENT_INVALID');
      }
      await input.storage.putObjectStream({blobKey:session.blobKey, contentType:session.contentType, chunks:checked()});
      return true;
    },

    async complete(tenant: TenantContext, uploadSessionId: string, inputData: {
      blobKey: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
    }) {
      const session = await input.store.get(tenant, uploadSessionId);
      if (!session || session.status !== "ACTIVE") return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
      if (session.blobKey !== inputData.blobKey || session.contentType !== inputData.contentType.toLowerCase() || session.sizeBytes !== inputData.sizeBytes || session.sha256 !== inputData.sha256.toLowerCase()) return null;
      const properties = await input.storage.getObjectProperties({ blobKey: session.blobKey });
      if (properties.contentLength !== session.sizeBytes || properties.contentType.toLowerCase() !== session.contentType) return null;
      if (!(await input.storage.verifyChecksum({ blobKey: session.blobKey, expectedSha256: session.sha256, maxBytes: session.sizeBytes }))) return null;
      const completed = await input.store.complete({ tenant, uploadSessionId, ...inputData, contentType: inputData.contentType.toLowerCase(), sha256: inputData.sha256.toLowerCase() });
      if (!completed || !input.jobStore) return completed;

      const payload: AssetProcessingRequest = {
        inputAssetVersionId: completed.assetVersion.assetVersionId,
        sourceType: completed.assetVersion.sourceType,
        blobKey: completed.assetVersion.blobKey,
        sha256: completed.assetVersion.sha256,
        sizeBytes: completed.assetVersion.sizeBytes,
        contentType: completed.assetVersion.contentType
      };
      const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const job: JobEnvelope<AssetProcessingRequest> = {
        jobId: `job_asset_process_${completed.assetVersion.assetVersionId}`,
        jobType: "asset.process",
        attempt: 1,
        maxAttempts: 3,
        idempotency: { key: `asset-process:${completed.assetVersion.assetVersionId}`, requestHash },
        tenant,
        payload,
        inputAssetVersionId: completed.assetVersion.assetVersionId,
        codeVersion: "upload-api.v1"
      };
      const processingJob = await input.jobStore.enqueue(job);
      return { ...completed, processingJob };
    },

    get(tenant: TenantContext, uploadSessionId: string): Promise<UploadSessionRecord | null> {
      return input.store.get(tenant, uploadSessionId);
    },

    cancel(tenant: TenantContext, uploadSessionId: string): Promise<boolean> {
      return input.store.cancel(tenant, uploadSessionId);
    }
  };
  return service;
}
