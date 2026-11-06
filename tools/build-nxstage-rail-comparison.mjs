// Isolated visual comparison: omit four non-interactive full-height bars.
// The recessed guides and articulated handle remain in the model.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-cabinet-review',output='output/nxstage-rail-comparison';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hashOf=b=>createHash('sha256').update(b).digest('hex');assert.equal(manifest.sourceHash,hashOf(source));assert.equal(scene.model.sourceHash,manifest.sourceHash);
const length=source.readUInt32LE(12),document=JSON.parse(source.subarray(20,20+length));
const names=['Vertical black side rail','Vertical black side rail.001','Angled rail mount','Angled rail mount.001'];
let triangles=0;const removedNodes=[],removedMeshes=[];
for(const name of names){
  const index=document.nodes.findIndex(n=>n.name===name),node=document.nodes[index];assert(index>=0&&node.mesh!==undefined&&!node.children?.length&&!node.extras?.componentId);
  const roots=document.scenes[document.scene??0].nodes;assert(roots.includes(index));roots.splice(roots.indexOf(index),1);
  removedNodes.push(index);removedMeshes.push(node.mesh);
  for(const primitive of document.meshes[node.mesh].primitives){assert(primitive.indices!==undefined);triangles+=document.accessors[primitive.indices].count/3;}
}
assert.equal(new Set(removedMeshes).size,names.length);
assert(!document.skins?.length);
const remap=(index,removed)=>index-removed.filter(item=>item<index).length;
for(const node of document.nodes){
  if(node.children){assert(!node.children.some(child=>removedNodes.includes(child)));node.children=node.children.map(child=>remap(child,removedNodes));}
  if(node.mesh!==undefined&&!removedMeshes.includes(node.mesh))node.mesh=remap(node.mesh,removedMeshes);
}
for(const scene of document.scenes)scene.nodes=scene.nodes.map(index=>remap(index,removedNodes));
for(const animation of document.animations??[])for(const channel of animation.channels){assert(!removedNodes.includes(channel.target.node));channel.target.node=remap(channel.target.node,removedNodes);}
document.nodes=document.nodes.filter((_,index)=>!removedNodes.includes(index));
document.meshes=document.meshes.filter((_,index)=>!removedMeshes.includes(index));
manifest.meshCount-=names.length;manifest.sceneNodeCount-=names.length;manifest.triangleCount-=triangles;
let json=Buffer.from(JSON.stringify(document));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+length),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),hash=hashOf(result);
manifest.sourceHash=hash;manifest.modelVersionId='preview:nxstage-rail-comparison-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=hash;scene.model.modelVersionId=manifest.modelVersionId;
const study={sourceHash:hashOf(source),hash,omittedNodes:names,limitation:'Photo-informed comparison; the rail mechanism and hidden geometry are not verified.'};
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify(study,null,2))]);
console.log(`Rail comparison: ${output} (${hash})`);
