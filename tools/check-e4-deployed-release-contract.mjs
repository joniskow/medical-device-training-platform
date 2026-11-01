import {tmpdir} from 'node:os';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile,writeFile,mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const readBytes = async (path) => Buffer.from(await readFile(resolve(root, path)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stableValue = (value) => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
    : value;
const stableHash = (value) => hash(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));

const canonical = await readJson("apps/web/src/model-manifest.json");
const mobile = await readJson("apps/web/src/model/model-manifest.mobile.json");
const reduced = await readJson("apps/web/src/model/model-manifest.reduced.json");
const fullBytes = await readBytes("fixtures/reference/model/aurora-infusion-controller.glb");
const mobileBytes = await readBytes("apps/web/src/model/aurora-infusion-controller.mobile.glb");
const reducedBytes = await readBytes("apps/web/src/model/aurora-infusion-controller.reduced.glb");
assert.equal(hash(fullBytes), canonical.sourceHash);
assert.equal(hash(mobileBytes), mobile.sourceHash);
assert.equal(hash(reducedBytes), reduced.sourceHash);

const releaseId = "release:fixture";
const modelVersionId = "model:fixture";
const releaseBindingId = `releasebind:${releaseId}:${modelVersionId}`;
const bind = (manifest, variantId) => ({
  ...manifest,
  modelVersionId,
  releaseBindingId,
  ...(variantId ? { variant: { ...manifest.variant, variantId } } : {})
});
const releasePrefix = `/org_fixture/releases/${releaseId}/models/${modelVersionId}`;
const boundCanonical = {
  ...bind(canonical),
  variants: canonical.variants.map((variant) => ({
    ...variant,
    modelVersionId,
    releaseBindingId,
    modelBlobKey: `org_fixture/releases/${releaseId}/models/${modelVersionId}/${variant.variantId}.glb`,
    manifestBlobKey: `org_fixture/releases/${releaseId}/models/${modelVersionId}/${variant.variantId}.json`
  }))
};
const releaseManifest = {
  schemaVersion: "release-manifest.v1",
  courseVersionId: "course:fixture",
  revision: 1,
  content: { model: { modelVersionId, releaseBindingId, manifestHash: canonical.sourceHash } },
  releaseArtifact: { manifestBlobKey: `org_fixture/releases/${releaseId}/release-manifest.json` }
};
const releaseHash = stableHash(releaseManifest);

const assets = {
  full: { manifest: boundCanonical, model: fullBytes, manifestHash: canonical.sourceHash },
  mobile: { manifest: bind(mobile, "mobile"), model: mobileBytes, manifestHash: mobile.sourceHash },
  reduced: { manifest: bind(reduced, "reduced"), model: reducedBytes, manifestHash: reduced.sourceHash }
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api/v1/releases/")) {
    const variant = url.searchParams.get("variant") ?? "full";
    const asset = assets[variant];
    if (!asset) { response.writeHead(404).end(); return; }
    const base = `http://127.0.0.1:${server.address().port}`;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      releaseId,
      releaseHash,
      modelVersionId,
      releaseBindingId,
      variantId: variant,
      manifestHash: asset.manifestHash,
      manifestUrl: `${base}/assets/${variant}.json`,
      modelUrl: `${base}/assets/${variant}.glb`,
      fallbackManifest: Object.fromEntries(Object.entries(asset.manifest).filter(([key]) => key !== "variants")),
      cacheControl: "private, max-age=60"
    }));
    return;
  }
  const match = url.pathname.match(/^\/assets\/(full|mobile|reduced)\.(json|glb)$/);
  if (match) {
    const asset = assets[match[1]];
    if (match[2] === "json") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(asset.manifest)); }
    else { response.setHeader("content-type", "model/gltf-binary"); response.end(asset.model); }
    return;
  }
  if (url.pathname === "/assets/release.json") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(releaseManifest));
    return;
  }
  response.writeHead(404).end();
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
try {
  const port = server.address().port;
  const fixtureDir=await mkdtemp(resolve(tmpdir(),'mdt-release-'));const reviewedPath=resolve(fixtureDir,'release.json');await writeFile(reviewedPath,JSON.stringify(releaseManifest));
  const runValidator = (allowHttp) => new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [resolve(root, "tools/check-e4-deployed-release.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        E4_DEPLOYED_BASE_URL: `http://127.0.0.1:${port}`,
        E4_DEPLOYED_RELEASE_ID: releaseId,
        E4_DEPLOYED_MODEL_VERSION_ID: modelVersionId,
        E4_REVIEWED_RELEASE_MANIFEST_PATH:reviewedPath,
        ...(allowHttp ? { E4_DEPLOYED_ALLOW_HTTP: "1" } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", rejectChild);
    child.on("close", (code) => code === 0 ? resolveChild() : rejectChild(new Error(output)));
  });
  await assert.rejects(() => runValidator(false), /HTTPS API base URL/);
  await runValidator(true);
  console.log("E4 deployed-release contract passed: local HTTPS-default gate rehearsal verifies release manifest, model, variant, and hash binding.");
} finally {
  await new Promise((resolveServer) => server.close(resolveServer));
}
