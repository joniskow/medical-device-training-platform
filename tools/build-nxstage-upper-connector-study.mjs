// Add the visible upper yellow-ringed connector as fixed visual geometry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'fixtures/nxstage-system-one-lower-housing-review';
const output = 'output/nxstage-upper-connector-study';
const [glb, manifest, scene] = await Promise.all([
  readFile(`${source}/nxstage-system-one.glb`),
  readFile(`${source}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${source}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(hash(glb), manifest.sourceHash);
assert.equal(scene.model.sourceHash, manifest.sourceHash);
const length = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + length));
const parent = doc.nodes.find(node => node.name === 'Cabinet proportion study');
const strip = doc.nodes.find(node => node.name === 'Lower left connector strip');
const collar = doc.nodes.find(node => node.name === 'Lower connector detail red collar');
const core = doc.nodes.find(node => node.name === 'Lower connector detail metal fitting');
const lower = doc.nodes.find(node => node.name === 'Lower connector detail light fitting');
assert(parent?.children && strip?.translation && collar?.translation && core?.translation && lower?.translation);
assert([strip,collar,core,lower].every(node => parent.children.includes(doc.nodes.indexOf(node))));
const stripHeight = doc.accessors[doc.meshes[strip.mesh].primitives[0].attributes.POSITION].max[1];
// The photographed blue plate runs from the upper fitting to just below the
// light-colored fitting, rather than down to the hanging yellow clip.
const top = collar.translation[1] + .032 + .014, bottom = lower.translation[1] - .012;
strip.scale = [1, (top - bottom) / (2 * stripHeight), 1]; strip.translation[1] = (top + bottom) / 2;
const yellow = doc.materials.findIndex(material => material.name === 'Control yellow');
assert(yellow >= 0);
const yellowMesh = structuredClone(doc.meshes[collar.mesh]);
yellowMesh.name = 'Upper connector yellow ring';
yellowMesh.primitives.forEach(primitive => { primitive.material = yellow; });
const yellowMeshIndex = doc.meshes.push(yellowMesh) - 1;
const yellowNode = structuredClone(collar);
yellowNode.name = 'Upper connector yellow ring'; yellowNode.mesh = yellowMeshIndex;
yellowNode.translation[1] += .032; yellowNode.extras = { decorative: true };
const metalNode = structuredClone(core);
const metalMesh = structuredClone(doc.meshes[core.mesh]); metalMesh.name = 'Upper connector metal center';
metalNode.name = 'Upper connector metal center'; metalNode.mesh = doc.meshes.push(metalMesh) - 1; metalNode.translation[1] += .032; metalNode.extras = { decorative: true };
for (const node of [yellowNode,metalNode]) {
  const index = doc.nodes.push(node) - 1;
  parent.children.push(index);
  for (const primitive of doc.meshes[node.mesh].primitives) manifest.triangleCount += doc.accessors[primitive.indices].count / 3;
}
manifest.sceneNodeCount += 2; manifest.meshCount += 2;
let json = Buffer.from(JSON.stringify(doc));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const bin = glb.subarray(20 + length), header = Buffer.alloc(20);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
const result = Buffer.concat([header, json, bin]), digest = hash(result);
manifest.sourceHash = digest; manifest.modelVersionId = 'preview:nxstage-upper-connector-study-v1'; manifest.releaseBindingId = manifest.modelVersionId;
scene.model.sourceHash = digest; scene.model.modelVersionId = manifest.modelVersionId;
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`, result),
  writeFile(`${output}/model-manifest.json`, JSON.stringify(manifest, null, 2)),
  writeFile(`${output}/office-scene-review.json`, JSON.stringify(scene, null, 2)),
]);
console.log(`Upper connector study: ${output} (${digest})`);
