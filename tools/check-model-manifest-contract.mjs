import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyPermittedTransform, validateAuthoritativeModelState, validateBrowserModelManifest } from "../packages/model-runtime/dist/browser.js";

const root = resolve(import.meta.dirname, "..");
const source = JSON.parse(await readFile(resolve(root, "apps/web/src/model-manifest.json"), "utf8"));
const manifest = validateBrowserModelManifest(source);
const mobileSource = JSON.parse(await readFile(resolve(root, "apps/web/src/model/model-manifest.mobile.json"), "utf8"));
const mobileManifest = validateBrowserModelManifest(mobileSource);
assert.equal(mobileManifest.variant?.variantId, "mobile");
assert.deepEqual(mobileManifest.variant?.preservesComponentIds, manifest.components.map((component) => component.componentId));
const cover = manifest.components.find((component) => component.componentId === "AIC-C02");
const sensor = manifest.components.find((component) => component.componentId === "AIC-C03");
assert.ok(cover);
assert.ok(sensor);

assert.deepEqual(
  applyPermittedTransform(cover, { rotationY: 0, translationX: 0 }, { rotationY: Math.PI / 2 }),
  { rotationY: Math.PI / 2, translationX: 0 },
  "permitted rotation should snap to the declared increment"
);
assert.equal(
  applyPermittedTransform(cover, { rotationY: 0, translationX: 0 }, { rotationY: Math.PI * 2 }),
  null,
  "rotation outside the manifest bounds must be rejected"
);
assert.deepEqual(
  applyPermittedTransform(sensor, { rotationY: 0, translationX: 0 }, { translationX: 0.2 }),
  { rotationY: 0, translationX: 0.2 },
  "permitted translation should be accepted"
);
assert.equal(
  applyPermittedTransform(sensor, { rotationY: 0, translationX: 0 }, { rotationY: 0.2 }),
  null,
  "a transform without a declared component capability must be rejected"
);
assert.deepEqual(
  applyPermittedTransform({ permittedTransforms: { translationX: { min: 1, max: 5, step: 2 } } }, { rotationY: 0, translationX: 1 }, { translationX: 2.1 }),
  { rotationY: 0, translationX: 3 },
  "transform snapping should be relative to the declared minimum"
);

const validState = {
  releaseBindingId: manifest.releaseBindingId,
  modelVersionId: manifest.modelVersionId,
  sequence: 1,
  nextSequence: 2,
  transforms: Object.fromEntries(manifest.components.map((component) => [component.componentId, { rotationY: 0, translationX: 0 }])),
  scorePoints: 0,
  completed: false,
  allowedActions: []
};
assert.equal(validateAuthoritativeModelState(manifest, validState), true, "a complete bound state should be accepted");
const invalidState = structuredClone(validState);
invalidState.transforms["AIC-C02"].rotationY = Math.PI * 2;
assert.equal(validateAuthoritativeModelState(manifest, invalidState), false, "an out-of-policy authoritative transform must be rejected");

const invalidTextureCount = structuredClone(source);
invalidTextureCount.textureCount = 1;
assert.throws(() => validateBrowserModelManifest(invalidTextureCount), /MODEL_MATERIALS_INVALID/);

const invalidVolume = structuredClone(source);
invalidVolume.components[0].interactionVolume.max[0] = -1;
assert.throws(() => validateBrowserModelManifest(invalidVolume), /MODEL_INTERACTION_VOLUME_INVALID/);

const invalidFidelity = structuredClone(source);
invalidFidelity.fidelity.status = "DIMENSIONALLY_VALIDATED";
invalidFidelity.fidelity.scaleStatus = "UNMEASURED";
assert.throws(() => validateBrowserModelManifest(invalidFidelity), /MODEL_FIDELITY_INVALID/, "dimensionally validated models need measured scale and bounded hidden-surface evidence");
invalidFidelity.fidelity.status = "VISUAL_RECONSTRUCTION";
assert.doesNotThrow(() => validateBrowserModelManifest(invalidFidelity), "visual reconstructions may retain explicit uncertainty");
invalidFidelity.fidelity.summary = "";
assert.throws(() => validateBrowserModelManifest(invalidFidelity), /MODEL_FIDELITY_INVALID/);

const invalidCounts = structuredClone(source);
invalidCounts.meshCount = -1;
assert.throws(() => validateBrowserModelManifest(invalidCounts), /MODEL_COUNTS_INVALID/);

const invalidBinding = structuredClone(source);
invalidBinding.modelVersionId = "";
assert.throws(() => validateBrowserModelManifest(invalidBinding), /MODEL_MANIFEST_BINDING_REQUIRED/);

const invalidConvention = structuredClone(source);
invalidConvention.forwardAxis = "+Z";
assert.throws(() => validateBrowserModelManifest(invalidConvention), /MODEL_MANIFEST_NOT_CANONICAL/);

const invalidVariantComponents = structuredClone(mobileSource);
invalidVariantComponents.variant.preservesComponentIds = ["AIC-C01", "AIC-C01", "AIC-C02"];
assert.throws(() => validateBrowserModelManifest(invalidVariantComponents), /MODEL_VARIANT_COMPONENTS_INVALID/);

const duplicateNodeMapping = structuredClone(source);
duplicateNodeMapping.components[1].nodePath = duplicateNodeMapping.components[0].nodePath;
assert.throws(() => validateBrowserModelManifest(duplicateNodeMapping), /MODEL_NODE_MAPPING_INVALID/);

const invalidVariantDescriptor = structuredClone(source);
invalidVariantDescriptor.variants = [null];
assert.throws(() => validateBrowserModelManifest(invalidVariantDescriptor), /MODEL_VARIANTS_INVALID/);

const invalidVariantKey = structuredClone(source);
invalidVariantKey.variants[0].modelBlobKey = "../unsafe.glb";
assert.throws(() => validateBrowserModelManifest(invalidVariantKey), /MODEL_VARIANTS_INVALID/);

const invalidVariantBinding = structuredClone(source);
invalidVariantBinding.variants[0].modelVersionId = "different-model";
invalidVariantBinding.variants[0].releaseBindingId = source.releaseBindingId;
assert.throws(() => validateBrowserModelManifest(invalidVariantBinding), /MODEL_VARIANTS_INVALID/);

const validVariantBinding = structuredClone(source);
validVariantBinding.variants[0].modelVersionId = source.modelVersionId;
validVariantBinding.variants[0].releaseBindingId = source.releaseBindingId;
assert.equal(validateBrowserModelManifest(validVariantBinding).variants?.[0].modelVersionId, source.modelVersionId);

console.log("Model manifest contract passed: binding/schema validation, interaction volumes, transform bounds, snapping, and capability rejection are enforced.");
