import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';

const server = createJobStatusHttpServer({ staticRoot: 'apps/web/dist', authenticator: { authenticate: async () => null }, organizationContextResolver: { resolveActiveOrganizations: async () => [] }, statusService: { get: async () => null, retry: async () => null } });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
for (const [path, contentType] of [
  ['/model/nxstage-training-scene-manifest.json', 'application/json'],
  ['/model/nxstage-cinematic-scene-manifest.json', 'application/json'],
  ['/demo-assets/nxstage-clinical-photo-v4.png', 'image/png'],
  ['/demo-assets/nxstage-office-background-openmontage.mp4', 'video/mp4'],
  ['/demo-assets/nxstage-office-background-photo-openmontage.mp4', 'video/mp4'],
  ['/demo-assets/nxstage-hallway-to-room-background-openmontage.mp4', 'video/mp4'],
  ['/demo-assets/nxstage-hallway-to-room-composite.mp4', 'video/mp4'],
  ['/demo-assets/nxstage-photo-video-composite-review.png', 'image/png']
]) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.status, 200, `${path} must be served`);
  assert(response.headers.get('content-type')?.startsWith(contentType), `${path} must use the correct content type`);
  await response.body?.cancel();
}
const profile = await mkdtemp(resolve(tmpdir(), 'training-scene-browser-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,1000', `http://127.0.0.1:${port}/demo`], { windowsHide: true, stdio: 'ignore' });
const removeProfile = async () => { for (let attempt = 0; attempt < 20; attempt += 1) { try { await rm(profile, { recursive: true, force: true }); return; } catch (error) { if (error.code !== 'EBUSY') throw error; await new Promise(resolveRetry => setTimeout(resolveRetry, 100)); } } await rm(profile, { recursive: true, force: true }); };
let socket;
const pending = new Map();
let sequence = 0;
const errors = [];
function command(method, params = {}) { return new Promise((resolveCommand, reject) => { const id = ++sequence; pending.set(id, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
const savedState = {
  view: 'creator', creatorStep: 'content', sourceStage: 'content', sourceKind: 'pdf', sourceFiles: ['Aurora setup guide.pdf'], sourceFileName: 'Aurora setup guide.pdf', sourceProgress: 100, pipelinePhase: 'CONTENT_READY', pipelineJobId: 'job:scene-browser', pipelineAttempt: 1, candidateTriangles: 0, reviewRationale: '', demoSource: false, videoPlaying: false, sceneInteractive: false, answer: 'idle', published: false, learnerProgress: 33, currentLesson: 0, selectedModule: null, editingModule: null,
  modules: [{ title: 'Orientation', type: 'Reading', minutes: 8, description: 'Orientation', completed: true }, { title: 'Flow path', type: 'Interactive lesson', minutes: 12, description: 'Flow path', completed: false }, { title: 'Checklist', type: 'Knowledge check', minutes: 10, description: 'Checklist', completed: false }]
};
try {
  let debugPort;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { debugPort = (await (await import('node:fs/promises')).readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise((wait) => setTimeout(wait, 100)); }
  }
  assert(debugPort, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const page = pages.find((candidate) => candidate.type === 'page');
  assert(page, 'Chrome did not expose a page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = (event) => { const message = JSON.parse(String(event.data)); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); } };
  await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(savedState))});` });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/demo` });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if ((await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""')).includes('Scene ready')) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  const finalStatus = await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""');
  assert(finalStatus.includes('Scene ready'), `The composite scene did not become ready: ${finalStatus}; browser errors: ${JSON.stringify(errors)}`);
  assert.equal(await evaluate('document.querySelector("[data-scene-manifest]")?.dataset.sceneManifest'), '/model/aurora-training-scene-manifest.json');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#demo-scene-canvas")).pointerEvents'), 'none');
  assert.equal(await evaluate('document.querySelector("#demo-scene-canvas").tabIndex'), -1, 'The inactive canvas must not receive keyboard focus');
  assert.equal(await evaluate('Boolean(document.querySelector(".scene-named-controls"))'), false, 'Named scene controls must not appear while interaction is off');
  await evaluate('document.querySelector("[data-action=toggle-scene-interaction]").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate('document.querySelector(".training-scene")?.classList.contains("interactive")'), true);
  assert.equal(await evaluate('document.activeElement?.dataset.action'), 'toggle-scene-interaction', 'Keyboard focus must remain on the interaction toggle after entering');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#demo-scene-canvas")).pointerEvents'), 'auto');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#demo-scene-canvas")).touchAction'), 'none', 'The interactive scene must retain touch drags instead of scrolling the page');
  assert.equal(await evaluate('document.querySelector("#demo-scene-canvas").tabIndex'), 0, 'The active canvas must be keyboard reachable');
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await evaluate('Boolean(document.querySelector(".scene-named-controls .named-model-control-list button"))')) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert.match(await evaluate('document.querySelector(".scene-named-controls .named-model-controls p")?.textContent ?? ""'), /turn dials.*open doors/i, 'Scene controls must explain the available interactions');
  assert(await evaluate('[...document.querySelectorAll(".scene-named-controls button")].some(button=>button.textContent === "Turn Flow dial left")'), 'The composite must offer named dial controls');
  await evaluate('document.querySelector(".scene-named-controls summary").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert(await evaluate('document.querySelector(".scene-named-controls details").open'), 'Named controls must be expandable from the keyboard');
  await evaluate('[...document.querySelectorAll(".scene-named-controls button")].find(button=>button.textContent === "Turn Flow dial right").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Flow dial turned to/, 'The named dial control must operate the scene model');
  await evaluate('for(let i=0;i<20;i++) [...document.querySelectorAll(".scene-named-controls button")].find(button=>button.textContent === "Turn Flow dial right").click()');
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Flow dial.*limit/i, 'Trying to turn beyond the dial limit must explain why it stopped');
  await evaluate('[...document.querySelectorAll(".scene-named-controls button")].find(button=>button.textContent === "Turn Flow dial left").click()');
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Flow dial turned to/, 'Turning away from the limit must work and clear the limit feedback');
  await evaluate('[...document.querySelectorAll(".scene-named-controls button")].find(button=>button.textContent === "Open Safety cover latch").click()');
  await evaluate('new Promise(resolve=>setTimeout(resolve,200))');
  assert(await evaluate('[...document.querySelectorAll(".scene-named-controls button")].some(button=>button.textContent === "Close Safety cover latch")'), 'The named door control must reflect its open state');
  await evaluate('window.testSceneCanvas = document.querySelector("#demo-scene-canvas")');
  await evaluate('document.querySelector("[data-action=toggle-scene-interaction]").focus()');
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate('document.activeElement?.dataset.action'), 'toggle-scene-interaction', 'Keyboard focus must remain on the interaction toggle after exiting');
  assert.equal(await evaluate('Boolean(document.querySelector(".scene-named-controls"))'), false, 'Leaving interaction mode must remove the named scene controls');
  assert.equal(await evaluate('document.querySelector("#demo-scene-canvas").tabIndex'), -1);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert(await evaluate('window.testSceneCanvas === document.querySelector("#demo-scene-canvas")'), 'Toggling interaction must retain the existing scene');
  assert(await evaluate('[...document.querySelectorAll(".scene-named-controls button")].some(button=>button.textContent === "Close Safety cover latch")'), 'A door must remain open when interaction mode is toggled');
  const modelState = { ...savedState, creatorStep: 'model', sourceStage: 'model', sourceKind: 'photos', sourceFiles: ['System One photos'], sourceFileName: 'System One photos', pipelinePhase: 'APPROVED', demoSource: true, candidateTriangles: 83000 };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(modelState))});` });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/demo` });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await evaluate('Boolean(document.querySelector(".named-model-controls"))')) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert(await evaluate('Boolean(document.querySelector(".named-model-controls summary"))'), `The named model controls must be available in the creator preview: ${await evaluate('document.querySelector("#demo-model-status")?.textContent ?? document.querySelector("#app")?.textContent?.slice(0,500)')}; ${JSON.stringify(errors)}`);
  await evaluate('document.querySelector("[data-action=select-demo-component][data-component=nxstage-control-panel]").click()');
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Showing Control panel/);
  const resetAvailable = await evaluate('[...document.querySelectorAll(".focus-model-copy button")].some(button=>button.textContent==="Reset view")');
  assert(resetAvailable, 'The creator preview must offer a way back from a close-up');
  await evaluate('[...document.querySelectorAll(".focus-model-copy button")].find(button=>button.textContent==="Reset view").click()');
  assert.equal(await evaluate('document.querySelector("#demo-model-status").textContent'), 'View reset.');
  await evaluate('document.querySelector(".named-model-controls summary").click()');
  assert.equal(await evaluate('document.querySelector(".named-model-controls").open'), true, 'Named controls must be expandable');
  const labels = await evaluate('[...document.querySelectorAll(".named-model-control-list button")].map(button=>button.textContent)');
  assert(labels.includes('Press Flow control'), `Named controls were ${JSON.stringify(labels)}`);
  assert(labels.includes('Press L/hr control'), `Named controls were ${JSON.stringify(labels)}`);
  assert(!labels.includes('Press Add Fluid'), 'Printed icon fields must not appear as buttons');
  assert(!labels.includes('Press Volume Toggle'), 'Printed icon fields must not appear as buttons');
  assert(labels.includes('Lift Cycler door handle'));
  assert(labels.includes('Open Upper cycler door'));
  const activate = async label => {
    await evaluate(`[...document.querySelectorAll('.named-model-control-list button')].find(button=>button.textContent===${JSON.stringify(label)}).focus()`);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const waitForStatus = async pattern => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const text = await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""');
      if (pattern.test(text)) return text;
      await new Promise((wait) => setTimeout(wait, 50));
    }
    const text = await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""');
    assert.match(text, pattern);
    return text;
  };
  await activate('Press Stop control');
  await evaluate('new Promise(resolve=>setTimeout(resolve,1400))');
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Stop control pressed in local preview/, 'Performance updates must not erase the most recent interaction feedback');
  await activate('Open Upper cycler door');
  assert.match(await evaluate('document.querySelector("#demo-model-status").textContent'), /Lift the cycler door handle/, 'The named door control must explain its interlock');
  await activate('Lift Cycler door handle');
  await waitForStatus(/Cycler door handle is raised/);
  await evaluate('new Promise(resolve=>setTimeout(resolve,450))');
  assert(await evaluate('[...document.querySelectorAll(".named-model-control-list button")].some(button=>button.textContent === "Lower Cycler door handle")'), 'The handle action must change to Lower after lifting');
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Lower Cycler door handle', 'Updating the label must preserve keyboard focus');
  await activate('Open Upper cycler door');
  await waitForStatus(/Upper cycler door is open/);
  await evaluate('new Promise(resolve=>setTimeout(resolve,450))');
  assert(await evaluate('[...document.querySelectorAll(".named-model-control-list button")].some(button=>button.textContent === "Close Upper cycler door")'), 'The door action must change to Close after opening');
  await activate('Close Upper cycler door');
  await waitForStatus(/Upper cycler door is closed/);
  await evaluate('new Promise(resolve=>setTimeout(resolve,450))');
  await activate('Lower Cycler door handle');
  await waitForStatus(/Cycler door handle is lowered/);

  const photoAuthoringState = {
    ...modelState,
    creatorStep: 'content',
    sourceStage: 'content',
    backgroundMode: 'LOCKED_INTERACTIVE',
    backgroundStatus: 'REVIEW_REQUIRED',
    backgroundApproved: false,
    backgroundGenerationId: 'gen:authoring-photo-preview',
    backgroundJobId: 'job:authoring-photo-preview',
    backgroundProgress: 100,
    backgroundPreviewUrl: '/demo-assets/nxstage-clinical-photo-v4.png',
  };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(photoAuthoringState))});` });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/demo` });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await evaluate('document.querySelector(".training-scene.photo-plate")?.classList.contains("photo-plate")')) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert(await evaluate('Boolean(document.querySelector(".training-scene.photo-plate"))'), 'Authoring must render the photo-backed preview branch');
  assert.equal(await evaluate('document.querySelector("#training-photo")?.getAttribute("src")'), '/demo-assets/nxstage-clinical-photo-v4.png');
  assert.match(await evaluate('document.querySelector(".video-caption")?.textContent ?? ""'), /photographic draft plate · preview only/i);
  assert.equal(await evaluate('document.querySelector("[data-scene-manifest]")?.dataset.sceneManifest'), '/model/nxstage-training-scene-manifest.json');
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if ((await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""')).includes("Scene ready")) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert.match(await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""'), /Scene ready/, 'The photo-backed authoring composite must load the source-bound model');
  assert.equal(await evaluate('document.querySelector("[data-action=toggle-scene-interaction]")?.getAttribute("aria-pressed")'), 'false', 'Authoring photo preview must start non-interactive');
  assert.equal(await evaluate('Boolean(document.querySelector(".scene-named-controls"))'), false, 'Authoring photo preview must not expose learner controls before interaction is enabled');

  const interactiveVideoAuthoringState = {
    ...photoAuthoringState,
    backgroundPreviewUrl: '/demo-assets/nxstage-office-background-photo-openmontage.mp4',
  };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(interactiveVideoAuthoringState))});` });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/demo` });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await evaluate('document.querySelector("#training-video")?.readyState >= 1')) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert.equal(await evaluate('document.querySelector("#training-video")?.getAttribute("src")'), '/demo-assets/nxstage-office-background-photo-openmontage.mp4');
  assert.equal(await evaluate('document.querySelectorAll(".background-review-artifacts figure").length'), 3, 'Interactive authoring must expose clean plate, model overlay, and final composite review artifacts');
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if ((await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""')).includes("Scene ready")) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert.match(await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""'), /Scene ready/, 'The generated interactive video must load with the source-bound model');

  const cinematicAuthoringState = {
    ...photoAuthoringState,
    backgroundMode: 'CINEMATIC',
    backgroundPreviewUrl: '/demo-assets/nxstage-hallway-to-room-composite.mp4',
  };
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(cinematicAuthoringState))});` });
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/demo` });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if ((await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""')).includes("Cinematic composite ready")) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  assert(await evaluate('Boolean(document.querySelector(".training-scene.cinematic"))'), 'Cinematic authoring must select the cinematic scene branch');
  assert.equal(await evaluate('document.querySelector("[data-scene-manifest]")?.dataset.sceneManifest'), '/model/nxstage-cinematic-scene-manifest.json');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-action=toggle-scene-interaction]"))'), false, 'Cinematic authoring must not expose live interaction');
  assert.match(await evaluate('document.querySelector("#demo-model-status")?.textContent ?? ""'), /Cinematic composite ready/, 'Cinematic authoring must report the baked composite as ready');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Training scene Chrome passed: packaged scene/video bindings, interactive controls, photo-backed authoring preview, generated MP4 review artifacts, and cinematic no-interaction mode are all enforced.');
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise((done) => browser.once('close', done));
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await removeProfile();
}
