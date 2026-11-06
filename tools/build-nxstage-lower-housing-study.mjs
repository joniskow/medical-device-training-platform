// Shape the fixed lower-right cover from the supplied open-cabinet photo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'fixtures/nxstage-system-one-tub-label-review';
const output = 'output/nxstage-lower-housing-study';
const [original, manifest, scene] = await Promise.all([
  readFile(`${source}/nxstage-system-one.glb`),
  readFile(`${source}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${source}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(original), manifest.sourceHash);
assert.equal(scene.model.sourceHash, manifest.sourceHash);
const jsonLength = original.readUInt32LE(12);
const doc = JSON.parse(original.subarray(20, 20 + jsonLength));
const node = doc.nodes.find(item => item.name === 'Lower right equipment cover');
assert(node && !node.extras?.interactionTargetId, 'The cover must be a fixed visual detail');
const primitive = doc.meshes[node.mesh].primitives[0];
const pos = doc.accessors[primitive.attributes.POSITION];
const oldTriangles = doc.accessors[primitive.indices].count / 3;
const w = pos.max[0], h = pos.max[1], depth = pos.max[2], corner = .004;
const contour = [[-w + corner, -h], [w - corner, -h]];
for (let i = 1; i <= 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 12; contour.push([w - corner + corner * Math.cos(a), -h + corner + corner * Math.sin(a)]); }
for (let i = 0; i <= 24; i++) { const x = w * (1 - 2 * i / 24); contour.push([x, .004 + .012 * Math.sqrt(Math.max(0, 1 - (x / w) ** 2))]); }
for (let i = 0; i <= 6; i++) { const a = Math.PI + i * Math.PI / 12; contour.push([-w + corner + corner * Math.cos(a), -h + corner + corner * Math.sin(a)]); }
const positions = [], normals = [], uvs = [];
function vertex(x, y, z, n) { positions.push(x, y, z); normals.push(...n); uvs.push((x / w + 1) / 2, (y / h + 1) / 2); }
for (let i = 0; i < contour.length; i++) {
  const a = contour[i], b = contour[(i + 1) % contour.length];
  vertex(0, -.004, depth, [0,0,1]); vertex(...a, depth, [0,0,1]); vertex(...b, depth, [0,0,1]);
  vertex(0, -.004, -depth, [0,0,-1]); vertex(...b, -depth, [0,0,-1]); vertex(...a, -depth, [0,0,-1]);
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1, n = [dy / length, -dx / length, 0];
  vertex(...a, depth, n); vertex(...a, -depth, n); vertex(...b, -depth, n);
  vertex(...a, depth, n); vertex(...b, -depth, n); vertex(...b, depth, n);
}
const binStart = 20 + jsonLength, binLength = original.readUInt32LE(binStart);
assert.equal(original.toString('ascii', binStart + 4, binStart + 8), 'BIN\0');
let binary = Buffer.from(original.subarray(binStart + 8, binStart + 8 + binLength));
function append(values, size, type) {
  const padding = (4 - binary.length % 4) % 4, bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  if (padding) binary = Buffer.concat([binary, Buffer.alloc(padding)]);
  const offset = binary.length; binary = Buffer.concat([binary, bytes]);
  const view = doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target:34962}) - 1;
  const item = {bufferView:view,componentType:5126,count:values.length/size,type};
  if (size === 3) { item.min = [0,1,2].map(i=>Math.min(...values.filter((_,j)=>j%3===i))); item.max = [0,1,2].map(i=>Math.max(...values.filter((_,j)=>j%3===i))); }
  return doc.accessors.push(item) - 1;
}
primitive.attributes = {POSITION:append(positions,3,'VEC3'),NORMAL:append(normals,3,'VEC3'),TEXCOORD_0:append(uvs,2,'VEC2')};
const indices = Buffer.alloc(positions.length / 3 * 2);
for (let i = 0; i < positions.length / 3; i++) indices.writeUInt16LE(i, i * 2);
const indexPadding = (4 - binary.length % 4) % 4;
if (indexPadding) binary = Buffer.concat([binary, Buffer.alloc(indexPadding)]);
const indexOffset = binary.length; binary = Buffer.concat([binary, indices]);
const indexView = doc.bufferViews.push({buffer:0,byteOffset:indexOffset,byteLength:indices.length,target:34963}) - 1;
primitive.indices = doc.accessors.push({bufferView:indexView,componentType:5123,count:positions.length/3,type:'SCALAR'}) - 1;
manifest.triangleCount += positions.length / 9 - oldTriangles;
doc.buffers[0].byteLength = binary.length;
binary = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.write('BIN\0',4);
const bin = Buffer.concat([binHeader,binary]), header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const updated = Buffer.concat([header, json, bin]), digest = hash(updated);
manifest.sourceHash = digest; manifest.modelVersionId = 'preview:nxstage-lower-housing-study-v1'; manifest.releaseBindingId = manifest.modelVersionId;
scene.model.sourceHash = digest; scene.model.modelVersionId = manifest.modelVersionId;
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`, updated),
  writeFile(`${output}/model-manifest.json`, JSON.stringify(manifest, null, 2)),
  writeFile(`${output}/office-scene-review.json`, JSON.stringify(scene, null, 2)),
]);
console.log(`Lower housing study: ${output} (${digest})`);
