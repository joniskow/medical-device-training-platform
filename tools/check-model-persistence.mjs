import assert from "node:assert/strict";
import { createPostgresModelAssetService } from "../apps/api/dist/postgres-model-asset-service.js";
import { createPostgresModelSessionService } from "../apps/api/dist/postgres-model-session-service.js";

function fakePool(handler) {
  const client = {
    async query(text, params) { return handler(String(text), params ?? []); },
    release() {}
  };
  return { async connect() { return client; } };
}

const manifest = {
  schemaVersion: "model-manifest.v1",
  format: "glb",
  normalizationStatus: "CANONICAL",
  unitSystem: "meter",
  scaleMeters: 1,
  upAxis: "Y",
  handedness: "right",
  origin: "bounding-box-center",
  forwardAxis: "-Z",
  sourceHash: "a".repeat(64),
  modelVersionId: "model-1",
  releaseBindingId: "releasebind:release-1:model-1",
  sceneNodeCount: 1,
  meshCount: 1,
  materialCount: 0,
  textureCount: 0,
  triangleCount: 1,
  materials: [],
  textures: [],
  variants: [{ variantId: "mobile", sourceHash: "c".repeat(64), modelVersionId: "model-1", releaseBindingId: "releasebind:release-1:model-1", modelBlobKey: "org-1/releases/release-1/models/model-1/mobile.glb", manifestBlobKey: "org-1/releases/release-1/models/model-1/mobile.json" }],
  components: [
    { componentId: "AIC-C02", nodePath: "Controller/Safety Cover", displayName: "Safety Cover", aliases: [], interactionCapabilities: ["select", "rotate"], permittedTransforms: { rotationY: { min: 0, max: Math.PI / 2, step: Math.PI / 2, snap: Math.PI / 2 } } }
  ]
};
const simulationDefinition = {
  schemaVersion: "simulation-definition.v1",
  simulationDefinitionId: "simulation-1",
  version: 1,
  model: { modelVersionId: "model-1", manifestHash: "a".repeat(64), componentIds: ["AIC-C02"] },
  components: [{ componentId: "AIC-C02", initialState: "closed", allowedActions: ["transform_component"] }],
  initialState: { currentStepId: "open-cover", variables: {}, componentStates: { "AIC-C02": "closed" } },
  steps: [{ stepId: "open-cover", title: "Open the safety cover", action: { type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } }, nextStepIds: [], points: 1 }],
  faults: [],
  scoring: { maxScore: 1, passScore: 1, stepPoints: { "open-cover": 1 }, faultPoints: {}, penalties: {} },
  completion: { requiredStepIds: ["open-cover"], requiredFaultIds: [], terminalStepIds: ["open-cover"] },
  equivalentPath: { mode: "TEXT_KEYBOARD", instructions: [{ stepId: "open-cover", text: "Open the safety cover." }], faultInstructions: [] }
};

let updateParams;
const assetPool = fakePool((sql,params) => {
  if(sql.includes("FROM release_manifests")){assert.match(sql,/e\.learner_id=\$3/);assert.match(sql,/e\.course_version_id=r\.course_version_id/);assert.equal(params[2],"learner-1");}
  if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64), manifest: { releaseArtifact: { manifestBlobKey: "org-1/releases/release-1/release-manifest.json" }, content: { model: { modelVersionId: "model-1", manifestHash: "a".repeat(64) } } } }] };
  if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "a".repeat(64), model_blob_key: "org-1/releases/release-1/models/model-1/full.glb", manifest_blob_key: "org-1/releases/release-1/models/model-1/full.json", manifest }] };
  return { rows: [] };
});
const urls = [];
const assetService = createPostgresModelAssetService({
  pool: assetPool,
  storage: { createDownloadUrl: async ({ blobKey }) => { urls.push(blobKey); return `https://private.test/${blobKey}`; } }
});
const asset = await assetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-1" }, { releaseId: "release-1", modelVersionId: "model-1" });
assert.equal(asset?.releaseBindingId, "releasebind:release-1:model-1");
assert.equal(asset?.releaseHash, "b".repeat(64));
assert.equal(asset?.variantId, "full");
assert.equal(asset?.fallbackManifest?.modelVersionId, "model-1");
assert.equal(asset?.fallbackManifest?.releaseBindingId, "releasebind:release-1:model-1");
assert.equal(asset?.fallbackManifest?.sourceHash, "a".repeat(64));
assert.equal(asset?.fallbackManifest?.variants, undefined, "equivalent-path metadata must not expose private variant blob keys");
assert.equal(asset?.releaseManifestUrl, undefined, "Full release manifests must stay private");
assert.deepEqual(urls.sort(), ["org-1/releases/release-1/models/model-1/full.glb", "org-1/releases/release-1/models/model-1/full.json"]);
const mobileAsset = await assetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-2" }, { releaseId: "release-1", modelVersionId: "model-1", variantId: "mobile" });
assert.equal(mobileAsset?.variantId, "mobile");
assert.equal(mobileAsset?.manifestHash, "c".repeat(64));
assert.equal(mobileAsset?.fallbackManifest?.modelVersionId, "model-1");
assert.equal(mobileAsset?.fallbackManifest?.releaseBindingId, "releasebind:release-1:model-1");
assert.equal(mobileAsset?.fallbackManifest?.sourceHash, "c".repeat(64));
assert.deepEqual(urls.slice(2).sort(), ["org-1/releases/release-1/models/model-1/mobile.glb", "org-1/releases/release-1/models/model-1/mobile.json"]);

const mismatchedVariantAssetService = createPostgresModelAssetService({
  pool: fakePool((sql) => {
    if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64) }] };
    if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "a".repeat(64), model_blob_key: "org-1/releases/release-1/models/model-1/full.glb", manifest_blob_key: "org-1/releases/release-1/models/model-1/full.json", manifest: { ...manifest, variants: [{ ...manifest.variants[0], releaseBindingId: "releasebind:other-release:model-1" }] } }] };
    return { rows: [] };
  }),
  storage: { createDownloadUrl: async () => "https://private.test/unexpected" }
});
assert.equal(await mismatchedVariantAssetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-mismatched-variant" }, { releaseId: "release-1", modelVersionId: "model-1", variantId: "mobile" }), null, "a variant descriptor bound to another release must fail closed");

const duplicateVariantAssetService = createPostgresModelAssetService({
  pool: fakePool((sql) => {
    if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64) }] };
    if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "a".repeat(64), model_blob_key: "org-1/releases/release-1/models/model-1/full.glb", manifest_blob_key: "org-1/releases/release-1/models/model-1/full.json", manifest: { ...manifest, variants: [manifest.variants[0], { ...manifest.variants[0], sourceHash: "d".repeat(64) }] } }] };
    return { rows: [] };
  }),
  storage: { createDownloadUrl: async () => "https://private.test/unexpected" }
});
assert.equal(await duplicateVariantAssetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-duplicate-variant" }, { releaseId: "release-1", modelVersionId: "model-1" }), null, "ambiguous variant descriptors must fail closed for every requested asset");

const mismatchedManifestPool = fakePool((sql) => {
  if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64) }] };
  if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "a".repeat(64), model_blob_key: "org-1/releases/release-1/models/model-1/full.glb", manifest_blob_key: "org-1/releases/release-1/models/model-1/full.json", manifest: { ...manifest, sourceHash: "d".repeat(64) } }] };
  return { rows: [] };
});
const mismatchedAssetService = createPostgresModelAssetService({
  pool: mismatchedManifestPool,
  storage: { createDownloadUrl: async () => "https://private.test/unexpected" }
});
assert.equal(await mismatchedAssetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-mismatch" }, { releaseId: "release-1", modelVersionId: "model-1" }), null, "a release binding with a mismatched manifest hash must fail closed");

const malformedBaseAssetService = createPostgresModelAssetService({
  pool: fakePool((sql) => {
    if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64) }] };
    if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "not-a-hash", model_blob_key: "", manifest_blob_key: "org-1/releases/release-1/models/model-1/full.json", manifest }] };
    return { rows: [] };
  }),
  storage: { createDownloadUrl: async () => "https://private.test/unexpected" }
});
assert.equal(await malformedBaseAssetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-malformed" }, { releaseId: "release-1", modelVersionId: "model-1" }), null, "malformed base release asset metadata must fail closed");

const foreignKeyAssetService = createPostgresModelAssetService({
  pool: fakePool((sql) => {
    if (sql.includes("release_manifests")) return { rows: [{ release_id: "release-1", release_hash: "b".repeat(64), manifest: { releaseArtifact: { manifestBlobKey: "org-1/releases/release-1/release-manifest.json" } } }] };
    if (sql.includes("release_model_bindings")) return { rows: [{ model_version_id: "model-1", release_binding_id: "releasebind:release-1:model-1", manifest_hash: "a".repeat(64), model_blob_key: "org-1/source-assets/foreign.glb", manifest_blob_key: "org-1/source-assets/foreign.json", manifest }] };
    return { rows: [] };
  }),
  storage: { createDownloadUrl: async () => "https://private.test/unexpected" }
});
assert.equal(await foreignKeyAssetService.getLearnerModel({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-foreign-key" }, { releaseId: "release-1", modelVersionId: "model-1" }), null, "release asset delivery must reject database bindings outside the release-owned prefix");

let startedRow;
const startPool = fakePool((sql, params) => {
  if(sql.startsWith('SELECT r.release_hash,r.manifest FROM enrollments e'))return {rows:[{release_hash:'b'.repeat(64),manifest:{content:{}}}]};
  if (sql.includes("FOR SHARE OF e,r,p FOR UPDATE OF a")) return {rows:[{enrollment_id:"enrollment-1",release_id:"release-1",activity_id:"activity-1"}],rowCount:1};
  if (sql.includes("idempotency_key") && sql.includes("FROM simulation_sessions")) return { rows: startedRow ? [startedRow] : [] };
  if (sql.includes("FROM release_model_bindings")) return { rows: [{ release_binding_id: "releasebind:release-1:model-1", model_version_id: "model-1", manifest }] };
  if (sql.includes("FROM enrollments")) return { rows: [{ enrollment_id: "enrollment-1" }] };
  if (sql.includes("FROM activities")) return { rows: [{ activity_id: "activity-1" }] };
  if (sql.includes("FROM certification_policies")) return { rows: [{ policy_id: "policy-1", version: 3 }] };
  if (sql.includes("FROM simulation_attempts")) return { rows: [{ simulation_attempt_id: "attempt-1" }] };
  if (sql.includes("FROM simulation_definitions")) return { rows: [{ simulation_definition_id: "simulation-1", definition: simulationDefinition }] };
  if (sql.includes("INSERT INTO simulation_sessions")) {
    startedRow = {
      simulation_session_id: "simulation-session-1", release_id: "release-1", activity_id: "activity-1", simulation_definition_id: "simulation-1",
      enrollment_id: "enrollment-1", attempt_id: "attempt-1", policy_id: "policy-1", policy_version: 3, release_binding_id: "releasebind:release-1:model-1", learner_id: "learner-1",
      model_version_id: "model-1", expires_at: new Date(Date.now() + 60_000), state: JSON.parse(params[4]), start_request_hash: params[15]
    };
    return { rows: [startedRow] };
  }
  return { rows: [] };
});
const sessionServiceForStart = createPostgresModelSessionService({ pool: startPool });
const startRequest = { releaseId: "release-1", activityId: "activity-1", simulationDefinitionId: "simulation-1", modelVersionId: "model-1", enrollmentId: "enrollment-1", attemptId: "attempt-1", policyId: "policy-1" };
const started = await sessionServiceForStart.start({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-start" }, startRequest, "start-1");
assert.equal(started.sessionId, "simulation-session-1");
assert.equal(started.state.nextSequence, 1);
assert.deepEqual(started.allowedActions, ["transform_component"]);
const startedAgain = await sessionServiceForStart.start({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-start-2" }, startRequest, "start-1");
assert.equal(startedAgain.sessionId, started.sessionId, "the same start idempotency key must return one session");
await assert.rejects(
  sessionServiceForStart.start({ organizationId: "org-1", actorId: "learner-2", correlationId: "corr-start-3" }, startRequest, "start-1"),
  /IDEMPOTENCY_KEY_REUSED/
);

let state = {
  releaseBindingId: "releasebind:release-1:model-1",
  modelVersionId: "model-1",
  sequence: 0,
  nextSequence: 1,
  transforms: { "AIC-C02": { rotationY: 0, translationX: 0 } },
  scorePoints: 0,
  completed: false,
  activeStepId: "open-cover",
  activeStepTitle: "Open the safety cover",
  allowedActions: ["transform_component"],
  simulationState: { currentStepId: "open-cover", variables: {}, componentStates: { "AIC-C02": "closed" }, completedStepIds: [], resolvedFaultIds: [], score: 0, nextSequence: 1, acceptedActionIds: [], acceptedNonces: [] }
};
let storedAction;
const sessionPool = fakePool((sql, params) => {
  if(sql.includes('FROM enrollments e'))return {rows:[{enrollment_id:'enrollment-1',manifest:{content:{policy:{}}}}]};
  if (sql.includes("FOR SHARE OF e,r,p FOR UPDATE OF a")) return {rows:[{enrollment_id:"enrollment-1",release_id:"release-1",activity_id:"activity-1"}],rowCount:1};
  if (sql.includes("UPDATE simulation_attempts a")) return {rows:[{simulation_attempt_id:"attempt-1",enrollment_id:"enrollment-1",activity_id:"activity-1",policy_id:"policy-1"}],rowCount:1};
  if (sql.includes("FROM simulation_sessions")) return { rows: [{ state, next_sequence: state.nextSequence, expires_at: new Date(Date.now() + 60_000), learner_id: "learner-1", status: "ACTIVE", release_id: "release-1", policy_id: "policy-1", simulation_definition_id: "simulation-1" }] };
  if (sql.includes("FROM simulation_actions")) return storedAction?.request?.clientActionId === params[2] ? { rows: [{ payload: storedAction }] } : { rows: [] };
  if (sql.includes("SELECT binding.release_binding_id")) return { rows: [{ release_binding_id: "releasebind:release-1:model-1", manifest }] };
  if (sql.includes("FROM release_model_bindings")) return { rows: [{ manifest }] };
  if (sql.includes("FROM simulation_definitions")) return { rows: [{ definition: simulationDefinition }] };
  if (sql.includes("UPDATE simulation_sessions")) { updateParams = params; state = JSON.parse(params[2]); return { rows: [] }; }
  if (sql.includes("INSERT INTO simulation_actions")) { storedAction = JSON.parse(params[6]); return { rows: [] }; }
  return { rows: [] };
});
const sessionService = createPostgresModelSessionService({ pool: sessionPool });
const unauthenticatedAction = await sessionService.submit(
  { organizationId: "org-1", correlationId: "corr-no-actor" },
  "session-1",
  { clientActionId: "action-no-actor", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 1, type: "request_hint" },
  "action-no-actor"
);
assert.equal(unauthenticatedAction.status, "expired_session");
assert.equal(await sessionService.resume({ organizationId: "org-1", correlationId: "corr-no-actor" }, "session-1", { releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", nextSequence: 1 }), null);
const selection = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-select" },
  "session-1",
  { clientActionId: "action-select", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 1, type: "select_component", componentId: "AIC-C02", source: "COMPONENT_LIST" },
  "action-select"
);
assert.equal(selection.status, "accepted");
assert.equal(selection.state?.selectedComponentId, "AIC-C02");
assert.equal(selection.state?.scorePoints, 0, "selection must not score a transform step");
assert.equal(selection.state?.activeStepTitle, "Open the safety cover");
assert.deepEqual(selection.state?.allowedActions, ["transform_component"]);
assert.equal(selection.nextSequence, 2);
const selectionSourceReuse = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-select-source-reuse" },
  "session-1",
  { clientActionId: "action-select", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 1, type: "select_component", componentId: "AIC-C02", source: "CANVAS" },
  "action-select"
);
assert.equal(selectionSourceReuse.status, "invalid_precondition", "reusing an action ID with a different selection source must not replay the original evidence");
const action = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-2" },
  "session-1",
  { clientActionId: "action-1", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 2, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } },
  "action-1"
);
assert.equal(action.status, "accepted", JSON.stringify(action));
assert.equal(action.nextSequence, 3);
assert.equal(action.state?.transforms["AIC-C02"].rotationY, Math.PI / 2);
assert.equal(action.state?.scorePoints, 1);
assert.equal(action.state?.completed, true);
assert.deepEqual(action.state?.allowedActions, []);
assert.equal(updateParams?.[3], 3);
const replay = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-3" },
  "session-1",
  { clientActionId: "action-1", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 2, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } },
  "action-1"
);
assert.equal(replay.status, "accepted");
const stale = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-stale" },
  "session-1",
  { clientActionId: "action-stale", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 1, type: "request_hint" },
  "action-stale"
);
assert.equal(stale.status, "stale_sequence");
assert.equal(stale.retryable, undefined, "stale actions must require resume instead of replaying an old envelope");
const reused = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-4" },
  "session-1",
  { clientActionId: "action-1", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 2, type: "reset_component", componentId: "AIC-C02" },
  "action-1"
);
assert.equal(reused.status, "invalid_precondition");
const outOfBounds = await sessionService.submit(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-5" },
  "session-1",
  { clientActionId: "action-2", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 3, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI * 2 } },
  "action-2"
);
assert.equal(outOfBounds.status, "invalid_precondition");
state.scorePoints = 999;
state.completed = false;
const resumed = await sessionService.resume(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-resume" },
  "session-1",
  { releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", nextSequence: 3 }
);
assert.equal(resumed?.status, "accepted");
assert.equal(resumed?.state?.scorePoints, 1, "resume must recompute score from the simulation state");
assert.equal(resumed?.state?.completed, true, "resume must recompute completion from the simulation state");
state.nextSequence = 100;
const malformedStateResume = await sessionService.resume(
  { organizationId: "org-1", actorId: "learner-1", correlationId: "corr-malformed-state" },
  "session-1",
  { releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", nextSequence: 3 }
);
assert.equal(malformedStateResume?.status, "version_mismatch", "malformed persisted sequence state must fail closed");
// A direct session action must obey the same physical dependency as the 3D UI.
manifest.components.push({ componentId: "HANDLE", nodePath: "Controller/Handle", displayName: "Handle", aliases: [], interactionCapabilities: ["select", "open", "rotate"], permittedTransforms: { rotationY: { min: 0, max: Math.PI / 2, step: Math.PI / 4 } }, interactionTargets: [{ targetId: "HANDLE-LIFT", nodePath: "Controller/Handle", displayName: "Handle", interactionType: "open", openRotationRadians: Math.PI / 2, closeRequires: { componentId: "AIC-C02", transform: "rotationY", value: 0, message: "Close the cover first." } }] });
manifest.components[0].interactionTargets = [{ targetId: "COVER", nodePath: "Controller/Safety Cover", displayName: "Cover", interactionType: "open", openRotationRadians: Math.PI / 2, openRequires: { componentId: "HANDLE", transform: "rotationY", value: Math.PI / 2, message: "Raise the handle first." } }];
simulationDefinition.model.componentIds.push("HANDLE");
simulationDefinition.components.push({ componentId: "HANDLE", initialState: "closed", allowedActions: ["transform_component"] });
simulationDefinition.initialState.componentStates.HANDLE = "closed";
state = { releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", sequence: 0, nextSequence: 1, transforms: { "AIC-C02": { rotationY: 0, translationX: 0 }, HANDLE: { rotationY: 0, translationX: 0 } }, scorePoints: 0, completed: false, allowedActions: ["transform_component"], simulationState: { currentStepId: "open-cover", variables: {}, componentStates: { "AIC-C02": "closed", HANDLE: "closed" }, completedStepIds: [], resolvedFaultIds: [], score: 0, nextSequence: 1, acceptedActionIds: [], acceptedNonces: [] } };
storedAction = undefined;
const lockedAction = { clientActionId: "locked-cover", releaseBindingId: "releasebind:release-1:model-1", modelVersionId: "model-1", expectedSequence: 1, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } };
const locked = await sessionService.submit({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-locked" }, "session-1", lockedAction, "locked-cover");
assert.equal(locked.status, "invalid_precondition", JSON.stringify(locked));
assert.equal(locked.feedback, "Raise the handle first.");
assert.equal(state.nextSequence, 1, "A blocked action must not advance the session");
state.transforms["AIC-C02"].rotationY = Math.PI / 2;
state.transforms.HANDLE.rotationY = Math.PI / 2;
const partialHandle = await sessionService.submit({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-partial-handle" }, "session-1", { ...lockedAction, clientActionId: "partial-handle", componentId: "HANDLE", transform: { rotationY: Math.PI / 4 } }, "partial-handle");
assert.equal(partialHandle.status, "invalid_precondition", JSON.stringify(partialHandle));
assert.equal(partialHandle.feedback, "Close the cover first.", "A partly lowered handle must report its own interlock");
assert.equal(state.nextSequence, 1, "A blocked partial movement must not advance the session");
state.transforms["AIC-C02"].rotationY = 0;
state.transforms.HANDLE.rotationY = Math.PI / 2;
const unlocked = await sessionService.submit({ organizationId: "org-1", actorId: "learner-1", correlationId: "corr-unlocked" }, "session-1", { ...lockedAction, clientActionId: "unlocked-cover" }, "unlocked-cover");
assert.equal(unlocked.status, "accepted", JSON.stringify(unlocked));
console.log("Model persistence passed: approved release binding, private URLs, idempotent tenant-scoped session start, bounded transforms, and authoritative sequence advancement are enforced.");
