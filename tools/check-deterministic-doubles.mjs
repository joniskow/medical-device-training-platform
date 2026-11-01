import assert from "node:assert/strict";
import {
  createDeterministicAiGateway,
  createDeterministicAssetProcessor,
  createDeterministicPolicyEvaluator,
  createDeterministicSimulation,
  createInMemoryJobDispatcher,
  createInMemoryNotifications,
  createInMemoryObjectStorage
} from "../tests/doubles/deterministic-adapters.mjs";

const tenant = { organizationId: "org_fixture", correlationId: "corr_fixture" };
const asset = createDeterministicAssetProcessor();
const result = await asset.process({ inputAssetVersionId: "assetv_fixture", sourceType: "pdf", blobKey: "manual.pdf", sha256: "sha_fixture" });
assert.equal(result.status, "READY");
assert.equal(result.outputArtifactIds.length, 1);

const ai = await createDeterministicAiGateway().execute({
  operation: "generate_course_draft",
  input: { fixture: true },
  sourceArtifactIds: result.outputArtifactIds,
  outputSchemaVersion: "course-draft.v1",
  tokenBudget: 1000,
  tenant
});
assert.equal(ai.status, "DRAFT");
assert.deepEqual(ai.citations, result.outputArtifactIds);

const storage = createInMemoryObjectStorage();
assert.match(await storage.createDownloadUrl({ blobKey: "manual.pdf" }), /^memory:\/\/download/);
const dispatcher = createInMemoryJobDispatcher();
await dispatcher.enqueue({ jobId: "job_fixture" });
assert.equal(dispatcher.jobs.length, 1);
const notifications = createInMemoryNotifications();
await notifications.create({ idempotencyKey: "notice_fixture" });
assert.equal(notifications.notifications.length, 1);

const simulation = await createDeterministicSimulation().applyAction({
  action: { actionId: "action_fixture", sequence: 0, nonce: "nonce_fixture", type: "select_component", payload: {} }
});
assert.equal(simulation.accepted, true);
assert.equal((await createDeterministicPolicyEvaluator().evaluate({ evidence: { score: 80 } })).passed, true);

console.log("Deterministic adapter doubles passed.");
