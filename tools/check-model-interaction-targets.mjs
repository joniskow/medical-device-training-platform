import assert from "node:assert/strict";
import { applySimulationAction, createInitialSimulationState, validateSimulationDefinition } from "../packages/simulation-schema/dist/index.js";
import { validateSimulationModelActions } from "../packages/model-runtime/dist/simulation-actions.js";

const definition = {
  schemaVersion: "simulation-definition.v1",
  simulationDefinitionId: "sim:interaction-targets:v1",
  version: 1,
  model: { modelVersionId: "model-1", manifestHash: "a".repeat(64), componentIds: ["AIC-C01"] },
  components: [{ componentId: "AIC-C01", initialState: "initial", allowedActions: ["activate_target"] }],
  initialState: { currentStepId: "prime", variables: {}, componentStates: { "AIC-C01": "initial" } },
  steps: [{ stepId: "prime", title: "Press Prime", action: { type: "activate_target", componentId: "AIC-C01", targetId: "AIC-C01-PRIME" }, nextStepIds: [], points: 1 }],
  faults: [],
  scoring: { maxScore: 1, passScore: 1, stepPoints: { prime: 1 }, faultPoints: {}, penalties: {} },
  completion: { requiredStepIds: ["prime"], requiredFaultIds: [], terminalStepIds: ["prime"] },
  equivalentPath: { mode: "TEXT_KEYBOARD", instructions: [{ stepId: "prime", text: "Press the Prime button." }], faultInstructions: [] }
};

assert.equal(validateSimulationDefinition(definition).valid, true, "activate_target definitions must validate");
const initial = createInitialSimulationState(definition);
const accepted = applySimulationAction(definition, initial, {
  actionId: "action-1",
  sequence: 1,
  nonce: "action-1",
  type: "activate_target",
  payload: { componentId: "AIC-C01", targetId: "AIC-C01-PRIME" }
});
assert.equal(accepted.accepted, true, "the declared target must advance the procedure");
assert.equal(accepted.scoreDelta, 1);

const wrongTarget = applySimulationAction(definition, initial, {
  actionId: "action-2",
  sequence: 1,
  nonce: "action-2",
  type: "activate_target",
  payload: { componentId: "AIC-C01", targetId: "AIC-C01-READY" }
});
assert.equal(wrongTarget.accepted, false, "an undeclared target must not satisfy the step");
assert.equal(wrongTarget.failure?.code, "ACTION_NOT_ALLOWED");

const binding = {
  modelVersionId: "model-1",
  manifestHash: "a".repeat(64),
  manifest: {
    sourceHash: "a".repeat(64),
    components: [{ componentId: "AIC-C01", interactionTargets: [{ targetId: "AIC-C01-PRIME", nodePath: "Prime", displayName: "Prime" }] }]
  }
};
const invalidTargetDefinition = structuredClone(definition);
invalidTargetDefinition.steps[0].action.targetId = "AIC-C01-NOT-DECLARED";
assert.ok(validateSimulationModelActions(invalidTargetDefinition, binding).some((finding) => finding.code === "MODEL_ACTION_TARGET_INVALID"), "model-bound validation must reject undeclared targets");

console.log("Model interaction target contract passed: declared target actions validate, advance, score, and reject wrong targets.");
