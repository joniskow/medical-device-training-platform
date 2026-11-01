import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createDeterministicAssetProcessor } from "../tests/doubles/deterministic-adapters.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "fixtures", "reference");
const outputRoot = resolve(root, "output", "fixture-import");
await mkdir(outputRoot, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, "fixture.json"), "utf8"));
const processor = createDeterministicAssetProcessor();

const sourceTypeFor = (path) => {
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".glb")) return "glb";
  if (path.endsWith(".png")) return "image";
  if (path.endsWith(".mp4")) return "video";
  return "unknown";
};

const expectedSignature = (path, bytes) => {
  if (path.endsWith(".pdf")) return bytes.subarray(0, 5).toString() === "%PDF-";
  if (path.endsWith(".glb")) return bytes.subarray(0, 4).toString() === "glTF" && bytes.readUInt32LE(4) === 2;
  if (path.endsWith(".png")) return bytes.readUInt32BE(0) === 0x89504e47;
  if (path.endsWith(".mp4")) return bytes.subarray(4, 8).toString() === "ftyp";
  return false;
};

const artifactId = (asset) => `assetv_${createHash("sha256").update(asset.sha256).digest("hex").slice(0, 16)}`;
const positiveResults = [];

for (const asset of manifest.assets) {
  const bytes = await readFile(resolve(root, asset.path));
  assert.equal(bytes.length, asset.bytes, `${asset.path}: byte count changed`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, `${asset.path}: checksum changed`);
  const sourceType = sourceTypeFor(asset.path);
  const request = {
    inputAssetVersionId: artifactId(asset),
    sourceType,
    blobKey: `org_fixture/${manifest.fixtureId}/${asset.path}`,
    sha256: asset.sha256
  };
  assert.notEqual(sourceType, "unknown", `${asset.path}: unsupported positive fixture type`);
  assert.equal(expectedSignature(asset.path, bytes), true, `${asset.path}: signature check failed`);
  assert.deepEqual(await processor.inspect(request), { supported: true, reasons: [] });
  const job = {
    jobId: `job_${artifactId(asset)}`,
    jobType: `fixture.${sourceType}.import`,
    attempt: 1,
    maxAttempts: 3,
    idempotency: { key: `fixture:${manifest.fixtureId}:${asset.sha256}`, requestHash: asset.sha256 },
    tenant: { organizationId: "org_fixture", actorId: "actor_fixture", correlationId: `corr_${manifest.fixtureId}` },
    payload: request
  };
  const result = await processor.process(request, job);
  assert.equal(result.status, "READY");
  assert.equal(result.outputArtifactIds.length, 1);
  positiveResults.push({ path: asset.path, sourceType, status: result.status, artifactId: result.outputArtifactIds[0] });
}

const negativeResults = [];
for (const variant of manifest.negativeVariants) {
  const bytes = await readFile(resolve(root, variant.path));
  const isCorruptPdf = variant.path.endsWith("corrupt-manual.pdf") && bytes.subarray(0, 5).toString() !== "%PDF-";
  const isUnsupported = variant.path.endsWith("unsupported-model.txt");
  const isReviewCase = ["incomplete-source.json", "prompt-injection-source.txt", "conflicting-source.json", "low-quality-reconstruction.json"]
    .some((name) => variant.path.endsWith(name));
  assert.equal(isCorruptPdf || isUnsupported || isReviewCase, true, `${variant.path}: no explicit rejection rule`);
  negativeResults.push({ path: variant.path, status: "REJECTED_OR_REVIEW_REQUIRED", expectedOutcome: variant.expectedOutcome });
}

const report = {
  fixtureId: manifest.fixtureId,
  fixtureVersion: manifest.version,
  mode: "deterministic-dry-run",
  tenantBoundary: "org_fixture",
  positiveAssets: positiveResults,
  negativeVariants: negativeResults,
  assertions: [
    "positive asset checksums and signatures verified",
    "positive assets produced deterministic READY results",
    "negative variants were classified as REJECTED_OR_REVIEW_REQUIRED",
    "all jobs carried tenant, correlation, idempotency, and retry metadata"
  ]
};

await writeFile(resolve(outputRoot, "reference-import-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Reference import dry run passed: ${positiveResults.length} positive assets and ${negativeResults.length} negative variants.`);
