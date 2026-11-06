// Shallow three-dimensional study of the unused rear connector in the supplied photo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source='fixtures/nxstage-system-one-rear-vent-review',output='output/nxstage-rear-outlet-depth-study';
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
function wall(name,points){
 const material=doc.materials.findIndex(m=>m.name==='Black rubber');assert(material>=0);
 const [a,b,c]=points,u=c.map((v,i)=>v-a[i]),v=b.map((n,i)=>n-a[i]);
 const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...cross),normal=cross.map(n=>n/len);
 const mesh=doc.meshes.push({name,primitives:[{attributes:{POSITION:append(points.flat(),3,'VEC3',5126,34962),NORMAL:append(points.flatMap(()=>normal),3,'VEC3',5126,34962)},indices:append([0,2,1,0,3,2],1,'SCALAR',5123,34963),material}]})-1;
 const node=doc.nodes.push({name,mesh,extras:{decorative:true}})-1;doc.scenes[doc.scene].nodes.push(node);manifest.sceneNodeCount++;manifest.meshCount++;manifest.triangleCount+=2;
}
// The four backing pieces leave a real opening for the shallow socket. Small
// printed labels and the electrical function are intentionally not modeled.
rect('Rear connector backing left',.006,.042,.205,.253,-.2827,'Cycler rear satin panel');
rect('Rear connector backing right',.092,.133,.205,.253,-.2827,'Cycler rear satin panel');
rect('Rear connector backing bottom',.042,.092,.205,.214,-.2827,'Cycler rear satin panel');
rect('Rear connector backing top',.042,.092,.242,.253,-.2827,'Cycler rear satin panel');
const outer=[[.042,.214],[.092,.214],[.092,.242],[.042,.242]],inner=[[.047,.218],[.087,.218],[.087,.238],[.047,.238]];
for(let i=0;i<4;i++){const j=(i+1)%4;wall(`Rear connector recessed wall ${i+1}`,[[...outer[i],-.2832],[...outer[j],-.2832],[...inner[j],-.2808],[...inner[i],-.2808]]);}
rect('Cycler rear connector recess',.047,.087,.218,.238,-.2808,'Gloss black rails and trim');
for(const [i,x,y] of [[0,.057,.226],[1,.077,.226],[2,.067,.233]])rect(`Cycler rear connector contact ${i+1}`,x-.0017,x+.0017,y-.0023,y+.0023,-.2810,'Rear service gray');
doc.buffers[0].byteLength=binary.length;binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20),binHeader=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+binary.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);binHeader.writeUInt32LE(binary.length);binHeader.write('BIN\0',4);
const result=Buffer.concat([header,json,binHeader,binary]),digest=hash(result);manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-rear-outlet-depth-study-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2))]);console.log(`Rear outlet depth study: ${output} (${digest})`);
