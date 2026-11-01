import {readFile} from 'node:fs/promises';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const baseUrl = required("E4_DEPLOYED_BASE_URL").replace(/\/$/, "");
const releaseId = required("E4_DEPLOYED_RELEASE_ID");
const modelVersionId = required("E4_DEPLOYED_MODEL_VERSION_ID");
const authorization = process.env.E4_DEPLOYED_ACCESS_TOKEN?.trim();
const headers = authorization ? { authorization: `Bearer ${authorization}` } : {};
const allowHttpForLocalContract = process.env.E4_DEPLOYED_ALLOW_HTTP === "1";
assert.match(baseUrl, allowHttpForLocalContract ? /^https?:\/\// : /^https:\/\//, "deployed release validation requires an HTTPS API base URL");
const privateDeliveryUrlPattern = allowHttpForLocalContract ? /^https?:\/\// : /^https:\/\//;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

function stableHash(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

async function jsonResponse(url) {
  const response = await fetch(url, { headers, cache: "no-store" });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return await response.json();
}

async function bytesResponse(url) {
  const response = await fetch(url, { cache: "no-store" });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const assets = {};
for (const variantId of ["full", "mobile", "reduced"]) {
  const asset = await jsonResponse(`${baseUrl}/api/v1/releases/${encodeURIComponent(releaseId)}/model-assets/${encodeURIComponent(modelVersionId)}?variant=${variantId}`);
  assert.equal(asset.releaseId, releaseId);
  assert.match(asset.releaseHash, /^[a-f0-9]{64}$/i);
  assert.equal(asset.modelVersionId, modelVersionId);
  assert.equal(asset.variantId, variantId);
  assert.equal(asset.releaseBindingId, `releasebind:${releaseId}:${modelVersionId}`);
  assert.match(asset.manifestHash, /^[a-f0-9]{64}$/i);
  assert.ok(asset.fallbackManifest && typeof asset.fallbackManifest === "object" && !Array.isArray(asset.fallbackManifest), "deployed asset must include bound equivalent-path metadata");
  assert.equal(asset.fallbackManifest.modelVersionId, modelVersionId);
  assert.equal(asset.fallbackManifest.releaseBindingId, asset.releaseBindingId);
  assert.equal(String(asset.fallbackManifest.sourceHash).toLowerCase(), asset.manifestHash.toLowerCase());
  assert.ok(Array.isArray(asset.fallbackManifest.components) && asset.fallbackManifest.components.length > 0, "deployed fallback metadata must expose approved components");
  assert.match(asset.manifestUrl, privateDeliveryUrlPattern, "deployed manifest URLs must be HTTPS private delivery URLs");
  assert.match(asset.modelUrl, privateDeliveryUrlPattern, "deployed model URLs must be HTTPS private delivery URLs");
  assert.equal(asset.releaseManifestUrl, undefined, "Learner responses must not disclose full release-manifest URLs");
  const manifest = await jsonResponse(asset.manifestUrl);
  const model = await bytesResponse(asset.modelUrl);
  assert.equal(manifest.modelVersionId, modelVersionId);
  assert.equal(manifest.releaseBindingId, asset.releaseBindingId);
  assert.equal(manifest.sourceHash.toLowerCase(), asset.manifestHash.toLowerCase());
  assert.equal(sha256(model), manifest.sourceHash.toLowerCase());
  if (variantId === "full") assert.equal(manifest.variant, undefined, "the full manifest must remain the canonical manifest");
  else assert.equal(manifest.variant?.variantId, variantId);
  assets[variantId] = { asset, manifest };
}

const releaseManifest = JSON.parse(await readFile(required('E4_REVIEWED_RELEASE_MANIFEST_PATH'),'utf8'));
assert.equal(stableHash(releaseManifest), assets.full.asset.releaseHash.toLowerCase());
assert.equal(typeof releaseManifest.releaseArtifact?.manifestBlobKey, "string");
assert.ok(String(releaseManifest.releaseArtifact.manifestBlobKey).endsWith(`/releases/${releaseId}/release-manifest.json`), "deployed release manifest must be stored under its release-owned prefix");
assert.equal(releaseManifest.content?.model?.modelVersionId, modelVersionId);
assert.equal(releaseManifest.content?.model?.releaseBindingId, assets.full.asset.releaseBindingId);

const canonicalVariants = assets.full.manifest.variants;
assert.ok(Array.isArray(canonicalVariants), "the deployed canonical manifest must declare approved variants");
for (const variantId of ["mobile", "reduced"]) {
  const descriptor = canonicalVariants.find((variant) => variant.variantId === variantId);
  assert.ok(descriptor, `canonical manifest is missing the ${variantId} descriptor`);
  assert.equal(descriptor.sourceHash.toLowerCase(), assets[variantId].manifest.sourceHash.toLowerCase());
  assert.ok(String(descriptor.modelBlobKey).endsWith(`/releases/${releaseId}/models/${modelVersionId}/${variantId}.glb`), `${variantId} model must be release-owned`);
  assert.ok(String(descriptor.manifestBlobKey).endsWith(`/releases/${releaseId}/models/${modelVersionId}/${variantId}.json`), `${variantId} manifest must be release-owned`);
}
for (const variantId of ["mobile", "reduced"]) {
  assert.equal(assets[variantId].asset.releaseHash, assets.full.asset.releaseHash, "all variants must reference the same immutable release manifest");

}
console.log(`E4 deployed release passed: ${releaseId}/${modelVersionId} served bound full/mobile/reduced private assets with matching manifest and GLB hashes.`);
