import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { createGlbModelManifest } from "../packages/model-runtime/dist/glb-manifest.js";
import { validateBrowserModelManifest } from "../packages/model-runtime/dist/browser.js";
import { validateTrainingSceneManifest } from "../packages/contracts/dist/scene-manifest.js";

const folder = process.env.NXSTAGE_REVIEW_MODEL_FOLDER ?? "fixtures/nxstage-system-one-interaction-review";
const expectedVersion = process.env.NXSTAGE_EXPECTED_MODEL_VERSION ?? "preview:nxstage-system-one-interaction-review-v3";
const expectedVentCount = Number(process.env.NXSTAGE_EXPECTED_VENT_COUNT ?? 15);
const background = process.env.NXSTAGE_REVIEW_BACKGROUND_PATH ?? "fixtures/nxstage-system-one-interaction-review/office-background-review.mp4";
const bytes = await readFile(`${folder}/nxstage-system-one.glb`);
const hash = createHash("sha256").update(bytes).digest("hex");
const manifest = validateBrowserModelManifest(JSON.parse(await readFile(`${folder}/model-manifest.json`, "utf8")));
const scene = validateTrainingSceneManifest(JSON.parse(await readFile(`${folder}/office-scene-review.json`, "utf8")));
const imported = createGlbModelManifest(bytes, hash, data => createHash("sha256").update(data).digest("hex"));
const jsonChunkLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonChunkLength).toString("utf8"));
const nodes = document.nodes ?? [];
for (const name of ["Cycler rear raised enclosure", "IV pole rear section"]) {
  const node = nodes.find(item => item.name === name);
  assert(node && !node.extras?.interactionTargetId, `${name} must be a fixed visual detail`);
}
const casterHubs = nodes.filter(node => /^Front caster hub(?:\.\d+)?$/.test(node.name ?? ""));
const casterWheels = nodes.filter(node => /^Caster wheel(?:\.\d+)?$/.test(node.name ?? ""));
assert.equal(casterHubs.length, 2, "The front wheels must have two hubs");
for (const hub of casterHubs) {
  const position = hub.translation;
  assert(position?.length === 3 && casterWheels.some(wheel => wheel.translation && Math.abs(wheel.translation[0] - position[0]) < 1e-5 && Math.abs(wheel.translation[1] - position[1]) < 1e-5 && Math.abs(wheel.translation[2] - position[2]) < .11), `${hub.name} must be aligned with a front wheel`);
}
const doorIndex = nodes.findIndex(node => node.name === "Cycler door assembly");
assert(doorIndex >= 0, "The cycler door assembly must exist");
const descendants = new Set();
const visit = index => { if (descendants.has(index)) return; descendants.add(index); for (const child of nodes[index].children ?? []) visit(child); };
visit(doorIndex);
const vents = nodes.map((node, index) => ({node, index})).filter(item => item.node.name?.startsWith("Cycler arched front vent "));
assert.equal(vents.length, expectedVentCount, "The front must have the expected number of arched vent slots");
assert(vents.every(({node,index}) => descendants.has(index) && !node.extras?.interactionTargetId), "Vents must travel with the door and must not become controls");
const recessIndex = nodes.findIndex(node => node.name === "Central recessed face");
assert(recessIndex >= 0 && descendants.has(recessIndex) && nodes[recessIndex].extras?.decorative && !nodes[recessIndex].extras?.interactionTargetId, "The curved face must move with the door without becoming a separate control");
assert(document.meshes[nodes[recessIndex].mesh].primitives.some(primitive => primitive.attributes.COLOR_0 !== undefined), "The curved face must retain its gradual surface shading");
const rearGrilles = nodes.filter(node => /^Cycler rear (left|right) perforations$/.test(node.name ?? ""));
assert.equal(rearGrilles.length, 2, "The rear panel must have two perforated fields");
assert(rearGrilles.every(node => node.extras?.decorative && !node.extras?.interactionTargetId), "Rear perforations must remain decorative");
assert.equal(nodes.filter(node => /^Cycler rear central louver [1-3]$/.test(node.name ?? "")).length, 3, "The rear panel must have three central louvers");
for (const name of ["Rear white canister body", "Rear canister mounting block", "Rear canister blue loop"]) {
  const node = nodes.find(item => item.name === name);
  assert(node && !node.extras?.interactionTargetId, `${name} must be present as a visual detail without an invented control`);
}
for (const name of ["Lower right equipment housing", "Lower right equipment cover"]) {
  const node = nodes.find(item => item.name === name);
  assert(node && !node.extras?.interactionTargetId, `${name} must remain a non-interactive visual detail`);
}

assert.equal(manifest.sourceHash, hash, "The review manifest must match the model bytes");
assert.equal(scene.model.sourceHash, hash, "The review scene must match the same model");
assert.equal(scene.model.modelVersionId, manifest.modelVersionId, "The review scene must match the model version");
assert.equal(scene.video.sourceHash, createHash("sha256").update(await readFile(background)).digest("hex"), "The review scene must match its background video");
assert.equal(manifest.modelVersionId, expectedVersion);
assert.equal(scene.production, undefined, "An unmeasured review must not carry production approval");
const target = (component, id) => manifest.components.find(c => c.componentId === component)?.interactionTargets?.find(t => t.targetId === id);
const kind = t => t?.interactionType ?? (t?.pressDepthMeters !== undefined ? "press" : undefined);
for (const id of ["NX-C01-ADD-FLUID", "NX-C01-VOLUME-TOGGLE", "NX-C01-TREATMENT", "NX-C01-STOP", "NX-C01-MUTE", ...[1,2,3].flatMap(row => [`NX-C01-ROW${row}-DOWN`, `NX-C01-ROW${row}-UP`])]) assert.equal(kind(target("nxstage-control-panel", id)),"press", `Missing press target ${id}`);
assert.equal(target("nxstage-control-panel", "NX-C01-FLOW"), undefined, "Printed artwork must not become a control");
for (const id of ["FW-C01-UP", "FW-C01-DOWN"]) assert.equal(kind(target("express-warmer-panel", id)),"press");
assert.equal(target("cycler-rear-power-switch", "NX-C05-POWER-SWITCH")?.openRotationSpace, "local");
assert.equal(target("cycler-rear-power-switch", "NX-C05-POWER-SWITCH")?.touchTapSlopPixels, 12);
assert.equal(imported.components.find(c => c.componentId === "cycler-rear-power-switch")?.interactionTargets?.[0]?.openRotationSpace,"local", "The GLB must carry its local hinge metadata");
assert.equal(imported.components.find(c => c.componentId === "cycler-rear-power-switch")?.interactionTargets?.[0]?.touchTapSlopPixels,12, "The GLB must carry its touch tolerance");
assert.equal(target("nxstage-cycler-door", "NX-C03-CYCLER-DOOR")?.openRequires?.componentId, "nxstage-cycler-handle");
assert.equal(target("pureflow-tub", "PF-C02-TUB")?.openRequires?.componentId, "nxstage-cabinet-door");
for (const cue of scene.interaction?.cues ?? []) assert(target(cue.componentId, cue.targetId), `Unknown scene target ${cue.targetId}`);
for (const path of manifest.fidelity?.evidenceRefs ?? []) await access(path);
console.log(`Preserved review: ${manifest.components.length} components, matching GLB and scene hashes, controls, and interlocks.`);
