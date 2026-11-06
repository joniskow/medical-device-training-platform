// Fixed visual approximation of the unused rear connector in the supplied photo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source='fixtures/nxstage-system-one-rear-vent-review',output='output/nxstage-rear-outlet-study';
const [glb,manifest,scene]=await Promise.all([readFile(`${source}/nxstage-system-one.glb`),readFile(`${source}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${source}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(glb),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const length=glb.readUInt32LE(12),doc=JSON.parse(glb.subarray(20,20+length)),start=20+length;assert.equal(glb.toString('ascii',start+4,start+8),'BIN\0');
let binary=Buffer.from(glb.subarray(start+8,start+8+glb.readUInt32LE(start)));
function append(values,size,type,componentType,target){
 const padding=(4-binary.length%4)%4;if(padding)binary=Buffer.concat([binary,Buffer.alloc(padding)]);
 const bytes=Buffer.alloc(values.length*(componentType===5126?4:2));values.forEach((v,i)=>componentType===5126?bytes.writeFloatLE(v,i*4):bytes.writeUInt16LE(v,i*2));
 const view=doc.bufferViews.push({buffer:0,byteOffset:binary.length,byteLength:bytes.length,target})-1;binary=Buffer.concat([binary,bytes]);
 const entry={bufferView:view,componentType,count:values.length/size,type};if(type==='VEC3'){entry.min=[0,1,2].map(i=>Math.min(...values.filter((_,j)=>j%3===i)));entry.max=[0,1,2].map(i=>Math.max(...values.filter((_,j)=>j%3===i)));}return doc.accessors.push(entry)-1;
}
function polygon(name,points,z,materialName){
 const material=doc.materials.findIndex(m=>m.name===materialName);assert(material>=0);const positions=[],normals=[],indices=[];
 for(const [x,y] of points){positions.push(x,y,z);normals.push(0,0,-1);}for(let i=1;i<points.length-1;i++)indices.push(0,i+1,i);
 const mesh=doc.meshes.push({name,primitives:[{attributes:{POSITION:append(positions,3,'VEC3',5126,34962),NORMAL:append(normals,3,'VEC3',5126,34962)},indices:append(indices,1,'SCALAR',5123,34963),material}]})-1;
 const node=doc.nodes.push({name,mesh,extras:{decorative:true}})-1;doc.scenes[doc.scene].nodes.push(node);manifest.sceneNodeCount++;manifest.meshCount++;manifest.triangleCount+=indices.length/3;
}
const rect=(name,x0,x1,y0,y1,z,mat)=>polygon(name,[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],z,mat);
// Approximate panel and inset only; its small printed labels are not reproduced.
rect('Cycler rear connector backing',.006,.133,.205,.253,-.2827,'Cycler rear satin panel');
polygon('Cycler rear unused connector',[[.045,.214],[.089,.214],[.092,.217],[.092,.239],[.089,.242],[.045,.242],[.042,.239],[.042,.217]],-.2832,'Black rubber');
polygon('Cycler rear connector recess',[[.049,.217],[.085,.217],[.088,.220],[.088,.236],[.085,.239],[.049,.239],[.046,.236],[.046,.220]],-.2835,'Gloss black rails and trim');
for(const [i,x,y] of [[0,.057,.226],[1,.077,.226],[2,.067,.233]])rect(`Cycler rear connector contact ${i+1}`,x-.0023,x+.0023,y-.003,y+.003,-.2838,'Rear service gray');
doc.buffers[0].byteLength=binary.length;binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+binary.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);binHeader.writeUInt32LE(binary.length);binHeader.write('BIN\0',4);
const result=Buffer.concat([header,json,binHeader,binary]),digest=hash(result);manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-rear-outlet-study-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2))]);console.log(`Rear outlet study: ${output} (${digest})`);
