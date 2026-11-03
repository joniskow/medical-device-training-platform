import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8'));
const source = `window.addEventListener('error', event => { window.runtimeFailure = event.message; }); window.addEventListener('unhandledrejection', event => { window.runtimeFailure = String(event.reason?.stack || event.reason); });
import {createBabylonModelRuntime} from './src/babylon-model-runtime.ts';
import {EngineStore, Vector3} from '@babylonjs/core';
const manifest=${JSON.stringify(manifest)};
const runtime=await createBabylonModelRuntime({canvas:document.querySelector('canvas'),manifest,modelUrl:'/model.glb',transparentBackground:true,interactiveCamera:false,camera:{alpha:Math.PI/2,beta:1.2,radius:5.2,target:[0,1.05,0]},lighting:{direction:[-.35,.8,-.45],exposure:0,whiteBalanceKelvin:5200},modelTransform:{translationMeters:[0,.554,0],rotationRadians:[0,0,0],scale:.2046},contactShadow:{enabled:true,opacity:.62,softness:.78,offsetMeters:-.004,direction:[.64,.48]}});
const scene=EngineStore.LastCreatedScene;
const meshes=scene.meshes.filter(m=>m.getTotalVertices()>0); const min=new Vector3(Infinity,Infinity,Infinity); const max=new Vector3(-Infinity,-Infinity,-Infinity);
for(const mesh of meshes){mesh.computeWorldMatrix(true);const box=mesh.getBoundingInfo().boundingBox;min.copyFrom(Vector3.Minimize(min,box.minimumWorld));max.copyFrom(Vector3.Maximize(max,box.maximumWorld));}
window.evidence={state:runtime.getState(),canvas:{width:document.querySelector('canvas').width,height:document.querySelector('canvas').height},bounds:{min:min.asArray(),max:max.asArray()},camera:{position:scene.activeCamera.position.asArray(),target:scene.activeCamera.target.asArray(),radius:scene.activeCamera.radius},shadow:scene.getMeshByName('model-contact-shadow')?.getBoundingInfo().boundingBox.centerWorld.asArray()}; window.ready=true;`;
const bundle = await build({ stdin: { contents: source, resolveDir: resolve('apps/web'), sourcefile: 'nxstage-composite-check.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
const server = createServer(async (req, res) => { if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; } if (req.url === '/model.glb') { res.setHeader('content-type', 'model/gltf-binary'); res.end(await readFile('fixtures/nxstage-system-one-interactive/nxstage-system-one.glb')); return; } res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body style="margin:0;background:#888"><canvas style="width:100vw;height:100vh" aria-label="composite"></canvas><script type="module" src="/app.js"></script></body></html>'); });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-composite-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1100,800',`http://127.0.0.1:${server.address().port}`], { windowsHide:true, stdio:'ignore' });
const removeProfile = async () => { for (let attempt = 0; attempt < 20; attempt += 1) { try { await rm(profile, { recursive: true, force: true }); return; } catch (error) { if (error.code !== 'EBUSY') throw error; await new Promise(resolveRetry => setTimeout(resolveRetry, 100)); } } await rm(profile, { recursive: true, force: true }); };
let socket; const pending=new Map(); let id=0;
const command=(method,params={})=>new Promise((resolveCommand,reject)=>{const key=++id;pending.set(key,{resolve:resolveCommand,reject});socket.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;};
try {
  let port; for(let attempt=0;attempt<100;attempt++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(wait=>setTimeout(wait,100));}}
  assert(port,'Chrome did not start'); const pages=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page=pages.find(item=>item.type==='page'); assert(page,'Chrome page missing'); socket=new WebSocket(page.webSocketDebuggerUrl); socket.onmessage=event=>{const message=JSON.parse(String(event.data));const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result);}}; await new Promise((resolveOpen,rejectOpen)=>{socket.onopen=resolveOpen;socket.onerror=rejectOpen;}); await command('Runtime.enable');
  for(let attempt=0;attempt<200;attempt++){if(await evaluate('Boolean(window.ready)'))break;await new Promise(wait=>setTimeout(wait,50));}
  assert(await evaluate('Boolean(window.ready)'), `Composite runtime did not become ready: ${await evaluate('window.runtimeFailure || "no browser error captured"')}`); const evidence=await evaluate('window.evidence'); const screenshot=await command('Page.captureScreenshot',{format:'png'}); await writeFile('output/nxstage-system-one/composite-browser.png',Buffer.from(screenshot.data,'base64')); await writeFile('output/nxstage-system-one/composite-browser-evidence.json',JSON.stringify(evidence,null,2)); assert.equal(evidence.state.phase,'READY'); assert(evidence.bounds.max[1]-evidence.bounds.min[1]>.5,'Placed device must have visible world-space height'); assert(evidence.bounds.min[1]<evidence.bounds.max[1]); assert(evidence.shadow,'Contact shadow must be present'); console.log(`NxStage composite browser passed: ${evidence.bounds.min.join(',')} -> ${evidence.bounds.max.join(',')}; transformed GLB and contact shadow are present.`);
} finally { socket?.close(); browser.kill(); if(browser.exitCode===null) await new Promise(resolveClose=>browser.once('close',resolveClose)); server.closeAllConnections(); await new Promise(resolveClose=>server.close(resolveClose)); await removeProfile(); }
