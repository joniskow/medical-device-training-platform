import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGlbModelManifest} from '../packages/model-runtime/dist/glb-manifest.js';

// Authored synthetic geometry. Existing reference fixtures and releases stay intact.
const folder='fixtures/aurora-training';
const doc={asset:{version:'2.0',generator:'Aurora synthetic training model v3'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Aurora Training Controller',children:[]}],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[],extras:{scaleMeters:1,upAxis:'Y',handedness:'right',origin:'bounding-box-center',forwardAxis:'-Z',provenance:'procedural-synthetic',clinicalFidelity:'fictional device; dimensions authored for training',fidelity:{status:'SEMANTIC_FIXTURE',sourceType:'PROCEDURAL_SYNTHETIC',scaleStatus:'UNMEASURED',hiddenSurfaceUncertainty:'UNKNOWN',summary:'Detailed authored training geometry for interaction rehearsal; not a real-device reconstruction or dimensional/manufacturing model.',evidenceRefs:['fixtures/reference/images/aic-overview.png','fixtures/reference/images/aic-control-panel.png','fixtures/reference/images/aic-safety-cover.png']}}};
const chunks=[];let offset=0;
function accessor(values,type,componentType,target){
 const size=type==='VEC3'?3:1;
 const bytes=componentType===5126?Buffer.alloc(values.length*4):Buffer.alloc(values.length*2);
 values.forEach((v,i)=>componentType===5126?bytes.writeFloatLE(v,i*4):bytes.writeUInt16LE(v,i*2));
 const view=doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target})-1;
 chunks.push(bytes);offset+=bytes.length;const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
 const a={bufferView:view,componentType,count:values.length/size,type};
 if(type==='VEC3'){a.min=[0,1,2].map(k=>Math.min(...values.filter((_,i)=>i%3===k)));a.max=[0,1,2].map(k=>Math.max(...values.filter((_,i)=>i%3===k)));}
 return doc.accessors.push(a)-1;
}
function material(name,color,metal=0,rough=.5,emission){const m={name,pbrMetallicRoughness:{baseColorFactor:[...color,1],metallicFactor:metal,roughnessFactor:rough}};if(emission)m.emissiveFactor=emission;return doc.materials.push(m)-1;}
const white=material('Warm ceramic housing',[.78,.83,.84],.05,.32),navy=material('Graphite panel',[.028,.065,.09],.15,.38),teal=material('Teal cover frame',[.025,.34,.37],.18,.33),steel=material('Brushed fasteners',[.42,.5,.53],.8,.27),black=material('Rubber seals',[.018,.028,.032],0,.88),tube=material('Training line',[.58,.83,.79],0,.35),green=material('Ready indicator',[.12,.65,.45],0,.4,[.04,.3,.16]),amber=material('Warning indicator',[.95,.4,.045],0,.4,[.2,.06,.005]),screen=material('Screen glow',[.025,.16,.18],.1,.4,[.015,.12,.14]),ink=material('Display markings',[.66,.94,.88],0,.5,[.15,.3,.25]);
function group(name,parent=0,extras,translation){const n={name,children:[]};if(extras)n.extras=extras;if(translation)n.translation=translation;const i=doc.nodes.push(n)-1;doc.nodes[parent].children.push(i);return i;}
function mesh(name,parent,positions,normals,indices,mat){
 const m=doc.meshes.push({name,primitives:[{attributes:{POSITION:accessor(positions,'VEC3',5126,34962),NORMAL:accessor(normals,'VEC3',5126,34962)},indices:accessor(indices,'SCALAR',5123,34963),material:mat}]})-1;
 const i=doc.nodes.push({name,mesh:m})-1;doc.nodes[parent].children.push(i);return i;
}
function box(name,parent,c,s,mat){
 const p=[],n=[],ix=[];
 for(const [normal,u,v] of [[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[0,0,1],[1,0,0]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[0,1,0],[1,0,0]]]){
  const start=p.length/3;for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]]){for(let k=0;k<3;k++)p.push(c[k]+(normal[k]+a*u[k]+b*v[k])*s[k]/2);n.push(...normal);}ix.push(start,start+1,start+2,start,start+2,start+3);
 }return mesh(name,parent,p,n,ix,mat);
}
function cylinder(name,parent,c,r,length,mat,segments=24){
 const p=[],n=[],ix=[];
 for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2,x=Math.cos(a),z=Math.sin(a);for(const y of [-length/2,length/2]){p.push(c[0]+r*x,c[1]+y,c[2]+r*z);n.push(x,0,z);}if(i<segments){let j=i*2;ix.push(j,j+1,j+3,j,j+3,j+2);}}
 for(const sign of [-1,1]){let center=p.length/3;p.push(c[0],c[1]+sign*length/2,c[2]);n.push(0,sign,0);for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2;p.push(c[0]+r*Math.cos(a),c[1]+sign*length/2,c[2]+r*Math.sin(a));n.push(0,sign,0);if(i<segments){let j=center+1+i;ix.push(center,...(sign>0?[j+1,j]:[j,j+1]));}}}
 return mesh(name,parent,p,n,ix,mat);
}
// Rounded housing profile extruded along depth; no external textures or fonts.
function roundedHousing(){
 const p=[],n=[],ix=[],ring=[],w=.23,h=.33,r=.019;
 for(const [cx,cy,start] of [[w/2-r,h/2-r,0],[-w/2+r,h/2-r,90],[-w/2+r,-h/2+r,180],[w/2-r,-h/2+r,270]])for(let j=0;j<=6;j++){const a=(start+j*15)*Math.PI/180;ring.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}
 for(let i=0;i<ring.length;i++){const next=ring[(i+1)%ring.length],pt=ring[i],dx=next[0]-pt[0],dy=next[1]-pt[1],d=Math.hypot(dx,dy),base=p.length/3;for(const [x,y,z] of [[pt[0],pt[1],-.067],[next[0],next[1],-.067],[next[0],next[1],.067],[pt[0],pt[1],.067]]){p.push(x,y,z);n.push(dy/d,-dx/d,0);}ix.push(base,base+1,base+2,base,base+2,base+3);}
 for(const z of [-.067,.067]){let b=p.length/3;p.push(0,0,z);n.push(0,0,Math.sign(z));for(const pt of ring){p.push(...pt,z);n.push(0,0,Math.sign(z));}for(let i=0;i<ring.length;i++){const a=b+1+i,next=b+1+(i+1)%ring.length;ix.push(b,...(z>0?[a,next]:[next,a]));}}
 mesh('Rounded housing',0,p,n,ix,white);
}
roundedHousing();
box('Rear service shell',0,[0,0,.069],[.198,.29,.014],navy);
box('Top carry grip',0,[0,.183,0],[.15,.015,.038],navy);for(const x of [-.067,.067])box('Grip riser '+x,0,[x,.17,0],[.016,.035,.038],navy);
for(const x of [-.082,.082])box('Rubber foot '+x,0,[x,-.174,0],[.036,.018,.092],black);
for(let i=0;i<7;i++)box('Vent '+i,0,[.109,-.079+i*.014,.008],[.014,.004,.052],navy);
const panel=group('Control Panel',0,{componentId:'AIC-C01',interaction:'select'});
box('Panel bezel',panel,[0,.072,-.073],[.196,.139,.015],navy);
box('Display',panel,[-.017,.092,-.082],[.128,.071,.004],screen);
// Display uses geometric bars, explicitly synthetic and independent of any real device UI.
for(let i=0;i<4;i++)box('Status row '+i,panel,[-.025,.115-i*.014,-.085],[.092-i*.012,.003,.001],ink);
for(const [x,mat,name] of [[-.061,green,'Prime'],[0,white,'Ready'],[.061,amber,'Stop']]){const key=box(name+' key',panel,[x,.024,-.084],[.038,.024,.009],mat);doc.nodes[key].extras={interactionTargetOwner:'AIC-C01',interactionTargetId:`AIC-C01-${name.toUpperCase()}`,interactionTargetDisplayName:`${name} button`,pressDepthMeters:.004,pressAxis:[0,0,1]};box(name+' mark',panel,[x,.024,-.089],[.015,.002,.001],navy);}
cylinder('Ready LED',panel,[.072,.122,-.085],.004,.007,green);
const sensor=group('Line Sensor',0,{componentId:'AIC-C03',interaction:'select'});
box('Line bay',sensor,[0,-.081,-.071],[.177,.137,.013],black);
box('Sensor enclosure',sensor,[.017,-.083,-.084],[.067,.045,.016],teal);
box('Optical window',sensor,[.017,-.083,-.095],[.036,.014,.007],navy);
cylinder('Line segment',sensor,[.017,-.081,-.105],.004,.217,tube);
for(const y of [-.13,-.035]){box('Tube guide '+y,sensor,[.017,y,-.1],[.027,.014,.016],white);cylinder('Guide line '+y,sensor,[.017,y,-.111],.004,.022,tube);}
box('Sensor warning marker',sensor,[.066,-.083,-.094],[.011,.011,.005],amber);
const cover=group('Safety Cover',0,{componentId:'AIC-C02',interaction:'select'},[-.092,-.081,-.111]);
// All door geometry is relative to this hinge. Positive Y rotation opens forward.
for(const [name,c,s] of [['Top rail',[.091,.07,0],[.182,.013,.012]],['Bottom rail',[.091,-.07,0],[.182,.013,.012]],['Hinge stile',[0,0,0],[.013,.14,.013]],['Latch stile',[.182,0,0],[.013,.14,.013]]])box(name,cover,c,s,teal);
box('Cover lower guard',cover,[.091,-.049,0],[.17,.027,.008],teal);
box('Door latch',cover,[.186,.005,-.009],[.018,.035,.018],steel);
for(const y of [-.049,.049])cylinder('Hinge barrel '+y,cover,[0,y,0],.009,.025,steel);
for(const x of [-.1,.1])for(const y of [-.144,.144]){box('Captive fastener '+x+y,0,[x,y,-.071],[.008,.008,.003],steel);box('Fastener slot '+x+y,0,[x,y,-.073],[.005,.001,.001],black);}
const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
function bounds(index,parent=[0,0,0]){const node=doc.nodes[index],origin=parent.map((v,k)=>v+(node.translation?.[k]??0));if(node.mesh!==undefined){const a=doc.accessors[doc.meshes[node.mesh].primitives[0].attributes.POSITION];for(let k=0;k<3;k++){minimum[k]=Math.min(minimum[k],a.min[k]+origin[k]);maximum[k]=Math.max(maximum[k],a.max[k]+origin[k]);}}for(const child of node.children??[])bounds(child,origin);}
bounds(0);doc.nodes[0].translation=minimum.map((v,k)=>-(v+maximum[k])/2);
doc.buffers=[{byteLength:offset}];let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat(chunks),header=Buffer.alloc(20),tail=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);tail.writeUInt32LE(bin.length);tail.writeUInt32LE(0x004e4942,4);const glb=Buffer.concat([header,json,tail,bin]);
const hash=createHash('sha256').update(glb).digest('hex'),manifest=createGlbModelManifest(glb,hash);
for(const c of manifest.components){if(c.componentId==='AIC-C02'){c.interactionCapabilities=['select','rotate'];c.permittedTransforms={rotationY:{min:0,max:Math.PI/2,step:Math.PI/12,snap:Math.PI/12}};}else if(c.componentId==='AIC-C01'){c.interactionCapabilities=['select','press'];}else c.interactionCapabilities=['select'];}
manifest.performanceBudget={minimumFps:30,interactiveWithinMs:5000,maxMemoryMb:128};
await mkdir(folder,{recursive:true});await writeFile(folder+'/aurora-training.glb',glb);await writeFile(folder+'/model-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(folder+'/provenance.json',JSON.stringify({schemaVersion:'authored-model.v1',source:'tools/build-aurora-training-model.mjs',sha256:hash,bytes:glb.length,componentIds:manifest.components.map(c=>c.componentId),dimensionsMeters:{housing:[.23,.33,.134]},provenance:'procedural-synthetic',reviewStatus:'REVIEW_REQUIRED',limitations:['Fictional training device, not a reproduction of commercial equipment','Authored geometry; not reconstructed from image/video','Movement limits must be configured and reviewed on import'],recommendedInteractions:{'AIC-C02':{rotationY:{min:0,max:Math.PI/2,step:Math.PI/12}}}},null,2)+'\n');
console.log(JSON.stringify({folder,sha256:hash,bytes:glb.length,triangles:manifest.triangleCount,meshes:manifest.meshCount,components:manifest.components.length}));
