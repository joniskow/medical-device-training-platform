import { AbstractMesh, ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Engine, HemisphericLight, ImageProcessingConfiguration, Matrix, Mesh, MeshBuilder, Quaternion, Scene, SceneLoader, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import "@babylonjs/loaders/glTF";
import { applyPermittedTransform, validateAuthoritativeModelState, validateBrowserModelManifest, type ModelManifest } from "@medical-device/model-runtime";
import type { AuthoritativeModelState, InteractiveModelRuntime, ModelRuntimeState, ModelSelectionSource, ModelSemanticAction } from "./model-contract.js";
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
  onInteractionTargetActivated?: (input: { targetId: string; targetName: string; componentId: string; interactionType?: "press" | "turn" | "open"; transform?: Partial<{ rotationY: number; translationX: number }> }) => void;
  onInteractionBlocked?: (input: { targetId: string; message: string }) => void;
  transparentBackground?: boolean;
  interactiveCamera?: boolean;
  interactionEnabled?: boolean;
  selectedHighlightOpacity?: number;
  camera?: { alpha: number; beta: number; radius: number; target?: [number, number, number] };
  lighting?: { direction?: [number, number, number]; exposure?: number; whiteBalanceKelvin?: number };
  modelTransform?: { translationMeters: [number, number, number]; rotationRadians: [number, number, number]; scale: number };
  contactShadow?: { enabled: boolean; opacity: number; softness: number; offsetMeters: number; direction?: [number, number] };
}

export class BabylonModelRuntimeError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "BabylonModelRuntimeError"; } }

async function sha256(bytes: Uint8Array): Promise<string> { const copy = bytes.slice(); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer)), (value) => value.toString(16).padStart(2, "0")).join(""); }
function validateManifest(value: unknown): BabylonManifest {
  try { return validateBrowserModelManifest(value); }
  catch (error) { throw new BabylonModelRuntimeError("MODEL_MANIFEST_INVALID", error instanceof Error ? error.message : "The approved model manifest is invalid."); }
}

function modelBounds(meshes: AbstractMesh[]) {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.refreshBoundingInfo({});
    const chain: Array<{ computeWorldMatrix: (force?: boolean) => Matrix; parent?: unknown }> = [];
    let current: unknown = mesh;
    while (current && typeof current === "object" && "computeWorldMatrix" in current) {
      chain.push(current as { computeWorldMatrix: (force?: boolean) => Matrix; parent?: unknown });
      current = "parent" in current ? (current as { parent?: unknown }).parent : undefined;
    }
    for (const node of chain.reverse()) node.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, box.minimumWorld);
    max = Vector3.Maximize(max, box.maximumWorld);
  }
  return { min, max, center: min.add(max).scale(0.5), radius: Math.max(Vector3.Distance(min, max) / 2, 0.1) };
}
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

export async function createBabylonModelRuntime(options: BabylonModelRuntimeOptions): Promise<InteractiveModelRuntime> {
  const started = performance.now(); const emit = (state: ModelRuntimeState) => options.onStateChange?.(state); emit({ phase: "LOADING", componentIds: [], transforms: {} });
  const originalTouchAction = options.canvas.style.touchAction;
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
    if (!options.canvas.getContext("webgl2", { alpha: options.transparentBackground === true, premultipliedAlpha: false })) throw new BabylonModelRuntimeError("WEBGL2_UNAVAILABLE", "This browser does not provide the required WebGL2 baseline.");

    partialEngine = new Engine(options.canvas, true, { preserveDrawingBuffer: false, stencil: true, alpha: options.transparentBackground === true });
    partialScene = new Scene(partialEngine); partialScene.clearColor = new Color4(0.035, 0.09, 0.11, options.transparentBackground ? 0 : 1);
    const engine = partialEngine; const scene = partialScene;
    const cameraConfig = options.camera;
    const camera = new ArcRotateCamera("model-camera", cameraConfig?.alpha ?? -0.8, cameraConfig?.beta ?? Math.PI / 2.8, cameraConfig?.radius ?? 3, cameraConfig?.target ? Vector3.FromArray(cameraConfig.target) : Vector3.Zero(), scene);
    scene.activeCamera = camera;
    let cameraInteractive = options.interactiveCamera !== false;
    let interactionEnabled = options.interactionEnabled !== false;
    if (cameraInteractive && interactionEnabled) camera.attachControl(options.canvas, true);
    const setCameraInteraction = (enabled: boolean) => { if (!cameraInteractive || !interactionEnabled) return; if (enabled) camera.attachControl(options.canvas, true); else camera.detachControl(); };
    options.canvas.style.touchAction = interactionEnabled ? "none" : originalTouchAction;
    options.canvas.tabIndex = interactionEnabled ? 0 : -1;
    options.canvas.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Enter Space");
    camera.lowerRadiusLimit = 0.1; camera.upperRadiusLimit = 100;
    camera.lowerBetaLimit = 0.12; camera.upperBetaLimit = Math.PI - 0.12;
    camera.wheelPrecision = 45;
    const lighting = options.lighting;
    const keyDirection = Vector3.FromArray(lighting?.direction ?? [0.35, 0.8, -0.45]).normalize();
    const key = new DirectionalLight("calibrated-key-light", keyDirection.negate(), scene);
    // The transparent foreground has no photographic environment map behind
    // it, so a little more neutral fill is needed to retain reflected detail
    // in charcoal ABS without flattening the warm key from the plate.
    key.intensity = 1.08;
    const kelvin = lighting?.whiteBalanceKelvin ?? 5200;
    const warm = Math.max(0, Math.min(1, (kelvin - 3200) / 5000));
    key.diffuse = new Color3(1, 0.86 + warm * 0.12, 0.72 + warm * 0.25);
    // The plate's left window contributes a broad camera-facing bounce in
    // addition to the overhead room light. Keeping a little upward component
    // preserves the top-plane highlight while lifting the front ABS/chassis
    // planes that would otherwise read as clipped black in the transparent
    // foreground.
    const fill = new HemisphericLight("calibrated-ambient-fill", new Vector3(-0.15, 0.55, 0.82).normalize(), scene);
    // The plate is a warm-neutral clinical room, not a blue studio HDRI. A
    // restrained warm fill keeps the charcoal base readable while preserving
    // the directional window/key contrast that sells the photographed plate.
    fill.intensity = 0.76;
    fill.diffuse = new Color3(0.90 + warm * 0.06, 0.90 + warm * 0.04, 0.86 + warm * 0.04);
    fill.groundColor = new Color3(0.20, 0.18, 0.16);
    if (Number.isFinite(lighting?.exposure)) scene.imageProcessingConfiguration.exposure = Math.pow(2, lighting!.exposure!);
    if (options.transparentBackground) {
      // The transparent model is composited over a photographic plate later;
      // ACES preserves the soft ABS highlights and keeps the white housing from
      // reading as clipped, un-tonemapped browser CG against the room plate.
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      scene.imageProcessingConfiguration.contrast = 0.98;
    }
    const imported = await SceneLoader.ImportMeshAsync(null, "", bytes, scene, undefined, ".glb");
    // Authored Blender clips are preserved in the GLB for review/export, but the
    // browser uses the bounded metadata-driven press path below so clips never
    // autoplay or fight pointer feedback.
    for (const animationGroup of scene.animationGroups) animationGroup.stop();
    const meshes = imported.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
    if (meshes.length === 0) throw new BabylonModelRuntimeError("MODEL_EMPTY", "The approved model contains no renderable mesh.");
    const actualTriangleCount = meshes.reduce((total, mesh) => total + Math.floor(mesh.getTotalIndices() / 3), 0);
    const actualMaterialCount = new Set(meshes.map((mesh) => mesh.material?.uniqueId ?? "unmaterialized")).size;
    const textureKeys = ["albedoTexture", "baseTexture", "diffuseTexture", "normalTexture", "metallicTexture", "roughnessTexture", "ambientTexture", "opacityTexture", "emissiveTexture", "bumpTexture", "reflectionTexture", "refractionTexture"] as const;
    const actualTextureCount = new Set(meshes.flatMap((mesh) => textureKeys.map((key) => (mesh.material as unknown as Record<string, unknown> | null)?.[key]).filter((texture): texture is object => Boolean(texture)))).size;
    if (meshes.length !== manifest.meshCount || actualTriangleCount !== manifest.triangleCount || actualMaterialCount !== manifest.materialCount || actualTextureCount !== manifest.textureCount) throw new BabylonModelRuntimeError("MODEL_GEOMETRY_MISMATCH", `The loaded scene does not match the approved model manifest (meshes ${meshes.length}/${manifest.meshCount}, triangles ${actualTriangleCount}/${manifest.triangleCount}, materials ${actualMaterialCount}/${manifest.materialCount}, textures ${actualTextureCount}/${manifest.textureCount}).`);
    let bounds = modelBounds(meshes);
    if (!cameraConfig) { camera.setTarget(bounds.center); camera.radius = bounds.radius * 2.8; }
    const importedNodes: TransformNode[] = [...imported.transformNodes, ...imported.meshes];
    const existingRoot = importedNodes.find((node) => node.name === "__root__");
    const placementRoot = existingRoot ?? new TransformNode("__root__", scene);
    if (!existingRoot) {
      // Some GLB exports have no explicit scene root. Wrap every top-level
      // imported node so placement applies to the complete device instead of
      // accidentally moving only the first mesh.
      for (const node of importedNodes) if (!node.parent) node.parent = placementRoot;
    }
    if (options.modelTransform) {
      placementRoot.position = Vector3.FromArray(options.modelTransform.translationMeters);
      placementRoot.rotation = Vector3.FromArray(options.modelTransform.rotationRadians);
      placementRoot.scaling = new Vector3(options.modelTransform.scale, options.modelTransform.scale, options.modelTransform.scale);
    }
    placementRoot.computeWorldMatrix(true);
    // Babylon's glTF root can be an imported mesh rather than a TransformNode;
    // one explicit frame is needed before its child world matrices include the
    // authored placement transform used for calibrated grounding.
    scene.render();
    // Recompute world-space bounds after the authored scene transform. Camera
    // limits and the grounding layer must follow the placed device, not the
    // raw GLB coordinate system.
    bounds = modelBounds(meshes);
    if (options.contactShadow?.enabled) {
      const makeGroundingLayer = (name: string, textureName: string, materialName: string, opacity: number, softness: number) => {
        const layer = MeshBuilder.CreateGround(name, { width: 1, height: 1, subdivisions: 1 }, scene);
        layer.isPickable = false;
        const texture = new DynamicTexture(textureName, { width: 256, height: 256 }, scene, false);
        const context = texture.getContext();
        const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 128);
        gradient.addColorStop(0, `rgba(0,0,0,${Math.min(1, Math.max(0, opacity))})`);
        gradient.addColorStop(Math.max(0.05, Math.min(0.92, 0.55 + softness * 0.35)), "rgba(0,0,0,0.12)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.clearRect(0, 0, 256, 256); context.fillStyle = gradient; context.fillRect(0, 0, 256, 256); texture.update();
        const material = new StandardMaterial(materialName, scene);
        material.diffuseTexture = texture; material.opacityTexture = texture; material.disableLighting = true; material.useAlphaFromDiffuseTexture = true; material.backFaceCulling = false; material.alpha = 0.92;
        layer.material = material;
        const calibratedDirection = options.contactShadow?.direction
          ? new Vector3(options.contactShadow.direction[0], 0, options.contactShadow.direction[1]).normalize()
          : Vector3.Zero();
        // Keep a visible cast direction without separating the soft footprint
        // from the casters at the calibrated 960×540 presentation scale.
        const directionalOffset = calibratedDirection.scale(bounds.radius * 0.10);
        layer.metadata = {
          calibratedDirection: calibratedDirection.asArray(),
          directionalOffset: directionalOffset.asArray(),
          placementCenter: bounds.center.asArray(),
        };
        layer.position = new Vector3(
          bounds.center.x + directionalOffset.x,
          bounds.min.y + options.contactShadow!.offsetMeters,
          bounds.center.z + directionalOffset.z,
        );
        return layer;
      };
      const shadow = makeGroundingLayer("model-contact-shadow", "model-contact-shadow-texture", "model-contact-shadow-material", options.contactShadow.opacity, options.contactShadow.softness);
      if (options.contactShadow.direction) {
        // The local ground plane's long axis is +Z. Rotate it toward the
        // calibrated plate-space shadow vector so the soft footprint follows
        // the room light instead of reading as a generic centered oval.
        shadow.rotation.y = Math.atan2(options.contactShadow.direction[0], options.contactShadow.direction[1]);
      }
      shadow.scaling.x = Math.max(bounds.radius * 1.42, 0.5);
      shadow.scaling.z = Math.max(bounds.radius * 0.84, 0.35);
      const ambient = makeGroundingLayer("model-ambient-grounding", "model-ambient-grounding-texture", "model-ambient-grounding-material", options.contactShadow.opacity * 0.36, Math.max(0.05, options.contactShadow.softness * 0.35));
      ambient.scaling.x = Math.max(bounds.radius * 0.74, 0.32);
      ambient.scaling.z = Math.max(bounds.radius * 0.48, 0.22);
      ambient.position.y -= 0.001;
    }
    // glTF units are meters: Babylon's one-meter default near plane clips tabletop devices.
    camera.minZ = Math.max(bounds.radius / 100, 0.0001);
    camera.maxZ = Math.max(bounds.radius * 100, 10);
    camera.lowerRadiusLimit = Math.max(bounds.radius * 0.15, camera.minZ * 4);
    camera.upperRadiusLimit = bounds.radius * 20;
    const componentMeshes = new Map<string, Mesh[]>();
    const componentRoots = new Map<string, TransformNode>();
    const baseTransforms = new Map<TransformNode, { position: Vector3; rotation: Vector3; quaternion: Quaternion; originallyQuaternion: boolean }>();
    const interactionTargetMeshes = new Map<string, Mesh[]>();
    const interactionTargetRoots = new Map<string, TransformNode>();
    const interactionTargetComponents = new Map<string, string>();
    const interactionTargetNames = new Map<string, string>();
    type Requirement = { componentId: string; transform: "rotationY" | "translationX"; value: number; message: string };
    const interactionTargetSettings = new Map<string, { interactionType: "press" | "turn" | "open" | "activate"; pressDepthMeters: number; pressAxis: Vector3; turnSensitivity: number; turnMinRadians?: number; turnMaxRadians?: number; openRotationRadians?: number; openRotationSpace?: "local"; touchTapSlopPixels?: number; openLiftMeters?: number; openTranslationMeters?: number; openDragDirection?: [number, number]; openVerb?: string; closeVerb?: string; openRequires?: Requirement; closeRequires?: Requirement }>();
    const nodes: TransformNode[] = [...imported.transformNodes, ...imported.meshes];
    for (const component of manifest.components) {
      const leaf = component.nodePath.split("/").pop() ?? component.displayName;
      const exactMatches = nodes.filter(node => { const path=sceneNodePath(node); return path===component.nodePath || path===`__root__/${component.nodePath}`; });
      const roots = exactMatches.length ? exactMatches : nodes.filter(node=>node.name===leaf);
      if(roots.length!==1)throw new BabylonModelRuntimeError('MODEL_COMPONENT_MISMATCH',`Component ${component.componentId} has no unique scene node.`);
      const root=roots[0];
      if ([...componentRoots.values()].includes(root)) throw new BabylonModelRuntimeError('MODEL_COMPONENT_MISMATCH', `Component ${component.componentId} shares a scene node with another component.`);
      componentRoots.set(component.componentId,root);
      // Keep the established Euler-angle component transform contract. Some
      // authored GLBs store rotations as quaternions, but the approved
      // interaction limits are expressed as local rotationY offsets around
      // the authored hinge/pivot.
      const originallyQuaternion = Boolean(root.rotationQuaternion);
      const baseQuaternion = root.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(root.rotation);
      const baseRotation = originallyQuaternion ? baseQuaternion.toEulerAngles() : root.rotation.clone();
      baseTransforms.set(root,{position:root.position.clone(),rotation:baseRotation,quaternion:baseQuaternion,originallyQuaternion});
    }
    // A movable assembly can contain independently selectable controls. Assign
    // each mesh to its closest component ancestor so selection stays unambiguous
    // while child controls still inherit the assembly's physical movement.
    const componentByRoot = new Map([...componentRoots].map(([id, root]) => [root, id]));
    for (const mesh of meshes) {
      let node: TransformNode | null = mesh;
      while (node && !componentByRoot.has(node)) node = node.parent instanceof TransformNode ? node.parent : null;
      const componentId = node ? componentByRoot.get(node) : undefined;
      if (!componentId) continue;
      mesh.metadata = { ...(mesh.metadata ?? {}), componentId };
      mesh.isVisible = true;
      const matches = componentMeshes.get(componentId) ?? [];
      matches.push(mesh);
      componentMeshes.set(componentId, matches);
    }
    for (const component of manifest.components) if (!componentMeshes.get(component.componentId)?.length) throw new BabylonModelRuntimeError('MODEL_COMPONENT_MISMATCH', `Component ${component.componentId} has no meshes of its own.`);
    for (const component of manifest.components) {
      for (const target of component.interactionTargets ?? []) {
        const exactMatches = nodes.filter((node) => { const path = sceneNodePath(node); return path === target.nodePath || path === `__root__/${target.nodePath}`; });
        if (exactMatches.length !== 1) throw new BabylonModelRuntimeError("MODEL_INTERACTION_TARGET_MISMATCH", `Interaction target ${target.targetId} has no unique scene node.`);
        const root = exactMatches[0];
        const matches = meshes.filter((mesh) => mesh === root || mesh.isDescendantOf(root));
        if (!matches.length) throw new BabylonModelRuntimeError("MODEL_INTERACTION_TARGET_MISMATCH", `Interaction target ${target.targetId} is empty.`);
        if (matches.some((mesh) => mesh.metadata?.componentId && mesh.metadata.componentId !== component.componentId)) throw new BabylonModelRuntimeError("MODEL_INTERACTION_TARGET_MISMATCH", `Interaction target ${target.targetId} crosses a component boundary.`);
        interactionTargetRoots.set(target.targetId, root);
        interactionTargetComponents.set(target.targetId, component.componentId);
        interactionTargetNames.set(target.targetId, target.displayName);
        interactionTargetMeshes.set(target.targetId, matches);
        const interactionType = target.interactionType ?? (target.pressDepthMeters !== undefined ? "press" : "activate");
        interactionTargetSettings.set(target.targetId, { interactionType, pressDepthMeters: target.pressDepthMeters ?? 0.004, pressAxis: Vector3.FromArray(target.pressAxis ?? [0, 0, 1]).normalize(), turnSensitivity: target.turnSensitivity ?? 0.012, turnMinRadians: target.turnMinRadians, turnMaxRadians: target.turnMaxRadians, openRotationRadians: target.openRotationRadians, openRotationSpace: target.openRotationSpace, touchTapSlopPixels: target.touchTapSlopPixels, openLiftMeters: target.openLiftMeters, openTranslationMeters: target.openTranslationMeters, openDragDirection: target.openDragDirection, openVerb: target.openVerb, closeVerb: target.closeVerb, openRequires: target.openRequires, closeRequires: target.closeRequires });
        for (const mesh of matches) mesh.metadata = { ...(mesh.metadata ?? {}), componentId: component.componentId, interactionTargetId: target.targetId };
      }
    }
    const selectionColors = new Map<Mesh, { enabled: boolean; color: Color3; alpha: number; selected: boolean; hovered: boolean; hinted: boolean }>();
    const refreshHighlight = (mesh: Mesh) => {
      const current = selectionColors.get(mesh);
      if (!current) return;
      const active = current.selected || current.hovered || current.hinted;
      mesh.renderOverlay = active || current.enabled;
      if (!active) { mesh.overlayColor = current.color; mesh.overlayAlpha = current.alpha; return; }
      mesh.overlayColor = current.hovered ? new Color3(0.35, 0.9, 0.78) : current.hinted ? new Color3(0.2, 0.72, 0.95) : new Color3(0.95, 0.72, 0.2);
      const selectedOpacity = options.selectedHighlightOpacity;
      mesh.overlayAlpha = current.hovered ? 0.18 : current.hinted ? 0.22 : (selectedOpacity !== undefined && Number.isFinite(selectedOpacity) ? Math.min(1, Math.max(0, selectedOpacity)) : 0.3);
    };
    const setHighlight = (mesh: Mesh, kind: "selected" | "hovered" | "hinted", enabled: boolean) => {
      if (!selectionColors.has(mesh)) selectionColors.set(mesh, { enabled: mesh.renderOverlay, color: mesh.overlayColor.clone(), alpha: mesh.overlayAlpha, selected: false, hovered: false, hinted: false });
      const current = selectionColors.get(mesh)!;
      current[kind] = enabled;
      refreshHighlight(mesh);
      if (!current.selected && !current.hovered && !current.hinted) selectionColors.delete(mesh);
    };
    const setInteractionHintsVisible = (visible: boolean) => {
      for (const meshes of interactionTargetMeshes.values()) for (const mesh of meshes) setHighlight(mesh, "hinted", visible);
    };
    let selectedComponentId: string | undefined;
    let hoveredComponentId: string | undefined;
    let hoveredInteractionTargetId: string | undefined;
    let focusedInteractionTargetId: string | undefined;
    let disposed = false;
    const transforms = Object.fromEntries(manifest.components.map((component) => [component.componentId, { rotationY: 0, translationX: 0 }]));
    const loadDurationMs = Math.round(performance.now() - started);
    const estimatedMemoryMb = meshes.reduce((total, mesh) => total + (mesh.getTotalVertices() * 3 * 4) + (mesh.getTotalIndices() * 4), 0) / (1024 * 1024);
    const budget = manifest.performanceBudget ?? { minimumFps: 30, interactiveWithinMs: 5000, maxMemoryMb: 128 };
    const state: ModelRuntimeState = { phase: loadDurationMs > budget.interactiveWithinMs || estimatedMemoryMb > budget.maxMemoryMb ? "REDUCED_COMPLEXITY" : "READY", componentIds: manifest.components.map((component) => component.componentId), transforms, loadDurationMs, estimatedMemoryMb, ...(loadDurationMs > budget.interactiveWithinMs ? { fallbackReason: `The approved model exceeded the ${budget.interactiveWithinMs} ms interactive budget; use the equivalent path.` } : estimatedMemoryMb > budget.maxMemoryMb ? { fallbackReason: `The approved model exceeded the ${budget.maxMemoryMb} MB scene budget; use the equivalent path.` } : {}) };
    const selectComponent = (componentId: string, source: ModelSelectionSource = "COMPONENT_LIST", emitAction = true) => { const selected = componentMeshes.get(componentId); if (!selected) return; if (source !== "KEYBOARD") { focusedInteractionTargetId = undefined; state.focusedInteractionTargetId = undefined; state.focusedInteractionTargetName = undefined; state.focusedInteractionType = undefined; } if (selectedComponentId) for (const mesh of componentMeshes.get(selectedComponentId) ?? []) setHighlight(mesh, "selected", false); selectedComponentId = componentId; state.selectedComponentId = componentId; for (const mesh of selected) setHighlight(mesh, "selected", true); emit({ ...state }); if (emitAction) options.onSemanticAction?.({ type: "select_component", componentId, source }); };
    const setHover = (targetId: string | undefined, componentId: string | undefined) => {
      if (hoveredInteractionTargetId === targetId && hoveredComponentId === componentId) return;
      if (hoveredInteractionTargetId) for (const mesh of interactionTargetMeshes.get(hoveredInteractionTargetId) ?? []) setHighlight(mesh, "hovered", false);
      hoveredInteractionTargetId = targetId;
      hoveredComponentId = componentId;
      if (hoveredInteractionTargetId) for (const mesh of interactionTargetMeshes.get(hoveredInteractionTargetId) ?? []) setHighlight(mesh, "hovered", true);
      state.hoveredInteractionTargetId = hoveredInteractionTargetId;
      state.hoveredInteractionTargetName = targetId ? interactionTargetNames.get(targetId) : undefined;
      state.hoveredComponentId = hoveredComponentId;
      if (!disposed) emit({ ...state });
    };
    const targetAt = (pointerEvent: Pick<PointerEvent, "clientX" | "clientY"> | undefined) => {
      if (!pointerEvent) return undefined;
      const rect = options.canvas.getBoundingClientRect();
      if (pointerEvent.clientX < rect.left || pointerEvent.clientX >= rect.right || pointerEvent.clientY < rect.top || pointerEvent.clientY >= rect.bottom) return undefined;
      const hits = scene.multiPick(pointerEvent.clientX - rect.left, pointerEvent.clientY - rect.top)?.filter((pick) => pick.hit && pick.pickedMesh).sort((a, b) => a.distance - b.distance) ?? [];
      const first = hits[0];
      if (!first) return undefined;
      const direct = first.pickedMesh?.metadata?.interactionTargetId;
      if (typeof direct === "string") return direct;
      // Permit a thin printed marking on the same component, but never select a
      // control through another part of the device or an intervening object.
      // Source-derived fascia decals are intentionally decorative and can sit
      // just in front of the stable target meshes; allow the tagged target to
      // be resolved through that one layer without broadening cross-component
      // picking.
      const componentId = first.pickedMesh?.metadata?.componentId;
      if (typeof componentId !== "string") return undefined;
      const decorativeOverlay = first.pickedMesh?.metadata?.decorative === true
        || first.pickedMesh?.metadata?.gltf?.extras?.decorative === true
        || first.pickedMesh?.name === "Photo-derived control fascia";
      const allowedOverlayGap = decorativeOverlay ? 0.25 : 0.01;
      for (const hit of hits.slice(1)) {
        if (hit.distance - first.distance > allowedOverlayGap || hit.pickedMesh?.metadata?.componentId !== componentId) break;
        const targetId = hit.pickedMesh?.metadata?.interactionTargetId;
        if (typeof targetId === "string") return targetId;
      }
      return undefined;
    };
    const componentAtTarget = (targetId: string | undefined) => targetId ? interactionTargetComponents.get(targetId) : undefined;
    const interactionTargetIds = [...interactionTargetRoots.keys()];
    const focusTarget = (targetId: string | undefined) => {
      state.interactionMessage = undefined;
      focusedInteractionTargetId = targetId;
      state.focusedInteractionTargetId = targetId;
      state.focusedInteractionTargetName = targetId ? interactionTargetNames.get(targetId) : undefined;
      state.focusedInteractionType = targetId ? interactionTargetSettings.get(targetId)?.interactionType : undefined;
      setHover(targetId, componentAtTarget(targetId));
      if (targetId) selectComponent(componentAtTarget(targetId)!, "KEYBOARD", false);
      if (!disposed) emit({ ...state });
    };
    let pressedTargetId: string | undefined;
    let pressedPointerId: number | undefined;
    let pressedInteractionType: "press" | "turn" | "open" | "activate" = "activate";
    let pressedTargetBasePosition: Vector3 | undefined;
    let pressedPointerStart: { x: number; y: number } | undefined;
    let pressedDoorPointer: { x: number; y: number } | undefined;
    let projectedSlideDirection: [number, number] | undefined;
    let hingePath: Array<{ x: number; y: number; rotation: number }> | undefined;
    let slidePath: Array<{ x: number; y: number; rotation: number }> | undefined;
    let hingePointerOffset = { x: 0, y: 0 };
    let pressedBaselineTransforms: Record<string, { rotationY: number; translationX: number }> | undefined;
    let dialPreviousY: number | undefined;
    let circularDial: { x: number; y: number; angle: number | undefined; rotation: number } | undefined;
    let pressedPointerMoved = false;
    let pressedInteractionChanged = false;
    let pressedInterruptedAnimation = false;
    let pressedStartRotation = 0;
    let pressedStartTranslation = 0;
    let pressedVisualStartRotation: number | undefined;
    let pressedVisualStartTranslation: number | undefined;
    let pressFrame = 0;
    let accessibleActivationTimer: number | undefined;
    const queuedNamedActions: Array<{ targetId: string; direction?: -1 | 1 }> = [];
    const visualRotations = new Map<string, number>();
    const rotationAnimations = new Map<string, { frame: number; target: number }>();
    const translationAnimations = new Map<string, { frame: number; target: number }>();
    const visualTranslations = new Map<string, number>();
    const setComponentTranslation = (componentId: string, requested: number, animate = false) => {
      const root = componentRoots.get(componentId), base = root && baseTransforms.get(root);
      const rule = manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.translationX;
      if (!root || !base || !rule || !Number.isFinite(requested)) return undefined;
      const value = Math.min(rule.max, Math.max(rule.min, requested));
      const previous = translationAnimations.get(componentId);
      if (previous) window.cancelAnimationFrame(previous.frame);
      translationAnimations.delete(componentId);
      const start = visualTranslations.get(componentId) ?? state.transforms[componentId].translationX;
      const draw = (distance: number) => { root.position.x = base.position.x + distance; visualTranslations.set(componentId, distance); };
      if (!disposed && animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && Math.abs(value - start) > 1e-5) {
        visualTranslations.set(componentId, start);
        const started = performance.now(), animation = { frame: 0, target: value };
        const tick = (now: number) => { if (disposed || translationAnimations.get(componentId) !== animation) return; const progress = Math.min(1, (now - started) / 350); draw(start + (value - start) * progress * progress * (3 - 2 * progress)); if (progress < 1) animation.frame = window.requestAnimationFrame(tick); else translationAnimations.delete(componentId); };
        translationAnimations.set(componentId, animation);
        animation.frame = window.requestAnimationFrame(tick);
      } else draw(value);
      state.transforms[componentId].translationX = value;
      return value;
    };
    const setComponentRotation = (componentId: string, requested: number, settings?: { interactionType?: "press" | "turn" | "open" | "activate"; turnMinRadians?: number; turnMaxRadians?: number; openRotationRadians?: number; openRotationSpace?: "local"; openLiftMeters?: number }, animate = false) => {
      const root = componentRoots.get(componentId);
      const base = root ? baseTransforms.get(root) : undefined;
      if (!root || !base || !Number.isFinite(requested)) return undefined;
      const component = manifest.components.find((item) => item.componentId === componentId);
      const rule = component?.permittedTransforms?.rotationY;
      const min = Math.max(rule?.min ?? -Infinity, settings?.turnMinRadians ?? -Infinity);
      const max = Math.min(rule?.max ?? Infinity, settings?.turnMaxRadians ?? Infinity);
      const value = Math.min(max, Math.max(min, requested));
      const previous = rotationAnimations.get(componentId);
      if (previous) window.cancelAnimationFrame(previous.frame);
      rotationAnimations.delete(componentId);
      const start = visualRotations.get(componentId) ?? state.transforms[componentId].rotationY;
      const applyLift = (angle: number) => { if (settings?.openLiftMeters !== undefined && settings.openRotationRadians) { const liftProgress = Math.min(1, Math.abs(angle / settings.openRotationRadians)); root.position.y = base.position.y + settings.openLiftMeters * liftProgress; } else if (Math.abs(angle) < 1e-8) root.position.y = base.position.y; };
      const draw = (angle: number, liftAngle = angle) => { if (Math.abs(angle) < 1e-8) { if (base.originallyQuaternion) root.rotationQuaternion = base.quaternion.clone(); else { root.rotationQuaternion = null; root.rotation = base.rotation.clone(); } } else if (settings?.interactionType === "turn" || settings?.openRotationSpace === "local") root.rotationQuaternion = base.quaternion.multiply(Quaternion.RotationAxis(Vector3.Up(), angle)); else { root.rotationQuaternion = null; root.rotation = base.rotation.add(new Vector3(0, angle, 0)); } applyLift(liftAngle); visualRotations.set(componentId, angle); };
      if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && Math.abs(value - start) > 1e-5) {
        visualRotations.set(componentId, start);
        applyLift(start);
        const started = performance.now();
        const animation = { frame: 0, target: value };
        const tick = (now: number) => {
          if (disposed || rotationAnimations.get(componentId) !== animation) return;
          const progress = Math.min(1, (now - started) / 350);
          const eased = progress * progress * (3 - 2 * progress);
          // Lift and rotation represent one physical movement. Keeping them
          // coupled also preserves the visible position when it is reversed.
          draw(start + (value - start) * eased);
          if (progress < 1) animation.frame = window.requestAnimationFrame(tick);
          else rotationAnimations.delete(componentId);
        };
        rotationAnimations.set(componentId, animation);
        animation.frame = window.requestAnimationFrame(tick);
      } else draw(value);
      state.transforms[componentId].rotationY = value;
      return value;
    };
    const buildHingePath = (root: TransformNode, localPoint: Vector3, open: number, space?: "local") => {
      const base = baseTransforms.get(root);
      if (!base) return undefined;
      const rect = options.canvas.getBoundingClientRect();
      const width = engine.getRenderWidth(), height = engine.getRenderHeight();
      const viewport = camera.viewport.toGlobal(width, height);
      root.parent?.computeWorldMatrix(true);
      const parent = root.parent?.getWorldMatrix() ?? Matrix.Identity();
      const path: Array<{ x: number; y: number; rotation: number }> = [];
      for (let i = 0; i <= 64; i += 1) {
        const rotation = open * i / 64;
        const local = Matrix.Compose(root.scaling, space === "local" ? base.quaternion.multiply(Quaternion.RotationAxis(Vector3.Up(), rotation)) : Quaternion.FromEulerVector(base.rotation.add(new Vector3(0, rotation, 0))), root.position);
        const world = local.multiply(parent);
        const point = Vector3.TransformCoordinates(localPoint, world);
        const projected = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), viewport);
        const x = rect.left + projected.x * rect.width / width;
        const y = rect.top + projected.y * rect.height / height;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
        path.push({ x, y, rotation });
      }
      return path;
    };
    const buildSlidePath = (root: TransformNode, point: Vector3, open: number) => {
      const base = baseTransforms.get(root);
      if (!base) return undefined;
      root.computeWorldMatrix(true);
      const localPoint = Vector3.TransformCoordinates(point, Matrix.Invert(root.getWorldMatrix()));
      root.parent?.computeWorldMatrix(true);
      const parent = root.parent?.getWorldMatrix() ?? Matrix.Identity();
      const rect = options.canvas.getBoundingClientRect();
      const width = engine.getRenderWidth(), height = engine.getRenderHeight();
      const viewport = camera.viewport.toGlobal(width, height);
      const rotation = root.rotationQuaternion ?? Quaternion.FromEulerVector(root.rotation);
      const path: Array<{ x: number; y: number; rotation: number }> = [];
      for (let i = 0; i <= 64; i += 1) {
        const distance = open * i / 64;
        const position = base.position.add(new Vector3(distance, 0, 0));
        const world = Matrix.Compose(root.scaling, rotation, position).multiply(parent);
        const projected = Vector3.Project(Vector3.TransformCoordinates(localPoint, world), Matrix.Identity(), scene.getTransformMatrix(), viewport);
        const x = rect.left + projected.x * rect.width / width, y = rect.top + projected.y * rect.height / height;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
        path.push({ x, y, rotation: distance });
      }
      const first = path[0], last = path[path.length - 1];
      return Math.hypot(last.x - first.x, last.y - first.y) >= 12 ? path : undefined;
    };
    const nearestPathPosition = (path: typeof hingePath, x: number, y: number, current: number) => {
      if (!path) return undefined;
      const target = { x: x - hingePointerOffset.x, y: y - hingePointerOffset.y };
      let best: { distance: number; rotation: number; x: number; y: number; segment: number; fraction: number } | undefined;
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 1e-8) continue;
        const fraction = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared));
        const px = a.x + fraction * dx, py = a.y + fraction * dy;
        const distance = (target.x - px) ** 2 + (target.y - py) ** 2;
        const rotation = a.rotation + fraction * (b.rotation - a.rotation);
        if (!best || distance < best.distance - 0.01 || (Math.abs(distance - best.distance) <= 0.01 && Math.abs(rotation - current) < Math.abs(best.rotation - current))) best = { distance, rotation, x: px, y: py, segment: i, fraction };
      }
      if (!best) return undefined;
      // Remove overshoot in the endpoint tangent so reversing direction moves
      // the door immediately instead of consuming the overshoot first.
      const atStart = best.segment === 0 && best.fraction < 1e-6;
      const atEnd = best.segment === path.length - 2 && best.fraction > 1 - 1e-6;
      let requested = best.rotation;
      if (atStart || atEnd) {
        const endpoint = atStart ? path[0] : path[path.length - 1];
        const neighbor = atStart ? path[1] : path[path.length - 2];
        const dx = endpoint.x - neighbor.x, dy = endpoint.y - neighbor.y, length = Math.hypot(dx, dy);
        if (length > 1e-6) {
          const overshoot = Math.max(0, ((target.x - endpoint.x) * dx + (target.y - endpoint.y) * dy) / length);
          if (overshoot > 0.1) requested += (atEnd ? 1 : -1) * Math.sign(path[path.length - 1].rotation) * 0.01;
          hingePointerOffset.x += overshoot * dx / length;
          hingePointerOffset.y += overshoot * dy / length;
        }
      }
      return requested;
    };
    const interactionCallback = (targetId: string, componentId: string, interactionType: "press" | "turn" | "open" | "activate", transform?: Partial<{ rotationY: number; translationX: number }>) => {
      if (!disposed) options.onInteractionTargetActivated?.({ targetId, targetName: interactionTargetNames.get(targetId) ?? targetId, componentId, interactionType: interactionType === "activate" ? undefined : interactionType, ...(transform ? { transform } : {}) });
    };
    const reportDoorLimit = (targetId: string, open: number, requested: number, applied: number, lift: boolean) => {
      if (Math.abs(requested - applied) <= 1e-8) { state.interactionMessage = undefined; return; }
      const atOpen = Math.abs(applied - open) < 1e-5;
      const position = lift ? (atOpen ? "raised" : "lowered") : (atOpen ? "open" : "closed");
      state.interactionMessage = `${interactionTargetNames.get(targetId) ?? targetId} is fully ${position}.`;
    };
    const releasePressedTarget = (activate = false, releaseTargetId?: string, pointerId?: number, requestedOpen?: boolean) => {
      if (!pressedTargetId) return;
      // Pointer events can only end the gesture that owns that pointer. In
      // particular, they must not release a keyboard or named-control press.
      if (pointerId !== undefined && pressedPointerId !== pointerId) return;
      if (accessibleActivationTimer !== undefined) { window.clearTimeout(accessibleActivationTimer); accessibleActivationTimer = undefined; }
      const targetId = pressedTargetId;
      const componentId = interactionTargetComponents.get(targetId);
      const interactionType = pressedInteractionType;
      const settings = interactionTargetSettings.get(targetId);
      const capturedPointerId = pressedPointerId;
      const sameTarget = releaseTargetId === targetId;
      let transform: Partial<{ rotationY: number; translationX: number }> | undefined;
      if (interactionType === "open" && settings?.openTranslationMeters !== undefined && componentId) {
        const open = settings.openTranslationMeters;
        const current = state.transforms[componentId].translationX;
        const component = manifest.components.find((item) => item.componentId === componentId);
        const snapped = component ? applyPermittedTransform(component, state.transforms[componentId], { translationX: current }) : null;
        const next = !activate ? pressedStartTranslation : pressedPointerMoved ? (snapped?.translationX ?? pressedStartTranslation) : sameTarget ? (requestedOpen === undefined ? (Math.abs(current) > 1e-5 ? 0 : open) : requestedOpen ? open : 0) : pressedStartTranslation;
        const applied = setComponentTranslation(componentId, next, true);
        if (activate && applied !== undefined && Math.abs(applied - pressedStartTranslation) > 1e-5) transform = { translationX: applied };
      } else if (!activate && (interactionType === "turn" || interactionType === "open") && componentId && (pressedInteractionChanged || pressedInterruptedAnimation)) {
        setComponentRotation(componentId, pressedStartRotation, settings, interactionType === "open");
      } else if (activate && componentId && interactionType === "open" && ((sameTarget && !pressedPointerMoved) || pressedInteractionChanged)) {
        const openRotation = settings?.openRotationRadians ?? manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
        const currentRotation = state.transforms[componentId]?.rotationY ?? 0;
        const component = manifest.components.find((item) => item.componentId === componentId);
        const snapped = component ? applyPermittedTransform(component, state.transforms[componentId], { rotationY: currentRotation }) : null;
        const nextRotation = pressedPointerMoved ? (settings?.openLiftMeters !== undefined ? (Math.abs(currentRotation - openRotation) < Math.abs(currentRotation) ? openRotation : 0) : (snapped?.rotationY ?? pressedStartRotation)) : requestedOpen === undefined ? (Math.abs(currentRotation) > 1e-5 ? 0 : openRotation) : requestedOpen ? openRotation : 0;
        const applied = setComponentRotation(componentId, nextRotation, settings, true);
        if (applied !== undefined && Math.abs(applied - pressedStartRotation) > 1e-5) transform = { rotationY: applied };
      } else if (activate && componentId && interactionType === "turn" && pressedInteractionChanged) {
        const component = manifest.components.find((item) => item.componentId === componentId);
        const current = state.transforms[componentId];
        const snapped = component ? applyPermittedTransform(component, current, { rotationY: current.rotationY }) : null;
        const value = snapped?.rotationY ?? pressedStartRotation;
        setComponentRotation(componentId, value, settings);
        pressedInteractionChanged = Math.abs(value - pressedStartRotation) > 1e-5;
        if (pressedInteractionChanged) transform = { rotationY: value };
      } else if (activate && componentId && interactionType === "open" && pressedInterruptedAnimation) {
        // Releasing outside without moving cancels the grab and lets the
        // previously accepted movement finish.
        setComponentRotation(componentId, pressedStartRotation, settings, true);
      }
      pressedTargetId = undefined;
      pressedPointerId = undefined;
      const root = interactionTargetRoots.get(targetId);
      if (root && interactionType === "press" && pressedTargetBasePosition) root.position.copyFrom(pressedTargetBasePosition);
      if (capturedPointerId !== undefined && options.canvas.hasPointerCapture(capturedPointerId)) options.canvas.releasePointerCapture(capturedPointerId);
      state.pressedInteractionTargetId = undefined;
      state.pressedInteractionTargetName = undefined;
      if (interactionType === "open") state.interactionMessage = undefined;
      setCameraInteraction(true);
      if (!disposed) emit({ ...state });
      const canActivate = interactionType === "turn" ? pressedInteractionChanged : interactionType === "open" ? Boolean(transform) : sameTarget;
      if (activate && canActivate && componentId) {
        if (interactionType === "press" || interactionType === "activate") interactionCallback(targetId, componentId, interactionType);
        else if (transform) interactionCallback(targetId, componentId, interactionType, transform);
      }
      pressedInteractionType = "activate";
      pressedTargetBasePosition = undefined;
      pressedPointerStart = undefined;
      pressedDoorPointer = undefined;
      projectedSlideDirection = undefined;
      hingePath = undefined;
      slidePath = undefined;
      hingePointerOffset = { x: 0, y: 0 };
      pressedBaselineTransforms = undefined;
      dialPreviousY = undefined;
      circularDial = undefined;
      pressedPointerMoved = false;
      pressedInteractionChanged = false;
      pressedInterruptedAnimation = false;
      pressedStartRotation = 0;
      pressedStartTranslation = 0;
      pressedVisualStartRotation = undefined;
      pressedVisualStartTranslation = undefined;
    };
    const interactionBlockReason = (targetId: string, destination?: Partial<{ rotationY: number; translationX: number }>) => {
      const settings = interactionTargetSettings.get(targetId);
      const componentId = interactionTargetComponents.get(targetId);
      if (!settings || settings.interactionType !== "open" || !componentId) return undefined;
      const transform = state.transforms[componentId];
      const axis = settings.openTranslationMeters !== undefined ? "translationX" : "rotationY";
      const open = settings.openTranslationMeters ?? settings.openRotationRadians ?? manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
      const current = transform[axis];
      const requested = destination?.[axis];
      const closing = requested === undefined ? Math.abs(current - open) < Math.abs(current) : Math.abs(requested) < Math.abs(current);
      const requirement = closing ? settings.closeRequires : settings.openRequires;
      if (!requirement) return undefined;
      if (Math.abs((state.transforms[requirement.componentId]?.[requirement.transform] ?? Infinity) - requirement.value) > 1e-5) return requirement.message;
      const visible = requirement.transform === "rotationY" ? visualRotations.get(requirement.componentId) : visualTranslations.get(requirement.componentId);
      // A grabbed part may have its animation paused while its logical target
      // is already at the required position. Check what is actually visible.
      if (Math.abs((visible ?? state.transforms[requirement.componentId]?.[requirement.transform] ?? Infinity) - requirement.value) > 1e-5) {
        const dependencyName = manifest.components.find((item) => item.componentId === requirement.componentId)?.displayName ?? "the required part";
        if (pressedTargetId && interactionTargetComponents.get(pressedTargetId) === requirement.componentId) return `Finish moving or release ${dependencyName} first.`;
        return `Wait for ${dependencyName} to finish moving.`;
      }
      return undefined;
    };
    const pressTarget = (targetId: string, pointerId?: number, start?: { x: number; y: number }, destination?: Partial<{ rotationY: number; translationX: number }>) => {
      const root = interactionTargetRoots.get(targetId);
      const settings = interactionTargetSettings.get(targetId);
      if (!root || !settings || pressedTargetId === targetId) return false;
      if (pressedTargetId && pressedPointerId !== undefined && pointerId !== undefined && pressedPointerId !== pointerId) return false;
      const blocked = interactionBlockReason(targetId, destination);
      if (blocked) {
        state.interactionMessage = blocked;
        emit({ ...state });
        options.onInteractionBlocked?.({ targetId, message: blocked });
        return false;
      }
      state.interactionMessage = undefined;
      releasePressedTarget();
      if (pointerId !== undefined && settings.interactionType === "open") {
        const componentId = interactionTargetComponents.get(targetId)!;
        const animations = settings.openTranslationMeters !== undefined ? translationAnimations : rotationAnimations;
        const animation = animations.get(componentId);
        if (animation) {
          window.cancelAnimationFrame(animation.frame);
          animations.delete(componentId);
          pressedInterruptedAnimation = true;
        }
      }
      pressedInteractionType = settings.interactionType;
      pressedTargetBasePosition = settings.interactionType === "press" ? root.position.clone() : undefined;
      if (settings.interactionType === "press") root.position.addInPlace(settings.pressAxis.scale(settings.pressDepthMeters));
      pressedTargetId = targetId;
      pressedPointerId = pointerId;
      pressedPointerStart = start;
      pressedDoorPointer = start;
      projectedSlideDirection = undefined;
      hingePath = undefined;
      slidePath = undefined;
      hingePointerOffset = { x: 0, y: 0 };
      pressedBaselineTransforms = Object.fromEntries(Object.entries(state.transforms).map(([id, transform]) => [id, { ...transform }]));
      dialPreviousY = start?.y;
      circularDial = undefined;
      if (settings.interactionType === "open" && settings.openTranslationMeters !== undefined && !settings.openDragDirection && start) {
        const componentId = interactionTargetComponents.get(targetId) ?? "";
        const componentRoot = componentRoots.get(componentId);
        const rect = options.canvas.getBoundingClientRect();
        const picked = scene.pick(start.x - rect.left, start.y - rect.top);
        const acceptedSurface = picked?.pickedMesh?.metadata?.interactionTargetId === targetId ||
          (picked?.pickedMesh?.metadata?.componentId === componentId && targetAt({ clientX: start.x, clientY: start.y }) === targetId);
        if (componentRoot && picked?.pickedPoint && acceptedSurface) {
          slidePath = buildSlidePath(componentRoot, picked.pickedPoint, settings.openTranslationMeters);
          if (slidePath) {
            const first = slidePath[0], last = slidePath[slidePath.length - 1];
            projectedSlideDirection = [last.x - first.x, last.y - first.y];
          }
        }
      }
      if (settings.interactionType === "open" && settings.openTranslationMeters === undefined && !settings.openDragDirection && start) {
        const componentId = interactionTargetComponents.get(targetId) ?? "";
        const componentRoot = componentRoots.get(componentId);
        const base = componentRoot && baseTransforms.get(componentRoot);
        const rect = options.canvas.getBoundingClientRect();
        const picked = scene.pick(start.x - rect.left, start.y - rect.top);
        const open = settings.openRotationRadians ?? manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
        const acceptedSurface = picked?.pickedMesh?.metadata?.interactionTargetId === targetId ||
          (picked?.pickedMesh?.metadata?.componentId === componentId && targetAt({ clientX: start.x, clientY: start.y }) === targetId);
        if (componentRoot && base && picked?.pickedPoint && acceptedSurface && open) {
          componentRoot.computeWorldMatrix(true);
          const localPoint = Vector3.TransformCoordinates(picked.pickedPoint, Matrix.Invert(componentRoot.getWorldMatrix()));
          hingePath = buildHingePath(componentRoot, localPoint, open, settings.openRotationSpace);
        }
      }
      if (settings.interactionType === "turn" && start) {
        const meshes = interactionTargetMeshes.get(targetId);
        if (meshes?.length) {
          for (const mesh of meshes) mesh.computeWorldMatrix(true);
          const rect = options.canvas.getBoundingClientRect();
          const picked = scene.pick(start.x - rect.left, start.y - rect.top)?.pickedMesh;
          const center = (picked?.metadata?.interactionTargetId === targetId ? picked : meshes[0]).getBoundingInfo().boundingBox.centerWorld;
          const point = Vector3.Project(center, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
          const x = rect.left + point.x * rect.width / engine.getRenderWidth();
          const y = rect.top + point.y * rect.height / engine.getRenderHeight();
          if (Math.hypot(start.x - x, start.y - y) >= 8) circularDial = { x, y, angle: Math.atan2(start.y - y, start.x - x), rotation: 0 };
        }
      }
      pressedPointerMoved = false;
      pressedInteractionChanged = false;
      pressedStartRotation = state.transforms[interactionTargetComponents.get(targetId) ?? ""]?.rotationY ?? 0;
      pressedStartTranslation = state.transforms[interactionTargetComponents.get(targetId) ?? ""]?.translationX ?? 0;
      setCameraInteraction(false);
      state.pressedInteractionTargetId = targetId;
      state.pressedInteractionTargetName = interactionTargetNames.get(targetId);
      emit({ ...state });
      window.cancelAnimationFrame(pressFrame);
      pressFrame = window.requestAnimationFrame(() => { if (pressedTargetId === targetId) emit({ ...state }); });
      return true;
    };
    const pointerObserver = scene.onPointerObservable.add((event) => {
      if (!interactionEnabled || state.phase === "CONTEXT_LOST") return;
      const pointerEvent = event.event instanceof PointerEvent ? event.event : undefined;
      if (event.type === PointerEventTypes.POINTERDOWN) {
        // Babylon can emit a down notification while processing a move after
        // pointer transitions. Only an actual DOM down may start a gesture.
        if (pointerEvent && pointerEvent.type !== "pointerdown") return;
        if (pointerEvent && pointerEvent.button !== 0) return;
        // A second finger (or a pointer while a key is held) must not capture
        // another control or replace the feedback for the active gesture.
        if (pressedTargetId && (pressedPointerId === undefined || pointerEvent?.pointerId !== pressedPointerId)) return;
        let targetId = event.pickInfo?.pickedMesh?.metadata?.interactionTargetId;
        // A printed label or decorative overlay can be the top visual hit while the
        // physical control beneath it is still the intended press target. Search the
        // full hit stack for the nearest tagged target before giving up.
        if (typeof targetId !== "string") targetId = targetAt(pointerEvent);
        if (typeof targetId === "string") {
          // Pointer interaction takes over from prior keyboard/named-control
          // focus; otherwise stale focus feedback can replace its result.
          focusedInteractionTargetId = undefined;
          state.focusedInteractionTargetId = undefined;
          state.focusedInteractionTargetName = undefined;
          state.focusedInteractionType = undefined;
          const began = pressTarget(targetId, pointerEvent?.pointerId, pointerEvent ? { x: pointerEvent.clientX, y: pointerEvent.clientY } : undefined);
          if (began || (pointerEvent?.pointerType !== "touch" && pointerEvent?.pointerType !== "pen")) setHover(targetId, componentAtTarget(targetId));
          if (began && pointerEvent?.isTrusted && typeof options.canvas.setPointerCapture === "function") options.canvas.setPointerCapture(pointerEvent.pointerId);
        }
        return;
      }
      if (event.type === PointerEventTypes.POINTERMOVE) {
        if (pressedTargetId && pressedPointerId !== undefined && pointerEvent?.pointerId === pressedPointerId && pressedPointerStart) {
          const distance = Math.hypot(pointerEvent.clientX - pressedPointerStart.x, pointerEvent.clientY - pressedPointerStart.y);
          const settings = interactionTargetSettings.get(pressedTargetId);
          // Open/close controls also support taps. Allow a small finger wobble
          // without reducing the precision of dial gestures.
          if (distance > (pointerEvent.pointerType === "touch" ? settings?.touchTapSlopPixels ?? 6 : 6)) pressedPointerMoved = true;
          const componentId = interactionTargetComponents.get(pressedTargetId);
          if (settings?.interactionType === "press" && pressedTargetBasePosition) {
            const root = interactionTargetRoots.get(pressedTargetId);
            if (root) {
              root.position.copyFrom(pressedTargetBasePosition);
              if (targetAt(pointerEvent) === pressedTargetId) root.position.addInPlace(settings.pressAxis.scale(settings.pressDepthMeters));
            }
          }
          if (settings?.interactionType === "turn" && componentId && pressedPointerMoved) {
            let requested = state.transforms[componentId].rotationY + ((dialPreviousY ?? pressedPointerStart.y) - pointerEvent.clientY) * settings.turnSensitivity;
            dialPreviousY = pointerEvent.clientY;
            if (circularDial) {
              const dx = pointerEvent.clientX - circularDial.x, dy = pointerEvent.clientY - circularDial.y;
              if (Math.hypot(dx, dy) >= 8) {
                const angle = Math.atan2(dy, dx);
                if (circularDial.angle !== undefined) {
                  let delta = angle - circularDial.angle;
                  if (delta > Math.PI) delta -= 2 * Math.PI;
                  if (delta < -Math.PI) delta += 2 * Math.PI;
                  circularDial.rotation += delta;
                }
                circularDial.angle = angle;
              } else circularDial.angle = undefined;
              requested = pressedStartRotation + circularDial.rotation;
            }
            const applied = setComponentRotation(componentId, requested, settings);
            if (applied !== undefined) {
              if (circularDial) circularDial.rotation = applied - pressedStartRotation;
              pressedInteractionChanged = Math.abs(applied - pressedStartRotation) > 1e-5;
              state.interactionMessage = Math.abs(requested - applied) > 1e-8
                ? `${interactionTargetNames.get(pressedTargetId) ?? pressedTargetId} is at its ${requested < applied ? "left" : "right"} limit.`
                : undefined;
              emit({ ...state });
            }
          } else if (settings?.interactionType === "open" && componentId && pressedPointerMoved) {
            const previous = pressedDoorPointer ?? pressedPointerStart;
            const dx = pointerEvent.clientX - previous.x, dy = pointerEvent.clientY - previous.y;
            pressedDoorPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
            if (settings.openTranslationMeters !== undefined) {
              const open = settings.openTranslationMeters;
              const direction = settings.openDragDirection ?? projectedSlideDirection;
              const distance = direction ? (dx * direction[0] + dy * direction[1]) / Math.hypot(...direction) : dy;
              const travelPixels = !settings.openDragDirection && projectedSlideDirection ? Math.hypot(...projectedSlideDirection) : 120;
              pressedVisualStartTranslation ??= visualTranslations.get(componentId) ?? pressedStartTranslation;
              const requested = nearestPathPosition(slidePath, pointerEvent.clientX, pointerEvent.clientY, pressedVisualStartTranslation) ?? (pressedVisualStartTranslation + distance * open / travelPixels);
              const applied = setComponentTranslation(componentId, Math.max(Math.min(0, open), Math.min(Math.max(0, open), requested)));
              if (applied !== undefined) { pressedVisualStartTranslation = applied; pressedInteractionChanged = Math.abs(applied - pressedStartTranslation) > 1e-5; reportDoorLimit(pressedTargetId, open, requested, applied, false); emit({ ...state }); }
              return;
            }
            const openRotation = settings.openRotationRadians ?? manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
            pressedVisualStartRotation ??= visualRotations.get(componentId) ?? pressedStartRotation;
            const pathRotation = nearestPathPosition(hingePath, pointerEvent.clientX, pointerEvent.clientY, pressedVisualStartRotation);
            const direction = settings.openDragDirection;
            const requested = pathRotation ?? (pressedVisualStartRotation + (direction ? (dx * direction[0] + dy * direction[1]) / Math.hypot(...direction) * Math.sign(openRotation) * Math.abs(openRotation) / 120 : dx * 0.012));
            const applied = setComponentRotation(componentId, Math.max(Math.min(0, openRotation), Math.min(Math.max(0, openRotation), requested)), settings);
            if (applied !== undefined) { pressedVisualStartRotation = applied; pressedInteractionChanged = Math.abs(applied - pressedStartRotation) > 1e-5; reportDoorLimit(pressedTargetId, openRotation, requested, applied, settings.openLiftMeters !== undefined || settings.openVerb === "Lift"); emit({ ...state }); }
          }
        }
        if (!pressedTargetId && pointerEvent?.pointerType !== "touch" && pointerEvent?.pointerType !== "pen") {
          const targetId = targetAt(pointerEvent);
          setHover(targetId, componentAtTarget(targetId));
        }
        return;
      }
      if (event.type === PointerEventTypes.POINTERUP) {
        if (pointerEvent?.type === "pointercancel") { releasePressedTarget(false, undefined, pointerEvent.pointerId); return; }
        // Babylon may report a pointer-up notification for a move event when the
        // pointer leaves the originally picked mesh. Keep dragging until DOM release.
        if (pointerEvent && pointerEvent.type !== "pointerup") return;
        const targetId = event.pickInfo?.pickedMesh?.metadata?.interactionTargetId ?? targetAt(pointerEvent);
        releasePressedTarget(true, typeof targetId === "string" ? targetId : undefined, pointerEvent?.pointerId);
        return;
      }
      if (event.type !== PointerEventTypes.POINTERPICK || !event.pickInfo?.hit) return;
      // A control click already emits its own action on release. Treating the
      // same click as a component selection would submit a second, competing
      // action to the learner session.
      if (typeof event.pickInfo.pickedMesh?.metadata?.interactionTargetId === "string" || targetAt(pointerEvent)) return;
      const componentId = event.pickInfo.pickedMesh?.metadata?.componentId;
      if (typeof componentId === "string") selectComponent(componentId, "CANVAS");
    });
    let pressedKey: string | undefined;
    const turnWithKeyboard = (targetId: string, componentId: string, direction: number) => {
      const settings = interactionTargetSettings.get(targetId)!;
      const component = manifest.components.find((item) => item.componentId === componentId);
      const rule = component?.permittedTransforms?.rotationY;
      const increment = rule?.snap ?? rule?.step ?? settings.turnSensitivity * 10;
      const previous = state.transforms[componentId]?.rotationY ?? 0;
      const minimum = Math.max(rule?.min ?? -Infinity, settings.turnMinRadians ?? -Infinity);
      const maximum = Math.min(rule?.max ?? Infinity, settings.turnMaxRadians ?? Infinity);
      const requested = Math.max(minimum, Math.min(maximum, previous + direction * increment));
      const normalized = component ? applyPermittedTransform(component, state.transforms[componentId], { rotationY: requested }) : null;
      const valid = normalized && normalized.rotationY >= minimum - 1e-8 && normalized.rotationY <= maximum + 1e-8;
      const applied = valid ? setComponentRotation(componentId, normalized.rotationY, settings) : previous;
      if (applied !== undefined && Math.abs(applied - previous) > 1e-8) {
        state.interactionMessage = undefined;
        emit({ ...state });
        interactionCallback(targetId, componentId, "turn", { rotationY: applied });
      } else if (applied !== undefined) {
        state.interactionMessage = `${interactionTargetNames.get(targetId) ?? targetId} is at its ${direction < 0 ? "left" : "right"} limit.`;
        emit({ ...state });
      }
    };
    const listInteractionTargets = () => interactionTargetIds.map((targetId) => {
      const componentId = interactionTargetComponents.get(targetId)!, settings = interactionTargetSettings.get(targetId)!;
      const position = state.transforms[componentId];
      const current = settings.openTranslationMeters !== undefined ? position.translationX : position.rotationY;
      const open = settings.openTranslationMeters ?? settings.openRotationRadians ?? manifest.components.find((item) => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
      return { targetId, componentId, displayName: interactionTargetNames.get(targetId) ?? targetId, interactionType: settings.interactionType, isOpen: settings.interactionType === "open" && Math.abs(current) > 1e-5, isFullyOpen: settings.interactionType === "open" && Math.abs(current - open) < 1e-5, openVerb: settings.openVerb ?? "Open", closeVerb: settings.closeVerb ?? "Close" };
    });
    const drainNamedActions = () => {
      while (!disposed && interactionEnabled && !pressedTargetId && queuedNamedActions.length) {
        const next = queuedNamedActions.shift()!;
        activateInteractionTarget(next.targetId, next.direction);
      }
    };
    const activateInteractionTarget = (targetId: string, direction?: -1 | 1) => {
      const componentId = interactionTargetComponents.get(targetId), settings = interactionTargetSettings.get(targetId);
      if (disposed || !interactionEnabled || state.phase === "CONTEXT_LOST" || !componentId || !settings) return false;
      if (pressedTargetId) {
        if (accessibleActivationTimer === undefined) return false;
        queuedNamedActions.push({ targetId, direction });
        return true;
      }
      focusTarget(targetId);
      if (settings.interactionType === "turn") { turnWithKeyboard(targetId, componentId, direction ?? 1); return true; }
      const openValue = settings.openTranslationMeters ?? settings.openRotationRadians ?? manifest.components.find(item => item.componentId === componentId)?.permittedTransforms?.rotationY?.max ?? Math.PI / 2;
      const destination = settings.interactionType === "open" && direction !== undefined ? (settings.openTranslationMeters !== undefined ? { translationX: direction > 0 ? openValue : 0 } : { rotationY: direction > 0 ? openValue : 0 }) : undefined;
      if (pressTarget(targetId, undefined, undefined, destination)) accessibleActivationTimer = window.setTimeout(() => {
        accessibleActivationTimer = undefined;
        if (!disposed && pressedTargetId === targetId && pressedPointerId === undefined) releasePressedTarget(true, targetId, undefined, destination ? direction! > 0 : undefined);
        drainNamedActions();
      }, 100);
      return true;
    };
    const keydown = (event: KeyboardEvent) => {
      if (!interactionEnabled || state.phase === "CONTEXT_LOST") return;
      if (event.key === "Escape" && pressedTargetId) {
        event.preventDefault();
        interruptInteraction();
        return;
      }
      // Keep one control in charge of an active pointer gesture. Keyboard
      // navigation or dial shortcuts must not select or change another one.
      if (pressedTargetId && pressedPointerId !== undefined && (event.key.startsWith("Arrow") || event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        return;
      }
      if (pressedKey) {
        if (event.key === pressedKey || event.key.startsWith("Arrow")) event.preventDefault();
        return;
      }
      if (focusedInteractionTargetId && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const settings = interactionTargetSettings.get(focusedInteractionTargetId);
        const componentId = interactionTargetComponents.get(focusedInteractionTargetId);
        if (settings?.interactionType === "turn" && componentId) {
          event.preventDefault();
          const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
          turnWithKeyboard(focusedInteractionTargetId, componentId, direction);
          return;
        }
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowUp") {
        if (!interactionTargetIds.length) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const currentIndex = focusedInteractionTargetId ? interactionTargetIds.indexOf(focusedInteractionTargetId) : direction === 1 ? -1 : 0;
        focusTarget(interactionTargetIds[(currentIndex + direction + interactionTargetIds.length) % interactionTargetIds.length]);
      } else if ((event.key === "Enter" || event.key === " ") && focusedInteractionTargetId) {
        event.preventDefault();
        if (event.repeat || pressedTargetId) return;
        const targetId = focusedInteractionTargetId;
        const settings = interactionTargetSettings.get(targetId);
        const componentId = interactionTargetComponents.get(targetId);
        if (settings?.interactionType === "turn" && componentId) {
          turnWithKeyboard(targetId, componentId, 1);
          return;
        }
        if (pressTarget(targetId)) pressedKey = event.key;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== pressedKey) return;
      event.preventDefault();
      pressedKey = undefined;
      if (pressedPointerId === undefined) releasePressedTarget(true, pressedTargetId);
    };
    const finishPointer = (event: PointerEvent, activate: boolean) => {
      const clearTransientHover = pressedPointerId === event.pointerId && (event.pointerType === "touch" || event.pointerType === "pen");
      releasePressedTarget(activate, activate ? targetAt(event) : undefined, event.pointerId);
      if (clearTransientHover) setHover(undefined, undefined);
    };
    const releaseFromDom = (event: PointerEvent) => finishPointer(event, false);
    const finishFromDom = (event: PointerEvent) => finishPointer(event, true);
    // A second touch can be a resting finger. Treat it as a pinch only after
    // the spacing changes, then keep the gesture until every finger lifts.
    const activeTouches = new Map<number, { x: number; y: number }>();
    let controlPinch: { ids: [number, number]; distance: number; radius: number; engaged: boolean } | undefined;
    const touchDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !cameraInteractive || !interactionEnabled) return;
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!controlPinch && activeTouches.size === 2) {
        const ids = [...activeTouches.keys()] as [number, number];
        const a = activeTouches.get(ids[0])!, b = activeTouches.get(ids[1])!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 0) {
          camera.detachControl();
          camera.inertialRadiusOffset = 0;
          controlPinch = { ids, distance, radius: camera.radius, engaged: false };
          for (const id of ids) {
            try { options.canvas.setPointerCapture(id); } catch { /* The pointer may already have been canceled. */ }
          }
        }
      }
      if (controlPinch) event.stopImmediatePropagation();
    };
    const touchMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !activeTouches.has(event.pointerId)) return;
      activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!controlPinch) return;
      const a = activeTouches.get(controlPinch.ids[0]), b = activeTouches.get(controlPinch.ids[1]);
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (!controlPinch.engaged && Math.abs(distance - controlPinch.distance) >= 8) {
          const interruptedTarget = pressedTargetId, interruptedType = pressedInteractionType;
          releasePressedTarget(false);
          camera.detachControl();
          controlPinch.engaged = true;
          if (interruptedTarget) {
            const name = interactionTargetNames.get(interruptedTarget) ?? interruptedTarget;
            state.interactionMessage = interruptedType === "open" || interruptedType === "turn"
              ? `Zooming. ${name} returned to its previous position.`
              : `Zooming. ${name} was not pressed.`;
            emit({ ...state });
          }
        }
        if (controlPinch.engaged && distance > 0) camera.radius = Math.min(camera.upperRadiusLimit ?? Infinity, Math.max(camera.lowerRadiusLimit ?? 0, controlPinch.radius * controlPinch.distance / distance));
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const touchEnd = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      activeTouches.delete(event.pointerId);
      if (!controlPinch) return;
      if (activeTouches.size === 0 || (!controlPinch.engaged && activeTouches.size < 2)) {
        controlPinch = undefined;
        if (!pressedTargetId) setCameraInteraction(true);
      }
    };
    const interruptInteraction = () => { const wasPinching = Boolean(controlPinch); pressedKey = undefined; queuedNamedActions.length = 0; activeTouches.clear(); controlPinch = undefined; releasePressedTarget(false); if (wasPinching) setCameraInteraction(true); setHover(undefined, undefined); };
    const focusCanvasOnPointerDown = (event: PointerEvent) => { if (interactionEnabled && event.button === 0) options.canvas.focus({ preventScroll: true }); };
    const setInteractionEnabled = (enabled: boolean) => {
      if (disposed || enabled === interactionEnabled) return;
      if (!enabled) interruptInteraction();
      interactionEnabled = enabled;
      options.canvas.tabIndex = enabled ? 0 : -1;
      if (enabled && cameraInteractive) camera.attachControl(options.canvas, true);
      else camera.detachControl();
      options.canvas.style.touchAction = enabled ? "none" : originalTouchAction;
    };
    const setCameraInteractive = (enabled: boolean) => {
      if (disposed || enabled === cameraInteractive) return;
      interruptInteraction();
      cameraInteractive = enabled;
      if (enabled && interactionEnabled) camera.attachControl(options.canvas, true);
      else camera.detachControl();
    };
    const visibilityChanged = () => { if (document.hidden) interruptInteraction(); };
    const clearHoverFromDom = () => { if (!pressedTargetId) setHover(undefined, undefined); };
    options.canvas.addEventListener("keydown", keydown);
    options.canvas.addEventListener("pointerdown", touchDown, true);
    options.canvas.addEventListener("pointermove", touchMove, true);
    options.canvas.addEventListener("pointerup", touchEnd, true);
    options.canvas.addEventListener("pointercancel", touchEnd, true);
    window.addEventListener("pointerup", touchEnd);
    window.addEventListener("pointercancel", touchEnd);
    options.canvas.addEventListener("pointerdown", focusCanvasOnPointerDown, true);
    options.canvas.addEventListener("keyup", keyup);
    options.canvas.addEventListener("blur", interruptInteraction);
    options.canvas.addEventListener("pointerleave", clearHoverFromDom);
    // Cancel before Babylon processes the event as a pointer release.
    options.canvas.addEventListener("pointercancel", releaseFromDom, true);
    options.canvas.addEventListener("pointerup", finishFromDom, true);
    options.canvas.addEventListener("lostpointercapture", releaseFromDom);
    window.addEventListener("blur", interruptInteraction);
    document.addEventListener("visibilitychange", visibilityChanged);
    const resize = () => engine.resize(); window.addEventListener("resize", resize); let phaseBeforeContextLoss: "READY" | "REDUCED_COMPLEXITY" = state.phase === "REDUCED_COMPLEXITY" ? "REDUCED_COMPLEXITY" : "READY"; let fallbackBeforeContextLoss = state.fallbackReason; const contextLost = engine.onContextLostObservable.add(() => { interruptInteraction(); phaseBeforeContextLoss = state.phase === "REDUCED_COMPLEXITY" ? "REDUCED_COMPLEXITY" : "READY"; fallbackBeforeContextLoss = state.fallbackReason; state.phase = "CONTEXT_LOST"; state.fallbackReason = "WebGL context lost. Use the equivalent text path or reload."; emit({ ...state }); }); const contextRestored = engine.onContextRestoredObservable.add(() => { state.phase = phaseAfterContextRestore(phaseBeforeContextLoss, loadDurationMs, state.measuredFps, budget); state.fallbackReason = state.phase === "REDUCED_COMPLEXITY" ? fallbackBeforeContextLoss ?? "The approved model remains on the equivalent path after context recovery." : undefined; emit({ ...state }); });
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
    const rotationModeForComponent = (componentId: string): "euler" | "quaternion" => {
      // A component may expose buttons before its rotational target.
      if ([...interactionTargetComponents].some(([targetId, owner]) => owner === componentId && interactionTargetSettings.get(targetId)?.openRotationSpace === "local")) return "quaternion";
      for (const [targetId, targetComponentId] of interactionTargetComponents) {
        if (targetComponentId !== componentId) continue;
        const settings = interactionTargetSettings.get(targetId);
        return settings?.interactionType === "turn" || settings?.openRotationSpace === "local" ? "quaternion" : "euler";
      }
      return "euler";
    };
    const applyAuthoritativeState = (nextState: AuthoritativeModelState, applyOptions?: { animateTargetId?: string }) => {
      if (!validateAuthoritativeModelState(manifest, nextState)) return;
      if (state.authoritative && nextState.sequence < state.authoritative.sequence) return;
      state.interactionMessage = undefined;
      // Selection-only updates do not invalidate the physical state on which a
      // gesture started. A changed transform does, so cancel that gesture.
      const preserveGesture = Boolean(pressedTargetId && pressedBaselineTransforms && Object.entries(nextState.transforms).every(([id, transform]) => {
        const baseline = pressedBaselineTransforms?.[id];
        return baseline && Math.abs(baseline.rotationY - transform.rotationY) < 1e-8 && Math.abs(baseline.translationX - transform.translationX) < 1e-8;
      }));
      if (pressedTargetId && !preserveGesture) interruptInteraction();
      const activeGestureComponent = preserveGesture && pressedTargetId ? interactionTargetComponents.get(pressedTargetId) : undefined;
      const animatedComponent = applyOptions?.animateTargetId ? interactionTargetComponents.get(applyOptions.animateTargetId) : undefined;
      const animatedSettings = applyOptions?.animateTargetId ? interactionTargetSettings.get(applyOptions.animateTargetId) : undefined;
      const safeTransforms: Record<string, { rotationY: number; translationX: number }> = {};
      for (const component of manifest.components) {
        const transform = component.componentId === activeGestureComponent ? state.transforms[component.componentId] : nextState.transforms[component.componentId];
        safeTransforms[component.componentId] = { rotationY: transform.rotationY, translationX: transform.translationX };
      }
      state.authoritative = nextState;
      for (const [componentId, transform] of Object.entries(safeTransforms)) {
        if (componentId === activeGestureComponent) continue;
        if (componentId === animatedComponent && animatedSettings && Math.abs((visualTranslations.get(componentId) ?? state.transforms[componentId].translationX) - transform.translationX) > 1e-8) setComponentTranslation(componentId, transform.translationX, true);
        const animation = translationAnimations.get(componentId);
        const preserveAnimation = animation && Math.abs(animation.target - transform.translationX) <= 1e-8;
        if (!preserveAnimation) {
          if (animation) window.cancelAnimationFrame(animation.frame);
          translationAnimations.delete(componentId);
          visualTranslations.set(componentId, transform.translationX);
        }
      }
      for (const [componentId, transform] of Object.entries(safeTransforms)) {
        if (componentId === activeGestureComponent) continue;
        const root = componentRoots.get(componentId);
        if (!root) continue;
        const base = baseTransforms.get(root)!;
        if (componentId === animatedComponent && animatedSettings && Math.abs((visualRotations.get(componentId) ?? state.transforms[componentId].rotationY) - transform.rotationY) > 1e-8) setComponentRotation(componentId, transform.rotationY, animatedSettings, true);
        const animation = rotationAnimations.get(componentId);
        const preserveAnimation = animation && Math.abs(animation.target - transform.rotationY) <= 1e-8;
        if (!preserveAnimation) {
          if (animation) window.cancelAnimationFrame(animation.frame);
          rotationAnimations.delete(componentId);
          if (Math.abs(transform.rotationY) < 1e-8) {
            if (base.originallyQuaternion) root.rotationQuaternion = base.quaternion.clone();
            else { root.rotationQuaternion = null; root.rotation = base.rotation.clone(); }
          } else if (rotationModeForComponent(componentId) === "quaternion") root.rotationQuaternion = base.quaternion.multiply(Quaternion.RotationAxis(Vector3.Up(), transform.rotationY));
          else { root.rotationQuaternion = null; root.rotation = base.rotation.add(new Vector3(0, transform.rotationY, 0)); }
          visualRotations.set(componentId, transform.rotationY);
        }
        const liftTarget = manifest.components.find((item) => item.componentId === componentId)?.interactionTargets?.find((target) => target.interactionType === "open" && target.openLiftMeters !== undefined && target.openRotationRadians);
        if (!preserveAnimation) root.position.y = base.position.y + (liftTarget?.openLiftMeters && liftTarget.openRotationRadians ? liftTarget.openLiftMeters * Math.min(1, Math.abs(transform.rotationY / liftTarget.openRotationRadians)) : 0);
        if (!translationAnimations.has(componentId)) root.position.x = base.position.x + transform.translationX;
      }
      state.transforms = safeTransforms;
      const focusedComponent = focusedInteractionTargetId ? interactionTargetComponents.get(focusedInteractionTargetId) : undefined;
      const displaySelection = focusedComponent ?? nextState.selectedComponentId;
      if (displaySelection && componentMeshes.has(displaySelection)) selectComponent(displaySelection, "KEYBOARD", false);
      else if (!displaySelection && selectedComponentId) {
        for (const mesh of componentMeshes.get(selectedComponentId) ?? []) setHighlight(mesh, "selected", false);
        selectedComponentId = undefined;
        state.selectedComponentId = undefined;
      }
      emit({ ...state });
    };
    const resetView = () => { camera.setTarget(cameraConfig?.target ? Vector3.FromArray(cameraConfig.target) : bounds.center); camera.radius = cameraConfig?.radius ?? bounds.radius * 2.8; camera.alpha = cameraConfig?.alpha ?? -0.8; camera.beta = cameraConfig?.beta ?? Math.PI / 2.8; camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; camera.inertialRadiusOffset = 0; camera.inertialPanningX = 0; camera.inertialPanningY = 0; };
    const fitModel = () => {
      if (disposed || !cameraInteractive || !interactionEnabled) return;
      const current = modelBounds(meshes);
      const aspect = Math.max(engine.getRenderWidth() / Math.max(engine.getRenderHeight(), 1), 0.1);
      const halfFov = Math.atan(Math.tan(camera.fov / 2) * Math.min(aspect, 1));
      const alpha = camera.alpha, beta = camera.beta;
      camera.setTarget(current.center);
      camera.alpha = alpha; camera.beta = beta;
      camera.radius = Math.min(camera.upperRadiusLimit ?? Infinity, Math.max(camera.lowerRadiusLimit ?? 0, current.radius / Math.sin(halfFov) * 1.08));
      camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; camera.inertialRadiusOffset = 0; camera.inertialPanningX = 0; camera.inertialPanningY = 0;
    };
    const frameComponent = (componentId: string) => {
      const selected = componentMeshes.get(componentId);
      if (!selected?.length || disposed || !cameraInteractive || !interactionEnabled) return;
      for (const mesh of selected) mesh.computeWorldMatrix(true);
      const componentBounds = modelBounds(selected);
      const aspect = Math.max(engine.getRenderWidth() / Math.max(engine.getRenderHeight(), 1), 0.1);
      const tangentY = Math.tan(camera.fov / 2), tangentX = tangentY * aspect;
      const view = camera.getViewMatrix(true);
      let distance = camera.minZ;
      for (const x of [componentBounds.min.x, componentBounds.max.x]) for (const y of [componentBounds.min.y, componentBounds.max.y]) for (const z of [componentBounds.min.z, componentBounds.max.z]) {
        const relative = new Vector3(x, y, z).subtract(componentBounds.center);
        const point = Vector3.TransformNormal(relative, view);
        distance = Math.max(distance, Math.abs(point.x) / tangentX - point.z, Math.abs(point.y) / tangentY - point.z);
      }
      // Keep the direction used above when retargeting; ArcRotateCamera
      // otherwise changes its angles to preserve its old world position.
      camera.setTarget(componentBounds.center, false, false, true);
      camera.radius = Math.min(camera.upperRadiusLimit ?? Infinity, Math.max(camera.lowerRadiusLimit ?? 0, distance * 1.15));
      camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; camera.inertialRadiusOffset = 0; camera.inertialPanningX = 0; camera.inertialPanningY = 0;
      selectComponent(componentId, "COMPONENT_LIST", selectedComponentId !== componentId);
    };
     return { getState: () => ({ ...state, transforms: Object.fromEntries(Object.entries(state.transforms).map(([id, transform]) => [id, { ...transform }])) }), selectComponent, frameComponent, fitModel, setInteractionHintsVisible, interactionBlockReason, listInteractionTargets, activateInteractionTarget, applyAuthoritativeState, setInteractionEnabled, setCameraInteractive, resetView, dispose: () => { disposed = true; window.cancelAnimationFrame(pressFrame); for (const animation of [...rotationAnimations.values(), ...translationAnimations.values()]) window.cancelAnimationFrame(animation.frame); rotationAnimations.clear(); translationAnimations.clear(); releasePressedTarget(); options.canvas.removeEventListener("keydown", keydown); options.canvas.removeEventListener("pointerdown", touchDown, true); options.canvas.removeEventListener("pointermove", touchMove, true); options.canvas.removeEventListener("pointerup", touchEnd, true); options.canvas.removeEventListener("pointercancel", touchEnd, true); window.removeEventListener("pointerup", touchEnd); window.removeEventListener("pointercancel", touchEnd); options.canvas.removeEventListener("pointerdown", focusCanvasOnPointerDown, true); options.canvas.removeEventListener("keyup", keyup); options.canvas.removeEventListener("blur", interruptInteraction); options.canvas.removeEventListener("pointerleave", clearHoverFromDom); options.canvas.removeEventListener("pointercancel", releaseFromDom, true); options.canvas.removeEventListener("pointerup", finishFromDom, true); options.canvas.removeEventListener("lostpointercapture", releaseFromDom); window.removeEventListener("blur", interruptInteraction); document.removeEventListener("visibilitychange", visibilityChanged); window.clearTimeout(sampleTimeout); window.removeEventListener("resize", resize); scene.onPointerObservable.remove(pointerObserver); engine.onContextLostObservable.remove(contextLost); engine.onContextRestoredObservable.remove(contextRestored); camera.detachControl(); scene.dispose(); engine.dispose(); options.canvas.style.touchAction = originalTouchAction; } };
  } catch (error) {
    partialScene?.dispose(); partialEngine?.dispose(); options.canvas.style.touchAction = originalTouchAction;
    const failure = error instanceof BabylonModelRuntimeError ? error : new BabylonModelRuntimeError("MODEL_RUNTIME_FAILED", error instanceof Error ? error.message : "The Babylon.js runtime failed.");
    emit({ phase: "ERROR", componentIds: [], transforms: {}, errorCode: failure.code, errorMessage: failure.message }); throw failure;
  }
}
