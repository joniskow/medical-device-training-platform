import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { prepareReleaseModelArtifacts } from "./release-model-artifacts.mjs";

const root = resolve(import.meta.dirname, "..");
const inputDir = await mkdtemp(resolve(tmpdir(), "e4-model-input-"));
const outputDir = await mkdtemp(resolve(tmpdir(), "e4-model-output-"));
const modelVersionId = "modelv_e4_release_test";
const releaseBindingId = "releasebind:e4-release-test:modelv_e4_release_test";

try {
  await writeFile(resolve(inputDir, "model-manifest.json"), await readFile(resolve(root, "apps/web/src/model-manifest.json")));
  for (const variantId of ["mobile", "reduced"]) {
    await writeFile(resolve(inputDir, `model-manifest.${variantId}.json`), await readFile(resolve(root, "apps/web/src/model", `model-manifest.${variantId}.json`)));
  }
  const originalVariants = new Map();
  for (const variantId of ["mobile", "reduced"]) {
    originalVariants.set(variantId, JSON.parse(await readFile(resolve(inputDir, `model-manifest.${variantId}.json`), "utf8")));
  }
  const index = await prepareReleaseModelArtifacts({ inputDir, outputDir, modelVersionId, releaseBindingId });
  assert.deepEqual(index.manifests.map((manifest) => manifest.variantId), ["full", "mobile", "reduced"]);
  for (const variantId of ["mobile", "reduced"]) {
    const manifest = JSON.parse(await readFile(resolve(outputDir, `model-manifest.${variantId}.json`), "utf8"));
    assert.equal(manifest.modelVersionId, modelVersionId);
    assert.equal(manifest.releaseBindingId, releaseBindingId);
    assert.equal(manifest.variant.variantId, variantId);
    assert.equal(manifest.sourceHash, originalVariants.get(variantId).sourceHash);
  }
  const boundCanonical = JSON.parse(await readFile(resolve(outputDir, "model-manifest.json"), "utf8"));
  assert.equal(boundCanonical.modelVersionId, modelVersionId);
  assert.equal(boundCanonical.releaseBindingId, releaseBindingId);
  assert.ok(boundCanonical.variants.every((variant) => variant.modelVersionId === modelVersionId && variant.releaseBindingId === releaseBindingId));
  for (const variantId of ["mobile", "reduced"]) {
    const unchanged = JSON.parse(await readFile(resolve(inputDir, `model-manifest.${variantId}.json`), "utf8"));
    assert.deepEqual(unchanged, originalVariants.get(variantId));
  }
  console.log("E4 release artifacts passed: canonical and optimized manifests are release-bound without mutating preview sources.");
} finally {
  await rm(inputDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
}
