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

const bundle = await readFile(new URL("apps/web/dist/demo.js", root), "utf8");
assert.match(bundle, /createBabylonModelRuntime/);
assert.match(bundle, /training-video/);
assert.match(bundle, /demo-scene-canvas/);
assert.match(bundle, /aurora-training-scene-manifest\.json/);
console.log("Training scene composite contract passed: packaged video and Babylon GLB hashes are bound by the scenario manifest.");
