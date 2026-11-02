import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one/model-manifest.json', 'utf8'));
const code = `import {createBabylonModelRuntime} from './src/babylon-model-runtime.ts';
import {EngineStore, Matrix, Vector3} from '@babylonjs/core';
const manifest=${JSON.stringify(manifest)};
const runtime=await createBabylonModelRuntime({canvas:document.querySelector('canvas'),manifest,modelUrl:'/model.glb',camera:{alpha:Math.PI/2,beta:1.2,radius:13.5,target:[0,3.6,0]}});
const scene=EngineStore.LastCreatedScene;
const snapshot=()=>scene.meshes.filter(m=>m.getTotalVertices()>0).map(m=>{m.computeWorldMatrix(true);return {name:m.name,component:m.metadata?.componentId,target:m.metadata?.interactionTargetId,local:m.position.asArray(),world:m.getBoundingInfo().boundingBox.centerWorld.asArray()};});
window.evidence={state:runtime.getState(),meshes:snapshot(),animations:scene.animationGroups.map(group=>({name:group.name,isPlaying:group.isPlaying})),camera:{position:scene.activeCamera.position.asArray(),target:scene.activeCamera.target.asArray(),radius:scene.activeCamera.radius,minZ:scene.activeCamera.minZ,maxZ:scene.activeCamera.maxZ},errors:[]};
const pointFor=(target)=>{target.computeWorldMatrix(true);const engine=scene.getEngine();const p=Vector3.Project(target.getBoundingInfo().boundingBox.centerWorld,Matrix.Identity(),scene.getTransformMatrix(),scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));const rect=document.querySelector('canvas').getBoundingClientRect();return {clientX:rect.left+p.x*rect.width/engine.getRenderWidth(),clientY:rect.top+p.y*rect.height/engine.getRenderHeight()};};
window.pointerPressTarget=(targetId,pointerId)=>{const canvas=document.querySelector('canvas');const target=scene.meshes.find(m=>m.metadata?.interactionTargetId===targetId);if(!target)throw Error('Interaction target missing: '+targetId);const point=pointFor(target);const rect=canvas.getBoundingClientRect();const picked=scene.pick(point.clientX-rect.left,point.clientY-rect.top);canvas.dispatchEvent(new PointerEvent('pointerdown',{...point,bubbles:true,pointerId,button:0,buttons:1}));scene.render();const pressed=runtime.getState();const pressedPosition=target.position.asArray();canvas.dispatchEvent(new PointerEvent('pointerup',{...point,bubbles:true,pointerId,button:0,buttons:0}));scene.render();return {targetId,picked:{name:picked?.pickedMesh?.name,target:picked?.pickedMesh?.metadata?.interactionTargetId},pressedTarget:pressed.pressedInteractionTargetId,pressedPosition,releasedTarget:runtime.getState().pressedInteractionTargetId,releasedPosition:target.position.asArray()};};
window.pointerCancelTarget=(targetId,pointerId)=>{const canvas=document.querySelector('canvas');const target=scene.meshes.find(m=>m.metadata?.interactionTargetId===targetId);if(!target)throw Error('Interaction target missing: '+targetId);const point=pointFor(target);canvas.dispatchEvent(new PointerEvent('pointerdown',{...point,bubbles:true,pointerId,button:0,buttons:1}));scene.render();const pressed=runtime.getState();const pressedPosition=target.position.asArray();canvas.dispatchEvent(new Event('pointercancel',{bubbles:true}));scene.render();return {targetId,pressedTarget:pressed.pressedInteractionTargetId,canceledTarget:runtime.getState().pressedInteractionTargetId,pressedPosition,canceledPosition:target.position.asArray()};};
window.pointerPressAll=()=>['NX-C01-FLOW','NX-C01-RATE','NX-C01-STOP','NX-C01-MUTE'].map((targetId,index)=>window.pointerPressTarget(targetId,20+index));
window.selectPanel=()=>{runtime.selectComponent('nxstage-control-panel');scene.render();window.evidence.selected=runtime.getState();};
window.ready=true;`;
const result = await build({ stdin: { contents: code, resolveDir: resolve('apps/web'), sourcefile: 'nxstage-check.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/model.glb') { res.setHeader('content-type', 'model/gltf-binary'); res.end(await readFile('fixtures/nxstage-system-one/nxstage-system-one.glb')); }
    else if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(result.outputFiles[0].contents); }
    else if (req.url === '/favicon.ico') res.writeHead(204).end();
    else { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>NxStage System One</title><style>body{margin:0;background:#18201f;color:#f0eee8;font:16px system-ui}header{padding:24px 36px}h1{margin:0;font-size:28px}p{color:#b8c2bb}canvas{width:100%;height:680px;display:block;touch-action:none}footer{padding:10px 36px;color:#b8c2bb}</style><header><h1>NxStage System One</h1><p>Photo-grounded device reconstruction · four tactile front-panel controls</p></header><canvas aria-label="NxStage System One 3D preview"></canvas><footer>Visual reconstruction · unmeasured scale · review required</footer><script type="module" src="/app.js"></script></html>'); }
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-model-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1100,900', `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
let socket;
const pending = new Map();
let id = 0;
const errors = [];
function command(method, params = {}) { return new Promise((resolveCommand, reject) => { const key = ++id; pending.set(key, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id: key, method, params })); }); }
async function evaluate(expression) { const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result.value; }
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) { try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise((wait) => setTimeout(wait, 100)); } }
  assert(port, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find((item) => item.type === 'page');
  assert(page, 'Chrome did not create a page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = (event) => { const message = JSON.parse(String(event.data)); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const pendingCommand = pending.get(message.id); if (pendingCommand) { pending.delete(message.id); message.error ? pendingCommand.reject(Error(message.error.message)) : pendingCommand.resolve(message.result); } };
  await new Promise((resolveSocket, rejectSocket) => { socket.onopen = resolveSocket; socket.onerror = rejectSocket; });
  await command('Runtime.enable');
  for (let attempt = 0; attempt < 200; attempt += 1) { if (await evaluate('Boolean(window.ready)')) break; await new Promise((wait) => setTimeout(wait, 50)); }
  assert(await evaluate('Boolean(window.ready)'), JSON.stringify(errors));
  await mkdir('output/nxstage-system-one', { recursive: true });
  await new Promise((wait) => setTimeout(wait, 200));
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile('output/nxstage-system-one/browser.png', Buffer.from(screenshot.data, 'base64'));
  const state = await evaluate('window.evidence.state');
  assert(['READY', 'REDUCED_COMPLEXITY'].includes(state.phase), `Unexpected runtime phase: ${state.phase}`);
  assert.equal(state.componentIds[0], 'nxstage-control-panel');
  const cancelEvidence = await evaluate("window.pointerCancelTarget('NX-C01-STOP', 19)");
  assert.equal(cancelEvidence.pressedTarget, 'NX-C01-STOP');
  assert.equal(cancelEvidence.canceledTarget, undefined);
  assert.notDeepEqual(cancelEvidence.pressedPosition, cancelEvidence.canceledPosition, 'A canceled control press must return the tagged target');
  const allPressEvidence = await evaluate('window.pointerPressAll()');
  assert.deepEqual(allPressEvidence.map((item) => item.targetId), ['NX-C01-FLOW', 'NX-C01-RATE', 'NX-C01-STOP', 'NX-C01-MUTE']);
  assert(allPressEvidence.every((item) => item.pressedTarget === item.targetId && item.releasedTarget === undefined && JSON.stringify(item.pressedPosition) !== JSON.stringify(item.releasedPosition)), `Every tagged control must press and release independently: ${JSON.stringify(allPressEvidence)}`);
  await evaluate('window.selectPanel();true');
  const evidence = await evaluate('window.evidence');
  await writeFile('output/nxstage-system-one/browser-evidence.json', JSON.stringify({ manifest, evidence, cancelEvidence, allPressEvidence, errors }, null, 2));
  assert.equal(evidence.meshes.length, manifest.meshCount);
  assert(evidence.animations.every((animation) => animation.isPlaying !== true), `Authored Blender press clips must not autoplay in the browser runtime: ${JSON.stringify(evidence.animations)}`);
  assert(evidence.camera.minZ < evidence.camera.radius / 10, 'Meter-scale model must not be clipped');
  assert.equal(evidence.selected.selectedComponentId, 'nxstage-control-panel');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(`NxStage Chrome passed: ${evidence.meshes.length} meshes, ${manifest.triangleCount} triangles, all four tactile button press/release/cancel paths, selected panel, and clean console.`);
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise((resolveClose) => browser.once('close', resolveClose));
  server.closeAllConnections();
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(profile, { recursive: true, force: true });
}
