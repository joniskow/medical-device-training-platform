import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reduceTriangles, triangleCount } from "./model-variant-geometry.mjs";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "fixtures/reference/model/aurora-infusion-controller.glb");
const outputDir = resolve(root, "apps/web/src/model");
const sourceManifestPath = resolve(root, "apps/web/src/model-manifest.json");

function aligned(value) { return (value + 3) & ~3; }

function parseGlb(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", "source must be a GLB");
  assert.equal(bytes.readUInt32LE(4), 2, "source must be glTF 2.0");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "source GLB length must match its header");
  let offset = 12;
  let json;
  let binary;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= bytes.length, "source GLB chunk exceeds the file");
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString("utf8", start, end));
    if (type === 0x004e4942) binary = bytes.subarray(start, end);
    offset = end;
  }
  assert.ok(json && binary, "source GLB must contain JSON and BIN chunks");
  return { json, binary };
}

function createGlb(json, binary) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(aligned(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const paddedBinary = Buffer.concat([binary, Buffer.alloc(aligned(binary.length) - binary.length)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length;
  const output = Buffer.alloc(totalLength);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  let offset = 12;
  output.writeUInt32LE(paddedJson.length, offset);
  output.writeUInt32LE(0x4e4f534a, offset + 4);
  paddedJson.copy(output, offset + 8);
  offset += 8 + paddedJson.length;
  output.writeUInt32LE(paddedBinary.length, offset);
  output.writeUInt32LE(0x004e4942, offset + 4);
  paddedBinary.copy(output, offset + 8);
  return output;
}

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function variantDocument(source, variantId, materialMode, geometryRatio) {
  const document = clone(source.json);
  document.asset ??= {};
  document.asset.generator = `mdt-e4-${variantId}`;
  document.extras ??= {};
  document.extras.modelVariant = variantId;
  for (const material of document.materials ?? []) {
    const pbr = material.pbrMetallicRoughness;
    if (!pbr) continue;
    delete pbr.metallicFactor;
    delete pbr.roughnessFactor;
  }
  if (materialMode === "flat-reduced") {
    for (const material of document.materials ?? []) {
      const pbr = material.pbrMetallicRoughness;
      if (pbr?.baseColorFactor) pbr.baseColorFactor = pbr.baseColorFactor.map((value, index) => index === 3 ? 1 : Math.round(value * 255) / 255);
    }
  }
  reduceTriangles(document, geometryRatio);
  return document;
}

const sourceBytes = await readFile(sourcePath);
const source = parseGlb(sourceBytes);
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
assert.equal(sourceManifest.sourceHash, hash(sourceBytes), "source manifest hash must match the canonical GLB");
await mkdir(outputDir, { recursive: true });

const variants = [
  { id: "mobile", file: "aurora-infusion-controller.mobile.glb", manifest: "model-manifest.mobile.json", materialMode: "flat-metallic-free", geometryRatio: 0.65, profiles: ["ios-webgl2", "android-webgl2"] },
  { id: "reduced", file: "aurora-infusion-controller.reduced.glb", manifest: "model-manifest.reduced.json", materialMode: "flat-reduced", geometryRatio: 0.35, profiles: ["ios-webgl2", "android-webgl2"] }
];
const reportVariants = [];
for (const variant of variants) {
  const document = variantDocument(source, variant.id, variant.materialMode, variant.geometryRatio);
  const variantTriangleCount = triangleCount(document);
  const geometryReduction = variantTriangleCount < sourceManifest.triangleCount
    ? `component-preserving-${variant.geometryRatio}-triangle-retention`
    : "not-applicable-three-component-floor";
  const bytes = createGlb(document, source.binary);
  const { variants: _sourceVariants, ...variantBase } = sourceManifest;
  const variantManifest = {
    ...variantBase,
    sourceHash: hash(bytes),
    triangleCount: variantTriangleCount,
    variant: {
      variantId: variant.id,
      role: variant.id === "mobile" ? "mobile-optimized" : "reduced-complexity",
      targetProfiles: variant.profiles,
      materialMode: variant.materialMode,
      geometryReduction,
      preservesComponentIds: sourceManifest.components.map((component) => component.componentId)
    }
  };
  await writeFile(resolve(outputDir, variant.file), bytes);
  await writeFile(resolve(outputDir, variant.manifest), `${JSON.stringify(variantManifest, null, 2)}\n`);
  reportVariants.push({
    variantId: variant.id,
    modelFile: `apps/web/src/model/${variant.file}`,
    manifestFile: `apps/web/src/model/${variant.manifest}`,
    sourceHash: variantManifest.sourceHash,
    bytes: bytes.length,
    bytesSaved: sourceBytes.length - bytes.length,
    triangleCount: variantManifest.triangleCount,
    textureCount: variantManifest.textureCount,
    componentIds: variantManifest.variant.preservesComponentIds,
    targetProfiles: variant.profiles,
    geometryReduction: variantManifest.variant.geometryReduction
  });
}

const report = {
  schemaVersion: "model-optimization-report.v1",
  source: {
    modelFile: "fixtures/reference/model/aurora-infusion-controller.glb",
    sourceHash: hash(sourceBytes),
    bytes: sourceBytes.length,
    triangleCount: sourceManifest.triangleCount,
    textureCount: sourceManifest.textureCount,
    componentIds: sourceManifest.components.map((component) => component.componentId)
  },
  variants: reportVariants,
  decision: "Variants apply component-preserving triangle retention to larger meshes and simplify material payloads. The canonical fixture contains one triangle per required interactive component, so it remains at three triangles rather than dropping a required target; larger production models use the generated geometric LOD path."
};
await writeFile(resolve(outputDir, "optimization-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Generated ${variants.length} E4 model variants; source=${sourceBytes.length} bytes, mobile=${reportVariants[0].bytes} bytes, reduced=${reportVariants[1].bytes} bytes.`);
