// Subdivide the broad door face and form an estimated hollow behind its detail.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='output/nxstage-front-bowl-study', output='output/nxstage-deep-bowl-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(source),manifest.sourceHash); assert.equal(scene.model.sourceHash,manifest.sourceHash);
const jsonLength=source.readUInt32LE(12), doc=JSON.parse(source.subarray(20,20+jsonLength));
const oldChunk=source.subarray(20+jsonLength); assert.equal(oldChunk.toString('ascii',4,8),'BIN\0');
const oldBin=Buffer.from(oldChunk.subarray(8));
const info=index=>{const a=doc.accessors[index], v=doc.bufferViews[a.bufferView]; assert.equal(v.buffer,0); assert(!v.byteStride); return {a, offset:(v.byteOffset??0)+(a.byteOffset??0)};};
const scale=.08561798119782785;
function shape(x,y){
  const u=Math.max(-1,Math.min(1,x/(1.83*scale))), bottom=2.47+1.03*u*u;
  const t=Math.max(0,Math.min(1,(y/scale-bottom)/(4.04-bottom)));
  return (1-u*u)*Math.sin(Math.PI*t);
}
// The photographed slots sit at the upper rim. Preserve that rim instead of
// leaving the slots suspended in front of the deeper part of the bowl.
function belowVentRim(y){const t=Math.max(0,Math.min(1,(.312-y)/.037));return t*t*(3-2*t);}
const detail=doc.meshes[doc.nodes.find(n=>n.name==='Central recessed face').mesh].primitives[0];
const dp=info(detail.attributes.POSITION), dn=info(detail.attributes.NORMAL), di=info(detail.indices);
assert.equal(dp.a.count,861); assert.equal(di.a.componentType,5123);
const points=[];
for(let i=0;i<dp.a.count;i++){
  const o=dp.offset+i*12,x=oldBin.readFloatLE(o),y=oldBin.readFloatLE(o+4);
  const z=oldBin.readFloatLE(o+8)-(.013+.008*shape(x,y))*belowVentRim(y);oldBin.writeFloatLE(z,o+8);points.push([x,y,z]);
}
dp.a.min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k])));dp.a.max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
const sums=points.map(()=>[0,0,0]);
for(let i=0;i<di.a.count;i+=3){
  const ids=[0,1,2].map(j=>oldBin.readUInt16LE(di.offset+(i+j)*2)),[a,b,c]=ids.map(id=>points[id]);
  const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  for(const id of ids)for(let k=0;k<3;k++)sums[id][k]+=cross[k];
}
for(let i=0;i<sums.length;i++){
  const o=dn.offset+i*12,len=Math.hypot(...sums[i]);assert(len>0);
  const sign=sums[i].reduce((s,v,k)=>s+v*oldBin.readFloatLE(o+k*4),0)<0?-1:1;
  for(let k=0;k<3;k++)oldBin.writeFloatLE(sign*sums[i][k]/len,o+k*4);
}
const shellNode=doc.nodes.find(n=>n.name==='Cycler door front shell'),shell=doc.meshes[shellNode.mesh].primitives[0];
// Bring the narrow slots closer to the reshaped rim. Their exact depth is an
// estimate; they remain separate, decorative children of the moving door.
const vents=doc.nodes.filter(n=>n.name?.startsWith('Cycler arched front vent '));
assert.equal(vents.length,15);
for(const vent of vents){assert(vent.translation);vent.translation[0]-=.008;}
const p=info(shell.attributes.POSITION),n=info(shell.attributes.NORMAL),uv=info(shell.attributes.TEXCOORD_0),idx=info(shell.indices);
assert.equal(p.a.count,600);assert.equal(idx.a.count,900);assert.equal(idx.a.componentType,5123);
const read=(a,i,count)=>Array.from({length:count},(_,k)=>oldBin.readFloatLE(a.offset+i*count*4+k*4));
const vertex=i=>({p:read(p,i,3),n:read(n,i,3),uv:read(uv,i,2)});
const outP=[],outN=[],outUv=[],outI=[];
function emit(v,front){
  let position=v.p,normal=v.n;
  if(front){
    const x=position[0],y=position[1]+shellNode.translation[1],h=0.00001,depth=(a,b)=>-.022*shape(a,b)*belowVentRim(b);
    position=[x,position[1],position[2]+depth(x,y)];
    const dx=(depth(x+h,y)-depth(x-h,y))/(2*h),dy=(depth(x,y+h)-depth(x,y-h))/(2*h);
    const sign=normal[2]<0?-1:1,len=Math.hypot(dx,dy,1);normal=[-sign*dx/len,-sign*dy/len,sign/len];
  }
  outI.push(outP.length/3);outP.push(...position);outN.push(...normal);outUv.push(...v.uv);
}
const midpoint=(a,b)=>({p:a.p.map((v,k)=>(v+b.p[k])/2),n:a.n.map((v,k)=>(v+b.n[k])/2),uv:a.uv.map((v,k)=>(v+b.uv[k])/2)});
function triangle(a,b,c,level){if(!level){emit(a,true);emit(b,true);emit(c,true);return;}const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);triangle(a,ab,ca,level-1);triangle(ab,b,bc,level-1);triangle(ca,bc,c,level-1);triangle(ab,bc,ca,level-1);}
let frontCount=0;
for(let i=0;i<idx.a.count;i+=3){const vs=[0,1,2].map(k=>vertex(oldBin.readUInt16LE(idx.offset+(i+k)*2)));if(vs.every(v=>v.p[2]>.0179)){frontCount++;triangle(...vs,5);}else for(const v of vs)emit(v,false);}
assert.equal(frontCount,2);assert(outP.length/3<65536);
const parts=[oldBin];let length=oldBin.length;
function append(values,type,components,target){
  const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}
  const bytes=Buffer.alloc(values.length*(type===5126?4:2));values.forEach((value,i)=>type===5126?bytes.writeFloatLE(value,i*4):bytes.writeUInt16LE(value,i*2));
  const view=doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length,target})-1;parts.push(bytes);length+=bytes.length;
  const accessor={bufferView:view,componentType:type,count:values.length/components,type:components===1?'SCALAR':`VEC${components}`};
  if(target===34962&&components===3&&values===outP){accessor.min=[0,1,2].map(k=>Math.min(...Array.from({length:values.length/3},(_,i)=>values[i*3+k])));accessor.max=[0,1,2].map(k=>Math.max(...Array.from({length:values.length/3},(_,i)=>values[i*3+k])));}
  return doc.accessors.push(accessor)-1;
}
shell.attributes.POSITION=append(outP,5126,3,34962);shell.attributes.NORMAL=append(outN,5126,3,34962);shell.attributes.TEXCOORD_0=append(outUv,5126,2,34962);shell.indices=append(outI,5123,1,34963);
const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}const bin=Buffer.concat(parts);doc.buffers[0].byteLength=length;
const chunkHeader=Buffer.alloc(8);chunkHeader.writeUInt32LE(length,0);chunkHeader.write('BIN\0',4);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+8+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,chunkHeader,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.triangleCount += outI.length/3-idx.a.count/3;manifest.modelVersionId='preview:nxstage-deep-bowl-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,depth:'estimated from photographs; not measured'},null,2))]);
console.log(`Deep bowl candidate: ${output} (${digest})`);
