import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(resolve(root, "config/pilot-readiness.json"), "utf8"));
assert.equal(config.schemaVersion, "pilot-readiness.v1");
assert.equal(config.deploymentBoundary, "personal-azure");
assert.equal(config.ai.providerBoundary, "azure-openai-foundry");
assert.equal(config.ai.retrieval, "postgres-full-text-pgvector");
assert.equal(config.deviceBaseline.graphics, "webgl2");
assert.equal(config.deviceBaseline.interactiveWithinSeconds, 5);
assert.equal(config.deviceBaseline.minimumFps, 30);
assert.equal(config.deviceBaseline.non3dAccessibility, "wcag-2.2-aa");
assert.equal(config.deviceBaseline.equivalentPathRequired, true);
assert.equal(config.privacy.noPhi, true);
assert.equal(config.privacy.discoveryDefault, "off");
assert.equal(config.privacy.rightsAttestationRequired, true);
assert.equal(config.recovery.rpoMinutes, 15);
assert.equal(config.credential.excludesLicensureAccreditation, true);
assert.equal(config.credential.onlineVerificationOnly, true);
assert.equal(config.ai.ocrPath, "worker-local-poppler-tesseract-english-v1");
assert.equal(config.ai.transcriptionPath, "disabled-for-pilot");
assert.equal(config.deviceBaseline.profiles.length, 3);
assert.equal(config.privacy.retentionDays, 365);
assert.equal(config.privacy.legalHoldOwner, "security-privacy-legal-owner");
assert.equal(config.economics.monthlyBudgetUsd, 500);
assert.equal(config.economics.maxConcurrentJobs, 4);
assert.equal(config.economics.maxAiTokensPerRun, 4000);
assert.equal(config.economics.alertThresholdPercent, 80);
assert.equal(config.recovery.restoreRegion, "southeastus");
assert.match(config.credential.issuerWording, /^This credential is an organization-issued platform certification/);
assert.match(config.credential.issuerWording, /not a professional license, accreditation, regulatory approval/);

const pending = [
  ["ai.deployment", config.ai.deployment], ["ai.region", config.ai.region], ["ai.model", config.ai.model],
  ["ai.apiVersion", config.ai.apiVersion], ["ai.ocrPath", config.ai.ocrPath], ["deviceBaseline.profiles", config.deviceBaseline.profiles],
  ["privacy.retentionDays", config.privacy.retentionDays], ["privacy.legalHoldOwner", config.privacy.legalHoldOwner],
  ["economics.monthlyBudgetUsd", config.economics.monthlyBudgetUsd], ["economics.maxConcurrentJobs", config.economics.maxConcurrentJobs],
  ["economics.maxAiTokensPerRun", config.economics.maxAiTokensPerRun], ["economics.alertThresholdPercent", config.economics.alertThresholdPercent],
  ["recovery.restoreRegion", config.recovery.restoreRegion], ["credential.issuerWordingApproved", config.credential.issuerWordingApproved ? "approved" : null]
].filter(([, value]) => value === null || (Array.isArray(value) && value.length === 0));

if (process.argv.includes("--strict") && pending.length > 0) throw new Error(`PILOT_SIGNOFFS_PENDING:${pending.map(([name]) => name).join(",")}`);
console.log(`Pilot readiness invariants passed; pending sign-offs=${pending.length}.`);
if (pending.length > 0) console.log(`Pending: ${pending.map(([name]) => name).join(", ")}`);
