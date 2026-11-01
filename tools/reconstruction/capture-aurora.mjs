import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../../apps/web/package.json',import.meta.url))('esbuild');
const destination=resolve(process.argv[2]??'output/reconstruction-capture');await mkdir(resolve(destination,'images'),{recursive:true});
const singleImage=process.argv.includes('--single-image'),viewIndices=singleImage?[3]:Array.from({length:48},(_,index)=>index);
const source=`import {Engine,Scene,SceneLoader,ArcRotateCamera,HemisphericLight,Vector3,Color4,StandardMaterial,DynamicTexture,VertexBuffer} from '@babylonjs/core';import '@babylonjs/loaders/glTF';
const canvas=document.querySelector('canvas'),engine=new Engine(canvas,true,{preserveDrawingBuffer:true}),scene=new Scene(engine);scene.clearColor=new Color4(.025,.03,.04,1);new HemisphericLight('light',new Vector3(0,1,0),scene).intensity=1;
const camera=new ArcRotateCamera('camera',0,1.1,.78,Vector3.Zero(),scene);camera.minZ=.001;camera.fov=.8;
const imported=await SceneLoader.ImportMeshAsync(null,'','/device.glb',scene);
// Add stable synthetic surface detail for a controlled photogrammetry benchmark.
// These are capture surfaces, never source camera poses or geometry supplied to reconstruction.
let seed=173;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(const mesh of imported.meshes.filter(m=>m.getTotalVertices()>0 && ${!singleImage})){
 const p=mesh.getVerticesData(VertexBuffer.PositionKind),n=mesh.getVerticesData(VertexBuffer.NormalKind),uv=[];
 for(let i=0;i<p.length;i+=3){const axis=Math.abs(n[i])>.5?0:Math.abs(n[i+1])>.5?1:2;const axes=axis===0?[2,1]:axis===1?[0,2]:[0,1];uv.push(p[i+axes[0]]*3+.5,p[i+axes[1]]*3+.5);}mesh.setVerticesData(VertexBuffer.UVKind,uv);
 const texture=new DynamicTexture('capture-detail-'+mesh.name,512,scene,false),ctx=texture.getContext();ctx.fillStyle='#949fa2';ctx.fillRect(0,0,512,512);
 for(let i=0;i<3600;i++){const v=Math.floor(35+random()*195);ctx.fillStyle='rgb('+v+','+v+','+v+')';const s=2+Math.floor(random()*9);ctx.fillRect(Math.floor(random()*512),Math.floor(random()*512),s,s);}texture.update();
 const material=new StandardMaterial('capture-'+mesh.name,scene);material.diffuseTexture=texture;material.specularPower=1;mesh.material=material;
}
await scene.whenReadyAsync();window.capture=async(index)=>{camera.alpha=-Math.PI/2+(index%24)*Math.PI*2/24;camera.beta=index<24?1.32:.8;camera.radius=.72;scene.render();await new Promise(r=>requestAnimationFrame(r));scene.render();const projection=camera.getProjectionMatrix();return {centerInSourceCoordinates:Vector3.TransformCoordinates(camera.position,imported.meshes[0].getWorldMatrix().clone().invert()).asArray(),intrinsics:{width:1920,height:1080,fx:projection.m[0]*1920/2,fy:projection.m[5]*1080/2,cx:960,cy:540,renderWidth:engine.getRenderWidth(),renderHeight:engine.getRenderHeight()}};};window.ready=true;engine.runRenderLoop(()=>scene.render());`;
const built=await build({stdin:{contents:source,resolveDir:resolve('apps/web'),sourcefile:'capture.js'},bundle:true,platform:'browser',format:'esm',write:false});
const server=createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].contents);}else if(req.url==='/device.glb'){res.setHeader('content-type','model/gltf-binary');res.end(await readFile('fixtures/aurora-training/aurora-training.glb'));}else{res.setHeader('content-type','text/html');res.end('<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%}</style><canvas></canvas><script type="module" src="/app.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile=await mkdtemp(resolve(tmpdir(),'aurora-capture-'));
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1920,1080',`http://127.0.0.1:${server.address().port}`],{windowsHide:true,stdio:'ignore'});
let socket,id=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}if(!port)throw Error('CHROME_NOT_STARTED');
 const page=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');socket=new WebSocket(page.webSocketDebuggerUrl);socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 let ready=false;for(let i=0;i<200;i++){if(await evaluate('Boolean(window.ready)')){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('CAPTURE_NOT_READY');
 const images=[],cameras=[];for(const index of viewIndices){const pose=await evaluate(`window.capture(${index})`);const s=await command('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(s.data,'base64'),name=`view-${String(index).padStart(3,'0')}.png`;await writeFile(resolve(destination,'images',name),bytes);images.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});cameras.push({name,...pose});if(images.length%12===1)console.log('Captured '+images.length+'/'+viewIndices.length);}
 await writeFile(resolve(destination,'capture.json'),JSON.stringify({schemaVersion:'synthetic-capture.v1',sourceModel:'fixtures/aurora-training/aurora-training.glb',sourceModelSha256:createHash('sha256').update(await readFile('fixtures/aurora-training/aurora-training.glb')).digest('hex'),provenance:singleImage?'Single synthetic oblique image with original model materials':'Synthetic orbit render with seeded surface texture; 24 azimuths at two elevations',width:1920,height:1080,images,cameras,cameraConvention:'GLB source coordinates, using inverse of actual Babylon import root world matrix',geometryProvidedToReconstruction:false,scale:'Unscaled reconstruction; metric normalization requires a measured reference'},null,2));console.log('Saved '+images.length+' synthetic Aurora views to '+destination);
}finally{socket?.close();browser.kill();if(browser.exitCode===null)await new Promise(r=>browser.once('close',r));server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
