import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bindModelVariants } from "../packages/db/dist/index.js";

const variantIds = ["mobile", "reduced"];

function requiredText(value, name) {
  assert.equal(typeof value, "string", `${name} must be a string`);
  assert.ok(value.trim().length > 0 && value.length <= 256, `${name} must be non-empty and bounded`);
  assert.ok(!/[\u0000-\u001f]/.test(value), `${name} must not contain control characters`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function variantManifestPath(inputDir, variantId) {
  return resolve(inputDir, `model-manifest.${variantId}.json`);
}

export async function prepareReleaseModelArtifacts({ inputDir, outputDir, modelVersionId, releaseBindingId }) {
  const modelId = requiredText(modelVersionId, "modelVersionId");
  const bindingId = requiredText(releaseBindingId, "releaseBindingId");
  const inputRoot = resolve(inputDir);
  const outputRoot = resolve(outputDir);
  const canonical = await readJson(resolve(inputRoot, "model-manifest.json"));
  assert.ok(Array.isArray(canonical.variants), "canonical manifest must declare variant descriptors");

  const descriptors = new Map(canonical.variants.map((variant) => [variant?.variantId, variant]));
  const boundCanonical = bindModelVariants(canonical, modelId, bindingId);
  const manifests = [{
    variantId: "full",
    file: "model-manifest.json",
    sourceHash: boundCanonical.sourceHash,
    manifestBlobKey: null,
    modelBlobKey: null
  }];

  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "model-manifest.json"), `${JSON.stringify(boundCanonical, null, 2)}\n`);

  for (const variantId of variantIds) {
    const descriptor = descriptors.get(variantId);
    assert.ok(descriptor, `canonical manifest is missing the ${variantId} descriptor`);
    const source = await readJson(variantManifestPath(inputRoot, variantId));
    assert.equal(source.variant?.variantId, variantId, `${variantId} manifest variant ID must match its filename`);
    assert.equal(source.sourceHash, descriptor.sourceHash, `${variantId} manifest hash must match its canonical descriptor`);
    const bound = bindModelVariants(source, modelId, bindingId);
    assert.equal(bound.modelVersionId, modelId);
    assert.equal(bound.releaseBindingId, bindingId);
    assert.equal(bound.sourceHash, source.sourceHash, `${variantId} binding must not change the model hash`);
    const file = `model-manifest.${variantId}.json`;
    await writeFile(resolve(outputRoot, file), `${JSON.stringify(bound, null, 2)}\n`);
    manifests.push({
      variantId,
      file,
      sourceHash: bound.sourceHash,
      manifestBlobKey: descriptor.manifestBlobKey ?? null,
      modelBlobKey: descriptor.modelBlobKey ?? null
    });
  }

  const index = {
    schemaVersion: "release-model-artifacts.v1",
    modelVersionId: modelId,
    releaseBindingId: bindingId,
    manifests
  };
  await writeFile(resolve(outputRoot, "release-model-artifacts.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
  const inputDir = args.get("--input");
  const outputDir = args.get("--output");
  const modelVersionId = args.get("--model-version-id");
  const releaseBindingId = args.get("--release-binding-id");
  if (!inputDir || !outputDir || !modelVersionId || !releaseBindingId) {
    throw new Error("Usage: node tools/release-model-artifacts.mjs --input <dir> --output <dir> --model-version-id <id> --release-binding-id <id>");
  }
  const result = await prepareReleaseModelArtifacts({ inputDir, outputDir, modelVersionId, releaseBindingId });
  console.log(`Prepared release-bound model manifests: ${result.manifests.map((manifest) => manifest.variantId).join(", ")}.`);
}
