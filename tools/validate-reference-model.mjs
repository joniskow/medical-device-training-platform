import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createGlbModelManifest, GlbValidationError } from "../packages/model-runtime/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const modelPath = resolve(root, "fixtures/reference/model/aurora-infusion-controller.glb");
const bytes = await readFile(modelPath);
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = createGlbModelManifest(bytes, hash);

assert.equal(manifest.schemaVersion, "model-manifest.v1");
assert.equal(manifest.format, "glb");
assert.equal(manifest.normalizationStatus, "CANONICAL");
assert.equal(manifest.scaleMeters, 1);
assert.equal(manifest.upAxis, "Y");
assert.equal(manifest.handedness, "right");
assert.equal(manifest.origin, "bounding-box-center");
assert.equal(manifest.forwardAxis, "-Z");
assert.equal(manifest.sceneNodeCount, 4);
assert.equal(manifest.meshCount, 3);
assert.equal(manifest.materialCount, 3);
assert.equal(manifest.triangleCount, 3);
assert.deepEqual(manifest.components.map(({ componentId, nodePath, interactionCapabilities }) => ({ componentId, nodePath, interactionCapabilities })), [
  { componentId: "AIC-C01", nodePath: "Aurora Infusion Controller/Control Panel", interactionCapabilities: ["select"] },
  { componentId: "AIC-C02", nodePath: "Aurora Infusion Controller/Safety Cover", interactionCapabilities: ["select"] },
  { componentId: "AIC-C03", nodePath: "Aurora Infusion Controller/Line Sensor", interactionCapabilities: ["select"] }
]);

const corrupt = Uint8Array.from(bytes);
corrupt[0] = 0;
assert.throws(() => createGlbModelManifest(corrupt), (error) => error instanceof GlbValidationError && error.code === "INVALID_HEADER");
console.log(`Reference GLB manifest passed: ${manifest.components.length} components, ${manifest.triangleCount} triangles.`);
