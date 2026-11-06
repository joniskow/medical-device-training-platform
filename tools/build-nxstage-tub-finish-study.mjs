// Compare a more reflective tub finish without changing its geometry or motion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'fixtures/nxstage-system-one-rear-mark-review';
const output = 'output/nxstage-tub-finish-study';
const [glb, manifest, scene] = await Promise.all([
  readFile(`${source}/nxstage-system-one.glb`),
  readFile(`${source}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${source}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(hash(glb), manifest.sourceHash);
assert.equal(scene.model.sourceHash, manifest.sourceHash);
const jsonLength = glb.readUInt32LE(12);
const doc = JSON.parse(glb.subarray(20, 20 + jsonLength));
const material = doc.materials.find(item => item.name === 'PureFlow tub satin metal');
assert(material?.pbrMetallicRoughness?.metallicRoughnessTexture);
material.pbrMetallicRoughness.metallicFactor = .72;
material.pbrMetallicRoughness.roughnessFactor = .75;
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = glb.subarray(20 + jsonLength);
const header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const result = Buffer.concat([header, json, bin]), digest = hash(result);
manifest.sourceHash = digest; manifest.modelVersionId = 'preview:nxstage-tub-finish-study-v1'; manifest.releaseBindingId = manifest.modelVersionId;
scene.model.sourceHash = digest; scene.model.modelVersionId = manifest.modelVersionId;
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`, result),
  writeFile(`${output}/model-manifest.json`, JSON.stringify(manifest, null, 2)),
  writeFile(`${output}/office-scene-review.json`, JSON.stringify(scene, null, 2)),
]);
console.log(`Tub finish study: ${output} (${digest})`);
