import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createGlbModelManifest } from "../packages/model-runtime/dist/glb-manifest.js";

const folder = process.env.NXSTAGE_MODEL_FOLDER ?? "fixtures/nxstage-system-one-interactive";
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
manifest.modelVersionId = "preview:nxstage-system-one-v1";
manifest.releaseBindingId = manifest.modelVersionId;
manifest.fidelity = {
  status: "VISUAL_RECONSTRUCTION",
  sourceType: "REFERENCE_IMAGES",
  scaleStatus: "UNMEASURED",
  hiddenSurfaceUncertainty: "UNKNOWN",
  summary: "Photo-grounded hard-surface reconstruction; proportions follow the supplied reference imagery, but no measured scale or hidden-surface evidence was supplied.",
  evidenceRefs: [`${folder}/nxstage-system-one-preview.png`]
};
manifest.performanceBudget = { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 128 };
const panel = manifest.components.find((component) => component.componentId === "nxstage-control-panel");
assert.ok(panel, "Exported NxStage GLB must retain the control-panel component ID");
panel.interactionCapabilities = ["select", "press"];
const expectedTargets = ["NX-C01-FLOW", "NX-C01-RATE", "NX-C01-STOP", "NX-C01-MUTE", ...[1,2,3].flatMap(row => [`NX-C01-ROW${row}-DOWN`, `NX-C01-ROW${row}-UP`])];
assert.deepEqual(new Set(panel.interactionTargets?.map((target) => target.targetId)), new Set(expectedTargets));
assert.ok(panel.interactionTargets?.every((target) => target.pressDepthMeters !== undefined));
// Blender extras are not transformed by the glTF exporter: its +Y depth axis
// becomes -Z in the exported node's parent coordinates.
for (const target of panel.interactionTargets) {
  target.pressAxis = [0, 0, -1];
  const match = /^NX-C01-ROW([123])-(DOWN|UP)$/.exec(target.targetId);
  if (match) target.displayName = `${["Dialysate", "Ultrafiltration", "Blood flow"][Number(match[1]) - 1]} ${match[2] === "DOWN" ? "decrease" : "increase"}`;
}
const cabinet = manifest.components.find((component) => component.componentId === "nxstage-cabinet-door");
const cycler = manifest.components.find((component) => component.componentId === "nxstage-cycler-door");
const handle = manifest.components.find((component) => component.componentId === "nxstage-cycler-handle");
if (handle) {
  handle.interactionCapabilities = ["select", "open", "rotate"];
  handle.permittedTransforms = { rotationY: { min: -Math.PI / 2, max: 0, step: Math.PI / 12 } };
}
if (cycler) {
  cycler.interactionCapabilities = ["select", "open", "translate"];
  cycler.permittedTransforms = { translationX: { min: 0, max: .8, step: .1 } };
}
if (cycler && handle) {
  const doorTarget = cycler.interactionTargets?.find((target) => target.targetId === "NX-C03-CYCLER-DOOR");
  const handleTarget = handle.interactionTargets?.find((target) => target.targetId === "NX-C04-CYCLER-HANDLE");
  assert.ok(doorTarget && handleTarget, "The cycler door and handle must have interaction targets");
  handleTarget.openDragDirection = [0, -1];
  handleTarget.openVerb = "Lift";
  handleTarget.closeVerb = "Lower";
  handleTarget.openLiftMeters = 0.3;
  doorTarget.openRequires = { componentId: handle.componentId, transform: "rotationY", value: -Math.PI / 2, message: "Lift the cycler door handle before opening the door." };
  handleTarget.closeRequires = { componentId: cycler.componentId, transform: "translationX", value: 0, message: "Close the cycler door before lowering the handle." };
}
if (cabinet) {
  cabinet.interactionCapabilities = ["select", "open", "rotate"];
  cabinet.permittedTransforms = { rotationY: { min: -Math.PI / 2, max: 0, step: Math.PI / 12, snap: Math.PI / 12 } };
}
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(`${folder}/model-manifest.json`, manifestJson);
// The baked cinematic foreground is a separate asset. Never relabel its
// manifest when rebuilding the interactive device.
if (!process.env.NXSTAGE_MODEL_FOLDER) {
  const scenePath = "apps/web/src/model/nxstage-training-scene-manifest.json";
  const scene = JSON.parse(await readFile(scenePath, "utf8"));
  scene.model.sourceHash = sourceHash;
  if (scene.production) scene.production.modelRevision = sourceHash;
  await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
}
await writeFile(`${folder}/provenance.json`, `${JSON.stringify({
  schemaVersion: "authored-model.v1",
  source: "blender/nxstage_system_one_scene.py",
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
