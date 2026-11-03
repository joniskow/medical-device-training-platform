import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyPermittedTransform, interactionStateViolation, validateAuthoritativeModelState, validateBrowserModelManifest } from "../packages/model-runtime/dist/browser.js";

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

const training = JSON.parse(await readFile(resolve(root, "apps/web/src/model/aurora-training-manifest.json"), "utf8"));
assert.doesNotThrow(() => validateBrowserModelManifest(training));
const localHinge = structuredClone(training);
const localHingeTarget = localHinge.components.find(component => component.componentId === "AIC-C02").interactionTargets[0];
localHingeTarget.openRotationSpace = "local";
assert.doesNotThrow(() => validateBrowserModelManifest(localHinge), "A rotating open target may use its local pivot axis");
localHingeTarget.touchTapSlopPixels = 12;
assert.doesNotThrow(() => validateBrowserModelManifest(localHinge), "A small open control may allow extra touch tap movement");
for (const invalid of [0, 25, -1, "12"]) {
  localHingeTarget.touchTapSlopPixels = invalid;
  assert.throws(() => validateBrowserModelManifest(localHinge), /MODEL_TOUCH_TAP_SLOP_INVALID/, "Invalid touch tolerances must be rejected");
}
delete localHingeTarget.touchTapSlopPixels;
localHingeTarget.openRotationSpace = "world";
assert.throws(() => validateBrowserModelManifest(localHinge), /MODEL_OPEN_ROTATION_SPACE_INVALID/, "Unknown rotation spaces must be rejected");
localHingeTarget.openRotationSpace = "local";
localHingeTarget.interactionType = "press";
assert.throws(() => validateBrowserModelManifest(localHinge), /MODEL_OPEN_ROTATION_SPACE_INVALID/, "A press target cannot declare an open rotation space");
const inconsistentDoor = structuredClone(training);
inconsistentDoor.components.find(component => component.componentId === "AIC-C02").interactionTargets[0].openRotationRadians = Math.PI;
assert.throws(() => validateBrowserModelManifest(inconsistentDoor), /MODEL_INTERACTION_ROTATION_INVALID/, "A door cannot open beyond its declared movement rule");
const inconsistentDial = structuredClone(training);
inconsistentDial.components.find(component => component.componentId === "AIC-C04").interactionTargets[0].turnMinRadians = 0.2;
assert.throws(() => validateBrowserModelManifest(inconsistentDial), /MODEL_INTERACTION_ROTATION_INVALID/, "A dial range must contain its initial position");
const unsnappedDial = structuredClone(training);
const unsnappedDialComponent = unsnappedDial.components.find(component => component.componentId === "AIC-C04");
unsnappedDialComponent.permittedTransforms.rotationY = { min: -2, max: 2, step: 0.05, snap: 0.5 };
unsnappedDialComponent.interactionTargets[0].turnMinRadians = -1.8;
unsnappedDialComponent.interactionTargets[0].turnMaxRadians = 1.8;
assert.throws(() => validateBrowserModelManifest(unsnappedDial), /MODEL_INTERACTION_ROTATION_INVALID/, "A dial stop must be an accepted snap setting");
const missingRule = structuredClone(training);
delete missingRule.components.find(component => component.componentId === "AIC-C04").permittedTransforms;
assert.throws(() => validateBrowserModelManifest(missingRule), /MODEL_INTERACTION_ROTATION_INVALID/, "A turn target must have bounded authoritative motion");
const sliding = structuredClone(training);
const slidingDoor = sliding.components.find(component => component.componentId === "AIC-C02");
slidingDoor.permittedTransforms = { translationX: { min: 0, max: 0.1, step: 0.1 } };
delete slidingDoor.interactionTargets[0].openRotationRadians;
slidingDoor.interactionTargets[0].openTranslationMeters = 0.1;
assert.doesNotThrow(() => validateBrowserModelManifest(sliding), "A sliding door can use a bounded translation");
slidingDoor.interactionTargets[0].openTranslationMeters = 0.2;
assert.throws(() => validateBrowserModelManifest(sliding), /MODEL_OPEN_TRANSLATION_INVALID/, "A sliding door cannot exceed its movement rule");
const interlocked = structuredClone(training);
const interlockedDoor = interlocked.components.find(component => component.componentId === "AIC-C02");
interlockedDoor.interactionTargets[0].openRequires = { componentId: "AIC-C04", transform: "rotationY", value: 0, message: "Return the dial to zero." };
assert.doesNotThrow(() => validateBrowserModelManifest(interlocked), "An interaction may depend on a valid component setting");
interlockedDoor.interactionTargets[0].openRequires.componentId = "missing";
assert.throws(() => validateBrowserModelManifest(interlocked), /MODEL_INTERACTION_REQUIREMENT_INVALID/, "Interaction dependencies must reference an existing component");
const nxstage = validateBrowserModelManifest(JSON.parse(await readFile(resolve(root, "fixtures/nxstage-system-one-interactive/model-manifest.json"), "utf8")));
const invalidDragDirection = structuredClone(nxstage);
invalidDragDirection.components.find(component => component.componentId === "nxstage-cycler-handle").interactionTargets[0].openDragDirection = [0, 0];
assert.throws(() => validateBrowserModelManifest(invalidDragDirection), /MODEL_OPEN_DRAG_DIRECTION_INVALID/, "A drag direction must identify a real direction on screen");
const invalidOpenVerb = structuredClone(nxstage);
invalidOpenVerb.components.find(component => component.componentId === "nxstage-cycler-handle").interactionTargets[0].openVerb = " ";
assert.throws(() => validateBrowserModelManifest(invalidOpenVerb), /MODEL_OPEN_VERB_INVALID/, "A named action must have a meaningful label");
const physicalState = { modelVersionId: nxstage.modelVersionId, releaseBindingId: nxstage.releaseBindingId, sequence: 0, nextSequence: 1, transforms: Object.fromEntries(nxstage.components.map(component => [component.componentId, { rotationY: 0, translationX: 0 }])), scorePoints: 0, completed: false, allowedActions: [] };
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), true, "A closed, locked cycler is a valid restored state");
physicalState.transforms["nxstage-cycler-door"].translationX = 0.8;
assert.match(interactionStateViolation(nxstage, physicalState.transforms, "nxstage-cycler-door"), /Lift the cycler door handle/);
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), false, "A restored open door cannot have a lowered handle");
physicalState.transforms["nxstage-cycler-handle"].rotationY = -Math.PI / 2;
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), true, "A raised handle permits an open door");
physicalState.transforms["nxstage-cycler-handle"].rotationY = -Math.PI / 4;
assert.match(interactionStateViolation(nxstage, physicalState.transforms, "nxstage-cycler-handle"), /Close the cycler door/, "A partly lowered handle must not be allowed while the door is open");
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), false, "Restoring a partly lowered handle with the door open must fail");
physicalState.transforms["nxstage-cycler-handle"].rotationY = -Math.PI / 2;
physicalState.transforms["nxstage-cycler-door"].translationX = 0.4;
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), true, "A raised handle permits a partially open door");
physicalState.transforms["nxstage-cycler-door"].translationX = 0.6;
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), true, "A decimal position must survive harmless snapping roundoff");
physicalState.transforms["nxstage-cycler-door"].translationX = 0.60001;
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), false, "A position genuinely between permitted steps must remain invalid");
physicalState.transforms["nxstage-cycler-door"].translationX = 0.4;
physicalState.transforms["nxstage-cycler-handle"].rotationY = -Math.PI / 4;
assert.match(interactionStateViolation(nxstage, physicalState.transforms, "nxstage-cycler-handle"), /Close the cycler door/, "A partly open door must also prevent lowering the handle");
physicalState.transforms["nxstage-cycler-handle"].rotationY = 0;
assert.match(interactionStateViolation(nxstage, physicalState.transforms, "nxstage-cycler-handle"), /Close the cycler door/);
assert.equal(validateAuthoritativeModelState(nxstage, physicalState), false, "Lowering the handle while the door is open is invalid");

console.log("Model manifest contract passed: binding/schema validation, interaction volumes, transform bounds, snapping, and capability rejection are enforced.");
