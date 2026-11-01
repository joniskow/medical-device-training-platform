import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(resolve(root, relative), "utf8"));
const observability = await readJson("config/observability-contract.json");
const matrix = await readJson("config/e4-device-matrix.json");
const packageJson = await readJson("package.json");

assert.equal(observability.schemaVersion, "observability-contract.v1");
assert.equal(observability.correlation.requestHeader, "x-correlation-id");
assert.equal(observability.correlation.responseHeader, "x-correlation-id");
assert.ok(observability.correlation.propagation.includes("ServiceBus.correlationId"));
assert.ok(observability.forbiddenDimensions.includes("sourceText"));
assert.ok(observability.dashboards.length >= 4);
assert.ok(observability.alerts.includes("dead-letter-growth"));

assert.equal(matrix.physicalAcceptance.schemaVersion, "e4-physical-evidence.v1");
assert.equal(matrix.physicalAcceptance.required, true);
assert.equal(matrix.physicalAcceptance.profiles.length, 3);
assert.deepEqual(new Set(matrix.physicalAcceptance.profiles.map((profile) => profile.id)), new Set(["ios-safari-webgl2", "android-chrome-webgl2", "firefox-webgl2"]));
for (const profile of matrix.physicalAcceptance.profiles) {
  assert.ok(profile.checks.includes("interactive-within-5000ms"));
  assert.ok(profile.checks.includes("minimum-30-fps"));
  assert.ok(profile.checks.includes("context-loss"));
}
assert.equal(matrix.physicalAcceptance.acceptance.interactiveWithinMs, 5000);
assert.equal(matrix.physicalAcceptance.acceptance.minimumFps, 30);

for (const path of [
  "docs/operations-runbook.md",
  "docs/device-performance-validation.md",
  "docs/clean-validation.md"
]) await readFile(resolve(root, path), "utf8");

assert.ok(packageJson.scripts["clean:validate"]);
assert.ok(packageJson.scripts["observability:validate"]);
console.log("Operational readiness contract passed: correlation propagation, safe telemetry dimensions, dashboard/alert requirements, physical evidence profiles, runbooks, and clean-validation entry points are present.");
