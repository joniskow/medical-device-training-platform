// Photo-informed, estimated ambient shading for the recessed door surface.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='output/nxstage-deep-bowl-study',output='output/nxstage-bowl-shading-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len)),chunk=Buffer.from(source.subarray(20+len));assert.equal(chunk.toString('ascii',4,8),'BIN\0');const bin=chunk.subarray(8);
const node=doc.nodes.find(n=>n.name==='Central recessed face'),primitive=doc.meshes[node.mesh].primitives[0];
function view(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];assert.equal(v.buffer,0);assert(!v.byteStride);return {a,offset:(v.byteOffset??0)+(a.byteOffset??0)};}
const pos=view(primitive.attributes.POSITION),color=view(primitive.attributes.COLOR_0);assert.equal(pos.a.count,861);assert.equal(color.a.count,pos.a.count);assert.equal(color.a.componentType,5123);assert(color.a.normalized);
const scale=.08561798119782785;
for(let i=0;i<pos.a.count;i++){
  const x=bin.readFloatLE(pos.offset+i*12),y=bin.readFloatLE(pos.offset+i*12+4),u=Math.max(-1,Math.min(1,x/(1.83*scale)));
  const bottom=2.47+1.03*u*u,t=Math.max(0,Math.min(1,(y/scale-bottom)/(4.04-bottom)));
  // The photo shows diffuse shadow under the vent rim fading toward the lower
  // edge. This is an artistic approximation, not a calibrated light map.
  const mask=(1-u*u)**2*Math.sin(Math.PI*t)*(.25+.75*t),factor=1-.50*mask;
  for(let channel=0;channel<3;channel++){const offset=color.offset+i*8+channel*2;bin.writeUInt16LE(Math.round(bin.readUInt16LE(offset)*factor),offset);}
}
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+chunk.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,chunk]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-bowl-shading-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,limitation:'Estimated diffuse shading from an uncalibrated reference photo.'},null,2))]);
console.log(`Bowl shading candidate: ${output} (${digest})`);
