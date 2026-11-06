// Isolated scale study. This does not replace any review or release assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { validateBrowserModelManifest } from '../packages/model-runtime/dist/browser.js';

const input = process.env.NXSTAGE_METRIC_INPUT ?? 'fixtures/nxstage-system-one-interaction-review';
const output = process.env.NXSTAGE_METRIC_OUTPUT ?? 'output/nxstage-metric-study';
const source = await readFile(`${input}/nxstage-system-one.glb`);
assert.equal(source.toString('ascii', 0, 4), 'glTF');
assert.equal(source.readUInt32LE(4), 2);
const jsonLength = source.readUInt32LE(12);
assert.equal(source.toString('ascii', 16, 20), 'JSON');
const document = JSON.parse(source.subarray(20, 20 + jsonLength));
const binaryHeader = 20 + jsonLength;
assert.equal(source.toString('ascii', binaryHeader + 4, binaryHeader + 8), 'BIN\0');
const binary = Buffer.from(source.subarray(binaryHeader + 8, binaryHeader + 8 + source.readUInt32LE(binaryHeader)));
assert.equal(document.buffers.length, 1);
assert(!document.skins?.length && !document.nodes.some(node => node.matrix), 'Study only handles this rigid, TRS-authored model');
assert(!document.meshes.some(mesh => mesh.primitives.some(primitive => primitive.targets)), 'Morph targets require separate handling');

const shell = document.nodes.find(node => node.name === 'Upper machine shell');
assert(shell && shell.mesh !== undefined && !shell.rotation && (shell.scale?.[0] ?? 1) === 1);
assert(!document.nodes.some(node => node.children?.includes(document.nodes.indexOf(shell))), 'Expected an unparented shell');
const shellPosition = document.accessors[document.meshes[shell.mesh].primitives[0].attributes.POSITION];
const sourceWidth = shellPosition.max[0] - shellPosition.min[0];
// Approximate manufacturer's System One width (15 in); the photographed
// unit has not been measured. Uniform scaling does not correct its depth.
const scale = 0.381 / sourceWidth;
const accessors = new Set();
for (const mesh of document.meshes) for (const primitive of mesh.primitives) accessors.add(primitive.attributes.POSITION);
for (const animation of document.animations ?? []) for (const channel of animation.channels) {
  assert.equal(channel.target.path, 'translation', 'Unexpected animation requires separate scale handling');
  accessors.add(animation.samplers[channel.sampler].output);
}
for (const index of accessors) {
  const accessor = document.accessors[index];
  assert.equal(accessor.componentType, 5126);
  assert.equal(accessor.type, 'VEC3');
  assert(!accessor.sparse);
  const view = document.bufferViews[accessor.bufferView];
  assert.equal(view.buffer, 0);
  const stride = view.byteStride ?? 12;
  for (let i = 0; i < accessor.count; i++) for (let component = 0; component < 3; component++) {
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride + component * 4;
    binary.writeFloatLE(binary.readFloatLE(offset) * scale, offset);
  }
  if (accessor.min) accessor.min = accessor.min.map(value => value * scale);
  if (accessor.max) accessor.max = accessor.max.map(value => value * scale);
}
for (const node of document.nodes) {
  if (node.translation) node.translation = node.translation.map(value => value * scale);
  for (const key of ['openTranslationMeters', 'pressDepthMeters', 'press_depth_meters']) {
    if (typeof node.extras?.[key] === 'number') node.extras[key] *= scale;
  }
}
let json = Buffer.from(JSON.stringify(document));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryChunk = Buffer.alloc(8);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
jsonHeader.writeUInt32LE(json.length); jsonHeader.write('JSON', 4);
binaryChunk.writeUInt32LE(binary.length); binaryChunk.write('BIN\0', 4);
const bytes = Buffer.concat([header, jsonHeader, json, binaryChunk, binary]);
const hash = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(`${input}/model-manifest.json`, 'utf8'));
manifest.sourceHash = hash;
manifest.modelVersionId = process.env.NXSTAGE_METRIC_VERSION ?? 'preview:nxstage-system-one-metric-study-v1';
manifest.releaseBindingId = manifest.modelVersionId;
manifest.fidelity.summary = 'Scale study calibrated to an approximate published System One width; the photographed device is unmeasured and its geometry remains approximate.';
for (const component of manifest.components) {
  const rule = component.permittedTransforms?.translationX;
  if (rule) for (const key of ['min', 'max', 'step', 'snap']) if (typeof rule[key] === 'number') rule[key] *= scale;
  for (const target of component.interactionTargets ?? []) {
    for (const key of ['openTranslationMeters', 'pressDepthMeters']) if (typeof target[key] === 'number') target[key] *= scale;
    for (const key of ['openRequires', 'closeRequires']) if (target[key]?.transform === 'translationX') target[key].value *= scale;
  }
}
validateBrowserModelManifest(manifest);
const sceneSource = process.env.NXSTAGE_METRIC_SCENE ?? `${input}/office-scene-review.json`;
const scene = JSON.parse(await readFile(sceneSource, 'utf8'));
scene.sceneId = 'scene:nxstage:office-overlay:metric-study';
scene.model.sourceHash = hash;
scene.model.modelVersionId = manifest.modelVersionId;
// Preserve the current projected placement for side-by-side behavior checks.
scene.model.scale /= scale;
const sceneUnits = process.env.NXSTAGE_METRIC_SCENE_UNITS === '1';
if (sceneUnits) {
  // Scale the entire virtual camera/model arrangement together so the model is
  // placed at its authored metric size while retaining the same projection.
  const factor = scene.model.scale;
  scene.model.translationMeters = scene.model.translationMeters.map(value => value / factor);
  scene.model.scale = 1;
  scene.camera.orbit.radius /= factor;
  scene.camera.orbit.target = scene.camera.orbit.target.map(value => value / factor);
  if (scene.render?.contactShadow) scene.render.contactShadow.offsetMeters /= factor;
}
await mkdir(output, { recursive: true });
await writeFile(`${output}/nxstage-system-one.glb`, bytes);
await writeFile(`${output}/model-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(`${output}/office-scene-review.json`, `${JSON.stringify(scene, null, 2)}\n`);
await writeFile(`${output}/study.json`, `${JSON.stringify({ sourceHash: createHash('sha256').update(source).digest('hex'), hash, scale, sceneUnits, originalShellWidth: sourceWidth, calibratedShellWidth: sourceWidth * scale, reference: 'https://hometherapies.freseniusmedicalcare.com/content/dam/home-therapies/travel-and-lifestyle/patient-journey/APM3382-Rev-B_LIVE-Book.pdf', limitation: 'Scale calibrated from an approximate product-family width; depth, motion and the photographed unit remain unmeasured. Not a production asset.' }, null, 2)}\n`);
console.log(`Metric study staged: shell width ${sourceWidth.toFixed(3)} -> ${(sourceWidth * scale).toFixed(3)} m; scale ${scale.toFixed(6)}; SHA-256 ${hash}`);
