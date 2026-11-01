import assert from "node:assert/strict";
import { validateAuthoritativeActionResult } from "../apps/web/dist/model-authority.js";

const manifest = {
  schemaVersion: "model-manifest.v1",
  format: "glb",
  sourceHash: "a".repeat(64),
  modelVersionId: "model-1",
  releaseBindingId: "binding-1",
  normalizationStatus: "CANONICAL",
  unitSystem: "meter",
  scaleMeters: 1,
  upAxis: "Y",
  handedness: "right",
  origin: "bounding-box-center",
  forwardAxis: "-Z",
  sceneNodeCount: 1,
  meshCount: 1,
  materialCount: 0,
  textureCount: 0,
  triangleCount: 1,
  materials: [],
  textures: [],
  components: [{ componentId: "AIC-C01", nodePath: "Controller/Panel", displayName: "Panel", aliases: [], interactionCapabilities: ["select"] }]
};
const state = { releaseBindingId: "binding-1", modelVersionId: "model-1", sequence: 1, nextSequence: 2, transforms: { "AIC-C01": { rotationY: 0, translationX: 0 } }, scorePoints: 0, completed: false, allowedActions: ["select_component"] };
const malformedAccepted = validateAuthoritativeActionResult(manifest, { status: "accepted", clientActionId: "a1", nextSequence: 2, feedback: "accepted" }, 1);
assert.equal(malformedAccepted.status, "version_mismatch", "an accepted response without authoritative state must fail closed");
const validRejected = validateAuthoritativeActionResult(manifest, { status: "invalid_precondition", clientActionId: "a2", nextSequence: 2, feedback: "Try again." }, 1);
assert.equal(validRejected.status, "invalid_precondition", "a rejected response may intentionally omit state");
const validAccepted = validateAuthoritativeActionResult(manifest, { status: "accepted", clientActionId: "a3", nextSequence: 2, state, feedback: "accepted" }, 0);
assert.equal(validAccepted.status, "accepted");
console.log("Model authority contract passed: accepted responses require a valid non-stale authoritative state.");
