// Isolated front-surface study; retains the source asset and interaction metadata.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';

const input = 'fixtures/nxstage-system-one-handle-gap-review';
const output = 'output/nxstage-front-bowl-study';
const [source, manifest, scene] = await Promise.all([
  readFile(`${input}/nxstage-system-one.glb`),
  readFile(`${input}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${input}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(source), manifest.sourceHash);
assert.equal(scene.model.sourceHash, manifest.sourceHash);
const jsonLength = source.readUInt32LE(12);
const doc = JSON.parse(source.subarray(20, 20 + jsonLength));
const binChunk = Buffer.from(source.subarray(20 + jsonLength));
assert.equal(binChunk.toString('ascii', 4, 8), 'BIN\0');
const bin = binChunk.subarray(8);
const node = doc.nodes.find(item => item.name === 'Central recessed face');
const primitive = doc.meshes[node.mesh].primitives[0];
const view = index => {
  const accessor = doc.accessors[index], bufferView = doc.bufferViews[accessor.bufferView];
  assert.equal(bufferView.buffer, 0);
  return {accessor, start: (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride: bufferView.byteStride};
};
const positions = view(primitive.attributes.POSITION), normals = view(primitive.attributes.NORMAL), indices = view(primitive.indices);
assert.equal(positions.accessor.count, 861);
assert.equal(positions.accessor.componentType, 5126);
assert.equal(normals.accessor.componentType, 5126);
assert.equal(indices.accessor.componentType, 5123);
assert(!positions.stride && !normals.stride && !indices.stride);
const points = [];
for (let i = 0; i < positions.accessor.count; i++) {
  const offset = positions.start + i * 12;
  const x = bin.readFloatLE(offset), y = bin.readFloatLE(offset + 4), z = bin.readFloatLE(offset + 8);
  // The original model-space outline is known from the generator. The curved
  // depth is estimated from the photo, and remains in front of the solid shell.
  const scale = 0.08561798119782785;
  const u = Math.max(-1, Math.min(1, x / (1.83 * scale)));
  const bottom = 2.47 + 1.03 * u * u;
  const t = Math.max(0, Math.min(1, (y / scale - bottom) / (4.04 - bottom)));
  const shape = (1 - u * u) * Math.sin(Math.PI * t);
  const adjusted = z + 0.004 - 0.015 * shape;
  bin.writeFloatLE(adjusted, offset + 8);
  points.push([x, y, adjusted]);
}
positions.accessor.min = [0, 1, 2].map(axis => Math.min(...points.map(p => p[axis])));
positions.accessor.max = [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis])));
const sums = points.map(() => [0, 0, 0]);
for (let i = 0; i < indices.accessor.count; i += 3) {
  const ids = [0, 1, 2].map(j => bin.readUInt16LE(indices.start + (i + j) * 2));
  const [a,b,c] = ids.map(id => points[id]);
  const u = b.map((v,k) => v-a[k]), v = c.map((v,k) => v-a[k]);
  const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  for (const id of ids) for (let k=0; k<3; k++) sums[id][k] += cross[k];
}
for (let i = 0; i < sums.length; i++) {
  const magnitude = Math.hypot(...sums[i]);
  assert(magnitude > 0);
  // Preserve the original normal hemisphere regardless of triangle winding.
  const offset = normals.start + i * 12;
  const dot = sums[i].reduce((sum, v, k) => sum + v * bin.readFloatLE(offset + k*4), 0);
  for (let k=0; k<3; k++) bin.writeFloatLE(sums[i][k] / magnitude * (dot < 0 ? -1 : 1), offset + k*4);
}
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4, 0x20)]);
const header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2,4); header.writeUInt32LE(20+json.length+binChunk.length,8);
header.writeUInt32LE(json.length,12); header.write('JSON',16);
const result = Buffer.concat([header,json,binChunk]), digest = hash(result);
manifest.sourceHash = digest; manifest.modelVersionId = 'preview:nxstage-front-bowl-v1'; manifest.releaseBindingId = manifest.modelVersionId;
scene.model.sourceHash = digest; scene.model.modelVersionId = manifest.modelVersionId;
await mkdir(output,{recursive:true});
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`,result),
  writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),
  writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),
  writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,limitation:'Estimated surface depth and outline; the shell behind the detail remains solid.'},null,2)),
]);
console.log(`Front bowl candidate: ${output} (${digest})`);
