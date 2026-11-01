import assert from "node:assert/strict";
import { BrowserSemanticActionClient } from "../apps/web/dist/model-contract.js";

const accepted = { status: "accepted", clientActionId: "action-1", nextSequence: 2, feedback: "accepted", state: { releaseBindingId: "binding-1", modelVersionId: "model-1", sequence: 1, nextSequence: 2, transforms: { "AIC-C02": { rotationY: Math.PI / 2, translationX: 0 } }, scorePoints: 1, completed: false } };
let submits = 0;
const transport = {
  async submit() { submits += 1; return accepted; },
  async resume() { return { status: "accepted", nextSequence: 2, feedback: "resumed", state: accepted.state }; }
};
let nextSequence = 1;
const storageValues = new Map();
const storage = { get length() { return storageValues.size; }, key(index) { return [...storageValues.keys()][index] ?? null; }, getItem(key) { return storageValues.get(key) ?? null; }, setItem(key, value) { storageValues.set(key, value); }, removeItem(key) { storageValues.delete(key); }, clear() { storageValues.clear(); } };
const client = new BrowserSemanticActionClient(transport, { releaseBindingId: "binding-1", modelVersionId: "model-1", getNextSequence: () => nextSequence }, "contract", storage);
const action = { type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 }, clientActionId: "action-1", expectedSequence: 1 };
const [first, duplicate] = await Promise.all([client.submit(action), client.submit(action)]);
assert.deepEqual(first, duplicate);
assert.equal(submits, 1, "duplicate action IDs must not create a second request");
assert.deepEqual(await client.submit(action), accepted, "completed action IDs must return the original result");
assert.deepEqual((await client.resume()).state, accepted.state, "resume must return authoritative state");
assert.equal(first.state.scorePoints, 1, "score must only be carried by the authoritative result");
const reloadedClient = new BrowserSemanticActionClient(transport, { releaseBindingId: "binding-1", modelVersionId: "model-1", getNextSequence: () => nextSequence }, "contract", storage);
assert.deepEqual(await reloadedClient.submit(action), accepted, "a refresh must reuse the persisted idempotent result");
assert.equal(submits, 1, "persisted results must avoid replaying an accepted action after refresh");
await reloadedClient.submit({ ...action, transform: { rotationY: 0 } });
assert.equal(submits, 2, "reusing an action ID for a different payload must not return the old persisted result");
const offlineClient = new BrowserSemanticActionClient({
  async submit() { throw new Error("offline"); },
  async resume() { throw new Error("offline"); }
}, { releaseBindingId: "binding-1", modelVersionId: "model-1", getNextSequence: () => nextSequence }, "offline", storage);
const offlineAction = { type: "request_hint", clientActionId: "offline-1", expectedSequence: 1 };
const offlineResult = await offlineClient.submit(offlineAction);
assert.equal(offlineResult.status, "retryable_network_failure");
assert.deepEqual(offlineClient.getPendingAction("offline-1"), offlineAction, "failed actions remain available for explicit retry");
assert.equal((await offlineClient.resume()).status, "retryable_network_failure");

let retryableResponseSubmits = 0;
const retryableResponseClient = new BrowserSemanticActionClient({
  async submit() {
    retryableResponseSubmits += 1;
    return retryableResponseSubmits === 1
      ? { status: "stale_sequence", clientActionId: "retryable-response-1", nextSequence: 2, feedback: "Refresh the authoritative state first.", retryable: true }
      : accepted;
  },
  async resume() { return accepted; }
}, { releaseBindingId: "binding-1", modelVersionId: "model-1", getNextSequence: () => nextSequence }, "retryable-response", storage);
const retryableResponseAction = { type: "request_hint", clientActionId: "retryable-response-1", expectedSequence: 1 };
assert.equal((await retryableResponseClient.submit(retryableResponseAction)).status, "stale_sequence");
assert.equal((await retryableResponseClient.submit(retryableResponseAction)).status, "accepted", "retryable server responses must not be cached as completed results");
assert.equal(retryableResponseSubmits, 2);

let malformedAcceptedSubmits = 0;
const malformedAccepted = { ...accepted, state: { ...accepted.state, modelVersionId: "wrong-model" } };
const malformedAcceptedClient = new BrowserSemanticActionClient({
  async submit() { malformedAcceptedSubmits += 1; return malformedAccepted; },
  async resume() { return accepted; }
}, { releaseBindingId: "binding-1", modelVersionId: "model-1", getNextSequence: () => nextSequence }, "malformed-accepted", storage);
const malformedAcceptedAction = { type: "request_hint", clientActionId: "malformed-accepted-1", expectedSequence: 1 };
await malformedAcceptedClient.submit(malformedAcceptedAction);
await malformedAcceptedClient.submit(malformedAcceptedAction);
assert.equal(malformedAcceptedSubmits, 2, "authority-invalid accepted responses must never be persisted as completed actions");
console.log("Model action contract passed: duplicate suppression, persisted refresh state, authoritative projection, resume state, and explicit network recovery are enforced.");
