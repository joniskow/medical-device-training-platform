import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const { PNG } = createRequire(import.meta.url)('../node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs');
const scene = JSON.parse(await readFile('apps/web/src/model/nxstage-training-scene-manifest.json', 'utf8'));
const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8'));
const videoBytes = await readFile('fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(videoBytes), scene.video.sourceHash, 'Photo-backed interactive video must match the scene manifest hash');

const source = `
window.addEventListener('error', event => { window.runtimeFailure = event.message; });
window.addEventListener('unhandledrejection', event => { window.runtimeFailure = String(event.reason?.stack || event.reason); });
import {createBabylonModelRuntime} from './src/babylon-model-runtime.ts';
import {EngineStore, Vector3} from '@babylonjs/core';
const manifest = ${JSON.stringify(manifest)};
const scene = ${JSON.stringify(scene)};
const video = document.querySelector('video');
await new Promise((resolve, reject) => { if (video.readyState >= 1) resolve(); else { video.addEventListener('loadedmetadata', resolve, {once:true}); video.addEventListener('error', () => reject(new Error('VIDEO_DECODE_FAILED')), {once:true}); } });
await new Promise((resolve) => { video.currentTime = Math.min(1.5, video.duration / 2); video.addEventListener('seeked', resolve, {once:true}); });
const runtime = await createBabylonModelRuntime({
  canvas: document.querySelector('canvas'), manifest, modelUrl:'/model.glb', transparentBackground:true,
  interactiveCamera:false, interactionEnabled:false,
  camera: scene.camera.orbit,
  lighting: {direction: scene.camera.lightDirection, exposure: scene.camera.exposure, whiteBalanceKelvin: scene.camera.whiteBalanceKelvin},
  modelTransform: scene.model,
  contactShadow: scene.render.contactShadow
});
const babylonScene = EngineStore.LastCreatedScene;
const meshes = babylonScene.meshes.filter(mesh => mesh.getTotalVertices() > 0);
const min = new Vector3(Infinity, Infinity, Infinity); const max = new Vector3(-Infinity, -Infinity, -Infinity);
for (const mesh of meshes) { mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox; min.copyFrom(Vector3.Minimize(min, box.minimumWorld)); max.copyFrom(Vector3.Maximize(max, box.maximumWorld)); }
babylonScene.render();
const shadowMesh = babylonScene.getMeshByName('model-contact-shadow');
window.evidence = { state: runtime.getState(), video: {width: video.videoWidth, height: video.videoHeight, duration: video.duration, currentTime: video.currentTime}, bounds: {min:min.asArray(), max:max.asArray()}, shadow: shadowMesh?.getBoundingInfo().boundingBox.centerWorld.asArray(), shadowRotationY: shadowMesh?.rotation.y, ambientGrounding: babylonScene.getMeshByName('model-ambient-grounding')?.getBoundingInfo().boundingBox.centerWorld.asArray() };
window.ready = true;
`;
const bundle = await build({ stdin: { contents: source, resolveDir: resolve('apps/web'), sourcefile: 'nxstage-photo-video-composite-check.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
const server = createServer(async (req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (req.url === '/model.glb') { res.setHeader('content-type', 'model/gltf-binary'); res.end(await readFile('fixtures/nxstage-system-one-interactive/nxstage-system-one.glb')); return; }
  if (req.url === '/plate.mp4') { res.setHeader('content-type', 'video/mp4'); res.end(videoBytes); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body style="margin:0;overflow:hidden;background:#d8d4cd"><video id="plate" autoplay muted loop playsinline src="/plate.mp4" style="position:absolute;inset:0;width:100vw;height:100vh;object-fit:cover"></video><canvas style="position:absolute;inset:0;width:100vw;height:100vh" aria-label="NxStage photo video composite"></canvas><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-photo-video-composite-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1100,800',`http://127.0.0.1:${server.address().port}`], { windowsHide:true, stdio:'ignore' });
const removeProfile = async () => { for (let attempt = 0; attempt < 20; attempt += 1) { try { await rm(profile, { recursive:true, force:true }); return; } catch (error) { if (error.code !== 'EBUSY') throw error; await new Promise(resolveRetry => setTimeout(resolveRetry, 100)); } } await rm(profile, { recursive:true, force:true }); };
let socket; const pending = new Map(); let id = 0;
const command = (method, params = {}) => new Promise((resolveCommand, reject) => { const key = ++id; pending.set(key, {resolve:resolveCommand, reject}); socket.send(JSON.stringify({id:key, method, params})); });
const evaluate = async expression => { const response = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result.value; };
try {
  let port; for (let attempt = 0; attempt < 100; attempt += 1) { try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(wait => setTimeout(wait, 100)); } }
  assert(port, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page = pages.find(item => item.type === 'page'); assert(page, 'Chrome page missing');
  socket = new WebSocket(page.webSocketDebuggerUrl); socket.onmessage = event => { const message = JSON.parse(String(event.data)); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); } };
  await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; }); await command('Runtime.enable');
  for (let attempt = 0; attempt < 240; attempt += 1) { if (await evaluate('Boolean(window.ready)')) break; await new Promise(wait => setTimeout(wait, 50)); }
  assert(await evaluate('Boolean(window.ready)'), `Photo video composite runtime did not become ready: ${await evaluate('window.runtimeFailure || "no browser error captured"')}`);
  const evidence = await evaluate('window.evidence');
  const screenshot = await command('Page.captureScreenshot', {format:'png'});
  await writeFile('output/nxstage-system-one/photo-video-composite-browser.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate("document.querySelector('video').style.visibility='hidden';document.body.style.background='#ff00ff';true");
  await evaluate('new Promise(resolve => setTimeout(resolve, 50))');
  const foreground = await command('Page.captureScreenshot', {format:'png'});
  const foregroundBytes = Buffer.from(foreground.data, 'base64');
  await writeFile('output/nxstage-system-one/photo-video-composite-foreground.png', foregroundBytes);
  const decoded = PNG.sync.read(foregroundBytes); let minX = decoded.width, minY = decoded.height, maxX = -1, maxY = -1, visible = 0, fringe = 0;
  for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) { const offset = (y * decoded.width + x) * 4; const distance = Math.abs(decoded.data[offset] - 255) + Math.abs(decoded.data[offset + 1]) + Math.abs(decoded.data[offset + 2] - 255); if (distance > 24) { visible += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); if (distance <= 96) fringe += 1; } }
  evidence.visual = {width: decoded.width, height: decoded.height, visiblePixels: visible, alphaBounds: [minX, minY, maxX, maxY], fringeRatio: visible ? fringe / visible : 1};
  await writeFile('output/nxstage-system-one/photo-video-composite-browser-evidence.json', JSON.stringify(evidence, null, 2));
  assert.equal(evidence.state.phase, 'READY'); assert.deepEqual([evidence.video.width, evidence.video.height], [scene.video.width, scene.video.height]); assert(Math.abs(evidence.video.duration - scene.video.durationSeconds) < 0.05, 'Photo-backed interactive plate duration must match the scene manifest'); assert(evidence.shadow, 'Video composite must include a contact shadow'); assert(evidence.ambientGrounding, 'Video composite must include ambient grounding'); assert(evidence.visual.visiblePixels > 500, 'Foreground capture must contain visible model pixels'); assert(evidence.visual.fringeRatio < 0.42, `Video composite has excessive transparent edge fringe/halo: ${JSON.stringify(evidence.visual)}`);
  assert(evidence.bounds.min[1] >= -0.03 && evidence.bounds.min[1] <= 0.03, `Model feet must meet the calibrated floor plane instead of floating or sinking: ${JSON.stringify(evidence.bounds)}`);
  const expectedShadowRotation = Math.atan2(scene.render.contactShadow.direction[0], scene.render.contactShadow.direction[1]);
  assert(Math.abs(evidence.shadowRotationY - expectedShadowRotation) < 0.01, `Contact shadow must follow the manifest light direction: ${JSON.stringify({ actual: evidence.shadowRotationY, expected: expectedShadowRotation })}`);
  console.log(`NxStage photo video composite browser passed: ${evidence.video.width}x${evidence.video.height} ${evidence.video.duration.toFixed(3)}s, model overlay and grounding present.`);
} finally { socket?.close(); browser.kill(); if (browser.exitCode === null) await new Promise(resolveClose => browser.once('close', resolveClose)); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); await removeProfile(); }
