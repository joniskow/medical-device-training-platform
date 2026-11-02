export type ModelRuntimePhase = "IDLE" | "LOADING" | "READY" | "ERROR" | "CONTEXT_LOST" | "REDUCED_COMPLEXITY";
export type ModelSelectionSource = "CANVAS" | "COMPONENT_LIST" | "KEYBOARD";
export type SemanticActionStatus = "accepted" | "invalid_precondition" | "stale_sequence" | "expired_session" | "unknown_component" | "version_mismatch" | "retryable_network_failure";

export interface ComponentTransform { rotationY: number; translationX: number; }

export interface ModelComponentManifest {
  componentId: string;
  nodePath: string;
  displayName: string;
  aliases: string[];
  interactionCapabilities: string[];
  interactionVolume?: { min: [number, number, number]; max: [number, number, number] };
  interactionTargets?: Array<{ targetId: string; nodePath: string; displayName: string; pressDepthMeters?: number; pressAxis?: [number, number, number] }>;
  permittedTransforms?: { rotationY?: { min: number; max: number; step: number; snap?: number }; translationX?: { min: number; max: number; step: number; snap?: number } };
}

export interface ApprovedModelManifest {
  schemaVersion: "model-manifest.v1";
  format: "glb";
  sourceHash: string;
  modelVersionId: string;
  releaseBindingId: string;
  normalizationStatus: "CANONICAL";
  unitSystem: "meter";
  scaleMeters: 1;
  upAxis: "Y";
  handedness: "right";
  origin: "bounding-box-center";
  forwardAxis: "-Z";
  sceneNodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  triangleCount: number;
  materials: Array<{ materialId: string; name: string }>;
  textures: Array<{ textureId: string; sha256: string; byteLength: number }>;
  components: ModelComponentManifest[];
}

export interface ModelSemanticAction {
 type: 'select_component'|'activate_target'|'transform_component'|'reset_component'|'request_hint'|'open_component'|'inspect_component'|'complete_step'|'acknowledge_fault'|'diagnose_fault'|'resolve_fault';
 componentId?:string;targetId?:string;source?:ModelSelectionSource;transform?:Partial<ComponentTransform>;value?:string;stepId?:string;clientActionId?:string;expectedSequence?:number;
}

export interface AuthoritativeModelState {
  releaseBindingId: string;
  modelVersionId: string;
  sequence: number;
  nextSequence: number;
  selectedComponentId?: string;
  transforms: Record<string, ComponentTransform>;
  scorePoints: number;
  completed: boolean;
  activeStepId?: string;
  activeStepTitle?: string;
  activeFaultId?: string;
  activeFaultTitle?: string;
  allowedActions: string[];
}

export interface AuthoritativeActionResult {
  status: SemanticActionStatus;
  clientActionId?: string;
  nextSequence: number;
  state?: AuthoritativeModelState;
  feedback: string;
  scoreDelta?: number;
  retryable?: boolean;
}

export interface ModelRuntimeState {
  phase: ModelRuntimePhase;
  selectedComponentId?: string;
  pressedInteractionTargetId?: string;
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
  submit(action: ModelSemanticAction): Promise<AuthoritativeActionResult>;
  resume(input: { releaseBindingId: string; modelVersionId: string; nextSequence: number }): Promise<AuthoritativeActionResult>;
}

export function createHttpSemanticActionTransport(input: { baseUrl: string; sessionId: string; releaseBindingId: string; modelVersionId: string; authorization?: string; organizationId?:string; fetcher?: typeof fetch }): SemanticActionTransport {
  const fetcher = input.fetcher ?? fetch;
  const url = `${input.baseUrl.replace(/\/$/, "")}/api/v1/model-sessions/${encodeURIComponent(input.sessionId)}/actions`;
  const headers = () => ({ "content-type": "application/json", ...(input.organizationId?{"x-organization-id":input.organizationId}:{}), ...(input.authorization ? { authorization: input.authorization } : {}) });
  return {
    async submit(action) {
      if (!action.clientActionId) throw new Error("MODEL_ACTION_ID_REQUIRED");
      const boundAction = { ...action, releaseBindingId: input.releaseBindingId, modelVersionId: input.modelVersionId };
      const response = await fetcher(url, { method: "POST", headers: { ...headers(), "idempotency-key": action.clientActionId }, body: JSON.stringify(boundAction) });
      if (!response.ok) throw new Error(`MODEL_ACTION_HTTP_${response.status}`);
      return await response.json() as AuthoritativeActionResult;
    },
    async resume(request) {
      const response = await fetcher(`${input.baseUrl.replace(/\/$/, "")}/api/v1/model-sessions/${encodeURIComponent(input.sessionId)}?releaseBindingId=${encodeURIComponent(request.releaseBindingId)}&modelVersionId=${encodeURIComponent(request.modelVersionId)}&nextSequence=${request.nextSequence}`, { headers: headers() });
      if (!response.ok) throw new Error(`MODEL_RESUME_HTTP_${response.status}`);
      return await response.json() as AuthoritativeActionResult;
    }
  };
}

export interface SemanticActionClient {
  submit(action: ModelSemanticAction): Promise<AuthoritativeActionResult>;
  resume(): Promise<AuthoritativeActionResult>;
}

function hasCacheableAuthoritativeState(result: AuthoritativeActionResult, action: ModelSemanticAction, binding: { releaseBindingId: string; modelVersionId: string }): boolean {
  const state = result.state;
  if (result.status !== "accepted" || !state) return false;
  if (state.releaseBindingId !== binding.releaseBindingId || state.modelVersionId !== binding.modelVersionId) return false;
  if (!Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.nextSequence) || state.nextSequence !== state.sequence + 1 || result.nextSequence !== state.nextSequence) return false;
  return !('expectedSequence' in action) || action.expectedSequence === state.sequence;
}

export class BrowserSemanticActionClient implements SemanticActionClient {
  private readonly pending = new Map<string, Promise<AuthoritativeActionResult>>();
  private readonly completed = new Map<string, { action: ModelSemanticAction; result: AuthoritativeActionResult }>();
  private readonly storage: Storage | undefined;
  constructor(private readonly transport: SemanticActionTransport, private readonly binding: { releaseBindingId: string; modelVersionId: string; getNextSequence: () => number }, private readonly storagePrefix = "mdt.model-action", storage?: Storage, private readonly canCacheAcceptedResult?: (result: AuthoritativeActionResult, action: ModelSemanticAction) => boolean) { this.storage = storage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage); }
  submit(action: ModelSemanticAction): Promise<AuthoritativeActionResult> {
    const clientActionId = "clientActionId" in action ? action.clientActionId : undefined;
    if (clientActionId && !this.completed.has(clientActionId)) {
      const saved = this.storage?.getItem(`${this.storagePrefix}.result.${clientActionId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as AuthoritativeActionResult | { action?: unknown; result?: AuthoritativeActionResult };
          if (parsed && typeof parsed === "object" && "result" in parsed && parsed.result && JSON.stringify(parsed.action) === JSON.stringify(action)) this.completed.set(clientActionId, { action, result: parsed.result });
          else if (parsed && typeof parsed === "object" && "status" in parsed) this.completed.set(clientActionId, { action, result: parsed as AuthoritativeActionResult });
          else this.storage?.removeItem(`${this.storagePrefix}.result.${clientActionId}`);
        } catch { this.storage?.removeItem(`${this.storagePrefix}.result.${clientActionId}`); }
      }
    }
    if (clientActionId && this.completed.has(clientActionId)) {
      const saved = this.completed.get(clientActionId)!;
      if (JSON.stringify(saved.action) === JSON.stringify(action)) return Promise.resolve(saved.result);
      this.completed.delete(clientActionId);
      this.storage?.removeItem(`${this.storagePrefix}.result.${clientActionId}`);
    }
    if (clientActionId && this.pending.has(clientActionId)) return this.pending.get(clientActionId)!;
    if (clientActionId) this.storage?.setItem(`${this.storagePrefix}.pending.${clientActionId}`, JSON.stringify(action));
    const request = this.transport.submit(action).then((result) => {
      if (clientActionId) {
        const cacheable = !result.retryable && hasCacheableAuthoritativeState(result, action, this.binding) && (!this.canCacheAcceptedResult || this.canCacheAcceptedResult(result, action));
        if (cacheable) {
          this.completed.set(clientActionId, { action, result });
          this.storage?.removeItem(`${this.storagePrefix}.pending.${clientActionId}`);
          this.storage?.setItem(`${this.storagePrefix}.result.${clientActionId}`, JSON.stringify({ action, result }));
        } else if (!result.retryable) {
          this.storage?.removeItem(`${this.storagePrefix}.pending.${clientActionId}`);
        }
        this.pending.delete(clientActionId);
      }
      return result;
    }).catch((error) => {
      if (clientActionId) this.pending.delete(clientActionId);
      return { status: "retryable_network_failure", clientActionId, nextSequence: this.binding.getNextSequence(), feedback: error instanceof Error ? error.message : "The network request can be retried.", retryable: true } satisfies AuthoritativeActionResult;
    });
    if (clientActionId) this.pending.set(clientActionId, request);
    return request;
  }
  resume(): Promise<AuthoritativeActionResult> {
    return this.transport.resume({ ...this.binding, nextSequence: this.binding.getNextSequence() }).catch((error) => ({
      status: "retryable_network_failure",
      nextSequence: this.binding.getNextSequence(),
      feedback: error instanceof Error ? error.message : "The session state could not be refreshed. Retry when connected.",
      retryable: true
    } satisfies AuthoritativeActionResult));
  }
  getPendingActionIds(): string[] { return this.storage ? Object.keys(this.storage).filter((key) => key.startsWith(`${this.storagePrefix}.pending.`)).map((key) => key.slice(`${this.storagePrefix}.pending.`.length)) : []; }
  getPendingAction(clientActionId: string): ModelSemanticAction | undefined {
    const saved = this.storage?.getItem(`${this.storagePrefix}.pending.${clientActionId}`);
    if (!saved) return undefined;
    try { return JSON.parse(saved) as Exclude<ModelSemanticAction, { type: "select_component" }>;
    } catch { this.storage?.removeItem(`${this.storagePrefix}.pending.${clientActionId}`); return undefined; }
  }
}
