import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(root, "fixtures", "reference");
const manifestPath = resolve(fixtureRoot, "fixture.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(manifest.fixtureId === "AIC-001", "fixture id must be AIC-001");
check(manifest.provenance === "synthetic", "fixture provenance must be synthetic");
check(manifest.rightsStatus === "generated-for-testing", "fixture rights status must be generated-for-testing");
check(manifest.containsPhi === false, "fixture must explicitly declare containsPhi=false");
check(manifest.language === "en-US", "fixture language must be en-US");
check(manifest.assets.length === 6, "fixture must contain six positive assets");
check(manifest.citations.length === 9, "fixture must contain nine source citations");
check(manifest.components.length === 3, "fixture must contain three model components");
check(manifest.procedure.requiredSteps.length === 7, "procedure must contain seven required steps");
check(manifest.fault.requiredSequence.length === 5, "fault sequence must contain five required actions");
check(manifest.assessment.requiredEvidence.length === 4, "assessment must contain four evidence requirements");
check(Object.keys(manifest.expectedOutcomes).sort().join(",") === "author,learner,operator,verifier", "fixture must contain author, learner, verifier, and operator outcomes");
check(manifest.gateEvidence.length === 4, "fixture must contain four gate evidence definitions");
check(manifest.negativeVariants.length === 6, "fixture must contain six negative variants");

for (const asset of manifest.assets) {
  const absolutePath = resolve(root, asset.path);
  const bytes = await readFile(absolutePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  check(bytes.length === asset.bytes, `${asset.path}: byte length mismatch`);
  check(hash === asset.sha256, `${asset.path}: sha256 mismatch`);
  if (asset.path.endsWith(".pdf")) check(bytes.subarray(0, 5).toString() === "%PDF-", `${asset.path}: invalid PDF signature`);
  if (asset.path.endsWith(".glb")) {
    check(bytes.subarray(0, 4).toString() === "glTF", `${asset.path}: invalid GLB magic`);
    check(bytes.readUInt32LE(4) === 2, `${asset.path}: GLB version must be 2`);
    const jsonLength = bytes.readUInt32LE(12);
    check(bytes.readUInt32LE(16) === 0x4e4f534a, `${asset.path}: first GLB chunk must be JSON`);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trim());
    const nodeNames = new Set((gltf.nodes ?? []).map((node) => node.name));
    for (const requiredNode of ["Control Panel", "Safety Cover", "Line Sensor"]) {
      check(nodeNames.has(requiredNode), `${asset.path}: missing node ${requiredNode}`);
    }
  }
  if (asset.path.endsWith(".png")) check(bytes.readUInt32BE(0) === 0x89504e47, `${asset.path}: invalid PNG signature`);
  if (asset.path.endsWith(".mp4")) check(bytes.subarray(4, 8).toString() === "ftyp", `${asset.path}: invalid MP4 signature`);
}

for (const variant of manifest.negativeVariants) {
  const absolutePath = resolve(root, variant.path);
  await readFile(absolutePath);
  check(variant.expectedOutcome === "terminal-rejection-or-review-queue", `${variant.path}: unexpected negative-variant outcome`);
}

for (const citation of manifest.citations) {
  check(typeof citation.asset === "string", "citation must identify an asset");
  check(typeof citation.anchor === "string", `${citation.asset}: citation must identify an anchor`);
  check(manifest.assets.some((asset) => asset.path.endsWith(citation.asset)), `${citation.asset}: citation asset is not a positive fixture asset`);
  if (citation.page !== undefined) check(Number.isInteger(citation.page) && citation.page > 0, `${citation.asset}: citation page must be a positive integer`);
  if (citation.startSeconds !== undefined || citation.endSeconds !== undefined) {
    check(Number.isFinite(citation.startSeconds) && Number.isFinite(citation.endSeconds), `${citation.asset}: time citation must have numeric bounds`);
    check(citation.startSeconds >= 0 && citation.endSeconds > citation.startSeconds, `${citation.asset}: time citation bounds are invalid`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Reference fixture ${manifest.fixtureId} passed: ${manifest.assets.length} positive assets, ${manifest.negativeVariants.length} negative variants.`);
}
