import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createGlbModelManifest } from "../packages/model-runtime/dist/glb-manifest.js";

const folder = "fixtures/nxstage-system-one";
const modelPath = `${folder}/nxstage-system-one.glb`;
const bytes = await readFile(modelPath);
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const manifest = createGlbModelManifest(bytes, sourceHash);
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
assert.deepEqual(panel.interactionTargets?.map((target) => target.targetId), ["NX-C01-FLOW", "NX-C01-RATE", "NX-C01-STOP", "NX-C01-MUTE"]);
assert.ok(panel.interactionTargets?.every((target) => target.pressDepthMeters !== undefined));
await writeFile(`${folder}/model-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(`${folder}/provenance.json`, `${JSON.stringify({
  schemaVersion: "authored-model.v1",
  source: "blender/nxstage_system_one_scene.py",
  blenderVersion: "5.2.3 LTS",
  sha256: sourceHash,
  bytes: bytes.length,
  reviewStatus: "REVIEW_REQUIRED",
  fidelity: manifest.fidelity,
  interactionTargets: panel.interactionTargets,
  limitations: ["No measured scale reference", "Hidden geometry remains unverified", "Not a clinical, regulatory, service, or manufacturing model"]
}, null, 2)}\n`);
console.log(JSON.stringify({ modelPath, sourceHash, bytes: bytes.length, meshes: manifest.meshCount, triangles: manifest.triangleCount, components: manifest.components.map((component) => component.componentId), interactionTargets: panel.interactionTargets?.map((target) => target.targetId) }));
