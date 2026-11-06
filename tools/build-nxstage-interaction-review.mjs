import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createGlbModelManifest } from "../packages/model-runtime/dist/glb-manifest.js";

const folder = process.env.NXSTAGE_MODEL_FOLDER ?? "fixtures/nxstage-system-one-interaction-review";
const modelPath = `${folder}/nxstage-system-one.glb`;
const bytes = await readFile(modelPath);
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const manifest = createGlbModelManifest(bytes, sourceHash, image => createHash("sha256").update(image).digest("hex"));
const sourcePhotoDir = "output/nxstage-system-one-photos";
const sourcePhotoNames = (await readdir(sourcePhotoDir)).filter(name => /\.(?:jpe?g|png)$/i.test(name)).sort();
assert.equal(sourcePhotoNames.length, 20, "NxStage manifest requires the complete 20-photo source set");
const sourcePhotoSet = await Promise.all(sourcePhotoNames.map(async name => {
  const photo = await readFile(`${sourcePhotoDir}/${name}`);
  return { file: `${sourcePhotoDir}/${name}`, bytes: photo.length, sha256: createHash("sha256").update(photo).digest("hex") };
}));
manifest.reconstructionSource = { type: "REFERENCE_PHOTO_SET", count: sourcePhotoSet.length, rightsReview: "REVIEW_REQUIRED", files: sourcePhotoSet };
manifest.modelVersionId = process.env.NXSTAGE_MODEL_VERSION ?? "preview:nxstage-system-one-interaction-review-v3";
manifest.releaseBindingId = manifest.modelVersionId;
manifest.fidelity = {
  status: "VISUAL_RECONSTRUCTION",
  sourceType: "REFERENCE_IMAGES",
  scaleStatus: "UNMEASURED",
  hiddenSurfaceUncertainty: "UNKNOWN",
  summary: "Photo-grounded hard-surface reconstruction; proportions follow the supplied reference imagery, but no measured scale or hidden-surface evidence was supplied.",
  evidenceRefs: ["fixtures/nxstage-system-one-interaction-review/panel-review.png", "fixtures/nxstage-system-one-interaction-review/front-review.png", "fixtures/nxstage-system-one-interaction-review/lower-cabinet-review.png", "fixtures/nxstage-system-one-interaction-review/rear-review.png"]
};
manifest.performanceBudget = { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 128 };
const panel = manifest.components.find((component) => component.componentId === "nxstage-control-panel");
assert.ok(panel, "Exported NxStage GLB must retain the control-panel component ID");
panel.interactionCapabilities = ["select", "press"];
const warmer = manifest.components.find((component) => component.componentId === "express-warmer-panel");
assert.ok(warmer, "The Express warmer control panel must be exported");
warmer.interactionCapabilities = ["select", "press"];
assert.deepEqual(new Set(warmer.interactionTargets?.map((target) => target.targetId)), new Set(["FW-C01-DOWN", "FW-C01-UP"]));
for (const target of warmer.interactionTargets) {
  target.pressAxis = [0, 0, -1];
  target.displayName = target.targetId === "FW-C01-DOWN" ? "Warmer temperature down" : "Warmer temperature up";
}
const expectedTargets = ["NX-C01-ADD-FLUID", "NX-C01-VOLUME-TOGGLE", "NX-C01-TREATMENT", "NX-C01-STOP", "NX-C01-MUTE", ...[1,2,3].flatMap(row => [`NX-C01-ROW${row}-DOWN`, `NX-C01-ROW${row}-UP`])];
assert.deepEqual(new Set(panel.interactionTargets?.map((target) => target.targetId)), new Set(expectedTargets));
assert.ok(panel.interactionTargets?.every((target) => target.pressDepthMeters !== undefined));
// Blender extras are not transformed by the glTF exporter: its +Y depth axis
// becomes -Z in the exported node's parent coordinates.
for (const target of panel.interactionTargets) {
  target.pressAxis = [0, 0, -1];
  const match = /^NX-C01-ROW([123])-(DOWN|UP)$/.exec(target.targetId);
  if (match) target.displayName = `${["Dialysate", "Ultrafiltration", "Blood flow"][Number(match[1]) - 1]} ${match[2] === "DOWN" ? "decrease" : "increase"}`;
}
// Keep related controls together for keyboard navigation and named controls.
const controlOrder = ["NX-C01-ADD-FLUID", "NX-C01-VOLUME-TOGGLE", "NX-C01-TREATMENT", ...[1,2,3].flatMap(row => [`NX-C01-ROW${row}-DOWN`, `NX-C01-ROW${row}-UP`]), "NX-C01-STOP", "NX-C01-MUTE"];
panel.interactionTargets.sort((a, b) => controlOrder.indexOf(a.targetId) - controlOrder.indexOf(b.targetId));
const pureflow = manifest.components.find(component => component.componentId === "pureflow-control-panel");
assert.ok(pureflow, "PureFlow control panel must be exported");
pureflow.interactionCapabilities = ["select", "press"];
assert.deepEqual(new Set(pureflow.interactionTargets?.map(target => target.targetId)), new Set(["PF-C01-UP", "PF-C01-DOWN", "PF-C01-GO", "PF-C01-STOP"]));
for (const target of pureflow.interactionTargets) target.pressAxis = [0, 0, -1];
const pureflowOrder = ["PF-C01-UP", "PF-C01-DOWN", "PF-C01-GO", "PF-C01-STOP"];
pureflow.interactionTargets.sort((a, b) => pureflowOrder.indexOf(a.targetId) - pureflowOrder.indexOf(b.targetId));
const powerSwitch = manifest.components.find(component => component.componentId === "cycler-rear-power-switch");
assert.ok(powerSwitch, "The rear cycler power switch must be exported");
powerSwitch.interactionCapabilities = ["select", "open", "rotate"];
powerSwitch.permittedTransforms = { rotationY: { min: -0.24, max: 0, step: 0.24, snap: 0.24 } };
const powerTarget = powerSwitch.interactionTargets?.find(target => target.targetId === "NX-C05-POWER-SWITCH");
assert.ok(powerTarget, "The rocker must have a target");
powerTarget.openRotationSpace = "local";
powerTarget.touchTapSlopPixels = 12;
powerTarget.openVerb = "Set on";
powerTarget.closeVerb = "Set off";
const cabinet = manifest.components.find((component) => component.componentId === "nxstage-cabinet-door");
const cycler = manifest.components.find((component) => component.componentId === "nxstage-cycler-door");
const handle = manifest.components.find((component) => component.componentId === "nxstage-cycler-handle");
if (handle) {
  handle.interactionCapabilities = ["select", "open", "rotate"];
  handle.permittedTransforms = { rotationY: { min: -Math.PI / 2, max: 0, step: Math.PI / 2 } };
}
if (cycler) {
  cycler.interactionCapabilities = ["select", "open", "translate"];
  cycler.permittedTransforms = { translationX: { min: 0, max: .8, step: .1 } };
}
if (cycler && handle) {
  const doorTarget = cycler.interactionTargets?.find((target) => target.targetId === "NX-C03-CYCLER-DOOR");
  const handleTarget = handle.interactionTargets?.find((target) => target.targetId === "NX-C04-CYCLER-HANDLE");
  assert.ok(doorTarget && handleTarget, "The cycler door and handle must have interaction targets");
  // The handle is hinged; let the runtime follow its projected arc from the
  // actual grabbed point instead of assuming a fixed vertical screen motion.
  handleTarget.openVerb = "Lift";
  handleTarget.closeVerb = "Lower";
  doorTarget.openRequires = { componentId: handle.componentId, transform: "rotationY", value: -Math.PI / 2, message: "Lift the cycler door handle before opening the door." };
  handleTarget.closeRequires = { componentId: cycler.componentId, transform: "translationX", value: 0, message: "Close the cycler door before lowering the handle." };
}
if (cabinet) {
  cabinet.interactionCapabilities = ["select", "open", "rotate"];
  cabinet.permittedTransforms = { rotationY: { min: -Math.PI / 2, max: 0, step: Math.PI / 12, snap: Math.PI / 12 } };
}
const tub = manifest.components.find(component => component.componentId === "pureflow-tub");
assert.ok(cabinet && tub, "The PureFlow tub and cabinet door must be exported");
tub.interactionCapabilities = ["select", "open", "translate"];
const tubTarget = tub.interactionTargets?.find(target => target.targetId === "PF-C02-TUB");
const cabinetTarget = cabinet.interactionTargets?.find(target => target.targetId === "NX-C02-CABINET-DOOR");
assert.ok(tubTarget && cabinetTarget, "The tub and cabinet must have interaction targets");
assert.ok(Number.isFinite(tubTarget.openTranslationMeters) && tubTarget.openTranslationMeters > 0, "The tub must provide its outward travel");
tub.permittedTransforms = { translationX: { min: 0, max: tubTarget.openTranslationMeters, step: .1 } };
tubTarget.openVerb = "Pull out";
tubTarget.closeVerb = "Push in";
tubTarget.openRequires = { componentId: cabinet.componentId, transform: "rotationY", value: -Math.PI / 2, message: "Open the cabinet door fully before pulling out the tub." };
cabinetTarget.closeRequires = { componentId: tub.componentId, transform: "translationX", value: 0, message: "Push the tub in before closing the cabinet door." };
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(`${folder}/model-manifest.json`, manifestJson);
// This review asset never rewrites a shared scene or release binding.
await writeFile(`${folder}/provenance.json`, `${JSON.stringify({
  schemaVersion: "authored-model.v1",
  source: process.env.NXSTAGE_MODEL_SOURCE ?? "blender/nxstage_system_one_interaction_review.py",
  blenderVersion: "5.2.3 LTS",
  sha256: sourceHash,
  bytes: bytes.length,
  reviewStatus: "REVIEW_REQUIRED",
  fidelity: manifest.fidelity,
  sourcePhotoSet,
  interactionTargets: panel.interactionTargets,
  limitations: ["No measured scale reference", "Hidden geometry remains unverified", "Not a clinical, regulatory, service, or manufacturing model"]
}, null, 2)}\n`);
console.log(JSON.stringify({ modelPath, sourceHash, bytes: bytes.length, meshes: manifest.meshCount, triangles: manifest.triangleCount, components: manifest.components.map((component) => component.componentId), interactionTargets: panel.interactionTargets?.map((target) => target.targetId) }));
