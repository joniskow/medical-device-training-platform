// Temporary, isolated comparison of wider stationary side-rail placement.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-clearance-review', output='output/nxstage-side-clearance-study';
const [source, manifest, scene] = await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const oldHash=createHash('sha256').update(source).digest('hex');
assert.equal(manifest.sourceHash,oldHash);assert.equal(scene.model.sourceHash,oldHash);
const length=source.readUInt32LE(12),document=JSON.parse(source.subarray(20,20+length));
for(const [name,shift] of [['Vertical black side rail',-.016],['Vertical black side rail.001',.016],['Angled rail mount',-.016],['Angled rail mount.001',.016]]){
  const node=document.nodes.find(item=>item.name===name);assert(node?.translation);node.translation[0]+=shift;
}
let json=Buffer.from(JSON.stringify(document));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+length),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),hash=createHash('sha256').update(result).digest('hex');
manifest.sourceHash=hash;manifest.modelVersionId='preview:nxstage-side-clearance-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=hash;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2))]);
console.log(`Side-rail comparison: ${output} (${hash})`);
