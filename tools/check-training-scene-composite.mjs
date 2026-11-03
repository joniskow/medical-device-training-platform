import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateTrainingSceneManifest } from "../packages/contracts/dist/scene-manifest.js";

const root = new URL("..", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const scene = await readJson("apps/web/dist/model/aurora-training-scene-manifest.json");
validateTrainingSceneManifest(scene);
const modelManifest = await readJson("apps/web/dist/model/aurora-training-manifest.json");
for (const cue of scene.interaction?.cues ?? []) {
  const component = cue.componentId ? modelManifest.components.find((item) => item.componentId === cue.componentId) : undefined;
  assert.ok(!cue.componentId || component, `Scene cue references an unknown component: ${cue.componentId}`);
  assert.ok(!cue.targetId || component?.interactionTargets?.some((target) => target.targetId === cue.targetId), `Scene cue references an unknown target: ${cue.targetId}`);
}
const modelBytes = await readFile(new URL("apps/web/dist/model/aurora-training.glb", root));
const videoBytes = await readFile(new URL("apps/web/dist/demo-assets/aic-priming-demo.mp4", root));
assert.equal(sha256(modelBytes), scene.model.sourceHash, "scene manifest must bind the packaged GLB hash");
assert.equal(sha256(videoBytes), scene.video.sourceHash, "scene manifest must bind the packaged video hash");
assert.equal(scene.video.contentType, "video/mp4");
assert.equal(scene.camera.principalPointPixels[0], scene.video.width / 2);
assert.equal(scene.camera.principalPointPixels[1], scene.video.height / 2);
assert.equal(scene.interaction?.equivalentPath, "TEXT_KEYBOARD");
assert.equal(scene.production?.rightsReview, "APPROVED");

const nxstageScene = await readJson("apps/web/dist/model/nxstage-training-scene-manifest.json");
validateTrainingSceneManifest(nxstageScene);
const nxstageModelManifest = await readJson("apps/web/dist/model/nxstage-system-one-manifest.json");
for (const cue of nxstageScene.interaction?.cues ?? []) {
  const component = cue.componentId ? nxstageModelManifest.components.find((item) => item.componentId === cue.componentId) : undefined;
  assert.ok(!cue.componentId || component, `NxStage cue references an unknown component: ${cue.componentId}`);
  assert.ok(!cue.targetId || component?.interactionTargets?.some((target) => target.targetId === cue.targetId), `NxStage cue references an unknown target: ${cue.targetId}`);
}
const nxstageModelBytes = await readFile(new URL("apps/web/dist/model/nxstage-system-one.glb", root));
const nxstageVideoBytes = await readFile(new URL("apps/web/dist/demo-assets/nxstage-office-background-photo-openmontage.mp4", root));
assert.equal(sha256(nxstageModelBytes), nxstageScene.model.sourceHash, "NxStage scene must bind the packaged GLB hash");
assert.equal(sha256(nxstageVideoBytes), nxstageScene.video.sourceHash, "NxStage scene must bind the packaged video hash");
assert.equal(nxstageScene.production?.integrationMode, "LOCKED_INTERACTIVE");
assert.equal(nxstageScene.render?.contactShadow?.enabled, true);
assert.deepEqual(nxstageScene.render?.contactShadow?.direction, [0.64, 0.48], "NxStage contact shadow must retain its calibrated plate-space direction");

const cinematicScene = await readJson("apps/web/dist/model/nxstage-cinematic-scene-manifest.json");
validateTrainingSceneManifest(cinematicScene);
const cinematicVideoBytes = await readFile(new URL("apps/web/dist/demo-assets/nxstage-hallway-to-room-composite.mp4", root));
const cinematicModelBytes = await readFile(new URL("apps/web/dist/model/nxstage-cinematic-source.glb", root));
const cinematicModelManifest = await readJson("apps/web/dist/model/nxstage-cinematic-source-manifest.json");
assert.equal(sha256(cinematicModelBytes), cinematicScene.model.sourceHash, "Cinematic scene must bind the model revision actually used to render it");
assert.equal(cinematicModelManifest.sourceHash, cinematicScene.model.sourceHash, "Cinematic source manifest must bind the same revision");
assert.equal(sha256(cinematicVideoBytes), cinematicScene.video.sourceHash, "Cinematic scene must bind the baked composite hash");
assert.equal(cinematicScene.production?.integrationMode, "CINEMATIC");
assert.equal(cinematicScene.interaction, undefined, "Cinematic scene must not expose live interaction cues");

const bundle = await readFile(new URL("apps/web/dist/demo.js", root), "utf8");
assert.match(bundle, /createBabylonModelRuntime/);
assert.match(bundle, /training-video/);
assert.match(bundle, /demo-scene-canvas/);
assert.match(bundle, /aurora-training-scene-manifest\.json/);
assert.match(bundle, /nxstage-cinematic-scene-manifest\.json/);
console.log("Training scene composite contract passed: packaged video and Babylon GLB hashes are bound by the scenario manifest.");
