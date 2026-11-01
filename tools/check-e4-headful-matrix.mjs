import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const root = resolve(import.meta.dirname, "..");
const matrix = JSON.parse(await readFile(resolve(root, "config/e4-device-matrix.json"), "utf8"));
const updateBaselines = process.env.E4_UPDATE_BASELINES === "1" || process.argv.includes("--update-baselines");
const browserId = (process.env.E4_BROWSER_ID ?? "chromium").replace(/[^A-Za-z0-9._-]/g, "-");
const baselineSuffix = browserId === "chromium" ? "" : `-${browserId}`;
const browserCandidates = browserId === "edge"
  ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"];
const candidates = [process.env.E4_BROWSER_PATH, process.env.E4_CHROME_PATH, ...browserCandidates].filter(Boolean);
let chromePath;
for (const candidate of candidates) { try { await stat(candidate); chromePath = candidate; break; } catch {} }
if (!chromePath) throw new Error("E4_CHROME_NOT_FOUND");

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
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
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    };
  }
  async open() { await new Promise((resolveOpen, rejectOpen) => { this.socket.addEventListener("open", resolveOpen, { once: true }); this.socket.addEventListener("error", rejectOpen, { once: true }); }); }
  command(method, params = {}) { const id = ++this.id; return new Promise((resolveCommand, rejectCommand) => { this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return result.result?.value; }
  close() { this.socket.close(); }
}

function pngPixels(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "visual baseline must use 8-bit PNG channels");
      assert.equal(data[10], 0, "visual baseline must use non-interlaced PNGs");
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  assert.ok(channels > 0, "unsupported visual baseline PNG color type");
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height * channels);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    assert.ok(filter <= 4, "unsupported PNG filter");
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? pixels[y * rowBytes + x - channels] : 0;
      const above = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * rowBytes + x - channels] : 0;
      const value = raw[sourceOffset++];
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : (() => {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        return pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
      })();
      pixels[y * rowBytes + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function compareVisualBaseline(actualBytes, baselineBytes) {
  const actual = pngPixels(actualBytes);
  const baseline = pngPixels(baselineBytes);
  assert.equal(actual.width, baseline.width);
  assert.equal(actual.height, baseline.height);
  assert.equal(actual.channels, baseline.channels);
  let changedPixels = 0;
  let totalDifference = 0;
  const pixelCount = actual.width * actual.height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < actual.channels; channel += 1) {
      const difference = Math.abs(actual.pixels[pixel * actual.channels + channel] - baseline.pixels[pixel * actual.channels + channel]);
      totalDifference += difference;
      if (difference > 16) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const changedRatio = changedPixels / pixelCount;
  const meanDifference = totalDifference / actual.pixels.length;
  assert.ok(changedRatio <= 0.02 && meanDifference <= 4, `visual baseline drift too large: ${(changedRatio * 100).toFixed(2)}% pixels, mean ${meanDifference.toFixed(2)}`);
  return { changedRatio, meanDifference };
}

async function waitForValue(devtools, expression, predicate, timeoutMs = 3_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await devtools.evaluate(expression);
    if (predicate(value)) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return await devtools.evaluate(expression);
}

const backendServer = createJobStatusHttpServer({
  staticRoot: resolve(root, "apps/web/dist"),
  authenticator: { authenticate: async () => null },
  organizationContextResolver: { resolveActiveOrganizations: async () => [] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolveListen) => backendServer.listen(0, "127.0.0.1", resolveListen));
const backendPort = backendServer.address().port;
const proxyServer = createHttpServer(async (request, response) => {
  try {
    const requestChunks = [];
    for await (const chunk of request) requestChunks.push(Buffer.from(chunk));
    const requestBody = Buffer.concat(requestChunks);
    const requestMethod = request.method ?? "GET";
    const requestHeaders = {};
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string" && !["host", "connection", "content-length"].includes(name.toLowerCase())) requestHeaders[name] = value;
    if (requestBody.byteLength > 0) await new Promise((resolveWait) => setTimeout(resolveWait, Math.ceil((requestBody.byteLength / matrix.testNetwork.uploadBytesPerSecond) * 1000)));
    await new Promise((resolveWait) => setTimeout(resolveWait, matrix.testNetwork.latencyMs));
    const upstream = await fetch(`http://127.0.0.1:${backendPort}${request.url ?? "/"}`, { method: requestMethod, headers: requestHeaders, ...(requestBody.byteLength > 0 && requestMethod !== "GET" && requestMethod !== "HEAD" ? { body: requestBody } : {}) });
    const body = Buffer.from(await upstream.arrayBuffer());
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.ceil((body.byteLength / matrix.testNetwork.downloadBytesPerSecond) * 1000)));
    const headers = {};
    for (const [name, value] of upstream.headers) if (!["connection", "keep-alive", "transfer-encoding"].includes(name.toLowerCase())) headers[name] = value;
    response.writeHead(upstream.status, headers);
    response.end(body);
  } catch {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("Local E4 network proxy failed.");
  }
});
await new Promise((resolveListen) => proxyServer.listen(0, "127.0.0.1", resolveListen));
const webPort = proxyServer.address().port;
const results = [];
try {
  for (const profile of matrix.profiles) {
    const cdpPort = await freePort();
    const temp = await mkdtemp(resolve(tmpdir(), "e4-headful-"));
    const browser = spawn(chromePath, [
      "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-allow-origins=*",
      `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${resolve(temp, "profile")}`, `--window-size=${profile.viewport[0]},${profile.viewport[1]}`,
      `http://127.0.0.1:${webPort}/learner/model?preview=1`
    ], { windowsHide: true, stdio: "ignore" });
    let devtools;
    try {
      devtools = new DevTools(await targetUrl(cdpPort));
      await devtools.open();
      await devtools.command("Runtime.enable");
      await devtools.command("Page.enable");
      await devtools.command("Accessibility.enable");
      await devtools.command("Page.bringToFront");
      const browserVersion = await devtools.command("Browser.getVersion");
      const expectedBrowser = browserId === "edge" ? "Edge" : "Chrome";
      const expectedEvidence = matrix.localEvidence?.find((item) => item.browser === expectedBrowser);
      assert.ok(expectedEvidence && browserVersion.product.includes(expectedEvidence.version), `${expectedBrowser} engine ${browserVersion.product} does not match the recorded local evidence`);
      if (profile.class === "mobile") {
        await devtools.command("Emulation.setDeviceMetricsOverride", { width: profile.viewport[0], height: profile.viewport[1], deviceScaleFactor: 1, mobile: true });
        await devtools.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      }
      await devtools.command("Page.navigate", { url: `http://127.0.0.1:${webPort}/learner/model?preview=1` });
      await devtools.command("Page.bringToFront");
      await devtools.command("Emulation.setFocusEmulationEnabled", { enabled: true });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
        if (state !== "LOADING") break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 4_000));
      const state = await devtools.evaluate("document.querySelector('#runtime-state')?.textContent");
      const loadMs = Number(await devtools.evaluate("document.querySelector('#load-time')?.textContent.replace(' ms','')"));
      const fps = Number(await devtools.evaluate("document.querySelector('#fps')?.textContent.replace(' FPS','')"));
      const memoryMb = Number(await devtools.evaluate("document.querySelector('#memory')?.textContent.replace(' MB','')"));
      const accessibilityTree = await devtools.command("Accessibility.getFullAXTree");
      const accessibilityRoles = (accessibilityTree.nodes ?? []).map((node) => node.role?.value).filter(Boolean);
      assert.ok(accessibilityRoles.includes("status"), `${profile.id} accessibility tree is missing live status content`);
      assert.ok(accessibilityRoles.includes("list") && accessibilityRoles.includes("listitem"), `${profile.id} accessibility tree is missing the component list semantics`);
      const viewport = await devtools.evaluate("({ width: window.innerWidth, height: window.innerHeight, coarse: matchMedia('(pointer: coarse)').matches })");
      const loadedVariant = await devtools.evaluate("performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('model-manifest') || name.includes('aurora-infusion-controller'))");
      assert.ok(Array.isArray(loadedVariant));
      if (profile.class === "mobile") assert.ok(loadedVariant.some((name) => name.includes("model-manifest.mobile.json")) && loadedVariant.some((name) => name.includes("aurora-infusion-controller.mobile.glb")), `${profile.id} did not load the approved mobile model variant: ${loadedVariant.join(", ")}`);
      else assert.ok(loadedVariant.some((name) => name.endsWith("/model-manifest.json")) && loadedVariant.some((name) => name.endsWith("/aurora-infusion-controller.glb")), `${profile.id} did not load the approved full model variant: ${loadedVariant.join(", ")}`);
      assert.ok(["READY", "REDUCED_COMPLEXITY"].includes(state));
      if (profile.class === "mobile") {
        assert.equal(viewport.width, profile.viewport[0]);
        assert.equal(viewport.height, profile.viewport[1]);
        assert.equal(viewport.coarse, true);
      } else {
        assert.ok(viewport.width >= profile.viewport[0] - 64 && viewport.width <= profile.viewport[0], `${profile.id} desktop viewport width was ${viewport.width}`);
        assert.ok(viewport.height >= profile.viewport[1] - 180 && viewport.height <= profile.viewport[1], `${profile.id} desktop viewport height was ${viewport.height}`);
      }
      assert.ok(Number.isFinite(loadMs) && loadMs <= profile.interactiveWithinMs, `${profile.id} exceeded the ${profile.interactiveWithinMs} ms interactive budget: measured ${loadMs} ms on ${matrix.testNetwork.name}`);
      assert.ok(Number.isFinite(fps) && fps >= profile.targetFps, `${profile.id} missed the ${profile.targetFps} FPS target: measured ${fps} FPS on ${matrix.testNetwork.name}`);
      assert.ok(Number.isFinite(memoryMb) && memoryMb <= profile.maxMemoryMb, `${profile.id} exceeded the ${profile.maxMemoryMb} MB memory budget: measured ${memoryMb} MB`);
      const canvasRect = await devtools.evaluate("(() => { const rect = document.querySelector('#model-canvas').getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }; })()");
      const canvasScreenshot = Buffer.from((await devtools.command("Page.captureScreenshot", { format: "png", fromSurface: true, clip: { ...canvasRect, scale: 1 } })).data, "base64");
      const baselineDir = resolve(root, "tests/e4-baselines");
      const baselinePath = resolve(baselineDir, `${profile.id}${baselineSuffix}.png`);
      let visualComparison = "created";
      if (updateBaselines) {
        await mkdir(baselineDir, { recursive: true });
        await writeFile(baselinePath, canvasScreenshot);
      } else {
        const baseline = await readFile(baselinePath);
        visualComparison = compareVisualBaseline(canvasScreenshot, baseline);
      }
      const selectCover = "(() => { const button = document.querySelector('#component-list button[data-component-id=\\\"AIC-C02\\\"]'); if (!button) return null; button.scrollIntoView({ block: 'center', inline: 'center' }); const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()";
      if (profile.class === "mobile") {
        const point = await devtools.evaluate(selectCover);
        assert.ok(point);
        await devtools.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }], modifiers: 0 });
        await devtools.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], modifiers: 0 });
      } else {
        const focusedComponent = await devtools.evaluate("(() => { const button = document.querySelector('#component-list button[data-component-id=\\\"AIC-C02\\\"]'); button?.focus(); return document.activeElement?.dataset.componentId; })()");
        assert.equal(focusedComponent, "AIC-C02", `${profile.id} could not focus the component button for keyboard activation`);
        await devtools.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\\r", unmodifiedText: "\\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await devtools.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
      const coverAction = await waitForValue(devtools, "[...document.querySelectorAll('#action-controls button')].map((button) => button.textContent)", (value) => Array.isArray(value) && value.includes("Open safety cover"));
      assert.ok(Array.isArray(coverAction) && coverAction.includes("Open safety cover"), `${profile.id} did not expose the permitted cover action after selection`);
      await devtools.evaluate("[...document.querySelectorAll('#action-controls button')].find((button) => button.textContent === 'Open safety cover')?.click(); true");
      await waitForValue(devtools, "document.querySelector('#score')?.textContent", (value) => value === "0");
      await devtools.evaluate("document.querySelector('#component-list button[data-component-id=\\\"AIC-C03\\\"]')?.click(); true");
      const sensorAction = await waitForValue(devtools, "[...document.querySelectorAll('#action-controls button')].map((button) => button.textContent)", (value) => Array.isArray(value) && value.includes("Position line sensor"));
      assert.ok(Array.isArray(sensorAction) && sensorAction.includes("Position line sensor"), `${profile.id} did not expose the permitted sensor action after selection`);
      await devtools.evaluate("[...document.querySelectorAll('#action-controls button')].find((button) => button.textContent === 'Position line sensor')?.click(); true");
      const completed = await waitForValue(devtools, "document.querySelector('#completion')?.textContent", (value) => typeof value === "string" && value.includes("Completed"));
      assert.match(completed, /Completed/);
      const screenshot = await devtools.command("Page.captureScreenshot", { format: "png", fromSurface: true });
      const screenshotBytes = Buffer.from(screenshot.data, "base64");
      assert.ok(screenshotBytes.length > 1_000, `${profile.id} screenshot capture is empty`);
      assert.equal(screenshotBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      results.push({ id: profile.id, state, loadMs, fps, memoryMb, targetFps: profile.targetFps, network: matrix.testNetwork.name, viewport, variant: profile.class === "mobile" ? "mobile" : "full", browser: browserId, browserVersion: browserVersion.product, userAgent: browserVersion.userAgent, screenshotBytes: screenshotBytes.length, visualComparison });
    } finally {
      devtools?.close();
      browser.kill();
      if (browser.exitCode === null) await new Promise((resolveClose) => browser.once("close", resolveClose));
      await rm(temp, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolveClose) => proxyServer.close(resolveClose));
  await new Promise((resolveClose) => backendServer.close(resolveClose));
}
console.log(`E4 foreground-capable viewport matrix: ${JSON.stringify(results)}`);
