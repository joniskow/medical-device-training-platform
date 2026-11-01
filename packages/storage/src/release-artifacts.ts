import { createHash } from "node:crypto";
import type { PrivateObjectStoragePort, ReleaseArtifactPublisherPort } from "@medical-device/contracts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_INVALID`);
  return value.trim();
}

function sha256(value: unknown): string {
  const result = text(value, "SHA256");
  if (!/^[0-9a-f]{64}$/i.test(result)) throw new Error("SHA256_INVALID");
  return result.toLowerCase();
}

function segment(value: string, name: string): string {
  const normalized = text(value, name);
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(normalized) || normalized.includes("..")) throw new Error(`${name}_INVALID`);
  return normalized;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function withoutBinding(value: JsonObject): JsonObject {
  const copy = { ...value };
  delete copy.modelVersionId;
  delete copy.releaseBindingId;
  if (Array.isArray(copy.variants)) {
    copy.variants = copy.variants.map((item) => {
      const variant = object(item);
      if (!variant) return item;
      const normalized = { ...variant };
      delete normalized.modelVersionId;
      delete normalized.releaseBindingId;
      delete normalized.modelBlobKey;
      delete normalized.manifestBlobKey;
      return normalized;
    });
  }
  return copy;
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function notFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "statusCode" in error && (error as { statusCode?: unknown }).statusCode === 404)
    || (error instanceof Error && error.message === "OBJECT_NOT_AVAILABLE");
}

async function writeImmutable(storage: PrivateObjectStoragePort, blobKey: string, bytes: Uint8Array, contentType: string): Promise<void> {
  try {
    const existing = await storage.readObject({ blobKey });
    const expected = createHash("sha256").update(bytes).digest("hex");
    if (existing.sha256 !== expected) throw new Error("RELEASE_ARTIFACT_IMMUTABLE_CONFLICT");
    return;
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  await storage.putObject({ blobKey, bytes, contentType });
  if (!(await storage.verifyChecksum({ blobKey, expectedSha256: createHash("sha256").update(bytes).digest("hex") }))) {
    throw new Error("RELEASE_ARTIFACT_CHECKSUM_FAILED");
  }
}

async function readJson(storage: PrivateObjectStoragePort, blobKey: string): Promise<JsonObject> {
  const result = await storage.readObject({ blobKey });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(result.bytes).toString("utf8"));
  } catch {
    throw new Error("RELEASE_MANIFEST_JSON_INVALID");
  }
  const value = object(parsed);
  if (!value) throw new Error("RELEASE_MANIFEST_JSON_INVALID");
  return value;
}

function modelPrefix(organizationId: string, releaseId: string, modelVersionId: string): string {
  return `${segment(organizationId, "ORGANIZATION_ID")}/releases/${segment(releaseId, "RELEASE_ID")}/models/${segment(modelVersionId, "MODEL_VERSION_ID")}`;
}

function releaseManifestKey(organizationId: string, releaseId: string): string {
  return `${segment(organizationId, "ORGANIZATION_ID")}/releases/${segment(releaseId, "RELEASE_ID")}/release-manifest.json`;
}

export function createReleaseArtifactPublisher(input: { storage: PrivateObjectStoragePort }): ReleaseArtifactPublisherPort {
  return {
    releaseManifestBlobKey({ organizationId, releaseId }) {
      return releaseManifestKey(organizationId, releaseId);
    },

    async materializeModelArtifacts({ organizationId, releaseId, modelVersionId, releaseBindingId, modelBlobKey, manifestBlobKey, manifest }) {
      const prefix = modelPrefix(organizationId, releaseId, modelVersionId);
      if (manifest.variants !== undefined && !Array.isArray(manifest.variants)) throw new Error("MODEL_VARIANTS_INVALID");
      const descriptors = Array.isArray(manifest.variants) ? manifest.variants : [];
      const variantIds = new Set<string>();
      for (const item of descriptors) {
        const descriptor = object(item);
        const variantId = text(descriptor?.variantId, "MODEL_VARIANT_ID");
        if (variantId === "full" || !/^[A-Za-z0-9._-]{1,64}$/.test(variantId) || variantIds.has(variantId)) throw new Error("MODEL_VARIANT_DESCRIPTOR_INVALID");
        variantIds.add(variantId);
      }
      const sourceManifest = await readJson(input.storage, manifestBlobKey);
      if (withoutBinding(sourceManifest).sourceHash !== withoutBinding(manifest).sourceHash || stableHash(withoutBinding(sourceManifest)) !== stableHash(withoutBinding(manifest))) throw new Error("MODEL_MANIFEST_SOURCE_MISMATCH");
      const sourceHash = sha256(sourceManifest.sourceHash);
      const canonicalModel = await input.storage.readObject({ blobKey: modelBlobKey });
      if (canonicalModel.sha256 !== sourceHash) throw new Error("MODEL_SOURCE_CHECKSUM_MISMATCH");
      const canonicalModelBlobKey = `${prefix}/full.glb`;
      const canonicalManifestBlobKey = `${prefix}/full.json`;
      await writeImmutable(input.storage, canonicalModelBlobKey, canonicalModel.bytes, canonicalModel.contentType || "model/gltf-binary");

      const boundDescriptors: JsonObject[] = [];
      for (const item of descriptors) {
        const descriptor = object(item);
        if (!descriptor) throw new Error("MODEL_VARIANT_DESCRIPTOR_INVALID");
        const variantId = text(descriptor.variantId, "MODEL_VARIANT_ID");
        const variantHash = sha256(descriptor.sourceHash);
        const variantModelBlobKey = text(descriptor.modelBlobKey, "MODEL_VARIANT_BLOB_KEY");
        const variantManifestBlobKey = text(descriptor.manifestBlobKey, "MODEL_VARIANT_MANIFEST_KEY");
        const variantManifest = await readJson(input.storage, variantManifestBlobKey);
        const variantManifestHash = sha256(variantManifest.sourceHash);
        const variantMetadata = object(variantManifest.variant);
        if (variantManifestHash !== variantHash || text(variantMetadata?.variantId, "MODEL_VARIANT_ID") !== variantId) {
          throw new Error("MODEL_VARIANT_SOURCE_MISMATCH");
        }
        const variantModel = await input.storage.readObject({ blobKey: variantModelBlobKey });
        if (variantModel.sha256 !== variantHash) throw new Error("MODEL_VARIANT_CHECKSUM_MISMATCH");
        const targetModelBlobKey = `${prefix}/${variantId}.glb`;
        const targetManifestBlobKey = `${prefix}/${variantId}.json`;
        await writeImmutable(input.storage, targetModelBlobKey, variantModel.bytes, variantModel.contentType || "model/gltf-binary");
        const boundVariantManifest = { ...variantManifest, modelVersionId, releaseBindingId, sourceHash: variantHash };
        await writeImmutable(input.storage, targetManifestBlobKey, jsonBytes(boundVariantManifest), "application/json");
        boundDescriptors.push({ ...descriptor, variantId, sourceHash: variantHash, modelVersionId, releaseBindingId, modelBlobKey: targetModelBlobKey, manifestBlobKey: targetManifestBlobKey });
      }

      const boundManifest = { ...manifest, modelVersionId, releaseBindingId, sourceHash, variants: boundDescriptors };
      await writeImmutable(input.storage, canonicalManifestBlobKey, jsonBytes(boundManifest), "application/json");
      return { modelBlobKey: canonicalModelBlobKey, manifestBlobKey: canonicalManifestBlobKey, manifest: boundManifest };
    },

    async materializeReleaseManifest({ blobKey, manifest, releaseHash }) {
      if (stableHash(manifest) !== sha256(releaseHash)) throw new Error("RELEASE_HASH_MISMATCH");
      await writeImmutable(input.storage, blobKey, jsonBytes(manifest), "application/json");
      const stored = await readJson(input.storage, blobKey);
      if (stableHash(stored) !== releaseHash.toLowerCase()) throw new Error("RELEASE_ARTIFACT_HASH_MISMATCH");
    }
  };
}
