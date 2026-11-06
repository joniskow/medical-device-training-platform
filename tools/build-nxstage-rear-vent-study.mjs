// Visual study of the two taller perforated fields in the supplied rear photo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source='fixtures/nxstage-system-one-left-cabinet-review', output='output/nxstage-rear-vent-study';
const [glb,manifest,scene]=await Promise.all([readFile(`${source}/nxstage-system-one.glb`),readFile(`${source}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${source}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(glb),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const jsonLength=glb.readUInt32LE(12),doc=JSON.parse(glb.subarray(20,20+jsonLength)),binStart=20+jsonLength;
assert.equal(glb.toString('ascii',binStart+4,binStart+8),'BIN\0');
let binary=Buffer.from(glb.subarray(binStart+8,binStart+8+glb.readUInt32LE(binStart)));
function append(values,componentType,type,size,target){
 const pad=(4-binary.length%4)%4;if(pad)binary=Buffer.concat([binary,Buffer.alloc(pad)]);
 const bytes=Buffer.alloc(values.length*(componentType===5126?4:2));values.forEach((v,i)=>componentType===5126?bytes.writeFloatLE(v,i*4):bytes.writeUInt16LE(v,i*2));
 const view=doc.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:bytes.length,target})-1;binary=Buffer.concat([binary,bytes]);
 const accessor={bufferView:view,componentType,count:values.length/size,type};
 if(type==='VEC3'){accessor.min=[0,1,2].map(i=>Math.min(...values.filter((_,j)=>j%3===i)));accessor.max=[0,1,2].map(i=>Math.max(...values.filter((_,j)=>j%3===i)));}
 return doc.accessors.push(accessor)-1;
}
for(const side of ['left','right']){
 const node=doc.nodes.find(n=>n.name===`Cycler rear ${side} perforations`);assert(node);
 const primitive=doc.meshes[node.mesh].primitives[0],oldTriangles=doc.accessors[primitive.indices].count/3;
 const positions=[],normals=[],indices=[],rows=24,columns=15,radius=.00115;
 const center=side==='left'?-.08733034:.08733034;
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const x=center+(col-(columns-1)/2)*.00535,y=.3744+row*.0037,start=positions.length/3;
  for(let i=0;i<8;i++){const angle=i*Math.PI/4;positions.push(x+radius*Math.cos(angle),y+radius*Math.sin(angle),-.1228617981);normals.push(0,0,-1);}
  for(let i=1;i<7;i++)indices.push(start,start+i+1,start+i);
 }
 primitive.attributes={POSITION:append(positions,5126,'VEC3',3,34962),NORMAL:append(normals,5126,'VEC3',3,34962)};
 primitive.indices=append(indices,5123,'SCALAR',1,34963);
 manifest.triangleCount+=indices.length/3-oldTriangles;
}
doc.buffers[0].byteLength=binary.length;binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+binary.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);binHeader.writeUInt32LE(binary.length);binHeader.write('BIN\0',4);
const result=Buffer.concat([header,json,binHeader,binary]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-rear-vent-study-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2))]);
console.log(`Rear vent study: ${output} (${digest})`);
