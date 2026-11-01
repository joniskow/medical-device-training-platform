import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const scene = await readJson("apps/web/dist/model/aurora-training-scene-manifest.json");
const modelBytes = await readFile(new URL("apps/web/dist/model/aurora-training.glb", root));
const videoBytes = await readFile(new URL("apps/web/dist/demo-assets/aic-priming-demo.mp4", root));
assert.equal(sha256(modelBytes), scene.model.sourceHash, "scene manifest must bind the packaged GLB hash");
assert.equal(sha256(videoBytes), scene.video.sourceHash, "scene manifest must bind the packaged video hash");
assert.equal(scene.video.contentType, "video/mp4");
assert.equal(scene.camera.principalPointPixels[0], scene.video.width / 2);
assert.equal(scene.camera.principalPointPixels[1], scene.video.height / 2);

const bundle = await readFile(new URL("apps/web/dist/demo.js", root), "utf8");
assert.match(bundle, /createBabylonModelRuntime/);
assert.match(bundle, /training-video/);
assert.match(bundle, /demo-scene-canvas/);
assert.match(bundle, /aurora-training-scene-manifest\.json/);
console.log("Training scene composite contract passed: packaged video and Babylon GLB hashes are bound by the scenario manifest.");
