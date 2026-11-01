import {createHash} from 'node:crypto';
import type { Pool } from "pg";
import type { PrivateObjectStoragePort, TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "@medical-device/db";
import type { LearnerModelAssetResponse, ModelAssetService } from "./model-asset-service.js";
import {validateBrowserModelManifest} from '@medical-device/model-runtime';

type JsonObject = Record<string, unknown>;
type ModelVariantBinding = { variantId: string; sourceHash: string; modelVersionId: string; releaseBindingId: string; modelBlobKey: string; manifestBlobKey: string };

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function blobKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 && !/[\u0000-\u001f]/.test(value);
}

function manifestBinding(manifest: unknown): { modelVersionId: string; releaseBindingId: string } | null {
  const value = object(manifest);
  const modelVersionId = text(value?.modelVersionId);
  const releaseBindingId = text(value?.releaseBindingId);
  return modelVersionId && releaseBindingId ? { modelVersionId, releaseBindingId } : null;
}

function manifestVariants(manifest: unknown, expected: { modelVersionId: string; releaseBindingId: string; modelPrefix: string }): ModelVariantBinding[] | null {
  const value = object(manifest);
  if (!value || value.variants === undefined) return [];
  if (!Array.isArray(value.variants)) return null;
  const ids = new Set<string>();
  const parsed: ModelVariantBinding[] = [];
  for (const item of value.variants) {
    const variant = object(item);
    const variantId = text(variant?.variantId);
    const sourceHash = text(variant?.sourceHash);
    const modelVersionId = text(variant?.modelVersionId);
    const releaseBindingId = text(variant?.releaseBindingId);
    const modelBlobKey = text(variant?.modelBlobKey);
    const manifestBlobKey = text(variant?.manifestBlobKey);
    if (!variantId || variantId === "full" || !/^[A-Za-z0-9._-]{1,64}$/.test(variantId) || ids.has(variantId) || !sha256(sourceHash) || modelVersionId !== expected.modelVersionId || releaseBindingId !== expected.releaseBindingId || modelBlobKey !== `${expected.modelPrefix}/${variantId}.glb` || manifestBlobKey !== `${expected.modelPrefix}/${variantId}.json`) return null;
    ids.add(variantId);
    parsed.push({ variantId, sourceHash, modelVersionId, releaseBindingId, modelBlobKey, manifestBlobKey });
  }
  return parsed;
}

/**
 * Resolves the immutable model binding from the published release snapshot.
 * Both the manifest and GLB are private objects; an absent manifest object is
 * deliberately treated as unavailable rather than falling back to a public
 * or synthetic asset.
 */
export function createPostgresModelAssetService(input: {
  pool: Pool;
  storage: PrivateObjectStoragePort;
  urlTtlSeconds?: number;
  privateDelivery?: boolean;
}): ModelAssetService {
  const ttl = input.urlTtlSeconds ?? 300;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > 900) throw new Error("MODEL_URL_TTL_INVALID");

  async function resolveBinding(tenant:TenantContext,request:{releaseId:string;modelVersionId:string;variantId?:string}){
    if(!tenant.actorId)return null;
    return withTenantTransaction(input.pool, tenant, async (client) => {
        const release = await client.query<{ release_id: string; release_hash: string; manifest: unknown }>(
          `SELECT r.release_id, r.release_hash, r.manifest
           FROM release_manifests r
           WHERE r.organization_id = $1 AND r.release_id = $2 AND r.status = 'PUBLISHED'
           AND EXISTS(SELECT 1 FROM enrollments e WHERE e.organization_id=r.organization_id AND e.course_version_id=r.course_version_id AND e.learner_id=$3 AND e.status='ACTIVE')`,
          [tenant.organizationId, request.releaseId,tenant.actorId]
        );
        const releaseRow = release.rows[0];
        if (!releaseRow) return null;
        if (!sha256(releaseRow.release_hash)) return null;
        const releaseManifestBlobKey = `${tenant.organizationId}/releases/${releaseRow.release_id}/release-manifest.json`;
        const releaseArtifact = object(object(releaseRow.manifest)?.releaseArtifact);
        if (text(releaseArtifact?.manifestBlobKey) !== releaseManifestBlobKey) return null;
        const binding = await client.query<{ model_version_id: string; release_binding_id: string; manifest_hash: string; model_blob_key: string; manifest_blob_key: string; manifest: unknown }>(
          `SELECT model_version_id, release_binding_id, manifest_hash, model_blob_key, manifest_blob_key, manifest
           FROM release_model_bindings
           WHERE organization_id = $1 AND release_id = $2 AND model_version_id = $3`,
          [tenant.organizationId, releaseRow.release_id, request.modelVersionId]
        );
        const bindingRow = binding.rows[0];
        const boundManifest = manifestBinding(bindingRow?.manifest);
        const boundManifestSourceHash = text(object(bindingRow?.manifest)?.sourceHash);
        const modelPrefix = `${tenant.organizationId}/releases/${releaseRow.release_id}/models/${request.modelVersionId}`;
        const expectedReleaseBindingId = `releasebind:${releaseRow.release_id}:${request.modelVersionId}`;
        if (!bindingRow
          || !boundManifest
          || !sha256(bindingRow.manifest_hash)
          || !sha256(boundManifestSourceHash)
          || !blobKey(bindingRow.model_blob_key)
          || !blobKey(bindingRow.manifest_blob_key)
          || boundManifest.modelVersionId !== request.modelVersionId
          || bindingRow.release_binding_id !== expectedReleaseBindingId
          || boundManifest.releaseBindingId !== bindingRow.release_binding_id
          || boundManifestSourceHash !== bindingRow.manifest_hash
          || bindingRow.model_blob_key !== `${modelPrefix}/full.glb`
          || bindingRow.manifest_blob_key !== `${modelPrefix}/full.json`) return null;
        const requestedVariant = request.variantId ?? "full";
        if (requestedVariant !== "full" && !/^[A-Za-z0-9._-]{1,64}$/.test(requestedVariant)) return null;
        const variants = manifestVariants(bindingRow.manifest, { modelVersionId: bindingRow.model_version_id, releaseBindingId: bindingRow.release_binding_id, modelPrefix });
        if (!variants) return null;
        const variant = variants.find((candidate) => candidate.variantId === requestedVariant);
        if (requestedVariant !== "full" && !variant) return null;
        const fallbackBase = Object.fromEntries(Object.entries(object(bindingRow.manifest) ?? {}).filter(([key]) => key !== "variants"));
        return {
          releaseId: releaseRow.release_id,
          releaseHash: releaseRow.release_hash,
          modelVersionId: bindingRow.model_version_id,
          variantId: variant?.variantId ?? "full",
          manifestHash: variant?.sourceHash ?? bindingRow.manifest_hash,
          modelBlobKey: variant?.modelBlobKey ?? bindingRow.model_blob_key,
          manifestBlobKey: variant?.manifestBlobKey ?? bindingRow.manifest_blob_key,
          releaseBindingId: bindingRow.release_binding_id,
          fallbackManifest: {
            ...fallbackBase,
            sourceHash: variant?.sourceHash ?? bindingRow.manifest_hash,
            modelVersionId: bindingRow.model_version_id,
            releaseBindingId: bindingRow.release_binding_id
          }
        };
      });
  }
  return {
    async getAuthorPreview(tenant,request){
      if(!tenant.actorId||!Number.isSafeInteger(request.revision)||request.revision<1)return null;
      return withTenantTransaction(input.pool,tenant,async client=>{
        const row=(await client.query(`SELECT v.revision,v.content,m.model_version_id,m.manifest,m.blob_key FROM course_versions v
          JOIN model_versions m ON m.organization_id=v.organization_id AND m.model_version_id=v.content->'model'->>'modelVersionId'
          WHERE v.organization_id=$1 AND v.course_version_id=$2 AND v.revision=$3 AND v.status IN ('DRAFT','IN_REVIEW') AND m.status='APPROVED' FOR SHARE OF v,m`,[tenant.organizationId,request.courseVersionId,request.revision])).rows[0];
        if(!row)return null;
        const course=object(row.content),binding=object(course?.model),definition=object(object(course?.simulation)?.definition),simulationModel=object(definition?.model),source=object(row.manifest);
        if(!source||!sha256(source.sourceHash)||binding?.manifestHash!==source.sourceHash||simulationModel?.manifestHash!==source.sourceHash||simulationModel?.modelVersionId!==row.model_version_id)return null;
        if(!blobKey(row.blob_key)||!row.blob_key.startsWith(tenant.organizationId+'/')||row.blob_key.includes('\\')||row.blob_key.split('/').some((part:string)=>part==='..'||part==='.'))return null;
        const manifest:Record<string,unknown>=Object.fromEntries(['schemaVersion','format','sourceHash','normalizationStatus','unitSystem','scaleMeters','upAxis','handedness','origin','forwardAxis','sceneNodeCount','meshCount','materialCount','textureCount','triangleCount','materials','textures','components'].map(key=>[key,source[key]]));
        manifest.modelVersionId=row.model_version_id;manifest.releaseBindingId=`preview:${request.courseVersionId}:${row.revision}`;
        try{validateBrowserModelManifest(manifest);}catch{return null;}
        return {courseVersionId:request.courseVersionId,revision:row.revision,modelVersionId:row.model_version_id,manifest,modelUrl:input.privateDelivery?`/api/v1/model-imports/${encodeURIComponent(row.model_version_id)}/content`:await input.storage.createDownloadUrl({blobKey:row.blob_key,expiresInSeconds:ttl}),expiresInSeconds:ttl};
      });
    },
    async getLearnerContent(tenant,request){
      const binding=await resolveBinding(tenant,request);if(!binding)return null;
      if(request.content==='manifest'){
        const object=await input.storage.readObject({blobKey:binding.manifestBlobKey,maxBytes:1024*1024});
        const manifest=validateBrowserModelManifest(JSON.parse(Buffer.from(object.bytes).toString('utf8')));
        if(manifest.sourceHash!==binding.manifestHash||manifest.modelVersionId!==binding.modelVersionId||manifest.releaseBindingId!==binding.releaseBindingId)throw Error('MODEL_CONTENT_MISMATCH');
        return {bytes:object.bytes,contentType:'application/json'};
      }
      const object=await input.storage.readObject({blobKey:binding.modelBlobKey,maxBytes:64*1024*1024});
      if(createHash('sha256').update(object.bytes).digest('hex')!==binding.manifestHash)throw Error('MODEL_CONTENT_MISMATCH');
      return {bytes:object.bytes,contentType:'model/gltf-binary'};
    },
    async getLearnerModel(tenant: TenantContext, request): Promise<LearnerModelAssetResponse | null> {
      if(!tenant.actorId)return null;
      const binding = await resolveBinding(tenant,request);
      if (!binding) return null;

      const base=`/api/v1/releases/${encodeURIComponent(binding.releaseId)}/model-assets/${encodeURIComponent(binding.modelVersionId)}?variant=${encodeURIComponent(binding.variantId)}`;
      const [manifestUrl, modelUrl] = input.privateDelivery ? [base+'&content=manifest',base+'&content=model'] : await Promise.all([
        input.storage.createDownloadUrl({ blobKey: binding.manifestBlobKey, expiresInSeconds: ttl }),
        input.storage.createDownloadUrl({ blobKey: binding.modelBlobKey, expiresInSeconds: ttl })
      ]);
      return {
        releaseId: binding.releaseId,
        releaseHash: binding.releaseHash,
        modelVersionId: binding.modelVersionId,
        releaseBindingId: binding.releaseBindingId,
        variantId: binding.variantId,
        manifestHash: binding.manifestHash,
        manifestUrl,
        modelUrl,
        fallbackManifest: binding.fallbackManifest,
        cacheControl: "private, max-age=60"
      };
    }
  };
}
