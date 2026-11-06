// Shift only the lower part of the exterior blue tube clear of the door sweep.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-connector-review',output='output/nxstage-blue-tube-clearance-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len)),chunk=Buffer.from(source.subarray(20+len));assert.equal(chunk.toString('ascii',4,8),'BIN\0');const bin=chunk.subarray(8);
const node=doc.nodes.find(n=>n.name==='Front left blue tube');assert(node&&!node.translation&&!node.rotation&&!node.scale);
const primitive=doc.meshes[node.mesh].primitives[0];
function accessor(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];assert.equal(a.componentType,5126);assert.equal(a.type,'VEC3');assert(!v.byteStride);return {a,offset:(v.byteOffset??0)+(a.byteOffset??0)};}
const positions=accessor(primitive.attributes.POSITION),normals=accessor(primitive.attributes.NORMAL);assert.equal(positions.a.count,normals.a.count);
const points=[];
for(let i=0;i<positions.a.count;i++){
  const p=positions.offset+i*12,n=normals.offset+i*12,x=bin.readFloatLE(p),y=bin.readFloatLE(p+4),z=bin.readFloatLE(p+8);
  const t=Math.max(0,Math.min(1,(-.05-y)/.04)),smooth=t*t*(3-2*t),derivative=t>0&&t<1?.35*6*t*(1-t):0;
  const shifted=x-.014*smooth;bin.writeFloatLE(shifted,p);points.push([shifted,y,z]);
  const nx=bin.readFloatLE(n),ny=bin.readFloatLE(n+4)-derivative*nx,nz=bin.readFloatLE(n+8),length=Math.hypot(nx,ny,nz);assert(length>0);
  bin.writeFloatLE(nx/length,n);bin.writeFloatLE(ny/length,n+4);bin.writeFloatLE(nz/length,n+8);
}
positions.a.min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k])));positions.a.max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+chunk.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,chunk]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-blue-tube-clearance-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,lowerOffsetMeters:.014,limitation:'Estimated route adjustment; the real tube is flexible and its exact routing is not measured.'},null,2))]);
console.log(`Blue tube clearance candidate: ${output} (${digest})`);
