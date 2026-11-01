import assert from "node:assert/strict";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`REAL_TOKEN_SMOKE_CONFIGURATION_MISSING:${name}`);
  return value;
}

const baseUrl = required("REAL_API_BASE_URL").replace(/\/$/, "");
const token = required("REAL_ACCESS_TOKEN");
const jobId = required("REAL_JOB_ID");
const response = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
  headers: { authorization: `Bearer ${token}` }
});
assert.equal(response.status, 200, `status smoke returned HTTP ${response.status}`);
const body = await response.json();
assert.equal(typeof body.jobId, "string");
assert.equal(body.jobId, jobId);
assert.equal(typeof body.state, "string");
assert.equal(typeof body.tenantOrganizationId, "undefined", "safe projection must not expose organization scope");

if (process.env.REAL_RUN_RETRY === "true") {
  const retryJobId = process.env.REAL_RETRY_JOB_ID?.trim();
  if (!retryJobId) throw new Error("REAL_TOKEN_SMOKE_CONFIGURATION_MISSING:REAL_RETRY_JOB_ID");
  const retry = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(retryJobId)}/retry`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "real-token smoke retry" })
  });
  assert.ok([200, 409].includes(retry.status), `retry smoke returned unexpected HTTP ${retry.status}`);
}

console.log(`Real-token smoke passed: authenticated status read for ${jobId}; retry=${process.env.REAL_RUN_RETRY === "true" ? "requested" : "not requested"}.`);
