import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const tenant = { organizationId: "org_http_test", actorId: "operator-1", correlationId: "corr_http_test" };
const retryable = {
  jobId: "job_http_retry",
  jobType: "asset.process",
  state: "DEAD_LETTERED",
  attempt: 3,
  maxAttempts: 3,
  createdAt: "2026-10-22T20:00:00.000Z",
  updatedAt: "2026-10-22T20:00:01.000Z",
  availableAt: "2026-10-22T20:00:01.000Z",
  errorClass: "RETRYABLE",
  lastFailure: { class: "RETRYABLE", code: "TEMPORARY", message: "temporary" },
  canRetry: true,
  nextAction: "RETRY"
};

const records = new Map([[retryable.jobId, retryable]]);
const statusService = {
  async get(_tenant, jobId) { return records.get(jobId) ?? null; },
  async retry(_tenant, jobId, _request) {
    const current = records.get(jobId);
    if (!current || !current.canRetry) return null;
    const updated = { ...current, state: "QUEUED", canRetry: false, nextAction: "WAIT", attempt: 1 };
    records.set(jobId, updated);
    return updated;
  }
};
const authenticator = {
  async authenticate(request) {
    const header = request.headers.authorization;
    if (header === "Bearer operator-token") return { subject: "operator-1", roles: ["operator"] };
    if (header === "Bearer learner-token") return { subject: "learner-1", roles: ["learner"] };
    if (header === "Bearer multi-token") return { subject: "multi-1", roles: ["learner"] };
    return null;
  }
};
const organizationContextResolver = {
  async resolveActiveOrganizations(subject) {
    if (subject === "operator-1" || subject === "learner-1") return [tenant.organizationId];
    if (subject === "multi-1") return ["org_http_a", "org_http_b"];
    return [];
  }
};
const server = createJobStatusHttpServer({ statusService, authenticator, organizationContextResolver, allowedOrigins: ["https://training.example.test"] });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

function call(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: options.headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

try {
  const unauthorized = await call("GET", "/api/v1/jobs/job_http_retry");
  assert.equal(unauthorized.status, 401);

  const noMembershipServer = createJobStatusHttpServer({
    statusService,
    authenticator: { async authenticate() { return { subject: "unassigned", roles: ["learner"] }; } },
    organizationContextResolver,
    allowedOrigins: ["https://training.example.test"]
  });
  await new Promise((resolve) => noMembershipServer.listen(0, "127.0.0.1", resolve));
  const noMembershipAddress = noMembershipServer.address();
  const noMembershipPort = typeof noMembershipAddress === "object" && noMembershipAddress ? noMembershipAddress.port : 0;
  const noMembership = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: noMembershipPort, path: "/api/v1/jobs/job_http_retry", method: "GET", headers: { authorization: "Bearer unassigned-token" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(noMembership.status, 403);
  assert.equal(JSON.parse(noMembership.body).error.code, "ORGANIZATION_MEMBERSHIP_REQUIRED");
  await new Promise((resolve) => noMembershipServer.close(resolve));
  assert.equal(JSON.parse(unauthorized.body).error.code, "AUTHENTICATION_REQUIRED");

  const multipleMembership = await call("GET", "/api/v1/jobs/job_http_retry", { headers: { authorization: "Bearer multi-token" } });
  assert.equal(multipleMembership.status, 409);
  assert.equal(JSON.parse(multipleMembership.body).error.code, "ORGANIZATION_CONTEXT_REQUIRED");

  const learner = await call("GET", "/api/v1/jobs/job_http_retry", { headers: { authorization: "Bearer learner-token", origin: "https://training.example.test" } });
  assert.equal(learner.status, 200);
  assert.match(learner.headers["x-correlation-id"], /^corr:/);
  assert.equal(learner.headers["access-control-allow-origin"], "https://training.example.test");
  assert.equal(learner.headers["x-content-type-options"], "nosniff");
  assert.equal(JSON.parse(learner.body).jobId, "job_http_retry");
  assert.equal("payload" in JSON.parse(learner.body), false);

  const suppliedCorrelation = await call("GET", "/api/v1/jobs/job_http_retry", { headers: { authorization: "Bearer learner-token", "x-correlation-id": "support:case-123" } });
  assert.equal(suppliedCorrelation.status, 200);
  assert.equal(suppliedCorrelation.headers["x-correlation-id"], "support:case-123");

  const forbidden = await call("POST", "/api/v1/jobs/job_http_retry/retry", { headers: { authorization: "Bearer learner-token", "content-type": "application/json" }, body: JSON.stringify({ reason: "try" }) });
  assert.equal(forbidden.status, 403);

  const unsupported = await call("POST", "/api/v1/jobs/job_http_retry/retry", { headers: { authorization: "Bearer operator-token" }, body: JSON.stringify({ reason: "missing content type" }) });
  assert.equal(unsupported.status, 415);

  const invalid = await call("POST", "/api/v1/jobs/job_http_retry/retry", { headers: { authorization: "Bearer operator-token", "content-type": "application/json" }, body: JSON.stringify({ reason: "" }) });
  assert.equal(invalid.status, 422);

  const retried = await call("POST", "/api/v1/jobs/job_http_retry/retry", { headers: { authorization: "Bearer operator-token", "content-type": "application/json" }, body: JSON.stringify({ reason: "Provider recovered; replay source." }) });
  assert.equal(retried.status, 200);
  assert.match(retried.headers["x-correlation-id"], /^corr:/);
  assert.equal(JSON.parse(retried.body).state, "QUEUED");
  assert.equal(JSON.parse(retried.body).nextAction, "WAIT");

  const preflight = await call("OPTIONS", "/api/v1/jobs/job_http_retry/retry", { headers: { origin: "https://training.example.test" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-methods"], "GET, PUT, POST, DELETE, OPTIONS");
  assert.ok(preflight.headers['access-control-allow-headers'].includes('X-Organization-Id'));
  assert.equal(preflight.headers["access-control-allow-origin"], "https://training.example.test");

  console.log("Job status HTTP API passed: authentication, role enforcement, validation, safe projection, CORS allowlist, and retry route.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
