// Keep the photographed lower connector assembly together while clearing the closed door.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-round-stop-review',output='output/nxstage-connector-clearance-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len)),parent=doc.nodes.find(n=>n.name==='Cabinet proportion study');assert(parent);
const nodes=doc.nodes.map((node,index)=>({node,index})).filter(({node})=>/^(Lower connector detail|Lower left connector strip)/.test(node.name??''));
assert.equal(nodes.length,7);assert(nodes.every(({index})=>parent.children.includes(index)));
for(const {node} of nodes){node.translation??=[0,0,0];node.translation[2]-=.0065;}
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+len),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-connector-clearance-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,offsetMeters:.0065,limitation:'Estimated assembly placement; the physical connector geometry has not been measured.'},null,2))]);
console.log(`Connector clearance candidate: ${output} (${digest})`);
