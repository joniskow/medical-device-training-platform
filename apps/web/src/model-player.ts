import {fetchModelAsset} from './private-model-fetch.js';
import { BrowserSemanticActionClient, createHttpSemanticActionTransport, type AuthoritativeActionResult, type AuthoritativeModelState, type ModelRuntime, type ModelRuntimeState, type ModelSemanticAction, type SemanticActionTransport } from "./model-contract.js";
import { applyPermittedTransform, validateBrowserModelManifest, type ModelManifest } from "@medical-device/model-runtime";
import { createBabylonModelRuntime } from "./babylon-model-runtime.js";
import { validateAuthoritativeActionResult } from "./model-authority.js";
import { authenticatedFetch, getSessionIdentity, getOrganizationHeaders, getAccessToken } from "./auth-session.js";

const canvas = document.querySelector<HTMLCanvasElement>("#model-canvas")!;
const status = document.querySelector<HTMLElement>("#model-status")!;
const componentList = document.querySelector<HTMLElement>("#component-list")!;
const fps = document.querySelector<HTMLElement>("#fps")!;
const loadTime = document.querySelector<HTMLElement>("#load-time")!;
const reset = document.querySelector<HTMLButtonElement>("#reset-view")!;
const fit = document.querySelector<HTMLButtonElement>("#fit-view")!;
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

function announce(message: string, error = false) { status.textContent = message; status.className = error ? "error" : "status"; }

function renderAuthoritativeState(authoritative: AuthoritativeModelState) {
  score.textContent = String(authoritative.scorePoints);
  completion.textContent = authoritative.completed ? "Completed by the authoritative session." : "Completion is determined by the authoritative session.";
  procedureStep.textContent = authoritative.activeStepTitle
    ? `Current step · ${authoritative.activeStepTitle}`
    : authoritative.completed ? "Procedure complete." : "Waiting for the next authoritative procedure state.";
  allowedActions.textContent = authoritative.allowedActions.length > 0
    ? `Allowed actions · ${authoritative.allowedActions.join(", ")}`
    : authoritative.completed ? "Allowed actions · none; procedure complete." : "Allowed actions · awaiting authoritative procedure state.";
  procedureFault.hidden = !authoritative.activeFaultTitle;
  if (authoritative.activeFaultTitle) procedureFault.textContent = `Active fault · ${authoritative.activeFaultTitle}`;
  for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-current", button.dataset.componentId === authoritative.selectedComponentId ? "true" : "false");
}

function renderState(state: ModelRuntimeState) {
  runtimeState.textContent = state.phase;
  if (state.loadDurationMs !== undefined) loadTime.textContent = `${state.loadDurationMs} ms`;
  if (state.measuredFps !== undefined) fps.textContent = `${state.measuredFps} FPS`;
  const memory = document.querySelector<HTMLElement>("#memory");
  if (memory && state.estimatedMemoryMb !== undefined) memory.textContent = `${state.estimatedMemoryMb.toFixed(2)} MB`;
  canvas.hidden = state.phase === "ERROR" || state.phase === "REDUCED_COMPLEXITY";
  if (state.authoritative) {
    // Keep the equivalent text path explicitly tied to the server projection.
    procedureStep.textContent = state.authoritative.activeStepTitle ?? "";
    procedureFault.hidden = !state.authoritative.activeFaultTitle;
    renderAuthoritativeState(state.authoritative);
  }
  fallback.hidden = !state.fallbackReason;
  if (state.fallbackReason) fallback.textContent = state.fallbackReason;
  for (const button of componentList.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-current", button.dataset.componentId === state.selectedComponentId ? "true" : "false");
  if (state.phase === "LOADING") announce("Loading the approved AIC-001 model…");
  if (state.phase === "READY" && !state.selectedComponentId) announce("Model ready. Select a component using the canvas or component list.");
  if (state.phase === "CONTEXT_LOST") announce("3D context lost. Use the equivalent text path or reload the preview.", true);
  if (state.phase === "REDUCED_COMPLEXITY") announce("Reduced-complexity equivalent path available.", true);
  if (state.phase === "ERROR") announce(`${state.errorCode ?? "MODEL_RUNTIME_FAILED"}: ${state.errorMessage ?? "The model could not be loaded."}`, true);
}

const query = new URLSearchParams(window.location.search);
const previewMode = query.get("preview") === "1";
const sessionId = query.get("sessionId");
const releaseId = query.get("releaseId");
const modelVersionId = query.get("modelVersionId");
const hasBoundSession = Boolean(sessionId && releaseId && modelVersionId);
const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const requestedVariant = coarsePointer ? "mobile" : "full";
const staticAsset = requestedVariant === "mobile"
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
type ActivityManifest = { sourceHash: string; modelVersionId: string; releaseBindingId: string; components: Array<{ componentId: string; displayName: string; interactionCapabilities?: string[]; permittedTransforms?: { rotationY?: { min: number; max: number; step?: number; snap?: number }; translationX?: { min: number; max: number; step?: number; snap?: number } } }> };
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
const previewTransport: SemanticActionTransport = {
  async submit(action) {
    if (action.expectedSequence !== serverState.nextSequence) return { status: "stale_sequence", clientActionId: "clientActionId" in action ? action.clientActionId : undefined, nextSequence: serverState.nextSequence, feedback: "This action is stale. Resume the session before trying again." };
    const next = structuredClone(serverState);
    if (action.type === "request_hint") {
      next.sequence += 1; next.nextSequence += 1; serverState = next;
      return { status: "accepted", clientActionId: action.clientActionId, nextSequence: next.nextSequence, state: next, scoreDelta: 0, feedback: "Hint: select every component, then use the permitted action for the safety cover and line sensor." };
    }
    if (!action.componentId || !next.transforms[action.componentId]) return { status: "unknown_component", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: "That component is not part of this approved release." };
    if (action.type === "reset_component") next.transforms[action.componentId] = { rotationY: 0, translationX: 0 };
    if (action.type === "transform_component") {
      const component = manifest.components.find((item) => item.componentId === action.componentId);
      const normalized = component ? applyPermittedTransform(component, next.transforms[action.componentId], action.transform) : null;
      if (!normalized) return { status: "invalid_precondition", clientActionId: action.clientActionId, nextSequence: next.nextSequence, feedback: "That transform is outside the permitted component bounds." };
      next.transforms[action.componentId] = normalized;
    }
    const previousScore = serverState.scorePoints;
    next.sequence += 1; next.nextSequence += 1; next.selectedComponentId = action.componentId;
    next.scorePoints = Object.values(next.transforms).some((value) => value.rotationY === Math.PI / 2) && Object.values(next.transforms).some((value) => value.translationX === 0.2) ? 2 : 0;
    next.completed = next.scorePoints === 2;
    serverState = next;
    return { status: "accepted", clientActionId: action.clientActionId, nextSequence: next.nextSequence, state: next, scoreDelta: next.scorePoints - previousScore, feedback: next.completed ? "All required actions are complete." : "Accepted. Continue with the next permitted action." };
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

let runtime: ModelRuntime | undefined;
if ((previewMode || (hasBoundSession && !assetLoadFailure && !manifestLoadFailure)) && !assetLoadFailure) try {
  runtime = await createBabylonModelRuntime({fetcher:fetchModelAsset,
    canvas,
    manifestUrl: asset.manifestUrl,
    modelUrl: asset.modelUrl,
    onStateChange: renderState,
    onSemanticAction: (action) => {
      if (action.type === "select_component") {
        selectedComponentId = action.componentId;
        actionLog.textContent = `Semantic action emitted: ${action.type} · ${action.componentId} · ${action.source}. Awaiting authoritative selection.`;
        announce(`${action.componentId} selected. Confirming selection with the activity session.`);
        renderActions();
        void submit({ ...action, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
      }
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
let selectedComponentId: string | undefined;
let lastAction: ModelSemanticAction | undefined;
const pendingActionId = actionClient.getPendingActionIds()[0];
if (pendingActionId) {
  lastAction = actionClient.getPendingAction(pendingActionId);
  if (lastAction) {
    retryAction.hidden = false;
    actionLog.textContent = "A previous action was not confirmed. Review the current state, then retry it explicitly if needed.";
  }
}
function actionId() { return `aic:${crypto.randomUUID()}`; }
function authoritativeResult(received: AuthoritativeActionResult): AuthoritativeActionResult {
  return validateAuthoritativeActionResult(manifest as unknown as ModelManifest, received, serverState.sequence);
}
function applyAuthoritativeResult(received: AuthoritativeActionResult): AuthoritativeActionResult {
  const result = authoritativeResult(received);
  const scoreEffect = result.scoreDelta === undefined ? "" : ` · score ${result.scoreDelta >= 0 ? "+" : ""}${result.scoreDelta}`;
  actionLog.textContent = `${result.status}: ${result.feedback}${scoreEffect}`;
  if (result.state) {
    serverState = result.state;
    selectedComponentId = result.state.selectedComponentId;
    renderAuthoritativeState(result.state);
    runtime?.applyAuthoritativeState(result.state);
    renderActions();
  } else if (result.status !== "accepted") {
    selectedComponentId = serverState.selectedComponentId;
    renderAuthoritativeState(serverState);
    runtime?.applyAuthoritativeState(serverState);
    renderActions();
  }
  return result;
}
async function submit(action: ModelSemanticAction) {
  lastAction = action;
  const result = applyAuthoritativeResult(await actionClient.submit(action));
  retryAction.hidden = !result.retryable;
  if (result.retryable) announce("The network request can be retried without replaying the action.", true); else announce(result.feedback, result.status !== "accepted");
}
function renderActions() {
  actionControls.replaceChildren();
  if(!previewMode&&!serverState.completed){
    const type=serverState.allowedActions[0] as ModelSemanticAction['type'];
    if(['select_component','transform_component','request_hint','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault'].includes(type)){
      const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=`Procedure action: ${type.replaceAll('_',' ')}`;box.append(legend);actionControls.append(box);
      const explanation=document.createElement('p');explanation.textContent='Use the procedure instructions to choose a component and enter any required value or step reference. Geometry changes require permitted transform values.';box.append(explanation);
      const field=(label:string,numeric=false)=>{const wrapper=document.createElement('label'),input=document.createElement('input');input.type=numeric?'number':'text';input.step='any';input.maxLength=2000;wrapper.append(document.createTextNode(label),input);box.append(wrapper);return input;};
      const value=field('Action value (if instructed)'),step=field('Step reference (if instructed)'),rotation=field('Rotation Y in radians (optional)',true),translation=field('Translation X in meters (optional)',true);
      const send=document.createElement('button');send.type='button';send.textContent='Submit procedure action';box.append(send);send.onclick=()=>{
        const transform={...(rotation.value.trim()?{rotationY:Number(rotation.value)}:{}),...(translation.value.trim()?{translationX:Number(translation.value)}:{})};
        if([rotation,translation].some(input=>input.validity.badInput)||Object.values(transform).some(v=>!Number.isFinite(v))){announce('Enter finite transform values.',true);return;}
        if(type==='transform_component'&&!Object.keys(transform).length){announce('Enter a rotation or translation for this transform action.',true);return;}
        if((['select_component','transform_component'].includes(type)||Object.keys(transform).length>0)&&!selectedComponentId){announce('Choose a component first.',true);return;}
        void submit({type,clientActionId:actionId(),expectedSequence:serverState.nextSequence,source:'KEYBOARD',...(selectedComponentId?{componentId:selectedComponentId}:{}),...(value.value.trim()?{value:value.value}:{}),...(step.value.trim()?{stepId:step.value}:{}),...(Object.keys(transform).length?{transform}:{})});
      };
    }
  }
  if (!selectedComponentId) return;
  const component = manifest.components.find((item) => item.componentId === selectedComponentId);
  if (!component) return;
  const add = (label: string, action: ModelSemanticAction) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", () => void submit(action)); actionControls.append(button); };
  const canTransform = previewMode || serverState.allowedActions.includes("transform_component");
  const canReset = previewMode || serverState.allowedActions.includes("reset_component") || serverState.allowedActions.includes("transform_component");
  const rotation = component.permittedTransforms?.rotationY?.snap;
  const translation = component.permittedTransforms?.translationX?.snap;
  if (canTransform && rotation !== undefined) add("Open safety cover", { type: "transform_component", componentId: selectedComponentId, transform: { rotationY: rotation }, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
  if (canTransform && translation !== undefined) add("Position line sensor", { type: "transform_component", componentId: selectedComponentId, transform: { translationX: translation }, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
  if (canReset && (rotation !== undefined || translation !== undefined)) add("Reset component", { type: "reset_component", componentId: selectedComponentId, clientActionId: actionId(), expectedSequence: serverState.nextSequence });
}
if (runtime) {
  const originalSelect = runtime.selectComponent;
  runtime.selectComponent = (componentId, source = "COMPONENT_LIST") => { selectedComponentId = componentId; originalSelect.call(runtime, componentId, source); renderActions(); };
}
reset.addEventListener("click", () => { runtime?.resetView(); announce("Camera reset to fit the approved model."); });
fit.addEventListener("click", () => { runtime?.resetView(); announce("Model fitted to the viewport."); });
hint.addEventListener("click", () => void submit({ type: "request_hint", clientActionId: actionId(), expectedSequence: serverState.nextSequence }));
retryAction.addEventListener("click", () => { if (lastAction) void submit(lastAction); });
if (hasBoundSession && !previewMode && !assetLoadFailure) {
  resumeSession.hidden = false;
  const result = applyAuthoritativeResult(await actionClient.resume());
  if (result.status !== "accepted") announce(result.feedback, true);
}
resumeSession.addEventListener("click", async () => {
  const result = applyAuthoritativeResult(await actionClient.resume());
  announce(result.feedback, result.status !== "accepted");
});
if (!runtime) runtimeState.textContent = "IDLE";
window.addEventListener("beforeunload", () => runtime?.dispose());
