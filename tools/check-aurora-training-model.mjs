import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGlbModelManifest} from '../packages/model-runtime/dist/glb-manifest.js';
const path='fixtures/aurora-training/',bytes=await readFile(path+'aurora-training.glb'),manifest=JSON.parse(await readFile(path+'model-manifest.json','utf8'));
const hash=createHash('sha256').update(bytes).digest('hex'),actual=createGlbModelManifest(bytes,hash);
assert.equal(hash,manifest.sourceHash);assert.equal(actual.normalizationStatus,'CANONICAL');assert.deepEqual(actual.components.map(c=>c.componentId),['AIC-C01','AIC-C03','AIC-C02']);assert(actual.triangleCount>1000);assert(bytes.length<256*1024);
const jsonSize=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jsonSize)),binary=bytes.subarray(28+jsonSize);
assert.equal(doc.images,undefined);assert(doc.buffers.every(b=>!b.uri),'Model must be self contained');
function values(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],size=a.type==='VEC3'?3:1;return Array.from({length:a.count*size},(_,i)=>a.componentType===5126?binary.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+i*4):binary.readUInt16LE((v.byteOffset??0)+(a.byteOffset??0)+i*2));}
let triangles=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
function visit(index,parent=[0,0,0]){const node=doc.nodes[index],origin=parent.map((v,k)=>v+(node.translation?.[k]??0));if(node.mesh!==undefined)for(const p of doc.meshes[node.mesh].primitives){const positions=values(p.attributes.POSITION),normals=values(p.attributes.NORMAL),indices=values(p.indices);assert(positions.every(Number.isFinite));assert.equal(positions.length,normals.length);for(let i=0;i<positions.length;i+=3){for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i+k]+origin[k]);max[k]=Math.max(max[k],positions[i+k]+origin[k]);}assert(Math.abs(Math.hypot(...normals.slice(i,i+3))-1)<1e-5);}
 for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3).map(index=>{assert(index<positions.length/3);return positions.slice(index*3,index*3+3);});const u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],normal=normals.slice(indices[i]*3,indices[i]*3+3);assert(Math.hypot(...cross)>1e-12,'Nondegenerate triangles');assert(cross.reduce((sum,n,k)=>sum+n*normal[k],0)>0,'Consistent outward winding');triangles++;}}
 for(const child of node.children??[])visit(child,origin);}
visit(0);assert.equal(triangles,manifest.triangleCount);for(let k=0;k<3;k++)assert(Math.abs(min[k]+max[k])<1e-6,'Bounding box centered at origin');assert(max[1]-min[1]>.35&&max[1]-min[1]<.4);assert(doc.nodes.find(n=>n.extras?.componentId==='AIC-C02').children.length>1,'Cover must be a movable assembly');
console.log(`Aurora geometry passed: ${triangles} outward-wound nondegenerate triangles, normalized normals, meter dimensions, centered origin, embedded buffers and stable component IDs.`);
