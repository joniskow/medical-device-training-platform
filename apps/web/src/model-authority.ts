import { validateAuthoritativeModelState, type ModelManifest } from "@medical-device/model-runtime";
import type { AuthoritativeActionResult } from "./model-contract.js";

const statuses = new Set(["accepted", "invalid_precondition", "stale_sequence", "expired_session", "unknown_component", "version_mismatch", "retryable_network_failure"]);

export function validateAuthoritativeActionResult(manifest: ModelManifest, received: AuthoritativeActionResult, currentSequence: number): AuthoritativeActionResult {
  const validEnvelope = statuses.has(received.status)
    && Number.isSafeInteger(received.nextSequence)
    && received.nextSequence >= 1
    && typeof received.feedback === "string"
    && received.feedback.length > 0
    && (received.clientActionId === undefined || typeof received.clientActionId === "string")
    && (received.scoreDelta === undefined || Number.isFinite(received.scoreDelta));
  const validState = received.state
    ? validateAuthoritativeModelState(manifest, received.state)
      && received.nextSequence === received.state.nextSequence
      && received.state.sequence >= currentSequence
    : received.status !== "accepted";
  if (validEnvelope && validState) return received;
  return {
    status: "version_mismatch",
    clientActionId: received.clientActionId,
    nextSequence: Math.max(currentSequence + 1, 1),
    feedback: "The activity returned an invalid or stale authoritative state. Resume before continuing."
  } satisfies AuthoritativeActionResult;
}
