import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBrowserModelManifest } from '../packages/model-runtime/dist/browser.js';
import { validateTrainingSceneManifest } from '../packages/contracts/dist/scene-manifest.js';

const sourceFolder = process.env.NXSTAGE_METRIC_INPUT ?? 'fixtures/nxstage-system-one-interaction-review';
const studyFolder = process.env.NXSTAGE_METRIC_OUTPUT ?? 'output/nxstage-metric-study';
const sourceScenePath = process.env.NXSTAGE_METRIC_SCENE ?? `${sourceFolder}/office-scene-review.json`;
const readGlb = async path => {
  const bytes = await readFile(path), length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length)), binary: bytes.subarray(20 + length + 8) };
};
const [source, study, sourceManifest, manifest, sourceScene, scene, report] = await Promise.all([
  readGlb(`${sourceFolder}/nxstage-system-one.glb`), readGlb(`${studyFolder}/nxstage-system-one.glb`),
  readFile(`${sourceFolder}/model-manifest.json`, 'utf8').then(JSON.parse), readFile(`${studyFolder}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(sourceScenePath, 'utf8').then(JSON.parse), readFile(`${studyFolder}/office-scene-review.json`, 'utf8').then(JSON.parse),
  readFile(`${studyFolder}/study.json`, 'utf8').then(JSON.parse),
]);
validateBrowserModelManifest(manifest); validateTrainingSceneManifest(scene);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(source.bytes), report.sourceHash);
assert.equal(hash(study.bytes), report.hash);
assert.equal(manifest.sourceHash, report.hash); assert.equal(scene.model.sourceHash, report.hash);
assert.equal(scene.model.modelVersionId, manifest.modelVersionId);
const close = (a, b) => Math.abs(a - b) < 1e-6;
assert(close(report.calibratedShellWidth, .381));
const sceneFactor = report.sceneUnits ? sourceScene.model.scale / report.scale : 1;
assert(close(scene.model.scale * report.scale * sceneFactor, sourceScene.model.scale));
for (let i = 0; i < 3; i++) {
  assert(close(scene.model.translationMeters[i] * sceneFactor, sourceScene.model.translationMeters[i]));
  assert(close(scene.camera.orbit.target[i] * sceneFactor, sourceScene.camera.orbit.target[i]));
}
assert(close(scene.camera.orbit.radius * sceneFactor, sourceScene.camera.orbit.radius));
assert.equal(source.json.nodes.length, study.json.nodes.length);
for (let i = 0; i < source.json.nodes.length; i++) {
  const a = source.json.nodes[i], b = study.json.nodes[i];
  assert.equal(a.name, b.name);
  if (a.translation) for (let j = 0; j < 3; j++) assert(close(b.translation[j], a.translation[j] * report.scale), `node ${a.name}`);
}
const positionIndices = new Set(source.json.meshes.flatMap(mesh => mesh.primitives.map(p => p.attributes.POSITION)));
for (const animation of source.json.animations ?? []) for (const channel of animation.channels) positionIndices.add(animation.samplers[channel.sampler].output);
for (const index of positionIndices) {
  const a = source.json.accessors[index], b = study.json.accessors[index];
  const av = source.json.bufferViews[a.bufferView], bv = study.json.bufferViews[b.bufferView];
  assert.equal(a.count, b.count);
  for (let i = 0; i < a.count; i++) for (let j = 0; j < 3; j++) {
    const x = source.binary.readFloatLE((av.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (av.byteStride ?? 12) + j * 4);
    const y = study.binary.readFloatLE((bv.byteOffset ?? 0) + (b.byteOffset ?? 0) + i * (bv.byteStride ?? 12) + j * 4);
    assert(close(y, x * report.scale), `accessor ${index}, element ${i}`);
  }
}
for (const component of sourceManifest.components) {
  const candidate = manifest.components.find(item => item.componentId === component.componentId);
  assert(candidate);
  for (const target of component.interactionTargets ?? []) {
    const next = candidate.interactionTargets.find(item => item.targetId === target.targetId);
    assert(next);
    for (const field of ['openTranslationMeters', 'pressDepthMeters']) if (target[field] !== undefined) assert(close(next[field], target[field] * report.scale), `${target.targetId} ${field}`);
  }
}
console.log(`Metric study verified: geometry, animation, interaction distances and scene placement; ${positionIndices.size} accessors.`);
