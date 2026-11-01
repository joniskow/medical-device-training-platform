import assert from "node:assert/strict";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const service = {
  async getLearnerModel(tenant, input) {
    assert.equal(tenant.organizationId, "org_fixture");
    if (input.releaseId !== "release-approved" || input.modelVersionId !== "model-approved") return null;
    return { releaseId: input.releaseId, releaseHash: "c".repeat(64), modelVersionId: input.modelVersionId, releaseBindingId: "binding-approved", variantId: input.variantId ?? "full", manifestHash: input.variantId === "mobile" ? "b".repeat(64) : "a".repeat(64), manifestUrl: `https://private.example/${input.variantId ?? "full"}/manifest`, modelUrl: `https://private.example/${input.variantId ?? "full"}/model`, cacheControl: "private, max-age=60" };
  }
};
const server = createJobStatusHttpServer({
  modelAssetService: service,
  authenticator: { authenticate: async (request) => request.headers.authorization === "Bearer learner" ? { subject: "learner", roles: ["learner"] } : null },
  organizationContextResolver: { resolveActiveOrganizations: async () => ["org_fixture"] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = server.address().port;
  const denied = await fetch(`http://127.0.0.1:${port}/api/v1/releases/release-unapproved/model-assets/model-approved`, { headers: { authorization: "Bearer learner" } });
  assert.equal(denied.status, 404);
  const allowed = await fetch(`http://127.0.0.1:${port}/api/v1/releases/release-approved/model-assets/model-approved`, { headers: { authorization: "Bearer learner" } });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.releaseBindingId, "binding-approved");
  assert.equal(body.releaseHash, "c".repeat(64));
  assert.equal(body.variantId, "full");
  assert.equal(body.releaseManifestUrl, undefined);
  assert.equal(body.cacheControl, "private, max-age=60");
  const mobile = await fetch(`http://127.0.0.1:${port}/api/v1/releases/release-approved/model-assets/model-approved?variant=mobile`, { headers: { authorization: "Bearer learner" } });
  assert.equal(mobile.status, 200);
  const mobileBody = await mobile.json();
  assert.equal(mobileBody.variantId, "mobile");
  const invalidVariant = await fetch(`http://127.0.0.1:${port}/api/v1/releases/release-approved/model-assets/model-approved?variant=../unsafe`, { headers: { authorization: "Bearer learner" } });
  assert.equal(invalidVariant.status, 422);
  const malformedPath = await fetch(`http://127.0.0.1:${port}/api/v1/releases/%E0%A4%A/model-assets/model-approved`, { headers: { authorization: "Bearer learner" } });
  assert.equal(malformedPath.status, 404, "malformed release path encoding must fail as an invalid route");
  console.log("Model asset binding passed: tenant-authenticated approved release binding and fail-closed lookup are enforced.");
} finally { await new Promise((resolve) => server.close(resolve)); }
