// Isolated submillimeter clearance study for the two handle arms.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-handle-review',output='output/nxstage-handle-gap-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const digest=b=>createHash('sha256').update(b).digest('hex');assert.equal(manifest.sourceHash,digest(source));assert.equal(scene.model.sourceHash,manifest.sourceHash);
const length=source.readUInt32LE(12),document=JSON.parse(source.subarray(20,20+length));
for(const [name,offset] of [['Cycler handle arm left',-.0005],['Cycler handle arm right',.0005]]){
  const index=document.nodes.findIndex(n=>n.name===name),node=document.nodes[index];assert(node?.translation&&document.nodes.find(n=>n.children?.includes(index))?.name==='Cycler handle hinge');node.translation[1]+=offset;
}
let json=Buffer.from(JSON.stringify(document));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+length),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),hash=digest(result);
manifest.sourceHash=hash;manifest.modelVersionId='preview:nxstage-handle-gap-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=hash;scene.model.modelVersionId=manifest.modelVersionId;
const study={sourceHash:digest(source),hash,armOutwardOffsetMeters:.0005,limitation:'Approximate clearance adjustment, not a measured physical gap.'};
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify(study,null,2))]);
console.log(`Handle-gap candidate: ${output} (${hash})`);
