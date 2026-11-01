import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceTriangles, triangleCount } from "./model-variant-geometry.mjs";

const root = resolve(import.meta.dirname, "..");
const report = JSON.parse(await readFile(resolve(root, "apps/web/src/model/optimization-report.json"), "utf8"));
const matrix = JSON.parse(await readFile(resolve(root, "config/e4-device-matrix.json"), "utf8"));
assert.equal(report.schemaVersion, "model-optimization-report.v1");
assert.equal(report.source.triangleCount, 3);
assert.deepEqual(report.source.componentIds, ["AIC-C01", "AIC-C02", "AIC-C03"]);
assert.ok(report.variants.length >= 2);

const synthetic = { accessors: [{ count: 12 }, { count: 6 }], meshes: [{ primitives: [{ indices: 0 }] }, { primitives: [{ indices: 1 }] }] };
assert.equal(triangleCount(synthetic), 6);
assert.equal(reduceTriangles(synthetic, 0.35), 2, "geometric LOD must retain at least one triangle per component mesh");
assert.deepEqual(synthetic.accessors.map((accessor) => accessor.count), [3, 3]);

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseGlb(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  let offset = 12;
  let json;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString("utf8", offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return json;
}

const sourceBytes = await readFile(resolve(root, report.source.modelFile));
assert.equal(hash(sourceBytes), report.source.sourceHash);
for (const variant of report.variants) {
  const bytes = await readFile(resolve(root, variant.modelFile));
  const manifest = JSON.parse(await readFile(resolve(root, variant.manifestFile), "utf8"));
  const document = parseGlb(bytes);
  assert.equal(hash(bytes), variant.sourceHash);
  assert.equal(manifest.sourceHash, variant.sourceHash);
  assert.equal(manifest.variant.variantId, variant.variantId);
  assert.ok(typeof manifest.variant.geometryReduction === "string");
  assert.deepEqual(manifest.variant.preservesComponentIds, report.source.componentIds);
  assert.equal(manifest.triangleCount, triangleCount(document));
  assert.ok(manifest.triangleCount <= report.source.triangleCount);
  if (manifest.triangleCount < report.source.triangleCount) assert.match(manifest.variant.geometryReduction, /^component-preserving-/);
  assert.ok(manifest.triangleCount <= matrix.sceneBudgets.maxTriangles);
  assert.equal(manifest.textureCount, 0);
  assert.ok(variant.bytesSaved > 0);
  assert.ok(document.extras?.modelVariant === variant.variantId);
  assert.deepEqual(variant.componentIds, report.source.componentIds);
  assert.ok(variant.targetProfiles.every((profileId) => matrix.profiles.some((profile) => profile.id === profileId)));
}
console.log(`E4 model variants passed: ${report.variants.map((variant) => `${variant.variantId} (-${variant.bytesSaved} bytes)`).join(", ")}; stable components and scene budgets preserved.`);
