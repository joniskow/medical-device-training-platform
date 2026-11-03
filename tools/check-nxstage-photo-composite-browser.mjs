import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const { PNG } = createRequire(import.meta.url)('../node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs');
const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8'));
const sceneManifest = JSON.parse(await readFile('apps/web/src/model/nxstage-training-scene-manifest.json', 'utf8'));
const photoPlatePath = process.env.NXSTAGE_PHOTO_PLATE || 'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png';
const source = `window.addEventListener('error', event => { window.runtimeFailure = event.message; }); window.addEventListener('unhandledrejection', event => { window.runtimeFailure = String(event.reason?.stack || event.reason); });
import {createBabylonModelRuntime} from './src/babylon-model-runtime.ts';
import {EngineStore, Vector3} from '@babylonjs/core';
const manifest=${JSON.stringify(manifest)};
const sceneConfig=${JSON.stringify(sceneManifest)};
const runtime=await createBabylonModelRuntime({canvas:document.querySelector('canvas'),manifest,modelUrl:'/model.glb',transparentBackground:true,interactiveCamera:false,camera:sceneConfig.camera.orbit,lighting:{direction:sceneConfig.camera.lightDirection,exposure:sceneConfig.camera.exposure,whiteBalanceKelvin:sceneConfig.camera.whiteBalanceKelvin},modelTransform:sceneConfig.model,contactShadow:sceneConfig.render.contactShadow});
const scene=EngineStore.LastCreatedScene;
const meshes=scene.meshes.filter(m=>m.getTotalVertices()>0 && m.name !== 'model-contact-shadow' && m.name !== 'model-ambient-grounding'); const min=new Vector3(Infinity,Infinity,Infinity); const max=new Vector3(-Infinity,-Infinity,-Infinity);
for(const mesh of meshes){mesh.computeWorldMatrix(true);const box=mesh.getBoundingInfo().boundingBox;min.copyFrom(Vector3.Minimize(min,box.minimumWorld));max.copyFrom(Vector3.Maximize(max,box.maximumWorld));}
scene.render();
const shadowMesh=scene.getMeshByName('model-contact-shadow'); const ambientMesh=scene.getMeshByName('model-ambient-grounding'); const importedRoot=scene.getTransformNodeByName('__root__'); const firstImported=meshes[0];
window.evidence={state:runtime.getState(),bounds:{min:min.asArray(),max:max.asArray()},shadow:shadowMesh?.getBoundingInfo().boundingBox.centerWorld.asArray(),shadowPosition:shadowMesh?.position.asArray(),shadowScale:shadowMesh?.scaling.asArray(),shadowCalibration:shadowMesh?.metadata,ambientGrounding:ambientMesh?.getBoundingInfo().boundingBox.centerWorld.asArray(),ambientGroundingPosition:ambientMesh?.position.asArray(),root:{position:importedRoot?.position.asArray(),scaling:importedRoot?.scaling.asArray(),world:importedRoot?.getWorldMatrix().asArray()},firstMesh:{position:firstImported.position.asArray(),world:firstImported.getWorldMatrix().asArray()}}; window.ready=true;`;
const bundle = await build({ stdin: { contents: source, resolveDir: resolve('apps/web'), sourcefile: 'nxstage-photo-composite-check.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (req.url === '/model.glb') { res.setHeader('content-type', 'model/gltf-binary'); res.end(await readFile('fixtures/nxstage-system-one-interactive/nxstage-system-one.glb')); return; }
  if (req.url === '/plate.png') { res.setHeader('content-type', 'image/png'); res.end(await readFile(photoPlatePath)); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body style="margin:0;overflow:hidden;background:#d8d4cd"><img src="/plate.png" style="position:absolute;inset:0;width:100vw;height:100vh;object-fit:cover"><canvas style="position:absolute;inset:0;width:100vw;height:100vh;filter:saturate(.94) contrast(.97) brightness(.99) blur(.16px)" aria-label="NxStage photo composite"></canvas><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-photo-composite-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1100,800',`http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
const removeProfile = async () => { for (let attempt = 0; attempt < 20; attempt += 1) { try { await rm(profile, { recursive: true, force: true }); return; } catch (error) { if (error.code !== 'EBUSY') throw error; await new Promise(resolveRetry => setTimeout(resolveRetry, 100)); } } await rm(profile, { recursive: true, force: true }); };
let socket; const pending = new Map(); let id = 0;
const command = (method, params = {}) => new Promise((resolveCommand, reject) => { const key = ++id; pending.set(key, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
const evaluate = async expression => { const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result.value; };
try {
  let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(wait => setTimeout(wait, 100)); } }
  assert(port, 'Chrome did not start'); const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page = pages.find(item => item.type === 'page'); assert(page, 'Chrome page missing'); socket = new WebSocket(page.webSocketDebuggerUrl); socket.onmessage = event => { const message = JSON.parse(String(event.data)); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); } }; await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; }); await command('Runtime.enable');
  for (let attempt = 0; attempt < 200; attempt++) { if (await evaluate('Boolean(window.ready)')) break; await new Promise(wait => setTimeout(wait, 50)); }
  assert(await evaluate('Boolean(window.ready)'), `Photo composite runtime did not become ready: ${await evaluate('window.runtimeFailure || "no browser error captured"')}`);
  const evidence = await evaluate('window.evidence'); const screenshot = await command('Page.captureScreenshot', { format: 'png' }); await writeFile('output/nxstage-system-one/photo-composite-browser.png', Buffer.from(screenshot.data, 'base64')); await copyFile(photoPlatePath, 'output/nxstage-system-one/photo-composite-clean-plate.png');
  await evaluate("document.querySelector('img').style.visibility='hidden';document.body.style.background='#ff00ff';true");
  await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
  const foreground = await command('Page.captureScreenshot', { format: 'png' }); await writeFile('output/nxstage-system-one/photo-composite-foreground.png', Buffer.from(foreground.data, 'base64')); const decoded = PNG.sync.read(Buffer.from(foreground.data, 'base64')); let minX=decoded.width,minY=decoded.height,maxX=-1,maxY=-1,visible=0,fringe=0;
  for(let y=0;y<decoded.height;y++) for(let x=0;x<decoded.width;x++){const offset=(y*decoded.width+x)*4;const distance=Math.abs(decoded.data[offset]-255)+Math.abs(decoded.data[offset+1])+Math.abs(decoded.data[offset+2]-255);if(distance>24){visible++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(distance<=96)fringe++;}}
  evidence.artifacts={cleanPlate:'output/nxstage-system-one/photo-composite-clean-plate.png',foreground:'output/nxstage-system-one/photo-composite-foreground.png',finalComposite:'output/nxstage-system-one/photo-composite-browser.png'}; evidence.visual={width:decoded.width,height:decoded.height,visiblePixels:visible,alphaBounds:[minX,minY,maxX,maxY],fringeRatio:visible?fringe/visible:1}; await writeFile('output/nxstage-system-one/photo-composite-browser-evidence.json', JSON.stringify(evidence, null, 2));
  assert.equal(evidence.state.phase, 'READY'); assert(evidence.bounds.max[1] - evidence.bounds.min[1] > .5, 'Placed model must remain visible over photo plate'); assert(evidence.shadow, 'Contact shadow must be present over photo plate'); assert(evidence.ambientGrounding, 'Ambient grounding layer must be present over photo plate');
  assert(evidence.visual.visiblePixels > 500, 'Foreground capture must contain visible model pixels');
  const [minXCapture, minYCapture, maxXCapture, maxYCapture] = evidence.visual.alphaBounds;
  assert(minXCapture >= 120 && maxXCapture <= evidence.visual.width - 120, `Model overlay must remain inside the calibrated safe region: ${JSON.stringify(evidence.visual)}`);
  assert(maxYCapture > evidence.visual.height * 0.55, `Model overlay must reach the grounded lower frame: ${JSON.stringify(evidence.visual)}`);
  assert(evidence.visual.fringeRatio < 0.42, `Model overlay has excessive transparent edge fringe/halo: ${JSON.stringify(evidence.visual)}`);
  console.log(`NxStage photo composite browser passed: ${evidence.bounds.min.join(',')} -> ${evidence.bounds.max.join(',')}; photo plate, calibrated GLB, lighting and contact shadow are present.`);
} finally { socket?.close(); browser.kill(); if (browser.exitCode === null) await new Promise(resolveClose => browser.once('close', resolveClose)); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); await removeProfile(); }
