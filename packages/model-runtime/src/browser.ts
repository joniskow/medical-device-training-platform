import type { ModelManifest } from "./glb-manifest.js";

export type ModelRuntimePhase = "IDLE" | "LOADING" | "READY" | "ERROR" | "CONTEXT_LOST" | "REDUCED_COMPLEXITY";
export type ModelSelectionSource = "CANVAS" | "COMPONENT_LIST" | "KEYBOARD";
export type SemanticActionStatus = "accepted" | "invalid_precondition" | "stale_sequence" | "expired_session" | "unknown_component" | "version_mismatch" | "retryable_network_failure";
export interface ComponentTransform { rotationY: number; translationX: number; }
export interface AuthoritativeModelState { releaseBindingId: string; modelVersionId: string; sequence: number; nextSequence: number; selectedComponentId?: string; transforms: Record<string, ComponentTransform>; scorePoints: number; completed: boolean; activeStepId?: string; activeStepTitle?: string; activeFaultId?: string; activeFaultTitle?: string; allowedActions: string[]; }
export interface AuthoritativeActionResult { status: SemanticActionStatus; clientActionId?: string; nextSequence: number; state?: AuthoritativeModelState; feedback: string; scoreDelta?: number; retryable?: boolean; }

/** Return the first unmet physical dependency in a complete model state. */
export function interactionStateViolation(manifest: ModelManifest, transforms: Record<string, ComponentTransform>, changedComponentId?: string): string | undefined {
  const components = changedComponentId ? [...manifest.components].sort((a, b) => Number(b.componentId === changedComponentId) - Number(a.componentId === changedComponentId)) : manifest.components;
  for (const component of components) for (const target of component.interactionTargets ?? []) {
    if (target.interactionType !== "open" || (!target.openRequires && !target.closeRequires)) continue;
    const position = transforms[component.componentId];
    if (!position) return "The model component state is incomplete.";
    const value = target.openTranslationMeters !== undefined ? position.translationX : position.rotationY;
    const open = target.openTranslationMeters ?? target.openRotationRadians ?? component.permittedTransforms?.rotationY?.max ?? 0;
    const requirements = [Math.abs(value) > 1e-5 ? target.openRequires : undefined, Math.abs(value - open) > 1e-5 ? target.closeRequires : undefined];
    for (const requirement of requirements) {
      if (requirement && (!transforms[requirement.componentId] || Math.abs(transforms[requirement.componentId][requirement.transform] - requirement.value) > 1e-5)) return requirement.message;
    }
  }
  return undefined;
}

/** Mechanical availability only; the published procedure still decides whether an action advances the task. */
export function modelInteractionOptions(manifest: ModelManifest, state: Pick<AuthoritativeModelState, 'transforms' | 'completed'>) {
  return manifest.components.flatMap(component => (component.interactionTargets ?? []).flatMap(target => {
    const positions: Array<{ label: string; transform?: Partial<ComponentTransform> }> = target.interactionType === 'open'
      ? [
        { label: target.openVerb ?? `Open ${target.displayName}`, transform: target.openTranslationMeters !== undefined ? { translationX: target.openTranslationMeters } : { rotationY: target.openRotationRadians ?? component.permittedTransforms?.rotationY?.max ?? 0 } },
        { label: target.closeVerb ?? `Close ${target.displayName}`, transform: target.openTranslationMeters !== undefined ? { translationX: 0 } : { rotationY: 0 } }
      ]
      : [{ label: target.displayName }];
    return positions.map(position => {
      const normalized = position.transform ? applyPermittedTransform(component, state.transforms[component.componentId] ?? { rotationY: 0, translationX: 0 }, position.transform) : undefined;
      const blockedReason = state.completed ? 'This attempt is complete.'
        : position.transform && !normalized ? 'This movement is unavailable.'
        : normalized ? interactionStateViolation(manifest, { ...state.transforms, [component.componentId]: normalized }, component.componentId) : undefined;
      return { componentId: component.componentId, targetId: target.targetId, label: position.label,
        type: position.transform ? 'transform_component' as const : 'activate_target' as const,
        ...(position.transform ? { transform: position.transform } : {}), enabled: !blockedReason,
        ...(blockedReason ? { blockedReason } : {}) };
    });
  }));
}

export function validateAuthoritativeModelState(manifest: ModelManifest, state: AuthoritativeModelState): boolean {
  if (state.releaseBindingId !== manifest.releaseBindingId || state.modelVersionId !== manifest.modelVersionId) return false;
  if (!Number.isSafeInteger(state.sequence) || state.sequence < 0 || !Number.isSafeInteger(state.nextSequence) || state.nextSequence !== state.sequence + 1) return false;
  if (!Number.isFinite(state.scorePoints) || state.scorePoints < 0 || typeof state.completed !== "boolean" || !Array.isArray(state.allowedActions) || !state.allowedActions.every((action) => typeof action === "string" && action.length > 0)) return false;
  if (state.selectedComponentId !== undefined && !manifest.components.some((component) => component.componentId === state.selectedComponentId)) return false;
  const expectedIds = new Set(manifest.components.map((component) => component.componentId));
  const actualIds = Object.keys(state.transforms);
  if (actualIds.length !== expectedIds.size || actualIds.some((componentId) => !expectedIds.has(componentId))) return false;
  const stateTransformAllowed = (value: number, rule: { min: number; max: number; step: number; snap?: number } | undefined): boolean => {
    if (!Number.isFinite(value)) return false;
    if (!rule) return value === 0;
    const normalized = applyPermittedTransform({ permittedTransforms: { rotationY: rule } }, { rotationY: 0, translationX: 0 }, { rotationY: value });
    return normalized !== null && Math.abs(normalized.rotationY - value) <= Number.EPSILON * 16 * Math.max(1, Math.abs(normalized.rotationY), Math.abs(value));
  };
  return manifest.components.every((component) => {
    const transform = state.transforms[component.componentId];
    return stateTransformAllowed(transform.rotationY, component.permittedTransforms?.rotationY)
      && stateTransformAllowed(transform.translationX, component.permittedTransforms?.translationX);
  }) && interactionStateViolation(manifest, state.transforms) === undefined;
}

export function applyPermittedTransform(component: { permittedTransforms?: { rotationY?: { min: number; max: number; step?: number; snap?: number }; translationX?: { min: number; max: number; step?: number; snap?: number } } }, current: ComponentTransform, requested: Partial<ComponentTransform> | undefined): ComponentTransform | null {
  if (!requested || (requested.rotationY === undefined && requested.translationX === undefined)) return null;
  const normalize = (value: number, rule: { min: number; max: number; step?: number; snap?: number } | undefined): number | null => {
    if (!rule || !Number.isFinite(value)) return null;
    const increment = rule.snap ?? rule.step;
    const snapped = increment && increment > 0 ? rule.min + Math.round((value - rule.min) / increment) * increment : value;
    const epsilon = Math.max(1e-12, Math.abs(increment ?? 0) * 1e-12);
    const normalized = Math.abs(snapped - rule.min) <= epsilon ? rule.min : Math.abs(snapped - rule.max) <= epsilon ? rule.max : snapped;
    return normalized < rule.min || normalized > rule.max ? null : normalized;
  };
  const rotationY = requested.rotationY === undefined ? current.rotationY : normalize(requested.rotationY, component.permittedTransforms?.rotationY);
  const translationX = requested.translationX === undefined ? current.translationX : normalize(requested.translationX, component.permittedTransforms?.translationX);
  return rotationY === null || translationX === null ? null : { rotationY, translationX };
}

export type ModelSemanticAction =
  | { type: "select_component"; componentId: string; source: ModelSelectionSource }
  | { type: "transform_component"; componentId: string; transform: Partial<ComponentTransform>; clientActionId: string; expectedSequence: number }
  | { type: "reset_component"; componentId: string; clientActionId: string; expectedSequence: number }
  | { type: "request_hint"; clientActionId: string; expectedSequence: number };

export interface ModelRuntimeState {
  phase: ModelRuntimePhase;
  selectedComponentId?: string;
  componentIds: string[];
  transforms: Record<string, ComponentTransform>;
  authoritative?: AuthoritativeModelState;
  loadDurationMs?: number;
  measuredFps?: number;
  estimatedMemoryMb?: number;
  fallbackReason?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ModelRuntime {
  getState(): ModelRuntimeState;
  selectComponent(componentId: string, source?: ModelSelectionSource): void;
  applyAuthoritativeState(state: AuthoritativeModelState): void;
  resetView(): void;
  dispose(): void;
}

export interface SemanticActionTransport {
  submit(action: Exclude<ModelSemanticAction, { type: "select_component" }>): Promise<AuthoritativeActionResult>;
  resume(input: { releaseBindingId: string; modelVersionId: string; nextSequence: number }): Promise<AuthoritativeActionResult>;
}

export interface SemanticActionClient {
  submit(action: Exclude<ModelSemanticAction, { type: "select_component" }>): Promise<AuthoritativeActionResult>;
  resume(): Promise<AuthoritativeActionResult>;
}

function isSafeModelBlobKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value !== value.trim()) return false;
  if (/[\u0000-\u001F\u007F]/.test(value) || value.includes("\\") || value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  return !value.split("/").some((segment) => segment === "." || segment === "..");
}

export function validateBrowserModelManifest(value: unknown): ModelManifest {
  if (!value || typeof value !== "object") throw new Error("MODEL_MANIFEST_INVALID");
  const manifest = value as Partial<ModelManifest>;
  if (manifest.schemaVersion !== "model-manifest.v1" || manifest.format !== "glb") throw new Error("MODEL_MANIFEST_VERSION_UNSUPPORTED");
  if (manifest.normalizationStatus !== "CANONICAL" || manifest.unitSystem !== "meter" || manifest.upAxis !== "Y" || manifest.handedness !== "right" || manifest.origin !== "bounding-box-center" || manifest.forwardAxis !== "-Z" || typeof manifest.scaleMeters !== "number" || !Number.isFinite(manifest.scaleMeters) || manifest.scaleMeters <= 0) throw new Error("MODEL_MANIFEST_NOT_CANONICAL");
  if (typeof manifest.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sourceHash) || typeof manifest.modelVersionId !== "string" || !manifest.modelVersionId.trim() || typeof manifest.releaseBindingId !== "string" || !manifest.releaseBindingId.trim()) throw new Error("MODEL_MANIFEST_BINDING_REQUIRED");
  const counts = [manifest.sceneNodeCount, manifest.meshCount, manifest.materialCount, manifest.textureCount, manifest.triangleCount];
  if (counts.some((count) => !Number.isSafeInteger(count) || Number(count) < 0)) throw new Error("MODEL_COUNTS_INVALID");
  if (!Array.isArray(manifest.materials) || manifest.materials.length !== manifest.materialCount || !manifest.materials.every((item) => item && typeof item === "object" && typeof (item as { materialId?: unknown }).materialId === "string" && typeof (item as { name?: unknown }).name === "string") || !Array.isArray(manifest.textures) || manifest.textures.length !== manifest.textureCount || !manifest.textures.every((item) => item && typeof item === "object" && typeof (item as { textureId?: unknown }).textureId === "string" && typeof (item as { sha256?: unknown }).sha256 === "string" && /^[a-f0-9]{64}$/i.test(String((item as { sha256?: unknown }).sha256)) && Number.isSafeInteger((item as { byteLength?: unknown }).byteLength) && Number((item as { byteLength: number }).byteLength) >= 0)) throw new Error("MODEL_MATERIALS_INVALID");
  if (!Array.isArray(manifest.components) || manifest.components.length === 0 || !manifest.components.every((component) => component && typeof component === "object")) throw new Error("MODEL_COMPONENTS_REQUIRED");
  if (manifest.performanceBudget && (!Number.isFinite(manifest.performanceBudget.minimumFps) || manifest.performanceBudget.minimumFps < 1 || !Number.isFinite(manifest.performanceBudget.interactiveWithinMs) || manifest.performanceBudget.interactiveWithinMs < 1 || !Number.isFinite(manifest.performanceBudget.maxMemoryMb) || manifest.performanceBudget.maxMemoryMb < 1)) throw new Error("MODEL_PERFORMANCE_BUDGET_INVALID");
  if (manifest.fidelity) {
    const fidelity = manifest.fidelity;
    const invalid = !["SEMANTIC_FIXTURE", "VISUAL_RECONSTRUCTION", "DIMENSIONALLY_VALIDATED"].includes(fidelity.status)
      || !["PROCEDURAL_SYNTHETIC", "REFERENCE_IMAGES", "PHOTOGRAMMETRY", "MEASURED_CAD"].includes(fidelity.sourceType)
      || !["UNMEASURED", "REFERENCE_MEASURED", "CALIBRATED"].includes(fidelity.scaleStatus)
      || !["UNKNOWN", "BOUNDED", "LOW"].includes(fidelity.hiddenSurfaceUncertainty)
      || typeof fidelity.summary !== "string"
      || !fidelity.summary.trim()
      || (fidelity.evidenceRefs !== undefined && (!Array.isArray(fidelity.evidenceRefs) || !fidelity.evidenceRefs.every((ref) => typeof ref === "string" && ref.trim())))
      || (fidelity.status === "DIMENSIONALLY_VALIDATED" && (fidelity.scaleStatus === "UNMEASURED" || fidelity.hiddenSurfaceUncertainty === "UNKNOWN"));
    if (invalid) throw new Error("MODEL_FIDELITY_INVALID");
  }
  const ids = manifest.components.map((component) => component.componentId);
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) throw new Error("MODEL_COMPONENTS_INVALID");
  const nodePaths = manifest.components.map((component) => component.nodePath);
  if (nodePaths.some((path) => typeof path !== "string" || path.length === 0) || new Set(nodePaths).size !== nodePaths.length) throw new Error("MODEL_NODE_MAPPING_INVALID");
  for (const component of manifest.components) {
    if (typeof component.nodePath !== "string" || !component.nodePath || typeof component.displayName !== "string" || !component.displayName || !Array.isArray(component.aliases) || !component.aliases.every((alias) => typeof alias === "string") || !Array.isArray(component.interactionCapabilities) || !component.interactionCapabilities.every((capability) => typeof capability === "string")) throw new Error("MODEL_COMPONENTS_INVALID");
    const volume = component.interactionVolume;
    if (volume && (!Array.isArray(volume.min) || !Array.isArray(volume.max) || volume.min.length !== 3 || volume.max.length !== 3 || volume.min.some((item) => typeof item !== "number" || !Number.isFinite(item)) || volume.max.some((item) => typeof item !== "number" || !Number.isFinite(item)) || volume.min.some((item, index) => item > volume.max[index]!))) throw new Error("MODEL_INTERACTION_VOLUME_INVALID");
    if (component.interactionTargets !== undefined) {
      if (!Array.isArray(component.interactionTargets) || component.interactionTargets.length === 0 || new Set(component.interactionTargets.map((target) => target.targetId)).size !== component.interactionTargets.length || new Set(component.interactionTargets.map((target) => target.nodePath)).size !== component.interactionTargets.length) throw new Error("MODEL_INTERACTION_TARGETS_INVALID");
      for (const target of component.interactionTargets) {
        if (!target || typeof target.targetId !== "string" || !target.targetId.trim() || typeof target.nodePath !== "string" || !target.nodePath.trim() || typeof target.displayName !== "string" || !target.displayName.trim()) throw new Error("MODEL_INTERACTION_TARGETS_INVALID");
        if (target.interactionType !== undefined && !["press", "turn", "open"].includes(target.interactionType)) throw new Error("MODEL_INTERACTION_TYPE_INVALID");
        if (target.pressDepthMeters !== undefined && (!Number.isFinite(target.pressDepthMeters) || target.pressDepthMeters <= 0 || target.pressDepthMeters > 0.05)) throw new Error("MODEL_PRESS_DEPTH_INVALID");
        if (target.pressAxis !== undefined && (!Array.isArray(target.pressAxis) || target.pressAxis.length !== 3 || target.pressAxis.some((value) => typeof value !== "number" || !Number.isFinite(value)) || Math.hypot(...target.pressAxis) < 1e-6)) throw new Error("MODEL_PRESS_AXIS_INVALID");
        if (target.turnSensitivity !== undefined && (!Number.isFinite(target.turnSensitivity) || target.turnSensitivity <= 0 || target.turnSensitivity > 1)) throw new Error("MODEL_TURN_SENSITIVITY_INVALID");
        if ((target.turnMinRadians !== undefined && !Number.isFinite(target.turnMinRadians)) || (target.turnMaxRadians !== undefined && !Number.isFinite(target.turnMaxRadians)) || (target.turnMinRadians !== undefined && target.turnMaxRadians !== undefined && target.turnMinRadians > target.turnMaxRadians)) throw new Error("MODEL_TURN_RANGE_INVALID");
        if (target.openRotationRadians !== undefined && !Number.isFinite(target.openRotationRadians)) throw new Error("MODEL_OPEN_ROTATION_INVALID");
        if (target.openRotationSpace !== undefined && (target.openRotationSpace !== "local" || target.interactionType !== "open" || target.openTranslationMeters !== undefined)) throw new Error("MODEL_OPEN_ROTATION_SPACE_INVALID");
        if (target.touchTapSlopPixels !== undefined && (target.interactionType !== "open" || !Number.isFinite(target.touchTapSlopPixels) || target.touchTapSlopPixels < 6 || target.touchTapSlopPixels > 24)) throw new Error("MODEL_TOUCH_TAP_SLOP_INVALID");
        if (target.openLiftMeters !== undefined && (!Number.isFinite(target.openLiftMeters) || target.openLiftMeters <= 0 || target.openLiftMeters > 1 || target.interactionType !== "open" || target.openTranslationMeters !== undefined)) throw new Error("MODEL_OPEN_LIFT_INVALID");
        if (target.openTranslationMeters !== undefined && (!Number.isFinite(target.openTranslationMeters) || target.interactionType !== "open" || target.openRotationRadians !== undefined)) throw new Error("MODEL_OPEN_TRANSLATION_INVALID");
        if (target.openDragDirection !== undefined && (target.interactionType !== "open" || !Array.isArray(target.openDragDirection) || target.openDragDirection.length !== 2 || target.openDragDirection.some((value) => !Number.isFinite(value)) || Math.hypot(...target.openDragDirection) < 1e-6)) throw new Error("MODEL_OPEN_DRAG_DIRECTION_INVALID");
        for (const verb of [target.openVerb, target.closeVerb]) if (verb !== undefined && (target.interactionType !== "open" || typeof verb !== "string" || !verb.trim() || verb.length > 40)) throw new Error("MODEL_OPEN_VERB_INVALID");
      }
    }
    const rotatingTargets = (component.interactionTargets ?? []).filter(target => target.interactionType === "turn" || (target.interactionType === "open" && target.openTranslationMeters === undefined));
    if (rotatingTargets.some(target => target.openRotationSpace === "local") && rotatingTargets.some(target => target.interactionType !== "turn" && target.openRotationSpace !== "local")) throw new Error("MODEL_OPEN_ROTATION_SPACE_INVALID");
    for (const rule of [component.permittedTransforms?.rotationY, component.permittedTransforms?.translationX]) {
      if (rule && (typeof rule.min !== "number" || typeof rule.max !== "number" || !Number.isFinite(rule.min) || !Number.isFinite(rule.max) || rule.min > rule.max || typeof rule.step !== "number" || !Number.isFinite(rule.step) || rule.step <= 0 || (rule.snap !== undefined && (typeof rule.snap !== "number" || !Number.isFinite(rule.snap) || rule.snap <= 0)))) throw new Error("MODEL_TRANSFORM_RULE_INVALID");
    }
    for (const target of component.interactionTargets ?? []) {
      if (target.interactionType !== "open" && target.interactionType !== "turn") continue;
      if (target.openTranslationMeters !== undefined) {
        const rule = component.permittedTransforms?.translationX;
        const normalized = applyPermittedTransform(component, { rotationY: 0, translationX: 0 }, { translationX: target.openTranslationMeters });
        const zero = applyPermittedTransform(component, { rotationY: 0, translationX: 0 }, { translationX: 0 });
        if (!rule || rule.min > 0 || rule.max < 0 || target.openTranslationMeters === 0 || !zero || Math.abs(zero.translationX) > 1e-9 || !normalized || Math.abs(normalized.translationX - target.openTranslationMeters) > 1e-9) throw new Error("MODEL_OPEN_TRANSLATION_INVALID");
        continue;
      }
      const rule = component.permittedTransforms?.rotationY;
      if (!rule || rule.min > 0 || rule.max < 0) throw new Error("MODEL_INTERACTION_ROTATION_INVALID");
      const isSetting = (value: number) => {
        const normalized = applyPermittedTransform(component, { rotationY: 0, translationX: 0 }, { rotationY: value });
        return normalized !== null && Math.abs(normalized.rotationY - value) <= 1e-9;
      };
      if (!isSetting(0)) throw new Error("MODEL_INTERACTION_ROTATION_INVALID");
      if (target.interactionType === "turn") {
        const min = Math.max(rule.min, target.turnMinRadians ?? rule.min);
        const max = Math.min(rule.max, target.turnMaxRadians ?? rule.max);
        if (min >= max || min > 0 || max < 0 || !isSetting(min) || !isSetting(max)) throw new Error("MODEL_INTERACTION_ROTATION_INVALID");
      } else {
        const open = target.openRotationRadians ?? rule.max;
        if (open === 0 || !isSetting(open)) throw new Error("MODEL_INTERACTION_ROTATION_INVALID");
      }
    }
  }
  for (const component of manifest.components) for (const target of component.interactionTargets ?? []) {
    for (const requirement of [target.openRequires, target.closeRequires]) {
      if (requirement === undefined) continue;
      if (target.interactionType !== "open" || !requirement || typeof requirement.componentId !== "string" || requirement.componentId === component.componentId || !["rotationY", "translationX"].includes(requirement.transform) || !Number.isFinite(requirement.value) || typeof requirement.message !== "string" || !requirement.message.trim()) throw new Error("MODEL_INTERACTION_REQUIREMENT_INVALID");
      const dependency = manifest.components.find((item) => item.componentId === requirement.componentId);
      const rule = dependency?.permittedTransforms?.[requirement.transform];
      const normalized = dependency && applyPermittedTransform(dependency, { rotationY: 0, translationX: 0 }, { [requirement.transform]: requirement.value });
      if (!rule || !normalized || Math.abs(normalized[requirement.transform] - requirement.value) > 1e-9) throw new Error("MODEL_INTERACTION_REQUIREMENT_INVALID");
    }
  }
  if (manifest.variant !== undefined) {
    const variant = manifest.variant;
    if (!variant || !/^[A-Za-z0-9._-]{1,64}$/.test(variant.variantId) || !["mobile-optimized", "reduced-complexity", "full"].includes(variant.role) || !Array.isArray(variant.targetProfiles) || !variant.targetProfiles.every((profile) => typeof profile === "string" && profile.length > 0) || typeof variant.materialMode !== "string" || typeof variant.geometryReduction !== "string" || !Array.isArray(variant.preservesComponentIds) || !variant.preservesComponentIds.every((componentId) => typeof componentId === "string" && componentId.length > 0)) throw new Error("MODEL_VARIANT_INVALID");
    const componentIds = manifest.components.map((component) => component.componentId);
    if (variant.preservesComponentIds.length !== componentIds.length || new Set(variant.preservesComponentIds).size !== componentIds.length || variant.preservesComponentIds.some((componentId) => !componentIds.includes(componentId))) throw new Error("MODEL_VARIANT_COMPONENTS_INVALID");
  }
  if (manifest.variants !== undefined) {
    if (!Array.isArray(manifest.variants)) throw new Error("MODEL_VARIANTS_INVALID");
    const validVariants = manifest.variants.every((variant) => {
      if (!variant || typeof variant !== "object") return false;
      const candidate = variant as { variantId?: unknown; sourceHash?: unknown; modelVersionId?: unknown; releaseBindingId?: unknown; modelBlobKey?: unknown; manifestBlobKey?: unknown; targetProfiles?: unknown };
      if (typeof candidate.variantId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(candidate.variantId) || typeof candidate.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.sourceHash)) return false;
      if (candidate.modelBlobKey !== undefined && !isSafeModelBlobKey(candidate.modelBlobKey)) return false;
      if (candidate.manifestBlobKey !== undefined && !isSafeModelBlobKey(candidate.manifestBlobKey)) return false;
      if (candidate.targetProfiles !== undefined && (!Array.isArray(candidate.targetProfiles) || !candidate.targetProfiles.every((profile) => typeof profile === "string" && profile.length > 0))) return false;
      const hasBinding = candidate.modelVersionId !== undefined || candidate.releaseBindingId !== undefined;
      if (hasBinding && (typeof candidate.modelVersionId !== "string" || !candidate.modelVersionId.trim() || candidate.modelVersionId !== manifest.modelVersionId || typeof candidate.releaseBindingId !== "string" || !candidate.releaseBindingId.trim() || candidate.releaseBindingId !== manifest.releaseBindingId)) return false;
      return true;
    });
    if (!validVariants || new Set(manifest.variants.map((variant) => variant.variantId)).size !== manifest.variants.length) throw new Error("MODEL_VARIANTS_INVALID");
  }
  return manifest as ModelManifest;
}
