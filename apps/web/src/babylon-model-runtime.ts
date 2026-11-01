import { AbstractMesh, ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, Mesh, Scene, SceneLoader, TransformNode, Vector3 } from "@babylonjs/core";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import "@babylonjs/loaders/glTF";
import { validateAuthoritativeModelState, validateBrowserModelManifest, type ModelManifest } from "@medical-device/model-runtime";
import type { AuthoritativeModelState, ModelRuntime, ModelRuntimeState, ModelSelectionSource, ModelSemanticAction } from "./model-contract.js";
import { phaseAfterContextRestore } from "./model-runtime-budget.js";

export { phaseAfterContextRestore } from "./model-runtime-budget.js";

type BabylonManifest = ModelManifest;

export interface BabylonModelRuntimeOptions {
  canvas: HTMLCanvasElement;
  manifestUrl?: string;
  manifest?: unknown;
  signal?: AbortSignal;
  modelUrl: string;
  modelBytes?: Uint8Array;
  fetcher?: typeof fetch;
  onStateChange?: (state: ModelRuntimeState) => void;
  onSemanticAction?: (action: ModelSemanticAction) => void;
}

export class BabylonModelRuntimeError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "BabylonModelRuntimeError"; } }

async function sha256(bytes: Uint8Array): Promise<string> { const copy = bytes.slice(); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer)), (value) => value.toString(16).padStart(2, "0")).join(""); }
function validateManifest(value: unknown): BabylonManifest {
  try { return validateBrowserModelManifest(value); }
  catch (error) { throw new BabylonModelRuntimeError("MODEL_MANIFEST_INVALID", error instanceof Error ? error.message : "The approved model manifest is invalid."); }
}

function modelBounds(meshes: AbstractMesh[]) { let min = new Vector3(Infinity, Infinity, Infinity); let max = new Vector3(-Infinity, -Infinity, -Infinity); for (const mesh of meshes) { const info = mesh.getHierarchyBoundingVectors(true); min = Vector3.Minimize(min, info.min); max = Vector3.Maximize(max, info.max); } return { min, max, center: min.add(max).scale(0.5), radius: Math.max(Vector3.Distance(min, max) / 2, 0.1) }; }
type SceneNode = { name?: string; parent?: unknown };
function sceneNodePath(mesh: SceneNode): string {
  const names: string[] = [];
  let current: SceneNode | null = mesh;
  while (current) {
    if (typeof current.name === "string" && current.name) names.unshift(current.name);
    current = current.parent && typeof current.parent === "object" ? current.parent as SceneNode : null;
  }
  return names.join("/");
}

export async function createBabylonModelRuntime(options: BabylonModelRuntimeOptions): Promise<ModelRuntime> {
  const started = performance.now(); const emit = (state: ModelRuntimeState) => options.onStateChange?.(state); emit({ phase: "LOADING", componentIds: [], transforms: {} });
  let partialEngine: Engine | undefined; let partialScene: Scene | undefined;
  try {
    let manifest:BabylonManifest;
    if(options.manifest!==undefined)manifest=validateManifest(options.manifest);
    else{
      if(!options.manifestUrl)throw new BabylonModelRuntimeError('MODEL_MANIFEST_FETCH_FAILED','The approved model manifest is unavailable.');
      const manifestResponse = await (options.fetcher??fetch)(options.manifestUrl, { cache: "no-store",signal:options.signal });
      if (!manifestResponse.ok) throw new BabylonModelRuntimeError("MODEL_MANIFEST_FETCH_FAILED", "The approved model manifest could not be loaded.");
      manifest = validateManifest(await manifestResponse.json());
    }
    let bytes=options.modelBytes;
    if(!bytes){
      const modelResponse = await (options.fetcher??fetch)(options.modelUrl, { cache: "no-store",signal:options.signal });
      if (modelResponse.status === 401 || modelResponse.status === 403) throw new BabylonModelRuntimeError("MODEL_URL_EXPIRED", "The private model URL expired or is not authorized.");
      if (!modelResponse.ok) throw new BabylonModelRuntimeError("MODEL_FETCH_FAILED", "The approved model could not be loaded.");
      bytes = new Uint8Array(await modelResponse.arrayBuffer());
    }
    if (await sha256(bytes) !== manifest.sourceHash!.toLowerCase()) throw new BabylonModelRuntimeError("MODEL_HASH_MISMATCH", "The model bytes do not match the approved manifest hash.");
    if(options.signal?.aborted)throw new BabylonModelRuntimeError('MODEL_LOAD_CANCELLED','Model loading was cancelled.');
    if (!options.canvas.getContext("webgl2")) throw new BabylonModelRuntimeError("WEBGL2_UNAVAILABLE", "This browser does not provide the required WebGL2 baseline.");

    partialEngine = new Engine(options.canvas, true, { preserveDrawingBuffer: false, stencil: true });
    partialScene = new Scene(partialEngine); partialScene.clearColor = new Color4(0.035, 0.09, 0.11, 1);
    const engine = partialEngine; const scene = partialScene;
    const camera = new ArcRotateCamera("model-camera", -0.8, Math.PI / 2.8, 3, Vector3.Zero(), scene); camera.attachControl(options.canvas, true); camera.lowerRadiusLimit = 0.1; camera.upperRadiusLimit = 100;
    new HemisphericLight("model-light", new Vector3(0, 1, 0), scene).intensity = 1.1;
    const imported = await SceneLoader.ImportMeshAsync(null, "", bytes, scene, undefined, ".glb");
    const meshes = imported.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
    if (meshes.length === 0) throw new BabylonModelRuntimeError("MODEL_EMPTY", "The approved model contains no renderable mesh.");
    const actualTriangleCount = meshes.reduce((total, mesh) => total + Math.floor(mesh.getTotalIndices() / 3), 0);
    const actualMaterialCount = new Set(meshes.map((mesh) => mesh.material?.uniqueId ?? "unmaterialized")).size;
    const textureKeys = ["albedoTexture", "baseTexture", "diffuseTexture", "normalTexture", "metallicTexture", "roughnessTexture", "ambientTexture", "opacityTexture", "emissiveTexture", "bumpTexture", "reflectionTexture", "refractionTexture"] as const;
    const actualTextureCount = new Set(meshes.flatMap((mesh) => textureKeys.map((key) => (mesh.material as unknown as Record<string, unknown> | null)?.[key]).filter((texture): texture is object => Boolean(texture)))).size;
    if (meshes.length !== manifest.meshCount || actualTriangleCount !== manifest.triangleCount || actualMaterialCount !== manifest.materialCount || actualTextureCount !== manifest.textureCount) throw new BabylonModelRuntimeError("MODEL_GEOMETRY_MISMATCH", `The loaded scene does not match the approved model manifest (meshes ${meshes.length}/${manifest.meshCount}, triangles ${actualTriangleCount}/${manifest.triangleCount}, materials ${actualMaterialCount}/${manifest.materialCount}, textures ${actualTextureCount}/${manifest.textureCount}).`);
    const bounds = modelBounds(meshes); camera.setTarget(bounds.center); camera.radius = bounds.radius * 2.8;
    // glTF units are meters: Babylon's one-meter default near plane clips tabletop devices.
    camera.minZ = Math.max(bounds.radius / 100, 0.0001);
    camera.maxZ = Math.max(bounds.radius * 100, 10);
    camera.lowerRadiusLimit = bounds.radius * 1.1;
    camera.upperRadiusLimit = bounds.radius * 20;
    const componentMeshes = new Map<string, Mesh[]>();
    const assignedMeshes = new Set<Mesh>();
    const componentRoots = new Map<string, TransformNode>();
    const baseTransforms = new Map<TransformNode, { position: Vector3; rotation: Vector3 }>();
    const nodes: TransformNode[] = [...imported.transformNodes, ...imported.meshes];
    for (const component of manifest.components) {
      const leaf = component.nodePath.split("/").pop() ?? component.displayName;
      const exactMatches = nodes.filter(node => { const path=sceneNodePath(node); return path===component.nodePath || path===`__root__/${component.nodePath}`; });
      const roots = exactMatches.length ? exactMatches : nodes.filter(node=>node.name===leaf);
      if(roots.length!==1)throw new BabylonModelRuntimeError('MODEL_COMPONENT_MISMATCH',`Component ${component.componentId} has no unique scene node.`);
      const root=roots[0];
      const matches=meshes.filter(mesh=>mesh===root||mesh.isDescendantOf(root));
      if(!matches.length||matches.some(mesh=>assignedMeshes.has(mesh)))throw new BabylonModelRuntimeError('MODEL_COMPONENT_MISMATCH',`Component ${component.componentId} is empty or overlaps another component.`);
      componentRoots.set(component.componentId,root);
      if(root.rotationQuaternion){root.rotation=root.rotationQuaternion.toEulerAngles();root.rotationQuaternion=null;}
      baseTransforms.set(root,{position:root.position.clone(),rotation:root.rotation.clone()});
      for (const mesh of matches) { assignedMeshes.add(mesh); mesh.metadata = { ...(mesh.metadata ?? {}), componentId: component.componentId }; mesh.isVisible = true; }
      componentMeshes.set(component.componentId, matches);
    }
    const selectionColors = new Map<Mesh, { enabled: boolean; color: Color3; alpha: number }>();
    const highlight = {
      addMesh(mesh: Mesh, color: Color3) {
        if (!selectionColors.has(mesh)) selectionColors.set(mesh, {enabled:mesh.renderOverlay,color:mesh.overlayColor.clone(),alpha:mesh.overlayAlpha});
        mesh.renderOverlay=true;mesh.overlayColor=color;mesh.overlayAlpha=.3;
      },
      removeMesh(mesh: Mesh) {
        const original = selectionColors.get(mesh);
        if (original) {mesh.renderOverlay=original.enabled;mesh.overlayColor=original.color;mesh.overlayAlpha=original.alpha;}
        selectionColors.delete(mesh);
      }
    }; let selectedComponentId: string | undefined; let disposed = false;
    const transforms = Object.fromEntries(manifest.components.map((component) => [component.componentId, { rotationY: 0, translationX: 0 }]));
    const loadDurationMs = Math.round(performance.now() - started);
    const estimatedMemoryMb = meshes.reduce((total, mesh) => total + (mesh.getTotalVertices() * 3 * 4) + (mesh.getTotalIndices() * 4), 0) / (1024 * 1024);
    const budget = manifest.performanceBudget ?? { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 128 };
    const state: ModelRuntimeState = { phase: loadDurationMs > budget.interactiveWithinMs || estimatedMemoryMb > budget.maxMemoryMb ? "REDUCED_COMPLEXITY" : "READY", componentIds: manifest.components.map((component) => component.componentId), transforms, loadDurationMs, estimatedMemoryMb, ...(loadDurationMs > budget.interactiveWithinMs ? { fallbackReason: `The approved model exceeded the ${budget.interactiveWithinMs} ms interactive budget; use the equivalent path.` } : estimatedMemoryMb > budget.maxMemoryMb ? { fallbackReason: `The approved model exceeded the ${budget.maxMemoryMb} MB scene budget; use the equivalent path.` } : {}) };
    const selectComponent = (componentId: string, source: ModelSelectionSource = "COMPONENT_LIST", emitAction = true) => { const selected = componentMeshes.get(componentId); if (!selected) return; if (selectedComponentId) for (const mesh of componentMeshes.get(selectedComponentId) ?? []) highlight.removeMesh(mesh); selectedComponentId = componentId; state.selectedComponentId = componentId; for (const mesh of selected) highlight.addMesh(mesh, new Color3(0.95, 0.72, 0.2)); emit({ ...state }); if (emitAction) options.onSemanticAction?.({ type: "select_component", componentId, source }); };
    const pointerObserver = scene.onPointerObservable.add((event) => { if (event.type !== PointerEventTypes.POINTERPICK || !event.pickInfo?.hit) return; const componentId = event.pickInfo.pickedMesh?.metadata?.componentId; if (typeof componentId === "string") selectComponent(componentId, "CANVAS"); });
    const resize = () => engine.resize(); window.addEventListener("resize", resize); let phaseBeforeContextLoss: "READY" | "REDUCED_COMPLEXITY" = state.phase === "REDUCED_COMPLEXITY" ? "REDUCED_COMPLEXITY" : "READY"; let fallbackBeforeContextLoss = state.fallbackReason; const contextLost = engine.onContextLostObservable.add(() => { phaseBeforeContextLoss = state.phase === "REDUCED_COMPLEXITY" ? "REDUCED_COMPLEXITY" : "READY"; fallbackBeforeContextLoss = state.fallbackReason; state.phase = "CONTEXT_LOST"; state.fallbackReason = "WebGL context lost. Use the equivalent text path or reload."; emit({ ...state }); }); const contextRestored = engine.onContextRestoredObservable.add(() => { state.phase = phaseAfterContextRestore(phaseBeforeContextLoss, loadDurationMs, state.measuredFps, budget); state.fallbackReason = state.phase === "REDUCED_COMPLEXITY" ? fallbackBeforeContextLoss ?? "The approved model remains on the equivalent path after context recovery." : undefined; emit({ ...state }); });
    let frames = 0;
    let sampleReported = false;
    const sampleStarted = performance.now();
    const reportSample = () => {
      if (disposed || sampleReported) return;
      sampleReported = true;
      state.measuredFps = Math.round(frames / Math.max((performance.now() - sampleStarted) / 1000, 1));
      if (state.measuredFps < budget.minimumFps && state.phase === "READY") {
        state.phase = "REDUCED_COMPLEXITY";
        state.fallbackReason = `The device measured ${state.measuredFps} FPS, below the ${budget.minimumFps} FPS target; use the equivalent path.`;
      }
      emit({ ...state });
    };
    const sample = () => {
      if (disposed || sampleReported) return;
      frames += 1;
      if (performance.now() - sampleStarted >= 1000) reportSample();
      else requestAnimationFrame(sample);
    };
    const sampleTimeout = window.setTimeout(reportSample, 1_250);
    requestAnimationFrame(sample);
    engine.runRenderLoop(() => { if (!disposed) scene.render(); });
    emit({ ...state });
    const applyAuthoritativeState = (nextState: AuthoritativeModelState) => {
      if (!validateAuthoritativeModelState(manifest, nextState)) return;
      if (state.authoritative && nextState.sequence < state.authoritative.sequence) return;
      const safeTransforms: Record<string, { rotationY: number; translationX: number }> = {};
      for (const component of manifest.components) {
        const transform = nextState.transforms[component.componentId];
        safeTransforms[component.componentId] = { rotationY: transform.rotationY, translationX: transform.translationX };
      }
      state.authoritative = nextState;
      for (const [componentId, transform] of Object.entries(safeTransforms)) {const root=componentRoots.get(componentId);if(!root)continue;const base=baseTransforms.get(root)!;root.rotation.y=base.rotation.y+transform.rotationY;root.position.x=base.position.x+transform.translationX;}
      state.transforms = safeTransforms;
      if (nextState.selectedComponentId && componentMeshes.has(nextState.selectedComponentId)) selectComponent(nextState.selectedComponentId, "KEYBOARD", false);
      else if (!nextState.selectedComponentId && selectedComponentId) {
        for (const mesh of componentMeshes.get(selectedComponentId) ?? []) highlight.removeMesh(mesh);
        selectedComponentId = undefined;
        state.selectedComponentId = undefined;
      }
      emit({ ...state });
    };
    const resetView = () => { camera.setTarget(bounds.center); camera.radius = bounds.radius * 2.8; camera.alpha = -0.8; camera.beta = Math.PI / 2.8; };
    return { getState: () => ({ ...state, transforms: { ...state.transforms } }), selectComponent, applyAuthoritativeState, resetView, dispose: () => { disposed = true; window.clearTimeout(sampleTimeout); window.removeEventListener("resize", resize); scene.onPointerObservable.remove(pointerObserver); engine.onContextLostObservable.remove(contextLost); engine.onContextRestoredObservable.remove(contextRestored); camera.detachControl(); scene.dispose(); engine.dispose(); } };
  } catch (error) {
    partialScene?.dispose(); partialEngine?.dispose();
    const failure = error instanceof BabylonModelRuntimeError ? error : new BabylonModelRuntimeError("MODEL_RUNTIME_FAILED", error instanceof Error ? error.message : "The Babylon.js runtime failed.");
    emit({ phase: "ERROR", componentIds: [], transforms: {}, errorCode: failure.code, errorMessage: failure.message }); throw failure;
  }
}
