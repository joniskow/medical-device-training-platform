import { createBabylonModelRuntime } from './babylon-model-runtime.js';
import { modelInteractionOptions, validateAuthoritativeModelState, validateBrowserModelManifest, type ModelManifest } from '@medical-device/model-runtime';
import type { InteractiveModelRuntime } from './model-contract.js';
import type { ModelAction, ModelState } from '@medical-device/api-client';

export type TrainingViewerAction = Omit<ModelAction, 'clientActionId' | 'expectedSequence' | 'releaseBindingId' | 'modelVersionId'>;
export interface TrainingViewerOptions {
  canvas: HTMLCanvasElement;
  camera?: {alpha:number;beta:number;radius:number;target?:[number,number,number]};
  onAction(action: TrainingViewerAction): void;
  onStatus?(status: { phase: string; measuredFps?: number; loadDurationMs?: number; message?: string }): void;
}
export interface TrainingViewer {
  load(input: { manifest: unknown; modelBytes: Uint8Array; state: ModelState; signal?: AbortSignal }): Promise<void>;
  applyState(state: ModelState): void;
  setEnabled(enabled: boolean): void;
  focusComponent(componentId: string): void;
  resetView(): void;
  setHintsVisible(visible: boolean): void;
  dispose(): void;
}

/** Standalone viewer: owns only its canvas and renderer, never authentication, scores or page navigation. */
export function mountTrainingViewer(options: TrainingViewerOptions): TrainingViewer {
  let runtime: InteractiveModelRuntime | undefined, manifest: ModelManifest | undefined, state: ModelState | undefined;
  let generation = 0, disposed = false, enabled = true, cameraOnly = false;
  let loading: AbortController | undefined;
  let loadQueue: Promise<void> = Promise.resolve();
  const applyState = (next: ModelState) => {
    if (disposed || !manifest || !validateAuthoritativeModelState(manifest, next) || (state && next.sequence < state.sequence)) throw new Error('VIEWER_STATE_MISMATCH');
    state = structuredClone(next);
    runtime?.applyAuthoritativeState(state);
    runtime?.setInteractionEnabled(enabled && !state.completed);
  };
  return {
    load(input) {
      if (disposed) return Promise.reject(new Error('VIEWER_DISPOSED'));
      const current = ++generation;
      loading?.abort();
      // A superseded loader must dispose its engine before another engine uses the same canvas.
      loadQueue = loadQueue.catch(() => {}).then(async () => {
      if (disposed || current !== generation) throw new Error('VIEWER_LOAD_CANCELLED');
      runtime?.dispose(); runtime = undefined; state = undefined;
      const controller = new AbortController(); loading = controller;
      const cancel = () => controller.abort();
      input.signal?.addEventListener('abort', cancel, { once: true });
      if (input.signal?.aborted) controller.abort();
      const deliver = (action: TrainingViewerAction) => { if (!disposed && !cameraOnly && current === generation && enabled && !state?.completed) options.onAction(action); };
      try {
        manifest = validateBrowserModelManifest(input.manifest);
        if (!validateAuthoritativeModelState(manifest, input.state)) throw new Error('VIEWER_STATE_MISMATCH');
        const created = await createBabylonModelRuntime({ canvas: options.canvas, manifest, modelBytes: input.modelBytes, modelUrl: '', signal: controller.signal,
          pixelRatioLimit: 1.5, selectedHighlightOpacity: .08, interactionEnabled: false, camera: options.camera,
          onStateChange: value => { if (!disposed && current === generation) options.onStatus?.({ phase: value.phase, measuredFps: value.measuredFps, loadDurationMs: value.loadDurationMs, message: value.errorMessage ?? value.interactionMessage }); },
          onSemanticAction: action => deliver(action as TrainingViewerAction),
          onInteractionTargetActivated: ({ componentId, targetId, transform }) => deliver(transform ? { type: 'transform_component', componentId, targetId, transform, source: 'CANVAS' } : { type: 'activate_target', componentId, targetId, source: 'CANVAS' }),
          onInteractionBlocked: ({ targetId, message }) => {
            if (!manifest || !state || current !== generation || disposed) return;
            options.onStatus?.({ phase: runtime?.getState().phase ?? 'READY', message });
            const attempted = modelInteractionOptions(manifest, state).find(option => option.targetId === targetId && !option.enabled && option.blockedReason === message);
            if (attempted) deliver({ type: attempted.type, componentId: attempted.componentId, targetId, transform: attempted.transform, source: 'CANVAS' });
          }
        });
        if (disposed || current !== generation || controller.signal.aborted) { created.dispose(); throw new Error('VIEWER_LOAD_CANCELLED'); }
        runtime = created; applyState(input.state); runtime.fitModel();
      } finally { input.signal?.removeEventListener('abort', cancel); if (loading === controller) loading = undefined; }
      });
      return loadQueue;
    },
    applyState,
    setEnabled(value) { enabled = value; runtime?.setInteractionEnabled(value && !state?.completed); },
    focusComponent(componentId) { cameraOnly=true;try{runtime?.frameComponent(componentId,options.camera);}finally{cameraOnly=false;} },
    resetView() { runtime?.resetView(); runtime?.fitModel(); },
    setHintsVisible(visible) { runtime?.setInteractionHintsVisible(visible); },
    dispose() { if (disposed) return; disposed = true; generation++; loading?.abort(); runtime?.dispose(); runtime = undefined; state = undefined; manifest = undefined; }
  };
}
