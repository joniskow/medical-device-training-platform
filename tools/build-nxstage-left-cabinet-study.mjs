// Approximate the fixed left-side panel, blank label and loop seen in the open-cabinet photos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = 'fixtures/nxstage-system-one-upper-connector-review', output = 'output/nxstage-left-cabinet-study';
const [glb, manifest, scene] = await Promise.all([
  readFile(`${source}/nxstage-system-one.glb`),
  readFile(`${source}/model-manifest.json`, 'utf8').then(JSON.parse),
  readFile(`${source}/office-scene-review.json`, 'utf8').then(JSON.parse),
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(glb), manifest.sourceHash); assert.equal(scene.model.sourceHash, manifest.sourceHash);
const jsonLength = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + jsonLength));
const binStart = 20 + jsonLength, binLength = glb.readUInt32LE(binStart);
assert.equal(glb.toString('ascii', binStart + 4, binStart + 8), 'BIN\0');
let binary = Buffer.from(glb.subarray(binStart + 8, binStart + 8 + binLength));
function append(values, size, type) {
  const pad = (4 - binary.length % 4) % 4; if (pad) binary = Buffer.concat([binary, Buffer.alloc(pad)]);
  const bytes = Buffer.alloc(values.length * 4); values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
  const view = doc.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:bytes.length,target:34962}) - 1;
  binary = Buffer.concat([binary,bytes]);
  const item = {bufferView:view,componentType:5126,count:values.length/size,type};
  if (type === 'VEC3') { item.min=[0,1,2].map(i=>Math.min(...values.filter((_,j)=>j%3===i))); item.max=[0,1,2].map(i=>Math.max(...values.filter((_,j)=>j%3===i))); }
  return doc.accessors.push(item)-1;
}
function addMesh(name, positions, normals, uvs, materialName) {
  const material=doc.materials.findIndex(item=>item.name===materialName); assert(material>=0);
  const attrs={POSITION:append(positions,3,'VEC3'),NORMAL:append(normals,3,'VEC3'),TEXCOORD_0:append(uvs,2,'VEC2')};
  const count=positions.length/3, pad=(4-binary.length%4)%4; if(pad)binary=Buffer.concat([binary,Buffer.alloc(pad)]);
  const indices=Buffer.alloc(count*2);for(let i=0;i<count;i++)indices.writeUInt16LE(i,i*2);
  const view=doc.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:indices.length,target:34963})-1;binary=Buffer.concat([binary,indices]);
  const accessor=doc.accessors.push({bufferView:view,componentType:5123,count,type:'SCALAR'})-1;
  const mesh=doc.meshes.push({name,primitives:[{attributes:attrs,indices:accessor,material}]})-1;
  const node=doc.nodes.push({name,mesh,extras:{decorative:true}})-1;doc.scenes[doc.scene].nodes.push(node);
  manifest.sceneNodeCount++;manifest.meshCount++;manifest.triangleCount+=count/3;
}
function panel(name,x0,x1,y0,y1,z,material) {
  const p=[x0,y0,z,x1,y0,z,x1,y1,z,x0,y0,z,x1,y1,z,x0,y1,z],n=Array(6).fill([0,0,1]).flat(),uv=[0,0,1,0,1,1,0,0,1,1,0,1];
  addMesh(name,p,n,uv,material);
}
// Visual-only blank label: the source is not legible enough to reproduce text.
panel('Left cabinet dark backing',-.185,-.130,-.188,-.020,.139,'Black rubber');
panel('Left cabinet blank label',-.181,-.137,-.153,-.103,.140,'Tubing white');
// A simplified fixed loop, intentionally not connected to simulated plumbing.
const anchors=[[-.106,-.052],[-.133,-.049],[-.148,-.040],[-.166,-.037],[-.182,-.041],[-.187,-.053],[-.181,-.064],[-.167,-.069],[-.150,-.067],[-.141,-.061],[-.146,-.082],[-.151,-.105],[-.147,-.133],[-.141,-.160]];
const path=[];
for(let i=0;i<anchors.length-1;i++)for(let j=0;j<8;j++){
  const t=j/8, p0=anchors[Math.max(0,i-1)],p1=anchors[i],p2=anchors[i+1],p3=anchors[Math.min(anchors.length-1,i+2)];
  path.push([0,1].map(k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t)));
}
path.push(anchors.at(-1));
const positions=[],normals=[],uvs=[],radius=.0018,sides=8,z=.148;
function tubeVertex(index,angle) {
  const p=path[index],before=path[Math.max(0,index-1)],after=path[Math.min(path.length-1,index+1)];
  const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1,c=Math.cos(angle),s=Math.sin(angle),n=[-dy/length*c,dx/length*c,s];
  positions.push(p[0]+radius*n[0],p[1]+radius*n[1],z+radius*n[2]);normals.push(...n);uvs.push((angle/(Math.PI*2)+1)%1,index/path.length);
}
for(let i=0;i<path.length-1;i++)for(let j=0;j<sides;j++){
  const a=j*Math.PI*2/sides,b=(j+1)*Math.PI*2/sides;
  tubeVertex(i,a);tubeVertex(i+1,a);tubeVertex(i+1,b);
  tubeVertex(i,a);tubeVertex(i+1,b);tubeVertex(i,b);
}
addMesh('Left cabinet white tubing loop',positions,normals,uvs,'Tubing white');
doc.buffers[0].byteLength=binary.length;binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.write('BIN\0',4);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+binary.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,binHeader,binary]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-left-cabinet-study-v1';manifest.releaseBindingId=manifest.modelVersionId;
scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([
  writeFile(`${output}/nxstage-system-one.glb`,result),
  writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),
  writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),
]);
console.log(`Left cabinet study: ${output} (${digest})`);
