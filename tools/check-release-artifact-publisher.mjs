import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createReleaseArtifactPublisher } from "../packages/storage/dist/index.js";
import { createInMemoryObjectStorage } from "../tests/doubles/deterministic-adapters.mjs";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const bytes = async (path) => Uint8Array.from(await readFile(path));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = await json("apps/web/src/model-manifest.json");
const mobile = await json("apps/web/src/model/model-manifest.mobile.json");
const reduced = await json("apps/web/src/model/model-manifest.reduced.json");
const fullBytes = await bytes("fixtures/reference/model/aurora-infusion-controller.glb");
const mobileBytes = await bytes("apps/web/src/model/aurora-infusion-controller.mobile.glb");
const reducedBytes = await bytes("apps/web/src/model/aurora-infusion-controller.reduced.glb");
assert.equal(hash(fullBytes), canonical.sourceHash);
assert.equal(hash(mobileBytes), mobile.sourceHash);
assert.equal(hash(reducedBytes), reduced.sourceHash);

const storage = createInMemoryObjectStorage();
await storage.putObject({ blobKey: "source/full.glb", bytes: fullBytes, contentType: "model/gltf-binary" });
await storage.putObject({ blobKey: "source/full.json", bytes: Buffer.from(JSON.stringify(canonical), "utf8"), contentType: "application/json" });
await storage.putObject({ blobKey: "source/mobile.glb", bytes: mobileBytes, contentType: "model/gltf-binary" });
await storage.putObject({ blobKey: "source/mobile.json", bytes: Buffer.from(JSON.stringify(mobile), "utf8"), contentType: "application/json" });
await storage.putObject({ blobKey: "source/reduced.glb", bytes: reducedBytes, contentType: "model/gltf-binary" });
await storage.putObject({ blobKey: "source/reduced.json", bytes: Buffer.from(JSON.stringify(reduced), "utf8"), contentType: "application/json" });

const publisher = createReleaseArtifactPublisher({ storage });
const organizationId = "org_fixture";
const releaseId = "release:fixture";
const modelVersionId = "model:fixture";
const releaseBindingId = `releasebind:${releaseId}:${modelVersionId}`;
const sourceManifest = {
  ...canonical,
  modelVersionId,
  releaseBindingId,
  variants: [
    { ...canonical.variants[0], modelBlobKey: "source/mobile.glb", manifestBlobKey: "source/mobile.json" },
    { ...canonical.variants[1], modelBlobKey: "source/reduced.glb", manifestBlobKey: "source/reduced.json" }
  ]
};
const materialized = await publisher.materializeModelArtifacts({
  organizationId,
  releaseId,
  modelVersionId,
  releaseBindingId,
  modelBlobKey: "source/full.glb",
  manifestBlobKey: "source/full.json",
  manifest: sourceManifest
});
const prefix = `${organizationId}/releases/${releaseId}/models/${modelVersionId}`;
assert.equal(materialized.modelBlobKey, `${prefix}/full.glb`);
assert.equal(materialized.manifestBlobKey, `${prefix}/full.json`);
assert.equal(materialized.manifest.variants[0].modelBlobKey, `${prefix}/mobile.glb`);
assert.equal(materialized.manifest.variants[1].manifestBlobKey, `${prefix}/reduced.json`);
assert.equal((await storage.readObject({ blobKey: `${prefix}/full.glb` })).sha256, canonical.sourceHash);
assert.equal((await storage.readObject({ blobKey: `${prefix}/mobile.glb` })).sha256, mobile.sourceHash);

const releaseManifest = { schemaVersion: "release-manifest.v1", releaseId, content: { model: materialized.manifest } };
const stableValue = (value) => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
    : value;
const stableHash = (value) => createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
const releaseHash = stableHash(releaseManifest);
const releaseManifestBlobKey = publisher.releaseManifestBlobKey({ organizationId, releaseId });
await publisher.materializeReleaseManifest({ blobKey: releaseManifestBlobKey, manifest: releaseManifest, releaseHash });
assert.deepEqual(await jsonFromStorage(storage, releaseManifestBlobKey), releaseManifest);

await assert.rejects(
  publisher.materializeModelArtifacts({
    organizationId,
    releaseId: "release:tampered",
    modelVersionId,
    releaseBindingId: "releasebind:tampered:model",
    modelBlobKey: "source/full.glb",
    manifestBlobKey: "source/full.json",
    manifest: { ...sourceManifest, sourceHash: "0".repeat(64) }
  }),
  /MODEL_MANIFEST_SOURCE_MISMATCH|MODEL_SOURCE_CHECKSUM_MISMATCH/
);

await assert.rejects(
  publisher.materializeModelArtifacts({
    organizationId,
    releaseId: "release:invalid-variants",
    modelVersionId,
    releaseBindingId,
    modelBlobKey: "source/full.glb",
    manifestBlobKey: "source/full.json",
    manifest: { ...sourceManifest, variants: { invalid: true } }
  }),
  /MODEL_VARIANTS_INVALID/
);
await assert.rejects(
  publisher.materializeModelArtifacts({
    organizationId,
    releaseId: "release:duplicate-variants",
    modelVersionId,
    releaseBindingId,
    modelBlobKey: "source/full.glb",
    manifestBlobKey: "source/full.json",
    manifest: { ...sourceManifest, variants: [sourceManifest.variants[0], sourceManifest.variants[0]] }
  }),
  /MODEL_VARIANT_DESCRIPTOR_INVALID/
);

console.log("Release artifact publisher passed: release-owned immutable model/manifest copies, byte checksums, manifest hashing, and tamper rejection.");

async function jsonFromStorage(objectStorage, blobKey) {
  const object = await objectStorage.readObject({ blobKey });
  return JSON.parse(Buffer.from(object.bytes).toString("utf8"));
}
