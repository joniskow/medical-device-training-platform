import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { validateBrowserModelManifest } from "../packages/model-runtime/dist/browser.js";
import { validateTrainingSceneManifest } from "../packages/contracts/dist/scene-manifest.js";
const folder = "fixtures/nxstage-system-one-interaction-review";
const scenePath = `${folder}/office-scene-review.json`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const model = validateBrowserModelManifest(JSON.parse(await readFile(`${folder}/model-manifest.json`, "utf8")));
assert.equal(model.sourceHash, hash(await readFile(`${folder}/nxstage-system-one.glb`)), "Model bytes and manifest must match before rebinding the review scene");
const scene = JSON.parse(await readFile(scenePath, "utf8"));
scene.model.modelVersionId = model.modelVersionId;
scene.model.sourceHash = model.sourceHash;
delete scene.production;
const checked = validateTrainingSceneManifest(scene);
for (const cue of checked.interaction?.cues ?? []) {
  const component = model.components.find(item => item.componentId === cue.componentId);
  assert(component?.interactionTargets?.some(target => target.targetId === cue.targetId), `Unknown review cue ${cue.targetId}`);
}
assert.equal(checked.video.sourceHash, hash(await readFile("fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4")), "Background video must match the review scene");
await writeFile(scenePath, `${JSON.stringify(checked, null, 2)}\n`);
console.log(`Review scene bound to ${model.sourceHash}; cues and background video validated.`);
