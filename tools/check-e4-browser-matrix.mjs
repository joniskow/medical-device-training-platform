import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const root = resolve(import.meta.dirname, "..");
const matrix = JSON.parse(await readFile(resolve(root, "config/e4-device-matrix.json"), "utf8"));
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

function runChrome(url, viewport, screenshotPath, userDataDir) {
  return new Promise((resolveRun, reject) => {
    const args = [
      "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=7000",
      `--window-size=${viewport[0]},${viewport[1]}`, `--user-data-dir=${userDataDir}`,
      `--screenshot=${screenshotPath}`, "--dump-dom", url
    ];
    const child = spawn(chromePath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`CHROME_EXIT_${code}: ${stderr.slice(-1000)}`)));
  });
}

const server = createJobStatusHttpServer({
  staticRoot: resolve(root, "apps/web/dist"),
  authenticator: { authenticate: async () => null },
  organizationContextResolver: { resolveActiveOrganizations: async () => [] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;
const results = [];
try {
  for (const profile of matrix.profiles) {
    const temp = await mkdtemp(resolve(tmpdir(), "e4-browser-"));
    const screenshotPath = resolve(temp, `${profile.id}.png`);
    try {
      const page = await runChrome(`http://127.0.0.1:${port}/learner/model?preview=1`, profile.viewport, screenshotPath, resolve(temp, "profile"));
      const dom = page.stdout;
      assert.match(dom, /AIC-001 model activity/);
      assert.match(dom, /id="component-list"/);
      assert.match(dom, /id="procedure-step"/);
      assert.match(dom, /id="action-log"/);
      const screenshot = await readFile(screenshotPath);
      assert.equal(screenshot.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.ok(screenshot.length > 1000, `${profile.id} screenshot is empty`);
      const width = screenshot.readUInt32BE(16);
      const height = screenshot.readUInt32BE(20);
      assert.equal(width, profile.viewport[0]);
      assert.equal(height, profile.viewport[1]);
      const runtime = /id="runtime-state">([^<]*)/.exec(dom)?.[1] ?? "UNKNOWN";
      const loadMs = Number(/id="load-time">(\d+) ms/.exec(dom)?.[1] ?? NaN);
      const fps = Number(/id="fps">(\d+) FPS/.exec(dom)?.[1] ?? NaN);
      const memoryMb = Number(/id="memory">([\d.]+) MB/.exec(dom)?.[1] ?? NaN);
      assert.ok(runtime !== "LOADING", `${profile.id} remained in loading state`);
      assert.ok(Number.isFinite(loadMs) && loadMs <= profile.interactiveWithinMs, `${profile.id} exceeded interactive budget`);
      assert.ok(Number.isFinite(memoryMb) && memoryMb <= profile.maxMemoryMb, `${profile.id} exceeded memory budget`);
      if (Number.isFinite(fps) && fps < profile.targetFps) assert.match(dom, /Reduced-complexity equivalent path available|below the .* FPS target/);
      results.push({ id: profile.id, runtime, loadMs, fps: Number.isFinite(fps) ? fps : null, memoryMb, screenshotBytes: screenshot.length });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
console.log(`E4 browser matrix passed: ${JSON.stringify(results)}`);
