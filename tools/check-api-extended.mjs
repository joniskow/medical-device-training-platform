import assert from "node:assert/strict";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const uploadSessionService = {
  create: async (_tenant, body) => ({ session: { uploadSessionId: "upload:test", blobKey: "org_fixture/uploads/test/file.pdf", expiresAt: new Date(Date.now() + 60_000).toISOString(), contentType: body.contentType, sizeBytes: body.sizeBytes }, uploadUrl: "https://blob.example/upload?sig=test", expiresInSeconds: 60 }),
  complete: async () => ({ session: { uploadSessionId: "upload:test", status: "COMPLETED" }, assetVersion: { assetVersionId: "assetv:test", state: "READY_FOR_SCAN" } }),
  get: async () => null,
  cancel: async () => true
};
let draftBody;
const draftService = { generate: async (_tenant, body) => (draftBody=body,{ aiRunId: "ai:test", result: { status: "DRAFT", output: { schemaVersion: "course-draft.v1" } } }) };
const server = createJobStatusHttpServer({
  uploadSessionService,
  draftService,
  authenticator: { authenticate: async (request) => request.headers.authorization === "Bearer operator" ? { subject: "user_fixture", roles: ["operator"] } : null },
  organizationContextResolver: { resolveActiveOrganizations: async () => ["org_fixture"] },
  statusService: { get: async () => null, retry: async () => null },
  allowedOrigins: ["https://training.example.test"]
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const headers = { authorization: "Bearer operator", "content-type": "application/json" };
  const create = await fetch(`http://127.0.0.1:${port}/api/v1/organizations/org_fixture/assets/upload-sessions`, { method: "POST", headers, body: JSON.stringify({ sourceType: "pdf", fileName: "manual.pdf", contentType: "application/pdf", sizeBytes: 10, sha256: "a".repeat(64) }) });
  assert.equal(create.status, 201);
  const complete = await fetch(`http://127.0.0.1:${port}/api/v1/upload-sessions/upload:test/complete`, { method: "POST", headers, body: JSON.stringify({ blobKey: "org_fixture/uploads/test/file.pdf", contentType: "application/pdf", sizeBytes: 10, sha256: "a".repeat(64) }) });
  assert.equal(complete.status, 200);
  const draft = await fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test/generate-draft`, { method: "POST", headers, body: JSON.stringify({ sourceArtifactIds: ["assetv:test"],mediaAssetVersionIds:["media:test"],videoLesson:true }) });
  assert.equal(draft.status, 200);
  assert.equal((await draft.json()).result.status, "DRAFT");
  assert.deepEqual(draftBody.mediaAssetVersionIds,['media:test']);
  assert.equal(draftBody.videoLesson, true);
  for(const mediaAssetVersionIds of ['wrong',['bad id'],['same','same'],Array.from({length:33},(_,i)=>'media:'+i)]){
    const response=await fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test/generate-draft`,{method:'POST',headers,body:JSON.stringify({sourceArtifactIds:['assetv:test'],mediaAssetVersionIds})});
    assert.equal(response.status,422);
  }
  console.log("Extended API passed: authenticated upload-session creation/completion and source-grounded draft route.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

