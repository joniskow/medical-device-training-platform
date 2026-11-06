import {fetchModelAsset} from './private-model-fetch.js';
import { BrowserSemanticActionClient, createHttpSemanticActionTransport, type AuthoritativeActionResult, type AuthoritativeModelState, type InteractiveModelRuntime, type ModelRuntimeState, type ModelSemanticAction, type SemanticActionTransport } from "./model-contract.js";
import { applyPermittedTransform, interactionStateViolation, validateBrowserModelManifest, type ModelManifest } from "@medical-device/model-runtime";
import { createBabylonModelRuntime } from "./babylon-model-runtime.js";
import { validateAuthoritativeActionResult } from "./model-authority.js";
import { authenticatedFetch, getSessionIdentity, getOrganizationHeaders, getAccessToken } from "./auth-session.js";
import { updateNxstageWarmerPreview } from "./nxstage-warmer-preview.js";

const canvas = document.querySelector<HTMLCanvasElement>("#model-canvas")!;
const status = document.querySelector<HTMLElement>("#model-status")!;
const lowerPanelGuidance = document.querySelector<HTMLElement>("#lower-panel-guidance");
const componentList = document.querySelector<HTMLElement>("#component-list")!;
const fps = document.querySelector<HTMLElement>("#fps")!;
const loadTime = document.querySelector<HTMLElement>("#load-time")!;
const reset = document.querySelector<HTMLButtonElement>("#reset-view")!;
const fit = document.querySelector<HTMLButtonElement>("#fit-view")!;
const focusComponent = document.querySelector<HTMLButtonElement>("#focus-component")!;
const showControls = document.querySelector<HTMLButtonElement>("#show-controls")!;
const hint = document.querySelector<HTMLButtonElement>("#hint")!;
const retryAction = document.querySelector<HTMLButtonElement>("#retry-action")!;
const resumeSession = document.querySelector<HTMLButtonElement>("#resume-session")!;
const actionControls = document.querySelector<HTMLElement>("#action-controls")!;
const score = document.querySelector<HTMLElement>("#score")!;
const completion = document.querySelector<HTMLElement>("#completion")!;
const fallback = document.querySelector<HTMLElement>("#fallback")!;
const actionLog = document.querySelector<HTMLElement>("#action-log")!;
const runtimeState = document.querySelector<HTMLElement>("#runtime-state")!;
const procedureStep = document.querySelector<HTMLElement>("#procedure-step")!;
const procedureFault = document.querySelector<HTMLElement>("#procedure-fault")!;
const allowedActions = document.querySelector<HTMLElement>("#allowed-actions")!;
let selectedComponentId: string | undefined;
let sessionInteractionEnabled = false;

function announce(message: string, error = false) { status.textContent = message; status.className = error ? "error" : "status"; }
function interactionTargetLabel(targetId: string) {
  for (const component of manifest.components) {
    const target = component.interactionTargets?.find((item) => item.targetId === targetId);
    if (target) return target.displayName;
  }
  return targetId;
}
function interactionTargetHint(targetId: string) {
  const target = manifest.components.flatMap(component => component.interactionTargets ?? []).find(item => item.targetId === targetId);
  if (target?.interactionType === "open") return `Drag to move, or click to ${(target.openVerb ?? "open").toLowerCase()} or ${(target.closeVerb ?? "close").toLowerCase()}.`;
  if (target?.interactionType === "turn") return "Drag to turn.";
  return target?.interactionType === "press" || target?.pressDepthMeters !== undefined ? "Press and release." : "Click or drag to interact.";
}

function renderAuthoritativeState(authoritative: AuthoritativeModelState) {
  score.textContent = String(authoritative.scorePoints);
  if (previewMode && visualOnlyPreview) {
    completion.textContent = "Visual preview only; no procedure score or completion is recorded.";
    procedureStep.textContent = "Select a component or interact directly with the model.";
    allowedActions.textContent = "Named controls are available for the selected component.";
  } else {
    completion.textContent = authoritative.completed ? "Completed by the authoritative session." : "Completion is determined by the authoritative session.";
    procedureStep.textContent = authoritative.activeStepTitle
      ? `Current step · ${authoritative.activeStepTitle}`
      : authoritative.completed ? "Procedure complete." : "Waiting for the next authoritative procedure state.";
    allowedActions.textContent = authoritative.allowedActions.length > 0
      ? `Allowed actions · ${authoritative.allowedActions.join(", ")}`
      : authoritative.completed ? "Allowed actions · none; procedure complete." : "Allowed actions · awaiting authoritative procedure state.";
  }
  procedureFault.hidden = !authoritative.activeFaultTitle;
  if (authoritative.activeFaultTitle) procedureFault.textContent = `Active fault · ${authoritative.activeFaultTitle}`;
  for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-current", button.dataset.componentId === authoritative.selectedComponentId ? "true" : "false");
}

let lastRenderAnnouncementKey = "";
let lastRenderPhase: ModelRuntimeState["phase"] | undefined;
let lastHoveredTargetId: string | undefined;
function renderState(state: ModelRuntimeState) {
  if (lowerPanelGuidance && state.selectedComponentId !== "pureflow-control-panel") lowerPanelGuidance.hidden = true;
  runtimeState.textContent = state.phase;
  if (state.loadDurationMs !== undefined) loadTime.textContent = `${state.loadDurationMs} ms`;
  if (state.measuredFps !== undefined) fps.textContent = `${state.measuredFps} FPS`;
  const memory = document.querySelector<HTMLElement>("#memory");
  if (memory && state.estimatedMemoryMb !== undefined) memory.textContent = `${state.estimatedMemoryMb.toFixed(2)} MB`;
  canvas.hidden = state.phase === "ERROR" || state.phase === "CONTEXT_LOST";
  updateFocusButton();
  showControls.disabled = (!previewMode && hasBoundSession && !sessionInteractionEnabled) || state.phase === "ERROR" || state.phase === "CONTEXT_LOST";
  canvas.style.cursor = state.pressedInteractionTargetId ? "grabbing" : state.hoveredInteractionTargetId ? "pointer" : "";
  if (state.authoritative) {
    // Keep the equivalent text path explicitly tied to the server projection.
    procedureStep.textContent = state.authoritative.activeStepTitle ?? "";
    procedureFault.hidden = !state.authoritative.activeFaultTitle;
    renderAuthoritativeState(state.authoritative);
  }
  fallback.hidden = !state.fallbackReason;
  if (state.fallbackReason) fallback.textContent = state.fallbackReason;
  for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-current", button.dataset.componentId === state.selectedComponentId ? "true" : "false");
  if (state.focusedInteractionTargetId && state.selectedComponentId && state.selectedComponentId !== selectedComponentId) {
    selectedComponentId = state.selectedComponentId;
    renderActions();
  }
  const announcementKey = JSON.stringify([state.phase, state.selectedComponentId, state.pressedInteractionTargetId, state.focusedInteractionTargetId, state.focusedInteractionType, state.hoveredInteractionTargetId, state.interactionMessage, state.errorCode, state.errorMessage]);
  const phaseChanged = state.phase !== lastRenderPhase;
  lastRenderPhase = state.phase;
  const previousHover = lastHoveredTargetId;
  lastHoveredTargetId = state.hoveredInteractionTargetId;
  if (announcementKey === lastRenderAnnouncementKey) return;
  lastRenderAnnouncementKey = announcementKey;
  if (state.phase === "LOADING") announce(nxstageReview ? "Loading the NxStage visual review…" : "Loading the approved AIC-001 model…");
  if (state.pressedInteractionTargetId) announce(`Holding ${interactionTargetLabel(state.pressedInteractionTargetId)}. Release to finish.`);
  if (!state.pressedInteractionTargetId && state.hoveredInteractionTargetId && state.hoveredInteractionTargetId !== state.focusedInteractionTargetId) announce(`Over ${interactionTargetLabel(state.hoveredInteractionTargetId)}. ${interactionTargetHint(state.hoveredInteractionTargetId)}`);
  else if (state.focusedInteractionTargetId && !state.pressedInteractionTargetId) announce(`Keyboard focus on ${interactionTargetLabel(state.focusedInteractionTargetId)}. ${state.focusedInteractionType === "turn" ? "Hold Shift and use the arrow keys to turn." : state.focusedInteractionType === "open" ? "Press Enter or Space to open or close; hold Shift and use the arrow keys to move gradually." : "Press Enter or Space to activate."}`);
  else if (!state.pressedInteractionTargetId && !state.hoveredInteractionTargetId && previousHover && /^(Over|Holding) /.test(status.textContent ?? "")) announce("Move over a control or select a component.");
  if (state.phase === "READY" && phaseChanged && !state.selectedComponentId) announce("Model ready. Select a component using the canvas or component list.");
  if (state.phase === "CONTEXT_LOST") announce("3D context lost. Use the equivalent text path or reload the preview.", true);
  if (state.phase === "REDUCED_COMPLEXITY" && phaseChanged && !state.pressedInteractionTargetId && !state.focusedInteractionTargetId) announce("The model may respond slowly. Named controls remain available.", true);
  if (state.phase === "ERROR") announce(`${state.errorCode ?? "MODEL_RUNTIME_FAILED"}: ${state.errorMessage ?? "The model could not be loaded."}`, true);
  if (state.interactionMessage) announce(state.interactionMessage);
}

const query = new URLSearchParams(window.location.search);
const previewMode = query.get("preview") === "1";
const sessionId = query.get("sessionId");
const releaseId = query.get("releaseId");
const modelVersionId = query.get("modelVersionId");
const hasBoundSession = Boolean(sessionId && releaseId && modelVersionId);
// This explicit visual review never substitutes assets into a bound session.
const nxstageReview = previewMode && !sessionId && !releaseId && !modelVersionId && query.get("model") === "nxstage-review";
let warmerPreviewNotice: HTMLElement | undefined;
if (nxstageReview) {
  document.title = "NxStage System One · interactive visual review";
  document.querySelector<HTMLElement>("#title")!.textContent = "NxStage System One · interactive visual review";
  document.querySelector<HTMLElement>("#model-introduction")!.textContent = "Press the controls on the model. Drag a door or tub to move it partway, or tap it to open or close fully. You can also select a component to use its named controls.";
  document.querySelector<HTMLElement>("#model-notice")!.textContent = "Visual review: dimensions and hidden geometry are estimates. The upper cartridge chamber is simplified, and treatment and power are not simulated.";
  canvas.setAttribute("aria-label", "Interactive NxStage System One model. Drag the background to rotate, use the wheel or pinch to zoom, and drag a door or tub to move it. Use arrow keys to choose a control, Enter or Space to activate it, Shift plus arrow keys to move a door or tub, and Escape to cancel a held control or drag.");
  hint.hidden = true;
  score.parentElement!.hidden = true;
  warmerPreviewNotice = document.createElement("p");
  warmerPreviewNotice.id = "nxstage-warmer-preview-feedback";
  warmerPreviewNotice.className = "muted";
  warmerPreviewNotice.setAttribute("role", "status");
  warmerPreviewNotice.hidden = true;
  status.insertAdjacentElement("afterend", warmerPreviewNotice);
}
const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const requestedVariant = coarsePointer ? "mobile" : "full";
const staticAsset = nxstageReview
  ? { manifestUrl: "/learner/nxstage-review-manifest.json", modelUrl: "/learner/model/nxstage-review.glb", variantId: "full" }
  : requestedVariant === "mobile"
  ? { manifestUrl: "/learner/model-manifest.mobile.json", modelUrl: "/learner/model/aurora-infusion-controller.mobile.glb", variantId: "mobile" }
  : { manifestUrl: "/learner/model-manifest.json", modelUrl: "/learner/model/aurora-infusion-controller.glb", variantId: "full" };
type BoundModelAsset = { releaseId: string; releaseHash: string; modelVersionId: string; releaseBindingId: string; variantId: string; manifestHash: string; manifestUrl: string; modelUrl: string; fallbackManifest: unknown };
let asset: typeof staticAsset | BoundModelAsset = staticAsset;
let assetLoadFailure: string | undefined;
let manifestLoadFailure: string | undefined;
if (hasBoundSession && !previewMode) {
  try {
    const accessToken = getAccessToken();
    if (!accessToken) throw new Error("AUTHENTICATION_REQUIRED");
    const response = await authenticatedFetch(`/api/v1/releases/${encodeURIComponent(releaseId!)}/model-assets/${encodeURIComponent(modelVersionId!)}?variant=${encodeURIComponent(requestedVariant)}`, { cache: "no-store", headers: { ...getOrganizationHeaders(), authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`MODEL_ASSET_HTTP_${response.status}`);
    const boundAsset = await response.json() as Partial<BoundModelAsset>;
    if (boundAsset.releaseId !== releaseId || boundAsset.modelVersionId !== modelVersionId || typeof boundAsset.releaseHash !== "string" || !/^[a-f0-9]{64}$/i.test(boundAsset.releaseHash) || typeof boundAsset.releaseBindingId !== "string" || typeof boundAsset.variantId !== "string" || boundAsset.variantId !== requestedVariant || typeof boundAsset.manifestHash !== "string" || typeof boundAsset.manifestUrl !== "string" || typeof boundAsset.modelUrl !== "string" || !boundAsset.fallbackManifest || typeof boundAsset.fallbackManifest !== "object" || Array.isArray(boundAsset.fallbackManifest)) throw new Error("MODEL_ASSET_BINDING_INVALID");
    asset = boundAsset as BoundModelAsset;
  } catch (error) {
    assetLoadFailure = error instanceof Error ? error.message : "The release-bound model asset could not be loaded.";
  }
}
type ActivityManifest = { sourceHash: string; modelVersionId: string; releaseBindingId: string; fidelity?: { status: string }; components: Array<{ componentId: string; displayName: string; interactionCapabilities?: string[]; interactionTargets?: Array<{ targetId: string; displayName: string; interactionType?: "press" | "turn" | "open"; pressDepthMeters?: number; turnMinRadians?: number; turnMaxRadians?: number; openRotationRadians?: number; openTranslationMeters?: number; openVerb?: string; closeVerb?: string }>; permittedTransforms?: { rotationY?: { min: number; max: number; step?: number; snap?: number }; translationX?: { min: number; max: number; step?: number; snap?: number } } }> };
const emptyManifest: ActivityManifest = { sourceHash: "", modelVersionId: "", releaseBindingId: "", components: [] };
let manifest: ActivityManifest = emptyManifest;
if (!assetLoadFailure) try {
  const manifestResponse = await fetchModelAsset(asset.manifestUrl, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`MODEL_MANIFEST_HTTP_${manifestResponse.status}`);
  manifest = validateBrowserModelManifest(await manifestResponse.json()) as ActivityManifest;
  if (hasBoundSession && !previewMode) {
    const boundAsset = asset as BoundModelAsset;
    if (boundAsset.modelVersionId !== manifest.modelVersionId || boundAsset.releaseBindingId !== manifest.releaseBindingId || boundAsset.manifestHash.toLowerCase() !== manifest.sourceHash.toLowerCase()) throw new Error("MODEL_ASSET_MANIFEST_MISMATCH");
  }
} catch (error) {
  const manifestError = error instanceof Error ? error.message : "The approved model manifest could not be loaded.";
  if (hasBoundSession && !previewMode && !assetLoadFailure && "fallbackManifest" in asset) {
    try {
      const fallback = validateBrowserModelManifest(asset.fallbackManifest);
      const boundAsset = asset as BoundModelAsset;
      if (fallback.modelVersionId !== boundAsset.modelVersionId || fallback.releaseBindingId !== boundAsset.releaseBindingId || fallback.sourceHash?.toLowerCase() !== boundAsset.manifestHash.toLowerCase()) throw new Error("MODEL_ASSET_FALLBACK_MISMATCH");
      manifest = fallback as ActivityManifest;
      manifestLoadFailure = manifestError;
    } catch {
      assetLoadFailure = manifestError;
    }
  } else {
    assetLoadFailure = manifestError;
  }
}
const initialState: AuthoritativeModelState = { releaseBindingId: manifest.releaseBindingId, modelVersionId: manifest.modelVersionId, sequence: 0, nextSequence: 1, transforms: Object.fromEntries(manifest.components.map((component) => [component.componentId, { rotationY: 0, translationX: 0 }])), scorePoints: 0, completed: false, allowedActions: [] };
let serverState = initialState;
const visualOnlyPreview = manifest.fidelity?.status === "VISUAL_RECONSTRUCTION";
const previewTransport: SemanticActionTransport = {
  async submit(action) {
    if (action.expectedSequence !== serverState.nextSequence) return { status: "stale_sequence", clientActionId: "clientActionId" in action ? action.clientActionId : undefined, nextSequence: serverState.nextSequence, feedback: "This action is stale. Resume the session before trying again." };
    const next = structuredClone(serverState);
    if (action.type === "request_hint") {
      next.sequence += 1; next.nextSequence += 1; serverState = next;
      return { status: "accepted", clientActionId: action.clientActionId, nextSequence: next.nextSequence, state: next, scoreDelta: 0, feedback: visualOnlyPreview ? "Select a component or interact directly with the model." : "Hint: select every component, then use the permitted action for the safety cover and line sensor." };
    }
    if (!action.componentId || !next.transforms[action.componentId]) return { status: "unknown_component", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: "That component is not part of this approved release." };
    if (action.type === "activate_target" && !manifest.components.find((item) => item.componentId === action.componentId)?.interactionTargets?.some((target) => target.targetId === action.targetId)) return { status: "invalid_precondition", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: "That control is not part of this model component." };
    if (action.type === "reset_component") next.transforms[action.componentId] = { rotationY: 0, translationX: 0 };
    if (action.type === "transform_component") {
      const component = manifest.components.find((item) => item.componentId === action.componentId);
      const normalized = component ? applyPermittedTransform(component, next.transforms[action.componentId], action.transform) : null;
      if (!normalized) return { status: "invalid_precondition", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: "That transform is outside the permitted component bounds." };
      next.transforms[action.componentId] = normalized;
    }
    if (action.type === "transform_component" || action.type === "reset_component") {
      const violation = interactionStateViolation(manifest as unknown as ModelManifest, next.transforms, action.componentId);
      if (violation) return { status: "invalid_precondition", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: violation };
    }
    const previousScore = serverState.scorePoints;
    next.sequence += 1; next.nextSequence += 1; next.selectedComponentId = action.componentId;
    next.scorePoints = !visualOnlyPreview && Object.values(next.transforms).some((value) => value.rotationY === Math.PI / 2) && Object.values(next.transforms).some((value) => value.translationX === 0.2) ? 2 : 0;
    next.completed = !visualOnlyPreview && next.scorePoints === 2;
    serverState = next;
    const feedback = visualOnlyPreview ? (action.type === "activate_target" ? "Preview only; treatment settings are not simulated." : action.type === "select_component" ? `Selected ${manifest.components.find(item => item.componentId === action.componentId)?.displayName ?? "component"}.` : "Updated in the local preview.") : next.completed ? "All required actions are complete." : "Accepted. Continue with the next permitted action.";
    return { status: "accepted", clientActionId: action.clientActionId, nextSequence: next.nextSequence, state: next, scoreDelta: next.scorePoints - previousScore, feedback };
  },
  async resume() { return { status: "accepted", nextSequence: serverState.nextSequence, state: serverState, feedback: "Authoritative session state restored." }; }
};
const unavailableTransport: SemanticActionTransport = {
  async submit(action) { return { status: "expired_session", clientActionId: action.clientActionId, nextSequence: serverState.nextSequence, feedback: "Start or resume the approved learning session before sending an action." }; },
  async resume() { return { status: "expired_session", nextSequence: serverState.nextSequence, feedback: "An approved learning session is required." }; }
};
const boundAuthorization = getAccessToken();
const boundIdentity = getSessionIdentity();
const actionTransport = hasBoundSession && !previewMode && !assetLoadFailure && manifest.components.length > 0 && sessionId
  ? createHttpSemanticActionTransport({ fetcher:async(input,init)=>{if(getSessionIdentity()!==boundIdentity)throw Error('Your learning session changed. Reopen the activity.');return authenticatedFetch(input,init);}, baseUrl: window.location.origin, sessionId, releaseBindingId: manifest.releaseBindingId, modelVersionId: manifest.modelVersionId, organizationId:getOrganizationHeaders()['x-organization-id'], authorization: boundAuthorization ? `Bearer ${boundAuthorization}` : undefined })
  : previewMode && !assetLoadFailure ? previewTransport : unavailableTransport;
const actionClient = new BrowserSemanticActionClient(actionTransport, { releaseBindingId: manifest.releaseBindingId, modelVersionId: manifest.modelVersionId, getNextSequence: () => serverState.nextSequence }, `mdt.model-action.${sessionId ?? manifest.releaseBindingId}`, undefined, (result) => {
  if (result.status !== "accepted" || !result.state) return false;
  return validateAuthoritativeActionResult(manifest as unknown as ModelManifest, result, serverState.sequence).status === "accepted";
});

let runtime: InteractiveModelRuntime | undefined;
const movingComponents = new Set<string>();
let pendingMotionAnnouncement: { componentId: string; moving: string; completed: string } | undefined;
if ((previewMode || (hasBoundSession && !assetLoadFailure && !manifestLoadFailure)) && !assetLoadFailure) try {
  runtime = await createBabylonModelRuntime({fetcher:fetchModelAsset,
    canvas,
    manifestUrl: asset.manifestUrl,
    modelUrl: asset.modelUrl,
    ...(nxstageReview ? { selectedHighlightOpacity: 0.08, pixelRatioLimit: 1.5 } : {}),
    camera: nxstageReview ? { alpha: Math.PI / 2, beta: 1.2, radius: 13.5, target: [0, 3.6, 0] } : undefined,
    interactionEnabled: previewMode,
    onStateChange: renderState,
    onSemanticAction: (action) => {
      if (action.type === "select_component") {
        selectedComponentId = action.componentId;
        actionLog.textContent = `Semantic action emitted: ${action.type} · ${action.componentId} · ${action.source}. Awaiting authoritative selection.`;
        announce(`${action.componentId} selected. Confirming selection with the activity session.`);
        renderActions();
        void submit({ ...action, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
      }
    },
    onInteractionBlocked: ({ message }) => { pendingMotionAnnouncement = undefined; announce(message); },
    onInteractionMotionFinished: (componentId) => {
      movingComponents.delete(componentId);
      if (pendingMotionAnnouncement?.componentId === componentId) {
        if (status.textContent === pendingMotionAnnouncement.moving) announce(pendingMotionAnnouncement.completed);
        pendingMotionAnnouncement = undefined;
      }
    },
    onInteractionTargetActivated: ({ targetId, componentId, interactionType, moving, transform }) => {
      if (moving && interactionType === "open") movingComponents.add(componentId);
      else movingComponents.delete(componentId);
      const action: ModelSemanticAction = transform
        ? { type: "transform_component", componentId, transform, clientActionId: actionId(), expectedSequence: serverState.nextSequence }
        : { type: "activate_target", componentId, targetId, clientActionId: actionId(), expectedSequence: serverState.nextSequence };
      actionLog.textContent = `Semantic ${interactionType ?? "target"} action emitted: ${targetId}. Awaiting authoritative procedure state.`;
      announce(`${interactionTargetLabel(targetId)} ${interactionType === "turn" ? "turned" : interactionType === "open" ? "opened or closed" : "activated"}. Confirming the action with the activity session.`);
      void submit(action, targetId, false, undefined, Boolean(transform));
    }
  });
} catch (error) {
  fallback.hidden = false;
  fallback.textContent = `The 3D renderer is unavailable. Use the component list and permitted action buttons to complete the equivalent activity. (${error instanceof Error ? error.message : "runtime error"})`;
  announce("Reduced-complexity equivalent path available.", true);
} else {
  fallback.hidden = false;
  fallback.textContent = assetLoadFailure
    ? `The approved release asset is unavailable. Use the equivalent activity path. (${assetLoadFailure})`
    : manifestLoadFailure
      ? `The approved release manifest is unavailable. The release-bound equivalent activity path remains available. (${manifestLoadFailure})`
      : "An approved learning session is required before the 3D model can load. Use the equivalent activity path or open the assigned course.";
  announce("Equivalent activity path available; model loading requires an approved session.", true);
}
if (nxstageReview) runtime?.fitModel();
for (const component of manifest.components) {
  const listItem = document.createElement("div");
  listItem.setAttribute("role", "listitem");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "component-button";
  button.dataset.componentId = component.componentId;
  button.setAttribute("aria-current", "false");
  button.textContent = component.displayName;
  button.addEventListener("click", () => {
    selectedComponentId = component.componentId;
    if (runtime) runtime.selectComponent(component.componentId, "COMPONENT_LIST");
    else {
      actionLog.textContent = `Semantic selection: ${component.componentId}. Awaiting authoritative selection.`;
      announce(`${component.componentId} selected. Confirming selection with the activity session.`);
      void submit({ type: "select_component", componentId: component.componentId, source: "COMPONENT_LIST", clientActionId: actionId(), expectedSequence: serverState.nextSequence });
      renderActions();
    }
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      button.click();
    }
  });
  listItem.append(button);
  componentList.append(listItem);
}
let lastAction: ModelSemanticAction | undefined;
let unresolvedAction = false;
let submissionTail: Promise<void> = Promise.resolve();
let pendingSubmissionCount = 0;
const pendingVisualMovements = new Map<string, string>();
const pendingSelections = new Map<string, string>();
const invalidatedVisualMovements = new Set<string>();
const pendingActionId = actionClient.getPendingActionIds()[0];
if (pendingActionId) {
  lastAction = actionClient.getPendingAction(pendingActionId);
  if (lastAction) {
    unresolvedAction = true;
    retryAction.hidden = false;
    actionLog.textContent = "A previous action was not confirmed. Review the current state, then retry it explicitly if needed.";
  }
}
function actionId() { return `aic:${crypto.randomUUID()}`; }
function authoritativeResult(received: AuthoritativeActionResult): AuthoritativeActionResult {
  return validateAuthoritativeActionResult(manifest as unknown as ModelManifest, received, serverState.sequence);
}
function applyAuthoritativeResult(received: AuthoritativeActionResult, currentActionId?: string, preservePendingVisuals = true, animateTargetId?: string): AuthoritativeActionResult {
  const result = authoritativeResult(received);
  const scoreEffect = result.scoreDelta === undefined ? "" : ` · score ${result.scoreDelta >= 0 ? "+" : ""}${result.scoreDelta}`;
  actionLog.textContent = `${result.status}: ${result.feedback}${scoreEffect}`;
  if (result.state) {
    const laterVisualComponents = new Set([...pendingVisualMovements].filter(([id]) => id !== currentActionId).map(([, componentId]) => componentId));
    const preserveVisual = Boolean(currentActionId) && preservePendingVisuals && result.status === "accepted" && laterVisualComponents.size > 0 && Object.entries(result.state.transforms).every(([id, position]) => {
      const previous = serverState.transforms[id];
      return previous && (laterVisualComponents.has(id) || (Math.abs(previous.rotationY - position.rotationY) < 1e-8 && Math.abs(previous.translationX - position.translationX) < 1e-8));
    });
    serverState = result.state;
    const laterSelection = result.status === "accepted" && currentActionId
      ? [...pendingSelections].filter(([id]) => id !== currentActionId).at(-1)?.[1]
      : undefined;
    const displayState = laterSelection ? { ...result.state, selectedComponentId: laterSelection } : result.state;
    selectedComponentId = displayState.selectedComponentId;
    renderAuthoritativeState(displayState);
    if (!preserveVisual) runtime?.applyAuthoritativeState(displayState, animateTargetId ? { animateTargetId } : undefined);
    const focusedTargetId = runtime?.getState().focusedInteractionTargetId;
    const focusedComponent = focusedTargetId && manifest.components.find((component) => component.interactionTargets?.some((target) => target.targetId === focusedTargetId));
    if (focusedComponent) {
      selectedComponentId = focusedComponent.componentId;
      for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-current", button.dataset.componentId === selectedComponentId ? "true" : "false");
    }
    renderActions();
  } else if (result.status !== "accepted") {
    selectedComponentId = serverState.selectedComponentId;
    renderAuthoritativeState(serverState);
    runtime?.applyAuthoritativeState(serverState);
    renderActions();
  }
  return result;
}
function submit(action: ModelSemanticAction, targetId?: string, retry = false, prepare?: () => ModelSemanticAction | undefined, visualMovement = false): Promise<void> {
  if (visualMovement && action.clientActionId && action.componentId) pendingVisualMovements.set(action.clientActionId, action.componentId);
  if (!retry && action.type === "select_component" && action.clientActionId && action.componentId) pendingSelections.set(action.clientActionId, action.componentId);
  const run = async () => {
  if (unresolvedAction && !retry) {
    runtime?.applyAuthoritativeState(serverState);
    announce("This action was not sent. Retry the unconfirmed action, then perform this action again.", true);
    return;
  }
  if (action.clientActionId && invalidatedVisualMovements.has(action.clientActionId)) {
    runtime?.applyAuthoritativeState(serverState);
    announce("This action was not sent because the preceding movement was not accepted. Please try again.", true);
    return;
  }
  const prepared = !retry && prepare ? prepare() : action;
  if (!prepared) return;
  const queuedAction = retry ? prepared : { ...prepared, expectedSequence: serverState.nextSequence };
  lastAction = queuedAction;
  const before = queuedAction.componentId ? serverState.transforms[queuedAction.componentId] : undefined;
  const received = await actionClient.submit(queuedAction);
  const checked = authoritativeResult(received);
  const confirmedPosition = queuedAction.componentId ? checked.state?.transforms[queuedAction.componentId] : undefined;
  const movementMatches = !visualMovement || !queuedAction.transform || Boolean(confirmedPosition && Object.entries(queuedAction.transform).every(([axis, value]) => Math.abs(confirmedPosition[axis as "rotationY" | "translationX"] - value) < 1e-8));
  if (visualMovement && queuedAction.componentId && (checked.status !== "accepted" || !movementMatches)) {
    const affected = new Set([queuedAction.componentId]);
    const components = (manifest as unknown as ModelManifest).components;
    let changed = true;
    while (changed) {
      changed = false;
      for (const component of components) for (const target of component.interactionTargets ?? []) {
        if (!affected.has(component.componentId) && [target.openRequires, target.closeRequires].some((requirement) => requirement && affected.has(requirement.componentId))) {
          affected.add(component.componentId);
          changed = true;
        }
      }
    }
    for (const [id, componentId] of pendingVisualMovements) if (id !== queuedAction.clientActionId && affected.has(componentId)) invalidatedVisualMovements.add(id);
  }
  const animateTargetId = !visualMovement && checked.status === "accepted" && queuedAction.type === "transform_component" ? targetId : undefined;
  const result = applyAuthoritativeResult(received, queuedAction.clientActionId, movementMatches, animateTargetId);
  if (nxstageReview && result.status === "accepted" && queuedAction.type === "activate_target" && targetId) {
    const level = updateNxstageWarmerPreview(targetId);
    if (level !== undefined && warmerPreviewNotice) {
      warmerPreviewNotice.hidden = false;
      warmerPreviewNotice.textContent = `Illustrative warmer bars: ${level} of 9. Power, temperature and heating are not simulated.`;
    }
  }
  retryAction.hidden = !result.retryable;
  if (result.retryable) { unresolvedAction = true; announce("The network request can be retried without replaying the action.", true); return; }
  if (retry) unresolvedAction = false;
  let description = "";
  if (result.status === "accepted" && result.state && queuedAction.componentId && targetId) {
    const component = manifest.components.find((item) => item.componentId === queuedAction.componentId);
    const target = component?.interactionTargets?.find((item) => item.targetId === targetId);
    const position = result.state.transforms[queuedAction.componentId];
    if (target && position) {
      if (target.interactionType === "open") {
        const value = target.openTranslationMeters !== undefined ? position.translationX : position.rotationY;
        const open = Math.abs(value) > 1e-5;
        const openPosition = target.openTranslationMeters ?? target.openRotationRadians ?? component?.permittedTransforms?.rotationY?.max;
        const partial = open && openPosition !== undefined && Math.abs(value - openPosition) > 1e-5;
        const positionDescription = target.openVerb === "Lift"
          ? (open ? (partial ? "partially raised" : "raised") : "lowered")
          : target.openVerb === "Pull out"
            ? (open ? (partial ? "partially pulled out" : "pulled out") : "pushed in")
            : (open ? (partial ? "partially open" : "open") : "closed");
        const actualPositionDescription = target.openVerb === "Set on" ? (open ? "in the on position (power not simulated)" : "in the off position (power not simulated)") : positionDescription;
        description = `${target.displayName} is ${actualPositionDescription}.`;
      } else if (target.interactionType === "turn") {
        description = `${target.displayName} position ${before && Math.abs(before.rotationY - position.rotationY) > 1e-8 ? "updated" : "unchanged"}.`;
      } else description = `${target.displayName} pressed.`;
    }
  }
  const completed = [description, result.feedback].filter(Boolean).join(" ");
  if (visualMovement && result.status === "accepted" && queuedAction.componentId && movingComponents.has(queuedAction.componentId) && description) {
    const moving = `${description.replace(/ is in the (.+)\.$/, " is moving toward the $1.").replace(/ is (?!moving toward)(.+)\.$/, " is moving toward $1.")} ${result.feedback ?? ""}`.trim();
    pendingMotionAnnouncement = { componentId: queuedAction.componentId, moving, completed };
    announce(moving);
  } else {
    pendingMotionAnnouncement = undefined;
    announce(completed, result.status !== "accepted");
  }
  };
  pendingSubmissionCount += 1;
  const pending = submissionTail.then(run, run).finally(() => { pendingSubmissionCount -= 1; if (action.clientActionId) { pendingSelections.delete(action.clientActionId); pendingVisualMovements.delete(action.clientActionId); invalidatedVisualMovements.delete(action.clientActionId); } });
  submissionTail = pending.catch(() => undefined);
  return pending;
}
function renderActions() {
  updateFocusButton();
  const focusedKey = actionControls.contains(document.activeElement) ? (document.activeElement as HTMLElement | null)?.dataset.controlKey : undefined;
  const previousProcedure = actionControls.querySelector<HTMLElement>("[data-procedure-action]");
  const previousInputs = [...(previousProcedure?.querySelectorAll<HTMLInputElement>("input[data-procedure-field]") ?? [])];
  const draft = new Map(previousInputs.map((input) => [input.dataset.procedureField, input.value]));
  const focusedInput = previousInputs.find((input) => input === document.activeElement);
  const focusedField = focusedInput?.dataset.procedureField;
  const selection = focusedInput && focusedInput.type !== "number" ? [focusedInput.selectionStart, focusedInput.selectionEnd] as const : undefined;
  actionControls.replaceChildren();
  if(!previewMode&&!serverState.completed){
    const type=serverState.allowedActions[0] as ModelSemanticAction['type'];
    if (serverState.allowedActions.includes("activate_target")) {
      const box = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = "Procedure target";
      box.append(legend);
      const explanation = document.createElement("p");
      explanation.textContent = "Choose a named control, or activate it directly in the 3D model.";
      box.append(explanation);
      for (const component of manifest.components) {
        for (const target of component.interactionTargets ?? []) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.controlKey = `procedure:${target.targetId}`;
          button.textContent = `${component.displayName}: ${target.displayName}`;
          button.addEventListener("click", () => {
            const isPress = target.interactionType === "press" || (target.interactionType === undefined && target.pressDepthMeters !== undefined);
            if (isPress && runtime && ["READY", "REDUCED_COMPLEXITY"].includes(runtime.getState().phase) && runtime.activateInteractionTarget(target.targetId)) return;
            void submit({ type: "activate_target", componentId: component.componentId, targetId: target.targetId, clientActionId: actionId(), expectedSequence: serverState.nextSequence }, target.targetId);
          });
          box.append(button);
        }
      }
      actionControls.append(box);
    }
    if(['select_component','transform_component','request_hint','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault'].includes(type)){
      const box=document.createElement('fieldset'),legend=document.createElement('legend');box.dataset.procedureAction=type;legend.textContent=`Procedure action: ${type.replaceAll('_',' ')}`;box.append(legend);actionControls.append(box);
      const explanation=document.createElement('p');explanation.textContent='Use the procedure instructions to choose a component and enter any required value or step reference. Geometry changes require permitted transform values.';box.append(explanation);
      const field=(key:string,label:string,numeric=false)=>{const wrapper=document.createElement('label'),input=document.createElement('input');input.type=numeric?'number':'text';input.step='any';input.maxLength=2000;input.dataset.procedureField=key;if(previousProcedure?.dataset.procedureAction===type)input.value=draft.get(key)??'';wrapper.append(document.createTextNode(label),input);box.append(wrapper);if(previousProcedure?.dataset.procedureAction===type&&focusedField===key){input.focus({preventScroll:true});if(selection&&selection[0]!==null&&selection[1]!==null)input.setSelectionRange(selection[0],selection[1]);}return input;};
      const value=field('value','Action value (if instructed)'),step=field('step','Step reference (if instructed)'),rotation=field('rotation','Rotation Y in radians (optional)',true),translation=field('translation','Translation X in meters (optional)',true);
      const send=document.createElement('button');send.type='button';send.textContent='Submit procedure action';box.append(send);send.onclick=()=>{
        const transform={...(rotation.value.trim()?{rotationY:Number(rotation.value)}:{}),...(translation.value.trim()?{translationX:Number(translation.value)}:{})};
        if([rotation,translation].some(input=>input.validity.badInput)||Object.values(transform).some(v=>!Number.isFinite(v))){announce('Enter finite transform values.',true);return;}
        if(type==='transform_component'&&!Object.keys(transform).length){announce('Enter a rotation or translation for this transform action.',true);return;}
        if((['select_component','transform_component'].includes(type)||Object.keys(transform).length>0)&&!selectedComponentId){announce('Choose a component first.',true);return;}
        void submit({type,clientActionId:actionId(),expectedSequence:serverState.nextSequence,source:'KEYBOARD',...(selectedComponentId?{componentId:selectedComponentId}:{}),...(value.value.trim()?{value:value.value}:{}),...(step.value.trim()?{stepId:step.value}:{}),...(Object.keys(transform).length?{transform}:{})});
      };
    }
  }
  const restoreControlFocus = () => { if (focusedKey) { const buttons = [...actionControls.querySelectorAll<HTMLButtonElement>("button")]; (buttons.find((button) => button.dataset.controlKey === focusedKey) ?? (focusedKey.endsWith(":open-fully") ? buttons.find((button) => button.dataset.controlKey === focusedKey.slice(0, -":open-fully".length)) : undefined))?.focus({ preventScroll: true }); } };
  if (!selectedComponentId) { restoreControlFocus(); return; }
  const component = manifest.components.find((item) => item.componentId === selectedComponentId);
  if (!component) { restoreControlFocus(); return; }
  const add = (label: string, action: ModelSemanticAction) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", () => void submit(action)); actionControls.append(button); };
  const canTransform = previewMode || serverState.allowedActions.includes("transform_component");
  const canReset = previewMode || serverState.allowedActions.includes("reset_component") || serverState.allowedActions.includes("transform_component");
  if (previewMode) for (const target of component.interactionTargets ?? []) {
    if (target.interactionType === "turn" || target.interactionType === "open") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.controlKey = target.targetId;
    button.textContent = `Press ${target.displayName}`;
    button.addEventListener("click", () => {
      if (runtime && ["READY", "REDUCED_COMPLEXITY"].includes(runtime.getState().phase)) runtime.activateInteractionTarget(target.targetId);
      else void submit({ type: "activate_target", componentId: component.componentId, targetId: target.targetId, source: "KEYBOARD", clientActionId: actionId(), expectedSequence: serverState.nextSequence }, target.targetId);
    });
    actionControls.append(button);
  }
  const rotation = component.permittedTransforms?.rotationY?.snap;
  const translation = component.permittedTransforms?.translationX?.snap;
  const movableTargets = component.interactionTargets?.filter((target) => target.interactionType === "turn" || target.interactionType === "open") ?? [];
  if (canTransform) for (const target of movableTargets) {
    const current = serverState.transforms[component.componentId];
    if (!current) continue;
    const addMovement = (label: string, key: string, requested: () => Partial<{ rotationY: number; translationX: number }>) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.controlKey = key;
      button.textContent = label;
      button.addEventListener("click", () => {
        const clientActionId = actionId();
        const prepareMovement = (): ModelSemanticAction | undefined => {
          const currentState = serverState.transforms[component.componentId];
          const modelComponent = (manifest as unknown as ModelManifest).components.find((item) => item.componentId === component.componentId);
          if (!currentState || !modelComponent) return;
          const change = requested();
          const next = applyPermittedTransform(modelComponent, currentState, change);
          if (!next) { announce("This movement is not available.", true); return; }
          if (target.interactionType === "turn" && ((target.turnMinRadians !== undefined && next.rotationY < target.turnMinRadians - 1e-8) || (target.turnMaxRadians !== undefined && next.rotationY > target.turnMaxRadians + 1e-8))) { announce(`${target.displayName} is at its limit.`); return; }
          if (next.rotationY === currentState.rotationY && next.translationX === currentState.translationX) { announce(`${target.displayName} is at its limit.`); return; }
          const violation = interactionStateViolation(manifest as unknown as ModelManifest, { ...serverState.transforms, [component.componentId]: next }, component.componentId);
          if (violation) { announce(violation, true); return; }
          const transform = { ...(change.rotationY !== undefined ? { rotationY: next.rotationY } : {}), ...(change.translationX !== undefined ? { translationX: next.translationX } : {}) };
          if (target.interactionType === "open" && runtime && ["READY", "REDUCED_COMPLEXITY"].includes(runtime.getState().phase)) {
            const blocked = runtime.interactionBlockReason(target.targetId, transform);
            if (blocked) { announce(blocked, true); return; }
          }
          return { type: "transform_component", componentId: component.componentId, transform, source: "KEYBOARD", clientActionId, expectedSequence: serverState.nextSequence };
        };
        if (pendingSubmissionCount > 0) {
          void submit({ type: "transform_component", componentId: component.componentId, source: "KEYBOARD", clientActionId }, target.targetId, false, prepareMovement);
          return;
        }
        const action = prepareMovement();
        if (!action) return;
        const visualState = runtime?.getState();
        const synchronized = visualState && Object.entries(serverState.transforms).every(([id, position]) => {
          const visual = visualState.transforms[id];
          return visual && Math.abs(visual.rotationY - position.rotationY) < 1e-8 && Math.abs(visual.translationX - position.translationX) < 1e-8;
        });
        if (target.interactionType === "open" && runtime && visualState && ["READY", "REDUCED_COMPLEXITY"].includes(visualState.phase) && synchronized) {
          if (visualState.pressedInteractionTargetId) { announce("Finish the current interaction first."); return; }
          const requestedPosition = action.transform?.translationX ?? action.transform?.rotationY ?? 0;
          runtime.activateInteractionTarget(target.targetId, Math.abs(requestedPosition) > 1e-5 ? 1 : -1);
          return;
        }
        void submit(action, target.targetId, false, prepareMovement);
      });
      actionControls.append(button);
    };
    if (target.interactionType === "turn" && component.permittedTransforms?.rotationY) {
      const rule = component.permittedTransforms.rotationY;
      for (const direction of [-1, 1] as const) addMovement(`Turn ${target.displayName} ${direction < 0 ? "left" : "right"}`, `${target.targetId}:${direction}`, () => ({ rotationY: Math.max(target.turnMinRadians ?? rule.min, Math.min(target.turnMaxRadians ?? rule.max, serverState.transforms[component.componentId].rotationY + direction * (rule.snap ?? rule.step ?? 0.12))) }));
    } else if (target.interactionType === "open") {
      const axis = target.openTranslationMeters !== undefined ? "translationX" : "rotationY";
      const open = target.openTranslationMeters ?? target.openRotationRadians ?? component.permittedTransforms?.rotationY?.max;
      if (open !== undefined && open !== 0) {
        const isOpen = Math.abs(current[axis]) > 1e-5;
        addMovement(`${isOpen ? target.closeVerb ?? "Close" : target.openVerb ?? "Open"} ${target.displayName}`, target.targetId, () => ({ [axis]: isOpen ? 0 : open }));
        if (isOpen && Math.abs(current[axis] - open) > 1e-5) addMovement(`${target.openVerb ?? "Open"} ${target.displayName} fully`, `${target.targetId}:open-fully`, () => ({ [axis]: open }));
      }
    }
  }
  if (canTransform && !movableTargets.length && rotation !== undefined) add("Open safety cover", { type: "transform_component", componentId: selectedComponentId, transform: { rotationY: rotation }, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
  if (canTransform && !movableTargets.length && translation !== undefined) add("Position line sensor", { type: "transform_component", componentId: selectedComponentId, transform: { translationX: translation }, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
  if (canReset && (rotation !== undefined || translation !== undefined)) add("Reset component", { type: "reset_component", componentId: selectedComponentId, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
  restoreControlFocus();
}
if (runtime) {
  showControls.hidden = runtime.listInteractionTargets().length === 0;
  const originalSelect = runtime.selectComponent;
  runtime.selectComponent = (componentId, source = "COMPONENT_LIST") => { selectedComponentId = componentId; originalSelect.call(runtime, componentId, source); renderActions(); };
  const quickViews = document.querySelector<HTMLElement>("#nxstage-quick-views");
  if (nxstageReview && quickViews) {
    quickViews.hidden = false;
    quickViews.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view-component]");
      const componentId = button?.dataset.viewComponent;
      if (!componentId || !runtime) return;
      if (componentId === "pureflow-tub") {
        const tub = manifest.components.find(component => component.componentId === componentId)?.interactionTargets?.find(target => target.targetId === "PF-C02-TUB");
        const blocked = tub?.openTranslationMeters === undefined ? undefined : runtime.interactionBlockReason(tub.targetId, { translationX: tub.openTranslationMeters });
        if (blocked) { announce(/^Open the cabinet door/i.test(blocked) ? "Open the cabinet door fully to see the PureFlow tub." : blocked); return; }
      }
      const doorAngle = componentId === "nxstage-cabinet-door" ? runtime.getState().transforms[componentId]?.rotationY ?? 0 : 0;
      runtime.frameComponent(componentId, { alpha: Math.PI / 2 - doorAngle, beta: 1.4 });
      canvas.scrollIntoView({ block: "center", behavior: "instant" });
      announce(`Focused ${manifest.components.find(component => component.componentId === componentId)?.displayName ?? "selected part"}. Drag the background to rotate, or use the controls on the model.`);
    });
  }
  const magnifier = document.querySelector<HTMLDetailsElement>("#nxstage-magnifier");
  if (nxstageReview && magnifier) {
    const regions: Record<string, string[]> = {
      left: ["NX-C01-ADD-FLUID", "NX-C01-VOLUME-TOGGLE", "NX-C01-TREATMENT"],
      decrease: ["NX-C01-ROW1-DOWN", "NX-C01-ROW2-DOWN", "NX-C01-ROW3-DOWN"],
      increase: ["NX-C01-ROW1-UP", "NX-C01-ROW2-UP", "NX-C01-ROW3-UP"],
      right: ["NX-C01-STOP", "NX-C01-MUTE"],
      "lower-arrows": ["PF-C01-UP", "PF-C01-DOWN"],
      "lower-actions": ["PF-C01-GO", "PF-C01-STOP"],
      warmer: ["FW-C01-UP", "FW-C01-DOWN"],
      "rear-switch": ["NX-C05-POWER-SWITCH"]
    };
    magnifier.hidden = false;
    magnifier.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-panel-region]");
      const ids = button?.dataset.panelRegion && regions[button.dataset.panelRegion];
      if (button?.dataset.panelRegion?.startsWith("lower-") && runtime) {
        const tub = manifest.components.find(component => component.componentId === "pureflow-tub")?.interactionTargets?.find(target => target.targetId === "PF-C02-TUB");
        const blocked = tub?.openTranslationMeters === undefined ? undefined : runtime.interactionBlockReason(tub.targetId, { translationX: tub.openTranslationMeters });
        if (blocked) { announce(/^Open the cabinet door/i.test(blocked) ? "Open the cabinet door fully to see the lower panel." : blocked); return; }
      }
      const rear = button?.dataset.panelRegion === "rear-switch";
      if (!ids || !runtime?.frameInteractionTargets(ids, { alpha: rear ? -Math.PI / 2 : Math.PI / 2, beta: rear ? 1.2 : 1.4 })) return;
      canvas.scrollIntoView({ block: "center", behavior: "instant" });
      announce(`Showing ${button.textContent?.toLowerCase() ?? "panel controls"}. Touch a control on the model.`);
    });
  }
}
showControls.addEventListener("click", () => {
  if (!runtime) return;
  const visible = showControls.getAttribute("aria-pressed") !== "true";
  runtime.setInteractionHintsVisible(visible);
  showControls.setAttribute("aria-pressed", String(visible));
  showControls.textContent = visible ? "Hide interactive parts" : "Show interactive parts";
  announce(visible ? "Interactive parts highlighted. Select or touch a highlighted part to use it." : "Interactive part highlights hidden.");
});
reset.addEventListener("click", () => { runtime?.resetView(); announce("Camera reset to fit the approved model."); if (nxstageReview) runtime?.fitModel(); });
fit.addEventListener("click", () => { runtime?.fitModel(); announce("Model fitted to the viewport."); });
function updateFocusButton() {
  const phase = runtime?.getState().phase;
  focusComponent.disabled = !selectedComponentId || !runtime || (phase !== "READY" && phase !== "REDUCED_COMPLEXITY") || (!previewMode && hasBoundSession && !sessionInteractionEnabled);
}
focusComponent.addEventListener("click", () => {
  if (!runtime || !selectedComponentId) return;
  const component = manifest.components.find((item) => item.componentId === selectedComponentId);
  if (selectedComponentId === "pureflow-tub") {
    const tub = component?.interactionTargets?.find(target => target.targetId === "PF-C02-TUB");
    const blocked = tub?.openTranslationMeters === undefined ? undefined : runtime.interactionBlockReason(tub.targetId, { translationX: tub.openTranslationMeters });
    if (blocked) { announce(/^Open the cabinet door/i.test(blocked) ? "Open the cabinet door fully to see the PureFlow tub." : blocked); return; }
  }
  runtime.frameComponent(selectedComponentId);
  if (selectedComponentId === "pureflow-control-panel") {
    const tub = manifest.components.find(item => item.componentId === "pureflow-tub")?.interactionTargets?.find(target => target.targetId === "PF-C02-TUB");
    const obscured = tub?.openTranslationMeters === undefined ? undefined : runtime.interactionBlockReason(tub.targetId, { translationX: tub.openTranslationMeters });
    if (lowerPanelGuidance) {
      lowerPanelGuidance.hidden = !obscured;
      lowerPanelGuidance.textContent = obscured ? "The cabinet door may obscure part of the lower panel. Open it fully for a complete view." : "";
    }
    if (obscured) { announce("The cabinet door may obscure part of the lower panel. Open it fully for a complete view."); return; }
  }
  announce(`Focused ${component?.displayName ?? "selected part"}.`);
});
hint.addEventListener("click", () => void submit({ type: "request_hint", clientActionId: actionId(), expectedSequence: serverState.nextSequence }));
retryAction.addEventListener("click", () => { if (lastAction) void submit(lastAction, undefined, true); });
if (hasBoundSession && !previewMode && !assetLoadFailure) {
  resumeSession.hidden = false;
  setSessionInteractive(false);
  announce("Restoring your learning session. Controls will be available when it is ready.");
  const result = applyAuthoritativeResult(await actionClient.resume());
  setSessionInteractive(result.status === "accepted");
  if (result.status !== "accepted") announce(result.feedback, true);
}
function setSessionInteractive(enabled: boolean) {
  sessionInteractionEnabled = enabled;
  runtime?.setInteractionEnabled(enabled);
  for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.disabled = !enabled;
  actionControls.inert = !enabled;
  hint.disabled = !enabled;
  showControls.disabled = !enabled || !runtime || ["ERROR", "CONTEXT_LOST"].includes(runtime.getState().phase);
  updateFocusButton();
}
resumeSession.addEventListener("click", async () => {
  setSessionInteractive(false);
  resumeSession.disabled = true;
  const result = applyAuthoritativeResult(await actionClient.resume());
  setSessionInteractive(result.status === "accepted");
  resumeSession.disabled = false;
  announce(result.feedback, result.status !== "accepted");
});
if (!runtime) runtimeState.textContent = "IDLE";
window.addEventListener("beforeunload", () => runtime?.dispose());
