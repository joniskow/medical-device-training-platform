import assert from "node:assert/strict";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const calls = [];
const session = {
  async start(tenant, request, key) { calls.push({ tenant, request, key }); return { sessionId: "session-1", ...request, policyVersion: 3, releaseBindingId: "binding-1", expiresAt: new Date(Date.now() + 60_000).toISOString(), nextSequence: 1, allowedActions: ["select_component"], state: { releaseBindingId: "binding-1", modelVersionId: request.modelVersionId, sequence: 0, nextSequence: 1, transforms: {}, scorePoints: 0, completed: false, activeStepId: "step-1", activeStepTitle: "Select the panel", allowedActions: ["select_component"] } }; },
  async submit(tenant, sessionId, action, key) { calls.push({ tenant, sessionId, action, key }); return { status: "accepted", clientActionId: action.clientActionId, nextSequence: 2, feedback: "Accepted", state: { releaseBindingId: action.releaseBindingId, modelVersionId: action.modelVersionId, sequence: 1, nextSequence: 2, transforms: {}, scorePoints: 0, completed: false, activeStepId: "step-1", activeStepTitle: "Select the panel", allowedActions: ["select_component"] } }; },
  async resume(_tenant, sessionId, input) { return { status: "accepted", nextSequence: input.nextSequence, feedback: `Resumed ${sessionId}`, state: { releaseBindingId: input.releaseBindingId, modelVersionId: input.modelVersionId, sequence: input.nextSequence - 1, nextSequence: input.nextSequence, transforms: {}, scorePoints: 0, completed: false, activeStepId: "step-1", activeStepTitle: "Select the panel", allowedActions: ["select_component"] } }; }
};
const server = createJobStatusHttpServer({
  modelSessionService: session,
  authenticator: { authenticate: async (request) => request.headers.authorization === "Bearer learner" ? { subject: "learner", roles: ["learner"] } : null },
  organizationContextResolver: { resolveActiveOrganizations: async () => ["org_fixture"] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = server.address().port;
  const started = await fetch(`http://127.0.0.1:${port}/api/v1/model-sessions`, { method: "POST", headers: { authorization: "Bearer learner", "content-type": "application/json", "idempotency-key": "start-1" }, body: JSON.stringify({ releaseId: "release-1", activityId: "activity-1", simulationDefinitionId: "simulation-1", modelVersionId: "model-1", enrollmentId: "enrollment-1", attemptId: "attempt-1", policyId: "policy-1" }) });
  assert.equal(started.status, 200);
  const action = await fetch(`http://127.0.0.1:${port}/api/v1/model-sessions/session-1/actions`, { method: "POST", headers: { authorization: "Bearer learner", "content-type": "application/json", "idempotency-key": "action-1" }, body: JSON.stringify({ clientActionId: "action-1", releaseBindingId: "binding-1", modelVersionId: "model-1", expectedSequence: 1, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: 1.57 } }) });
  assert.equal(action.status, 200);
  const actionBody = await action.json();
  assert.equal(actionBody.state.activeStepTitle, "Select the panel");
  const invalidAction = await fetch(`http://127.0.0.1:${port}/api/v1/model-sessions/session-1/actions`, { method: "POST", headers: { authorization: "Bearer learner", "content-type": "application/json", "idempotency-key": "invalid-action" }, body: JSON.stringify({ clientActionId: "invalid-action", releaseBindingId: "binding-1", modelVersionId: "model-1", expectedSequence: 1, type: "transform_component", componentId: "", transform: {} }) });
  assert.equal(invalidAction.status, 422, "malformed semantic actions must be rejected at the HTTP boundary");
  for(const type of ['open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault','request_hint']){
    const body={clientActionId:'semantic-'+type,releaseBindingId:'binding-1',modelVersionId:'model-1',expectedSequence:1,type,value:'checked',stepId:'step-1'};
    const send=payload=>fetch(`http://127.0.0.1:${port}/api/v1/model-sessions/session-1/actions`,{method:'POST',headers:{authorization:'Bearer learner','content-type':'application/json','idempotency-key':body.clientActionId},body:JSON.stringify(payload)});
    assert.equal((await send(body)).status,200);assert.equal(calls.at(-1).action.value,'checked');assert.equal(calls.at(-1).action.stepId,'step-1');
    assert.equal((await send({...body,score:100})).status,422);assert.equal((await send({...body,value:{script:'bad'}})).status,422);
  }
  const resumed = await fetch(`http://127.0.0.1:${port}/api/v1/model-sessions/session-1?releaseBindingId=binding-1&modelVersionId=model-1&nextSequence=2`, { headers: { authorization: "Bearer learner" } });
  assert.equal(resumed.status, 200);
  const malformedPath = await fetch(`http://127.0.0.1:${port}/api/v1/model-sessions/%E0%A4%A`, { headers: { authorization: "Bearer learner" } });
  assert.equal(malformedPath.status, 404, "malformed session path encoding must fail as an invalid route");
  assert.equal(calls[0].key, "start-1");
  assert.equal(calls[0].tenant.organizationId, "org_fixture");
  assert.equal(calls[1].key, "action-1");
  console.log("Model session HTTP passed: authenticated start, semantic action, and resume contracts preserve tenant, binding, sequence, and idempotency metadata.");
} finally { await new Promise((resolve) => server.close(resolve)); }
