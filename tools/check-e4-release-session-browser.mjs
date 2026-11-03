import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const root = resolve(import.meta.dirname, "..");
const mobileManifest = JSON.parse(await readFile(resolve(root, "apps/web/dist/model-manifest.mobile.json"), "utf8"));
const forceManifestFailure = process.env.E4_RELEASE_BROWSER_FORCE_MANIFEST_FAILURE === "1";
const slowSelections = process.env.E4_RELEASE_BROWSER_SLOW_SELECTIONS === "1" || process.argv.includes("--slow-selections");
const retrySelection = process.argv.includes("--retry-selection");
const candidates = [process.env.E4_CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
let browserPath;
for (const candidate of candidates) { try { await stat(candidate); browserPath = candidate; break; } catch {} }
if (!browserPath) throw new Error("E4_BROWSER_NOT_FOUND");

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function targetUrl(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("E4_CDP_TARGET_TIMEOUT");
}

class DevTools {
  id = 0;
  pending = new Map();
  socket;
  constructor(url) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    };
  }
  async open() { await new Promise((resolveOpen, rejectOpen) => { this.socket.addEventListener("open", resolveOpen, { once: true }); this.socket.addEventListener("error", rejectOpen, { once: true }); }); }
  command(method, params = {}) { const id = ++this.id; return new Promise((resolveCommand, rejectCommand) => { this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return result.result?.value; }
  close() { this.socket.close(); }
}

let semanticMode=false;
let delayedSelections=0;
let selectionsInFlight=0;
let overlappedSelection=false;
let staleActions=0;
let failedSelection=false;
function stateFor(state) {
  return {
    releaseBindingId: "releasebind_aic001_preview_v1",
    modelVersionId: "modelv_aic001_reference_v1",
    sequence: state.sequence,
    nextSequence: state.nextSequence,
    selectedComponentId: state.selectedComponentId,
    transforms: state.transforms,
    scorePoints: state.scorePoints,
    completed: state.completed,
    activeStepId: state.completed ? "complete" : "procedure",
    activeStepTitle: state.completed ? "Procedure complete" : "Complete the approved procedure",
    allowedActions: state.completed ? [] : semanticMode?["inspect_component"]:["select_component", "transform_component"]
  };
}

const sessionState = {
  sequence: 0,
  nextSequence: 1,
  transforms: {
    "AIC-C01": { rotationY: 0, translationX: 0 },
    "AIC-C02": { rotationY: 0, translationX: 0 },
    "AIC-C03": { rotationY: 0, translationX: 0 }
  },
  scorePoints: 0,
  completed: false,
  selectedComponentId: undefined
};

const webPort = await freePort();
const server = createJobStatusHttpServer({
  staticRoot: resolve(root, "apps/web/dist"),
  allowedOrigins: [`http://127.0.0.1:${webPort}`],
  authenticator: { authenticate: async () => ({ subject: "learner-1", roles: ["learner"] }) },
  organizationContextResolver: { resolveActiveOrganizations: async () => ["org-fixture"] },
  statusService: { get: async () => null, retry: async () => null },
  modelAssetService: {
    async getLearnerModel(_tenant, request) {
      if (request.releaseId !== "release-1" || request.modelVersionId !== "modelv_aic001_reference_v1") return null;
      const variant = request.variantId === "mobile" ? "mobile" : "full";
      const suffix = variant === "mobile" ? ".mobile" : "";
      const port = server.address().port;
      return {
        releaseId: request.releaseId,
        releaseHash: "c".repeat(64),
        modelVersionId: request.modelVersionId,
        releaseBindingId: "releasebind_aic001_preview_v1",
        variantId: variant,
        manifestHash: mobileManifest.sourceHash,
        manifestUrl: forceManifestFailure ? `http://127.0.0.1:${port}/learner/missing/model-manifest${suffix}.json` : `http://127.0.0.1:${port}/learner/model-manifest${suffix}.json`,
        modelUrl: `http://127.0.0.1:${port}/learner/model/aurora-infusion-controller${suffix}.glb`,
        fallbackManifest: { ...mobileManifest, modelVersionId: "modelv_aic001_reference_v1", releaseBindingId: "releasebind_aic001_preview_v1" },
        cacheControl: "private, max-age=60"
      };
    }
  },
  modelSessionService: {
    async submit(_tenant, sessionId, action) {
      assert.equal(sessionId, "session-1");
      assert.equal(action.releaseBindingId, "releasebind_aic001_preview_v1");
      assert.equal(action.modelVersionId, "modelv_aic001_reference_v1");
      if (retrySelection && action.type === "select_component" && !failedSelection) { failedSelection = true; throw new Error("Simulated interrupted selection"); }
      if (slowSelections && action.type === "select_component") { delayedSelections += 1; selectionsInFlight += 1; await new Promise(wait => setTimeout(wait, 1500)); selectionsInFlight -= 1; }
      if (slowSelections && action.type === "transform_component" && selectionsInFlight) overlappedSelection = true;
      if(semanticMode){assert.equal(action.type,'inspect_component');assert.equal(action.value,'inspected');assert.equal(action.stepId,'procedure');}
      if (action.expectedSequence !== sessionState.nextSequence) { staleActions += 1; return { status: "stale_sequence", clientActionId: action.clientActionId, nextSequence: sessionState.nextSequence, feedback: "Stale sequence." }; }
      if (action.componentId && !sessionState.transforms[action.componentId]) return { status: "unknown_component", clientActionId: action.clientActionId, nextSequence: sessionState.nextSequence, feedback: "Unknown component." };
      if (action.type === "transform_component" && action.componentId) sessionState.transforms[action.componentId] = { ...sessionState.transforms[action.componentId], ...(action.transform ?? {}) };
      sessionState.selectedComponentId = action.componentId ?? sessionState.selectedComponentId;
      sessionState.sequence += 1;
      sessionState.nextSequence += 1;
      const previousScore = sessionState.scorePoints;
      sessionState.scorePoints = sessionState.transforms["AIC-C02"].rotationY === Math.PI / 2 && sessionState.transforms["AIC-C03"].translationX === 0.2 ? 2 : 0;
      sessionState.completed = sessionState.scorePoints === 2;
      return { status: "accepted", clientActionId: action.clientActionId, nextSequence: sessionState.nextSequence, state: stateFor(sessionState), scoreDelta: sessionState.scorePoints - previousScore, feedback: sessionState.completed ? "Completed." : "Accepted." };
    },
    async resume(_tenant, sessionId, input) { assert.equal(sessionId, "session-1"); return { status: "accepted", nextSequence: sessionState.nextSequence, state: stateFor(sessionState), feedback: `Resumed at ${input.nextSequence}.` }; }
  }
});

await new Promise((resolveListen) => server.listen(webPort, "127.0.0.1", resolveListen));
const port = webPort;
const cdpPort = await freePort();
const temp = await mkdtemp(resolve(tmpdir(), "e4-release-browser-"));
const browser = spawn(browserPath, [
  "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-allow-origins=*",
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${resolve(temp, "profile")}`, "--window-size=412,915", "about:blank"
], { windowsHide: true, stdio: "ignore" });
let devtools;
try {
  devtools = new DevTools(await targetUrl(cdpPort));
  await devtools.open();
  await devtools.command("Runtime.enable");
  await devtools.command("Page.enable");
  await devtools.command("Page.addScriptToEvaluateOnNewDocument", { source: "sessionStorage.setItem('mdt.auth.access-token','test-learner-token'); sessionStorage.setItem('mdt.auth.organization-id','org-fixture'); window.__e4Bodies=[]; window.__e4Headers=[]; window.__e4Responses=[]; const __e4Fetch=window.fetch.bind(window); window.fetch=async(input,init)=>{ if(init?.body) window.__e4Bodies.push(String(init.body)); if(init?.headers) window.__e4Headers.push(Object.fromEntries(new Headers(init.headers).entries())); const response=await __e4Fetch(input,init); if(!response.ok){ const copy=response.clone(); window.__e4Responses.push({status:response.status,body:await copy.text()}); } return response; };" });
  await devtools.command("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await devtools.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await devtools.command("Page.navigate", { url: `http://127.0.0.1:${port}/learner/model?sessionId=session-1&releaseId=release-1&modelVersionId=modelv_aic001_reference_v1` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
    if (["READY", "REDUCED_COMPLEXITY", "ERROR"].includes(state)) break;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  const runtimeState = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
  assert.equal(runtimeState, forceManifestFailure ? "IDLE" : "READY");
  if (forceManifestFailure) {
    const fallback = await devtools.evaluate("document.querySelector('#fallback')?.textContent");
    assert.match(fallback, /equivalent activity path remains available/i);
    assert.equal(await devtools.evaluate("document.querySelectorAll('#component-list button').length"), 3);
  }
  const resources = await devtools.evaluate("performance.getEntriesByType('resource').map((entry) => entry.name)");
  assert.ok(resources.some((name) => name.includes("model-manifest.mobile.json")));
  if (!forceManifestFailure) assert.ok(resources.some((name) => name.includes("aurora-infusion-controller.mobile.glb")));
  const click = async (selector) => { await devtools.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click(); true`); await new Promise((wait) => setTimeout(wait, 150)); };
  const pressEnter = async (selector) => {
    const focused = await devtools.evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.focus(); return document.activeElement === button; })()`);
    assert.equal(focused, true, `could not focus ${selector} for keyboard rehearsal`);
    await devtools.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await devtools.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await new Promise((wait) => setTimeout(wait, 150));
  };
  const waitForAction = async (label) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const labels = await devtools.evaluate("[...document.querySelectorAll('#action-controls button')].map((button) => button.textContent)");
      if (labels?.includes(label)) return;
      await new Promise((wait) => setTimeout(wait, 50));
    }
    assert.fail(`missing action ${label}`);
  };
  await pressEnter("#component-list button[data-component-id='AIC-C02']");
  if (retrySelection) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await devtools.evaluate("!document.querySelector('#retry-action').hidden")) break;
      await new Promise(wait => setTimeout(wait, 50));
    }
    assert(await devtools.evaluate("!document.querySelector('#retry-action').hidden"), "An interrupted action must offer an explicit retry");
    const failedBody = JSON.parse((await devtools.evaluate('window.__e4Bodies')).at(-1));
    const beforeBlocked = await devtools.evaluate('window.__e4Bodies.length');
    await click('#hint');
    assert.equal(await devtools.evaluate('window.__e4Bodies.length'), beforeBlocked, 'Later actions must wait for the unconfirmed action');
    assert.match(await devtools.evaluate('document.querySelector("#model-status").textContent'), /Retry the unconfirmed action/, 'The learner must be told how to continue');
    assert.match(await devtools.evaluate('document.querySelector("#model-status").textContent'), /This action was not sent/, 'The learner must know the later action did not run');
    await click('#retry-action');
    await waitForAction("Open safety cover");
    const retriedBody = JSON.parse((await devtools.evaluate('window.__e4Bodies')).at(-1));
    assert.equal(retriedBody.clientActionId, failedBody.clientActionId, 'Retry must preserve the action identity');
    assert.equal(retriedBody.expectedSequence, failedBody.expectedSequence, 'Retry must preserve the original sequence');
  }
  await waitForAction("Open safety cover");
  await click("#action-controls > button");
  await pressEnter("#component-list button[data-component-id='AIC-C03']");
  await waitForAction("Position line sensor");
  await click("#action-controls > button");
  if (slowSelections) {
    for (let attempt = 0; attempt < 100 && selectionsInFlight; attempt += 1) await new Promise(wait => setTimeout(wait, 50));
    assert.equal(selectionsInFlight, 0, 'Delayed selections must finish before checking their results');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await devtools.evaluate("document.querySelector('#completion')?.textContent"))?.includes("Completed")) break;
      await new Promise(wait => setTimeout(wait, 50));
    }
  }
  const completion = await devtools.evaluate("document.querySelector('#completion')?.textContent");
  const score = await devtools.evaluate("document.querySelector('#score')?.textContent");
  const actionLog = await devtools.evaluate("document.querySelector('#action-log')?.textContent");
  const allowed = await devtools.evaluate("document.querySelector('#allowed-actions')?.textContent");
  const ariaCurrent = await devtools.evaluate("document.querySelector(\"#component-list button[data-component-id='AIC-C03']\")?.getAttribute('aria-current')");
  const requestBodies = await devtools.evaluate("window.__e4Bodies");
  if (slowSelections) assert(delayedSelections >= 2, 'The test must actually delay both selection actions');
  if (slowSelections) assert.equal(overlappedSelection, false, 'Movement must wait until the preceding selection is confirmed');
  if (slowSelections) assert.equal(staleActions, 0, 'Rapid actions must not produce stale session requests');
  const requestHeaders = await devtools.evaluate("window.__e4Headers");
  const responseErrors = await devtools.evaluate("window.__e4Responses");
  const actionTypes = requestBodies.map((body) => JSON.parse(body).type);
  assert.deepEqual(actionTypes, retrySelection ? ["select_component", "select_component", "transform_component", "select_component", "transform_component"] : ["select_component", "transform_component", "select_component", "transform_component"], `unexpected duplicate or missing semantic actions: ${JSON.stringify(requestBodies)}`);
  assert.ok(requestHeaders.filter(headers=>headers.authorization==='Bearer test-learner-token').every(headers=>headers['x-organization-id']==='org-fixture'),'Organization context missing from asset/session transport');
  assert.ok(requestHeaders.filter((headers) => headers.authorization === "Bearer test-learner-token").length >= 5, `authenticated asset/session requests missing bearer token: ${JSON.stringify(requestHeaders)}`);
  assert.match(completion, /Completed/, `completion=${completion}; score=${score}; action=${actionLog}; bodies=${JSON.stringify(requestBodies)}; responses=${JSON.stringify(responseErrors)}`);
  assert.equal(score, "2");
  assert.match(actionLog, /score \+2/);
  assert.match(allowed, /none; procedure complete/);
  assert.equal(ariaCurrent, "true");
  const resumed = await devtools.evaluate("window.fetch('/api/v1/model-sessions/session-1?releaseBindingId=releasebind_aic001_preview_v1&modelVersionId=modelv_aic001_reference_v1&nextSequence=5').then((response) => response.status)");
  assert.equal(resumed, 200);
  semanticMode=true;sessionState.completed=false;
  await click('#resume-session');await waitForAction('Submit procedure action');
  await devtools.evaluate(`(() => {for(const [label,value] of [['Action value (if instructed)','inspected'],['Step reference (if instructed)','procedure']]){const wrapper=[...document.querySelectorAll('#action-controls label')].find(el=>el.firstChild.textContent===label);wrapper.querySelector('input').value=value;}return true;})()`);
  await pressEnter('#action-controls fieldset button');
  assert.equal(sessionState.completed,true);const semanticBody=JSON.parse((await devtools.evaluate('window.__e4Bodies')).at(-1));assert.equal(semanticBody.type,'inspect_component');assert.equal(semanticBody.value,'inspected');assert.equal(semanticBody.stepId,'procedure');
  console.log("E4 release-session browser rehearsal passed: bound mobile variant, authenticated release asset lookup, semantic actions, completion, and resume all work through the learner page.");
} finally {
  devtools?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise((resolveClose) => browser.once("close", resolveClose));
  await rm(temp, { recursive: true, force: true });
  await new Promise((resolveClose) => server.close(resolveClose));
}
