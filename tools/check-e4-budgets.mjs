import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "apps/web/src/model-manifest.json"), "utf8"));
const optimization = JSON.parse(await readFile(resolve(root, "apps/web/src/model/optimization-report.json"), "utf8"));
const matrix = JSON.parse(await readFile(resolve(root, "config/e4-device-matrix.json"), "utf8"));
assert.equal(manifest.schemaVersion, "model-manifest.v1");
assert.equal(manifest.normalizationStatus, "CANONICAL");
assert.equal(manifest.upAxis, "Y");
assert.equal(manifest.handedness, "right");
assert.equal(manifest.origin, "bounding-box-center");
assert.equal(manifest.forwardAxis, "-Z");
assert.equal(manifest.unitSystem, "meter");
assert.ok(manifest.sourceHash && /^[a-f0-9]{64}$/.test(manifest.sourceHash));
assert.ok(manifest.modelVersionId && manifest.releaseBindingId);
assert.equal(manifest.textureCount, manifest.textures.length);
assert.ok(manifest.triangleCount <= matrix.sceneBudgets.maxTriangles);
assert.ok(manifest.textureCount <= matrix.sceneBudgets.maxTextures);
assert.ok(manifest.performanceBudget?.minimumFps >= 30);
assert.ok(manifest.performanceBudget?.interactiveWithinMs <= 5000);
assert.ok(manifest.performanceBudget?.maxMemoryMb <= matrix.profiles[0].maxMemoryMb);
assert.ok(manifest.textures.reduce((total, texture) => total + texture.byteLength, 0) <= matrix.sceneBudgets.maxTextureBytes);
assert.equal(matrix.profiles.length, 3);
assert.ok(matrix.profiles.every((profile) => profile.targetFps >= 30 && profile.interactiveWithinMs <= 5000));
assert.ok(optimization.variants.length >= 2);
for (const variant of optimization.variants) {
  assert.ok(variant.triangleCount <= matrix.sceneBudgets.maxTriangles);
  assert.ok(variant.textureCount <= matrix.sceneBudgets.maxTextures);
  assert.deepEqual(variant.componentIds, manifest.components.map((component) => component.componentId));
  assert.ok(variant.targetProfiles.every((profileId) => matrix.profiles.some((profile) => profile.id === profileId)));
}
console.log(`E4 scene budgets passed: ${manifest.triangleCount} canonical triangles, ${manifest.textureCount} textures, ${optimization.variants.length} optimized variants, ${matrix.profiles.length} device profiles.`);
