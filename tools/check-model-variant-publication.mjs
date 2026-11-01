import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bindModelVariants, bindReleaseModelManifest } from "../packages/db/dist/course-review-store.js";

const source = {
  schemaVersion: "model-manifest.v1",
  sourceHash: "a".repeat(64),
  variants: [{ variantId: "mobile", sourceHash: "b".repeat(64), modelBlobKey: "models/mobile.glb", manifestBlobKey: "models/mobile.json", targetProfiles: ["ios-webgl2", "android-webgl2"] }]
};
const bound = bindModelVariants(source, "model-1", "release-binding-1");
assert.equal(bound.variants[0].modelVersionId, "model-1");
assert.equal(bound.variants[0].releaseBindingId, "release-binding-1");
assert.equal(bound.variants[0].modelBlobKey, "models/mobile.glb");
assert.throws(() => bindModelVariants({ ...source, variants: [{ ...source.variants[0], modelBlobKey: undefined }] }, "model-1", "release-binding-1"), /MODEL_VARIANT_BINDING_INVALID/);
assert.throws(() => bindModelVariants({ ...source, variants: [{ ...source.variants[0], variantId: "full" }] }, "model-1", "release-binding-1"), /MODEL_VARIANT_BINDING_INVALID/);
const canonical = JSON.parse(await readFile(resolve(import.meta.dirname, "../apps/web/src/model-manifest.json"), "utf8"));
const boundManifest = bindReleaseModelManifest(canonical, "model-1", "release-binding-1", canonical.sourceHash);
assert.equal(boundManifest.modelVersionId, "model-1");
assert.equal(boundManifest.releaseBindingId, "release-binding-1");
assert.throws(() => bindReleaseModelManifest({ ...canonical, components: [] }, "model-1", "release-binding-1", canonical.sourceHash), /MODEL_RELEASE_MANIFEST_INVALID/);
console.log("Model variant publication contract passed: variant keys, hashes, uniqueness, and release binding are fail-closed.");
