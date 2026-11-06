// Make an isolated candidate from the current metric review, preserving
// animation and interaction rules while adjusting tub and floor placement.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const input = 'fixtures/nxstage-system-one-depth-review';
const output = 'output/nxstage-tub-clearance-study';
const [source, manifest, scene, study] = await Promise.all([
  readFile(`${input}/nxstage-system-one.glb`),
  readFile(`${input}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${input}/office-scene-review.json`, 'utf8').then(JSON.parse),
  readFile(`${input}/study.json`, 'utf8').then(JSON.parse),
]);
const oldHash = createHash('sha256').update(source).digest('hex');
assert.equal(manifest.sourceHash, oldHash);
assert.equal(scene.model.sourceHash, oldHash);
const length = source.readUInt32LE(12), document = JSON.parse(source.subarray(20, 20 + length));
const index = document.nodes.findIndex(node => node.name === 'PureFlow tub outward orientation');
const parent = document.nodes.find(node => node.children?.includes(index));
const node = document.nodes[index];
assert(node && parent?.name === 'Cabinet proportion study');
assert.deepEqual(parent.scale, [1, 1.5, 1]);
// The original Blender study is in unscaled Z-up units. Lower the tub by .17
// and the floor by .05 in that space; their parent scales the vertical axis.
// This keeps the rim below the fixed controller throughout its travel.
node.translation[1] -= .17 * study.scale / parent.scale[1];
const floor = document.nodes.find(item => item.name === 'Cabinet floor');
assert(floor && parent.children.includes(document.nodes.indexOf(floor)));
floor.translation[1] -= .05 * study.scale / parent.scale[1];
let json = Buffer.from(JSON.stringify(document));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = source.subarray(20 + length), header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const result = Buffer.concat([header, json, bin]);
const hash = createHash('sha256').update(result).digest('hex');
manifest.sourceHash = hash; scene.model.sourceHash = hash;
manifest.modelVersionId = 'preview:nxstage-tub-clearance-v1';
manifest.releaseBindingId = manifest.modelVersionId;
scene.model.modelVersionId = manifest.modelVersionId;
study.sourceHash = oldHash; study.hash = hash;
study.tubRestOffsetMeters = { down: .17 * study.scale, floorDown: .05 * study.scale };
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`, result),
  writeFile(`${output}/model-manifest.json`, JSON.stringify(manifest, null, 2)),
  writeFile(`${output}/office-scene-review.json`, JSON.stringify(scene, null, 2)),
  writeFile(`${output}/study.json`, JSON.stringify(study, null, 2)),
]);
console.log(`Isolated tub clearance candidate: ${output} (${hash})`);
