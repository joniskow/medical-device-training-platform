// Add estimated shallow visual outlines around the photographed shelf pads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const input='fixtures/nxstage-system-one-shelf-notch-review',output='output/nxstage-shelf-outline-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const jsonLength=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+jsonLength)),offset=20+jsonLength;
assert.equal(source.toString('ascii',offset+4,offset+8),'BIN\0');
const initial=source.subarray(offset+8,offset+8+source.readUInt32LE(offset));
const parts=[initial];let length=initial.length;
function append(values,components,target){
 const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}
 const bytes=Buffer.alloc(values.length*4);values.forEach((value,index)=>bytes.writeFloatLE(value,index*4));
 const view=doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,target})-1;parts.push(bytes);length+=bytes.length;
 const accessor={bufferView:view,componentType:5126,count:values.length/components,type:`VEC${components}`};
 if(components===3&&target===34962){accessor.min=[0,1,2].map(k=>Math.min(...values.filter((_,i)=>i%3===k)));accessor.max=[0,1,2].map(k=>Math.max(...values.filter((_,i)=>i%3===k)));}
 return doc.accessors.push(accessor)-1;
}
const outline=[];const halfX=.054,halfZ=.027,radius=.020,width=.00065;
for(const [sx,sz,start] of [[1,1,0],[-1,1,Math.PI/2],[-1,-1,Math.PI],[1,-1,3*Math.PI/2]]){
 for(let i=0;i<=8;i++){const angle=start+Math.PI/2*i/8;outline.push([(halfX-radius)*sx+radius*Math.cos(angle),(halfZ-radius)*sz+radius*Math.sin(angle)]);}
}
const positions=[],normals=[],uvs=[],colors=[];
const vertex=(p,inner)=>{
 const [x,z]=p,scale=inner?1-width/Math.hypot(x,z):1;
 positions.push(x*scale,.00165,z*scale);normals.push(0,1,0);uvs.push(.5+x,.5+z);colors.push(.92,.92,.92,1);
};
for(let i=0;i<outline.length;i++){
 const a=outline[i],b=outline[(i+1)%outline.length];
 vertex(a,false);vertex(b,false);vertex(b,true);vertex(a,false);vertex(b,true);vertex(a,true);
}
const attrs={POSITION:append(positions,3,34962),NORMAL:append(normals,3,34962),TEXCOORD_0:append(uvs,2,34962),COLOR_0:append(colors,4,34962)};
const indexPadding=(4-length%4)%4;if(indexPadding){parts.push(Buffer.alloc(indexPadding));length+=indexPadding;}
const indices=Buffer.alloc(positions.length/3*2);for(let i=0;i<positions.length/3;i++)indices.writeUInt16LE(i,i*2);
const indexView=doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:indices.length,target:34963})-1;parts.push(indices);length+=indices.length;
const indexAccessor=doc.accessors.push({bufferView:indexView,componentType:5123,count:positions.length/3,type:'SCALAR'})-1;
const shelfMaterial=doc.meshes[doc.nodes.find(n=>n.name==='Upper white shelf').mesh].primitives[0].material;
for(const side of ['left','right']){
 const pad=doc.nodes.find(n=>n.name===`Shelf ${side} recessed pad`);assert(pad?.translation);
 // The source photo places these shallow pads on the exposed front lip. The
 // previous positions were buried underneath the cycler support.
 pad.translation[2]=.150;
 pad.scale=[1,1,.55];
 const mesh=doc.meshes.push({name:`Shelf ${side} outline`,primitives:[{attributes:attrs,indices:indexAccessor,material:shelfMaterial,mode:4}]})-1;
 const node=doc.nodes.push({name:`Shelf ${side} outline`,mesh,translation:[...pad.translation],scale:[...pad.scale],extras:{decorative:true}})-1;
 doc.scenes[doc.scene].nodes.push(node);
}
doc.buffers[0].byteLength=length;const padding=(4-length%4)%4;if(padding){parts.push(Buffer.alloc(padding));length+=padding;}
const bin=Buffer.concat(parts),binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(length,0);binHeader.write('BIN\0',4);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,binHeader,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-shelf-outline-v1';manifest.releaseBindingId=manifest.modelVersionId;manifest.sceneNodeCount+=2;manifest.meshCount+=2;manifest.triangleCount+=positions.length/9*2;
scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,limitation:'Front pad positions, compressed depths and thin outlines are estimates from a photograph, not measured geometry.'},null,2))]);
console.log(`Shelf-outline candidate: ${output} (${digest})`);
