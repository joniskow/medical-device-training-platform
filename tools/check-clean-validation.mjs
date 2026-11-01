import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.packageManager, "pnpm@11.25.0");
assert.ok(process.versions.node);

const windows = process.platform === "win32";
const pnpm = windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
const env = { ...process.env, CI: "1", TZ: "UTC", LC_ALL: "C", DOCUMENT_OCR_ENABLED: "false" };
const commands = [
  ["local:validate"],
  ["typecheck"],
  ["lint"],
  ["test"],
  ["build"],
  ["document:extract"]
];

function run(args) {
  const spawnArgs = windows ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")] : args;
  const result = spawnSync(pnpm, spawnArgs, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`CLEAN_VALIDATION_FAILED:${args.join(" ")}:${result.status}`);
}

for (const args of commands) run(args);
const artifact = resolve(root, "output/fixture-import/aic-001-document-extraction.json");
const first = await readFile(artifact);
const firstHash = createHash("sha256").update(first).digest("hex");
run(["document:extract"]);
const second = await readFile(artifact);
const secondHash = createHash("sha256").update(second).digest("hex");
assert.equal(secondHash, firstHash, "document extraction is not deterministic across clean validation passes");
console.log(`Clean validation passed: ${commands.length} gates and deterministic document extraction (${firstHash}).`);
