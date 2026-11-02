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
const profile = await mkdtemp(resolve(tmpdir(), 'training-scene-browser-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,1000', `http://127.0.0.1:${port}/demo`], { windowsHide: true, stdio: 'ignore' });
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
  await evaluate('document.querySelector("[data-action=toggle-scene-interaction]").click()');
  assert.equal(await evaluate('document.querySelector(".training-scene")?.classList.contains("interactive")'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#demo-scene-canvas")).pointerEvents'), 'auto');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Training scene Chrome passed: packaged scene manifest and exact video hash are consumed before composite load, camera/model binding succeeds, and interaction mode toggles safely.');
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise((done) => browser.once('close', done));
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(profile, { recursive: true, force: true });
}
