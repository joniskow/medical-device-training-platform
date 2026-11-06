// Isolated adjustment to the approximated cabinet exterior and caster forks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';

const input='fixtures/nxstage-system-one-clearance-review', output='output/nxstage-cabinet-clearance-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const oldHash=createHash('sha256').update(source).digest('hex');
assert.equal(manifest.sourceHash,oldHash);assert.equal(scene.model.sourceHash,oldHash);
const length=source.readUInt32LE(12),document=JSON.parse(source.subarray(20,20+length));
const forks=document.nodes.filter(n=>/^Caster fork(?:\.\d+)?$/.test(n.name??''));assert.equal(forks.length,4);
for(const fork of forks){
  assert(fork.translation&&!fork.scale&&!fork.rotation);
  const accessor=document.accessors[document.meshes[fork.mesh].primitives[0].attributes.POSITION];
  const halfHeight=accessor.max[1];assert(Math.abs(accessor.min[1]+halfHeight)<1e-6);
  // Keep the lower end at the wheel while bringing the fork's top below the floor.
  fork.scale=[1,.55,1];fork.translation[1]-=halfHeight*.45;
}
const rear=document.nodes.filter(n=>/^(Rear (?:gray service cover|lower port panel|cable port|central pole socket|blue tube connector|canister |mounting screw|white canister body)|Blue rear fluid tube|Black rear hose|White rear cable)/.test(n.name??''));
assert(rear.length>=15);
for(const node of rear){assert(node.translation);node.translation[2]-=.042;}
let json=Buffer.from(JSON.stringify(document));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+length),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),hash=createHash('sha256').update(result).digest('hex');
manifest.sourceHash=hash;manifest.modelVersionId='preview:nxstage-cabinet-clearance-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=hash;scene.model.modelVersionId=manifest.modelVersionId;
const study={sourceHash:oldHash,hash,rearwardOffsetMeters:.042,casterForkHeightFactor:.55,limitation:'Approximate model correction; not a measurement of the photographed device.'};
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify(study,null,2))]);
console.log(`Cabinet-clearance candidate: ${output} (${hash})`);
