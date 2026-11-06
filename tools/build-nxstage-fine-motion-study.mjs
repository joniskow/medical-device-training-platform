// Retain the existing motion limits while reducing release snapping in review.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-blue-tube-review',output='output/nxstage-fine-motion-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len));
for(const [componentId,axis,nodeName] of [['nxstage-cabinet-door','rotationY','Lower cabinet door hinge'],['nxstage-cycler-door','translationX','Cycler door assembly'],['pureflow-tub','translationX','PureFlow tub travel axis']]){
  const component=manifest.components.find(c=>c.componentId===componentId),rule=component?.permittedTransforms?.[axis],node=doc.nodes.find(n=>n.name===nodeName);
  assert(rule&&node&&rule.step>0);assert.equal(rule.min===0||rule.max===0,true);
  const oldSnap=rule.snap??rule.step;rule.snap=componentId==='nxstage-cabinet-door'?Math.PI/180:oldSnap/10;
  const intervals=(rule.max-rule.min)/rule.snap;assert(Math.abs(intervals-Math.round(intervals))<1e-8,'Motion endpoints must remain reachable');
  node.extras??={};node.extras.reviewMotionSnap=rule.snap;
}
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+len),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-fine-motion-v2';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,limitation:'Finer release increments are a visual interaction choice, not a measurement of device friction or mechanical stops.'},null,2))]);
console.log(`Fine motion candidate: ${output} (${digest})`);
