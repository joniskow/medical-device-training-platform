import assert from "node:assert/strict";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const calls = [];
const reviewStore = {
  createRevision:async input=>{calls.push({type:'revision',input});return {courseId:'course',courseVersionId:'course:revision'};},
  saveDraft: async (input) => {
    if (input.revision !== 1) throw new Error("COURSE_VERSION_STALE");
    calls.push({ type: "edit", input });
    return { revision: 2 };
  },
  get: async (_tenant, courseVersionId) => ({ courseVersion: { courseVersionId, revision: 1, status: "IN_REVIEW", content: { schemaVersion: "course-draft.v1" }, createdBy: "author" }, decisions: [] }),
  recordDecision: async (input) => { calls.push({ type: "review", input }); return { decisionId: "review:test", ...input, organizationId: "org_fixture", actorId: input.tenant.actorId, createdAt: new Date().toISOString() }; },
  publish: async (input) => { calls.push({ type: "publish", input }); return { releaseId: "release:test", organizationId: "org_fixture", courseVersionId: input.courseVersionId, status: "PUBLISHED", releaseHash: "a".repeat(64), manifest: { schemaVersion: "release-manifest.v1" }, publishedBy: input.tenant.actorId, createdAt: new Date().toISOString() }; }
};

const server = createJobStatusHttpServer({
  courseReviewStore: reviewStore,
  authenticator: { authenticate: async (request) => {
    if (request.headers.authorization === "Bearer learner") return { subject: "learner", roles: ["learner"] };
    if (request.headers.authorization === "Bearer reviewer") return { subject: "reviewer", roles: ["reviewer"] };
    if (request.headers.authorization === "Bearer publisher") return { subject: "publisher", roles: ["publisher"] };
    if (request.headers.authorization === "Bearer author") return { subject: "author", roles: ["author"] };
    return null;
  } },
  organizationContextResolver: { resolveActiveOrganizations: async () => ["org_fixture"] },
  statusService: { get: async () => null, retry: async () => null }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = server.address().port;
  const draftUrl = `http://127.0.0.1:${port}/api/v1/course-versions/course:test`;
  assert.equal((await fetch(draftUrl, { headers: { authorization: "Bearer learner" } })).status, 403);
  assert.equal((await fetch(draftUrl, { headers: { authorization: "Bearer reviewer" } })).status, 200);
  const edit = (token, revision) => fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ revision, content: { schemaVersion: "course-draft.v1", title: "Edited" } })
  });
  assert.equal((await edit("reviewer", 1)).status, 403);
  assert.equal((await edit("author", 0)).status, 409);
  const saved = await edit("author", 1);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: 2 });
  assert.equal(calls[0].input.tenant.organizationId, "org_fixture");
  const review = await fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test`, {
    method: "POST",
    headers: { authorization: "Bearer reviewer", "content-type": "application/json", "idempotency-key": "review:test" },
    body: JSON.stringify({ targetType: "COURSE", targetId: "course:test", decision: "APPROVE", rationale: "Reviewed", revision: 1 })
  });
  assert.equal(review.status, 201);

  const authorPublish = await fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test/publish`, {
    method: "POST",
    headers: { authorization: "Bearer author", "content-type": "application/json", "idempotency-key": "publish:author" },
    body: "{}"
  });
  assert.equal(authorPublish.status, 403);

  const publish = await fetch(`http://127.0.0.1:${port}/api/v1/course-versions/course:test/publish`, {
    method: "POST",
    headers: { authorization: "Bearer publisher", "content-type": "application/json", "idempotency-key": "publish:test" },
    body: "{}"
  });
  assert.equal(publish.status, 200);
  assert.deepEqual(calls.map((call) => call.type), ["edit", "review", "publish"]);
  const revise=(token,body)=>fetch(draftUrl+'/revise',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':'revision:test'},body:JSON.stringify(body)});
  assert.equal((await revise('learner',{reason:'Update procedure'})).status,403);
  assert.equal((await revise('publisher',{reason:'Update procedure'})).status,403);
  assert.equal((await revise('author',{reason:'Update procedure',organizationId:'foreign'})).status,422);
  assert.equal((await revise('author',{reason:'Update procedure'})).status,201);
  const revisionCall=calls.find(call=>call.type==='revision');assert.equal(revisionCall.input.tenant.organizationId,'org_fixture');assert.equal(revisionCall.input.idempotencyKey,'revision:test');
  console.log("Course review HTTP passed: authenticated review, author publish denial, publisher release path, and idempotency headers.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
