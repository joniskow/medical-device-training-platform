// Match the visible front label positions to the supplied open-cabinet photo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'fixtures/nxstage-system-one-tub-finish-review';
const output = 'output/nxstage-tub-label-study';
const [glb, manifest, scene] = await Promise.all([
  readFile(`${source}/nxstage-system-one.glb`),
  readFile(`${source}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${source}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(hash(glb), manifest.sourceHash);
assert.equal(scene.model.sourceHash, manifest.sourceHash);
const length = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + length));
const label = doc.nodes.find(node => node.name === 'Tub upper left label');
const tub = doc.nodes.find(node => node.name === 'PureFlow tub travel axis');
const index = doc.nodes.indexOf(label);
assert(label?.translation && tub?.children?.includes(index), 'The label must move with the tub');
// The first upper label sits near the center of the front face in the open
// cabinet photo, above the heat-warning symbol. Its exact size is unmeasured.
label.translation[2] = -.044;
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = glb.subarray(20 + length), header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const result = Buffer.concat([header, json, bin]), digest = hash(result);
manifest.sourceHash = digest; manifest.modelVersionId = 'preview:nxstage-tub-label-study-v1'; manifest.releaseBindingId = manifest.modelVersionId;
scene.model.sourceHash = digest; scene.model.modelVersionId = manifest.modelVersionId;
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`, result),
  writeFile(`${output}/model-manifest.json`, JSON.stringify(manifest, null, 2)),
  writeFile(`${output}/office-scene-review.json`, JSON.stringify(scene, null, 2)),
]);
console.log(`Tub label study: ${output} (${digest})`);
