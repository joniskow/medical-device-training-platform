import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";
import { phaseAfterContextRestore } from "../apps/web/dist/model-runtime-budget.js";

const root = resolve(import.meta.dirname, "..");
assert.equal(phaseAfterContextRestore("REDUCED_COMPLEXITY", 100, 60, { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 96 }), "REDUCED_COMPLEXITY", "context restore must preserve a pre-existing reduced-complexity decision");
assert.equal(phaseAfterContextRestore("READY", 100, 20, { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 96 }), "REDUCED_COMPLEXITY", "context restore must preserve a measured FPS fallback");
const chromeCandidates = [
  process.env.E4_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter((value) => typeof value === "string");
let chromePath;
for (const candidate of chromeCandidates) {
  try { await stat(candidate); chromePath = candidate; break; } catch { /* try the next configured installation */ }
}
if (!chromePath) throw new Error("E4_CHROME_NOT_FOUND");

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("E4_CDP_TARGET_TIMEOUT");
}

class DevTools {
  #nextId = 1;
  #pending = new Map();
  constructor(url) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
  }
  command(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.#pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

const server = createJobStatusHttpServer({
  staticRoot: resolve(root, "apps/web/dist"),
  authenticator: { authenticate: async () => null },
  organizationContextResolver: { resolveActiveOrganizations: async () => [] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const webPort = server.address().port;
const cdpPort = await freePort();
const temp = await mkdtemp(resolve(tmpdir(), "e4-context-loss-"));
const browser = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-allow-origins=*",
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${resolve(temp, "profile")}`,
  `http://127.0.0.1:${webPort}/learner/model?preview=1`
], { windowsHide: true, stdio: "ignore" });
let devtools;
try {
  devtools = new DevTools(await waitForTarget(cdpPort));
  await devtools.open();
  await devtools.command("Runtime.enable");
  await devtools.command("Page.enable");
  await devtools.command("Page.navigate", { url: `http://127.0.0.1:${webPort}/learner/model?preview=1` });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
    if (state !== "LOADING") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const readyState = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
  assert.ok(["READY", "REDUCED_COMPLEXITY"].includes(readyState), `runtime did not load before context-loss test: ${readyState}`);
  const lossSupported = await devtools.evaluate(`(() => {
    const canvas = document.querySelector('#model-canvas');
    const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__e4ContextExtension = extension;
    extension.loseContext();
    return true;
  })()`);
  assert.equal(lossSupported, true, "the browser must expose WEBGL_lose_context for the regression test");
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const lostState = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
  const lostStatus = await devtools.evaluate("document.querySelector('#model-status')?.textContent");
  assert.equal(lostState, "CONTEXT_LOST");
  assert.match(lostStatus, /context lost/i);
  const restored = await devtools.evaluate("window.__e4ContextExtension.restoreContext(); true");
  assert.equal(restored, true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const restoredState = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
  assert.equal(restoredState, "READY");
  console.log(`E4 context-loss regression passed: ${readyState} -> ${lostState} -> ${restoredState}.`);
} finally {
  devtools?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise((resolveClose) => browser.once("close", resolveClose));
  await rm(temp, { recursive: true, force: true });
  await new Promise((resolveClose) => server.close(resolveClose));
}
