// Re-space the photographed front vent row without altering the source fixture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-bowl-review',output='output/nxstage-vent-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len));
const indices=doc.nodes.map((n,i)=>({n,i})).filter(({n})=>/^Cycler arched front vent \d+$/.test(n.name??'')).sort((a,b)=>a.n.name.localeCompare(b.n.name));
assert.equal(indices.length,15);
const original=indices.map(({n})=>structuredClone(n)),parent=doc.nodes.find(n=>n.name==='Cycler door assembly');
assert(parent&&indices.every(({i})=>parent.children.includes(i)));
function interpolate(a,b,t){return a.map((value,k)=>value+(b[k]-value)*t);}
for(let i=0;i<17;i++){
  const position=i*14/16,left=Math.floor(position),right=Math.min(14,left+1),fraction=position-left;
  const node=structuredClone(original[Math.round(position)]),q0=original[left].rotation,q1=original[right].rotation;
  const dot=q0.reduce((sum,value,k)=>sum+value*q1[k],0),rotation=interpolate(q0,q1.map(value=>dot<0?-value:value),fraction),magnitude=Math.hypot(...rotation);
  node.name=`Cycler arched front vent ${String(i+1).padStart(2,'0')}`;
  node.translation=interpolate(original[left].translation,original[right].translation,fraction);
  node.rotation=rotation.map(value=>value/magnitude);
  if(i<15){node.mesh=original[i].mesh;doc.nodes[indices[i].i]=node;}
  else {
    const mesh=structuredClone(doc.meshes[node.mesh]);mesh.name=`Front vent study mesh ${i+1}`;
    manifest.triangleCount+=mesh.primitives.reduce((sum,p)=>sum+doc.accessors[p.indices].count/3,0);
    node.mesh=doc.meshes.push(mesh)-1;parent.children.push(doc.nodes.length);doc.nodes.push(node);manifest.sceneNodeCount++;manifest.meshCount++;
  }
}
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+len),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-front-vent-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,ventCount:17,evidence:'17 dark slots visible in 20261020_130849.jpg; slot dimensions and spacing are estimated.'},null,2))]);
console.log(`Vent candidate: ${output} (${digest})`);
