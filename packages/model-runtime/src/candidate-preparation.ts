import {readEmbeddedGlbImages} from './glb-manifest.js';

export type CandidatePoint=[number,number,number];
export interface CandidateRegion {componentId:string;displayName:string;faces:number[];pivot:CandidatePoint}
export interface CandidatePreparation {upAxis:'+X'|'-X'|'+Y'|'-Y'|'+Z'|'-Z';yawDegrees:number;measurement:{a:CandidatePoint;b:CandidatePoint;meters:number;reference:string};regions:CandidateRegion[];rationale:string;sourceHash:string;qualityReportHash?:string;sourceImageHashes?:string[];sourceVideoHash?:string;singleImageHypothesis?:boolean;reconstructionJobId?:string}
const fail=(message:string):never=>{throw Error('CANDIDATE_PREPARATION_INVALID: '+message);};
const finitePoint=(point:unknown):point is CandidatePoint=>Array.isArray(point)&&point.length===3&&point.every(Number.isFinite);

function parse(bytes:Uint8Array){
 if(bytes.length<28||bytes.length>64*1024*1024)fail('GLB size');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.length||v.getUint32(16,true)!==0x4e4f534a)fail('GLB header');
 const size=v.getUint32(12,true),end=20+size;if(end+8>bytes.length||v.getUint32(end+4,true)!==0x004e4942||end+8+v.getUint32(end,true)!==bytes.length)fail('binary bounds');
 const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,end))),binary=bytes.subarray(end+8);
 if(doc.buffers?.length!==1||doc.buffers[0].uri||doc.animations?.length||doc.skins?.length||doc.meshes?.length!==1||doc.meshes[0].primitives?.length!==1||doc.nodes?.filter((n:any)=>n.mesh!==undefined).length!==1||doc.nodes.some((n:any)=>n.matrix||n.rotation||n.translation||n.scale||n.skin!==undefined)||doc.extensionsRequired?.some((extension:string)=>extension!=='KHR_materials_unlit'))fail('only a static, untransformed single-surface candidate is supported');
 const primitive=doc.meshes[0].primitives[0];if((primitive.mode??4)!==4||primitive.targets||primitive.indices===undefined)fail('indexed triangles required');
 readEmbeddedGlbImages(bytes);
 function accessor(index:number){
  const a=doc.accessors?.[index],view=doc.bufferViews?.[a?.bufferView],dimensions=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[a?.type],sizes=({5121:1,5123:2,5125:4,5126:4} as Record<number,number>),size=sizes[a?.componentType];
  if(!a||a.sparse||!view||view.buffer!==undefined&&view.buffer!==0||!size||!dimensions||!Number.isSafeInteger(a.count)||a.count<1||a.count>3000000)fail('accessor');
  const start=(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??dimensions*size;
  if(![start,stride,view.byteLength,view.byteOffset??0,a.byteOffset??0].every(Number.isSafeInteger)||start<0||(view.byteOffset??0)<0||(a.byteOffset??0)<0||start%size||stride%size||stride<dimensions*size||start+(a.count-1)*stride+dimensions*size>(view.byteOffset??0)+view.byteLength||(view.byteOffset??0)+view.byteLength>binary.length)fail('accessor bounds');
  const data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),values:number[]=[];
  for(let i=0;i<a.count;i++)for(let k=0;k<dimensions;k++){const offset=start+i*stride+k*size;const value=a.componentType===5126?data.getFloat32(offset,true):a.componentType===5125?data.getUint32(offset,true):a.componentType===5123?data.getUint16(offset,true):data.getUint8(offset);if(!Number.isFinite(value))fail('nonfinite attribute');values.push(value);}
  return {a,values,dimensions,size};
 }
 const position=accessor(primitive.attributes.POSITION),indices=accessor(primitive.indices);
 if(position.a.type!=='VEC3'||position.a.componentType!==5126||indices.a.type!=='SCALAR'||indices.a.componentType===5126||indices.values.length%3||indices.values.some(i=>i>=position.a.count))fail('position/index shape');
 const attributes:Record<string,ReturnType<typeof accessor>>={};
 for(const [name,index] of Object.entries(primitive.attributes)){if(!['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1','COLOR_0'].includes(name))fail('unsupported vertex attribute');const attribute=accessor(index as number);if(attribute.a.count!==position.a.count)fail('attribute length');if(name==='NORMAL'&&(attribute.a.type!=='VEC3'||attribute.a.componentType!==5126))fail('normal format');if(name.startsWith('TEXCOORD')&&attribute.a.type!=='VEC2')fail('UV format');if(name==='COLOR_0'&&!['VEC3','VEC4'].includes(attribute.a.type))fail('color format');attributes[name]=attribute;}
 return {doc,binary,primitive,positions:position.values,indices:indices.values,attributes};
}

export function inspectReconstructionCandidate(bytes:Uint8Array){const {positions,indices}=parse(bytes);return {positions:new Float32Array(positions),indices:new Uint32Array(indices),triangleCount:indices.length/3};}

export function prepareReconstructionCandidate(bytes:Uint8Array,input:CandidatePreparation):Uint8Array{
 const {doc,binary,primitive,positions,indices,attributes}=parse(bytes);
 if(!input||!['+X','-X','+Y','-Y','+Z','-Z'].includes(input.upAxis)||!Number.isFinite(input.yawDegrees)||Math.abs(input.yawDegrees)>180||!/^[a-f0-9]{64}$/.test(input.sourceHash)||typeof input.rationale!=='string'||!input.rationale.trim()||input.rationale.length>4000||!finitePoint(input.measurement?.a)||!finitePoint(input.measurement?.b)||!Number.isFinite(input.measurement.meters)||input.measurement.meters<=0||input.measurement.meters>1000||typeof input.measurement.reference!=='string'||!input.measurement.reference.trim()||input.measurement.reference.length>1000||!Array.isArray(input.regions)||input.regions.length<1||input.regions.length>32)fail('measurement, orientation and mapping evidence required');
 for(const hash of [input.qualityReportHash,input.sourceVideoHash])if(hash!==undefined&&!/^[a-f0-9]{64}$/.test(hash))fail('source evidence hash');
 if(input.sourceImageHashes!==undefined&&(!Array.isArray(input.sourceImageHashes)||input.sourceImageHashes.length>100||input.sourceImageHashes.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))))fail('source image hashes');
 const distance=Math.hypot(...input.measurement.a.map((v,k)=>v-input.measurement.b[k]));if(distance<1e-8)fail('measurement points coincide');const scale=input.measurement.meters/distance;if(scale<1e-8||scale>1e8)fail('scale out of bounds');
 const angle=input.yawDegrees*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
 function rotate(p:CandidatePoint):CandidatePoint{const [x,y,z]=p;const basis:Record<CandidatePreparation['upAxis'],CandidatePoint>={'+Y':[x,y,z],'-Y':[x,-y,-z],'+Z':[x,z,-y],'-Z':[x,-z,y],'+X':[-y,x,z],'-X':[y,-x,z]};const q=basis[input.upAxis];return [cos*q[0]+sin*q[2],q[1],-sin*q[0]+cos*q[2]];}
 const rotated:CandidatePoint[]=[];const min:CandidatePoint=[Infinity,Infinity,Infinity],max:CandidatePoint=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<positions.length;i+=3){const p=rotate(positions.slice(i,i+3) as CandidatePoint).map(v=>v*scale) as CandidatePoint;rotated.push(p);for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
 if(min.some((v,k)=>!Number.isFinite(v)||!Number.isFinite(max[k])||max[k]-v>1000)||Math.max(...max.map((v,k)=>v-min[k]))<1e-6)fail('prepared physical dimensions');
 const center=min.map((v,k)=>v+(max[k]-v)/2),transform=(p:CandidatePoint)=>rotate(p).map((v,k)=>v*scale-center[k]) as CandidatePoint;
 const faceCount=indices.length/3,owners=new Int16Array(faceCount).fill(-1),ids=new Set<string>();
 input.regions.forEach((region,index)=>{if(!region||typeof region.componentId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(region.componentId)||ids.has(region.componentId)||typeof region.displayName!=='string'||!region.displayName.trim()||region.displayName.length>200||!finitePoint(region.pivot)||!Array.isArray(region.faces)||!region.faces.length||region.faces.length>faceCount)fail('invalid component region');ids.add(region.componentId);for(const face of region.faces){if(!Number.isSafeInteger(face)||face<0||face>=faceCount||owners[face]!==-1)fail('duplicate or invalid face mapping');owners[face]=index;}});
  const chunks:Uint8Array[]=[binary.slice()];let offset=binary.length;
 function append(values:number[],type:string,componentType:number,normalized?:boolean){
  const dimensions=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[type],size=componentType===5121?1:componentType===5123?2:4;
  const padding=(4-offset%4)%4;if(padding){chunks.push(new Uint8Array(padding));offset+=padding;}
  const data=new Uint8Array(values.length*size),view=new DataView(data.buffer);
  values.forEach((v,i)=>{if(componentType===5126)view.setFloat32(i*size,v,true);else if(componentType===5125)view.setUint32(i*size,v,true);else if(componentType===5123)view.setUint16(i*size,v,true);else view.setUint8(i,v);});
  const bufferView=doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;chunks.push(data);offset+=data.length;
  const accessor:any={bufferView,componentType,count:values.length/dimensions,type};if(normalized)accessor.normalized=true;
  if(type==='VEC3'){accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++){accessor.min[i%3]=Math.min(accessor.min[i%3],values[i]);accessor.max[i%3]=Math.max(accessor.max[i%3],values[i]);}}
  return doc.accessors.push(accessor)-1;
 }
 doc.nodes=[{name:'Prepared reconstruction',children:[]}];doc.meshes=[];doc.scene=0;doc.scenes=[{nodes:[0]}];
 const faceGroups=input.regions.map(region=>region.faces);const remaining=Array.from(owners.keys()).filter(face=>owners[face]===-1);if(remaining.length)faceGroups.push(remaining);
 faceGroups.forEach((faces,group)=>{
  const region=input.regions[group],pivot=region?transform(region.pivot):[0,0,0],vertices:number[]=[],remap=new Map<number,number>(),newIndices:number[]=[];
  for(const face of faces)for(const old of indices.slice(face*3,face*3+3)){let index=remap.get(old);if(index===undefined){index=vertices.length;vertices.push(old);remap.set(old,index);}newIndices.push(index);}
  const mapped:Record<string,number>={};for(const [name,attribute] of Object.entries(attributes)){const values:number[]=[];for(const vertex of vertices){let value=attribute.values.slice(vertex*attribute.dimensions,(vertex+1)*attribute.dimensions);if(name==='POSITION')value=rotated[vertex].map((v,k)=>v-center[k]-pivot[k]);if(name==='NORMAL')value=rotate(value as CandidatePoint);values.push(...value);}mapped[name]=append(values,attribute.a.type,attribute.a.componentType,attribute.a.normalized);}
  const mesh=doc.meshes.push({name:region?.displayName??'Unassigned surface',primitives:[{...primitive,attributes:mapped,indices:append(newIndices,'SCALAR',5125)}]})-1;
  const node:any={name:region?region.componentId:'Unassigned surface',mesh,translation:pivot};if(region)node.extras={componentId:region.componentId,displayName:region.displayName,interaction:'select'};doc.nodes[0].children.push(doc.nodes.push(node)-1);
 });
 const singleImage= input.singleImageHypothesis===true||doc.extras?.reconstructionMethod==='single-image-generative-hypothesis';
 if(input.reconstructionJobId!==undefined&&!/^job_reconstruct_[a-f0-9]{64}$/.test(input.reconstructionJobId))fail('reconstruction job ID');
 doc.extras={...doc.extras,scaleMeters:1,upAxis:'Y',handedness:'right',origin:'bounding-box-center',forwardAxis:'-Z',reviewRequired:true,preparation:{schemaVersion:'candidate-preparation.v1',sourceHash:input.sourceHash,qualityReportHash:input.qualityReportHash,sourceImageHashes:input.sourceImageHashes,sourceVideoHash:input.sourceVideoHash,reconstructionJobId:input.reconstructionJobId,...(singleImage?{reconstruction:{method:'single-image-generative-hypothesis',hiddenGeometryVerified:false,deviceDetailsVerified:false,surfaceErrorMeasured:false}}:{}),measurement:input.measurement,upAxis:input.upAxis,yawDegrees:input.yawDegrees,rationale:input.rationale.trim(),components:input.regions.map(region=>({componentId:region.componentId,displayName:region.displayName,pivot:region.pivot,faceCount:region.faces.length})),unassignedFaceCount:remaining.length,approved:false}};
 const padding=(4-offset%4)%4;if(padding){chunks.push(new Uint8Array(padding));offset+=padding;}doc.buffers[0].byteLength=offset;
 let json=new TextEncoder().encode(JSON.stringify(doc));const padded=new Uint8Array(json.length+(4-json.length%4)%4).fill(32);padded.set(json);json=padded;
 const total=28+json.length+offset;if(total>64*1024*1024)fail('prepared model exceeds import size limit');const output=new Uint8Array(total),view=new DataView(output.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);view.setUint32(12,json.length,true);view.setUint32(16,0x4e4f534a,true);output.set(json,20);view.setUint32(20+json.length,offset,true);view.setUint32(24+json.length,0x004e4942,true);let at=28+json.length;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}return output;
}
