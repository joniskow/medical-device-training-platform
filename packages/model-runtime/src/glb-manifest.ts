export interface ModelComponentManifest {
  componentId: string;
  nodePath: string;
  displayName: string;
  aliases: string[];
  interactionCapabilities: string[];
  interactionVolume?: { min: [number, number, number]; max: [number, number, number] };
  interactionTargets?: ModelInteractionTarget[];
  permittedTransforms?: { rotationY?: { min: number; max: number; step: number; snap?: number }; translationX?: { min: number; max: number; step: number; snap?: number } };
}

export interface ModelInteractionTarget {
  targetId: string;
  nodePath: string;
  displayName: string;
  interactionType?: "press" | "turn" | "open";
  pressDepthMeters?: number;
  pressAxis?: [number, number, number];
  turnSensitivity?: number;
  turnMinRadians?: number;
  turnMaxRadians?: number;
  openRotationRadians?: number;
  /** Apply rotationY around the component pivot’s local Y axis. */
  openRotationSpace?: "local";
  /** Touch movement in CSS pixels allowed before treating a tap as a drag. */
  touchTapSlopPixels?: number;
  openLiftMeters?: number;
  openTranslationMeters?: number;
  openDragDirection?: [number, number];
  openVerb?: string;
  closeVerb?: string;
  /** Required whenever the target is away from its closed position. */
  openRequires?: { componentId: string; transform: "rotationY" | "translationX"; value: number; message: string };
  /** Required whenever the target is away from its fully open position. */
  closeRequires?: { componentId: string; transform: "rotationY" | "translationX"; value: number; message: string };
}

export interface ModelFidelityEvidence {
  status: "SEMANTIC_FIXTURE" | "VISUAL_RECONSTRUCTION" | "DIMENSIONALLY_VALIDATED";
  sourceType: "PROCEDURAL_SYNTHETIC" | "REFERENCE_IMAGES" | "PHOTOGRAMMETRY" | "MEASURED_CAD";
  scaleStatus: "UNMEASURED" | "REFERENCE_MEASURED" | "CALIBRATED";
  hiddenSurfaceUncertainty: "UNKNOWN" | "BOUNDED" | "LOW";
  summary: string;
  evidenceRefs?: string[];
}

export interface ModelVariantManifest {
  variantId: string;
  role: "mobile-optimized" | "reduced-complexity" | "full";
  targetProfiles: string[];
  materialMode: string;
  geometryReduction: string;
  preservesComponentIds: string[];
}

export interface ModelManifest {
  schemaVersion: "model-manifest.v1";
  format: "glb";
  sourceHash?: string;
  modelVersionId?: string;
  releaseBindingId?: string;
  unitSystem: "meter";
  scaleMeters: number;
  upAxis: string;
  handedness: "right" | "left";
  origin: "bounding-box-center" | "scene-origin";
  forwardAxis: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
  normalizationStatus: "CANONICAL" | "REQUIRES_NORMALIZATION";
  sceneNodeCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  triangleCount: number;
  materials: Array<{ materialId: string; name: string }>;
  textures: Array<{ textureId: string; sha256: string; byteLength: number }>;
  preparation?:Record<string,unknown>;
  reconstructionLineage?:Record<string,unknown>;
  fidelity?: ModelFidelityEvidence;
  performanceBudget?: { minimumFps: number; interactiveWithinMs: number; maxMemoryMb: number };
  variant?: ModelVariantManifest;
  variants?: Array<{ variantId: string; sourceHash: string; modelVersionId?: string; releaseBindingId?: string; modelBlobKey?: string; manifestBlobKey?: string; targetProfiles?: string[] }>;
  components: ModelComponentManifest[];
}

export class GlbValidationError extends Error {
  readonly code: "INVALID_HEADER" | "INVALID_LENGTH" | "MISSING_JSON" | "INVALID_JSON" | "INVALID_COMPONENTS";

  constructor(code: GlbValidationError["code"], message: string) {
    super(message);
    this.name = "GlbValidationError";
    this.code = code;
  }
}

type GlbDocument = {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{ name?: string; mesh?: number; children?: number[]; translation?: [number, number, number]; rotation?: [number, number, number, number]; extras?: { componentId?: string; interaction?: string; displayName?: string; interactionTargetOwner?: string; interactionTargetId?: string; interactionTargetDisplayName?: string; interactionType?: "press" | "turn" | "open"; pressDepthMeters?: number; pressAxis?: [number, number, number]; turnSensitivity?: number; turnMinRadians?: number; turnMaxRadians?: number; openRotationRadians?: number; openRotationSpace?: "local"; touchTapSlopPixels?: number; openLiftMeters?: number; openTranslationMeters?: number } }>;
  meshes?: Array<{ primitives?: Array<{ indices?: number }> }>;
  materials?: unknown[];
  images?: Array<{bufferView?:number;uri?:string}>;
  textures?: Array<{source?:number}>;
  bufferViews?: Array<{buffer?:number;byteOffset?:number;byteLength:number}>;
  accessors?: Array<{ count?: number }>;
  extras?: { scaleMeters?: number; upAxis?: string; handedness?: "right" | "left"; origin?: "bounding-box-center" | "scene-origin"; forwardAxis?: ModelManifest["forwardAxis"]; preparation?: Record<string,unknown>; fidelity?: ModelFidelityEvidence; provenance?: string };
};

const readUint32 = (bytes: Uint8Array, offset: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

function readJsonChunk(bytes: Uint8Array): GlbDocument {
  if (bytes.byteLength < 20 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF" || readUint32(bytes, 4) !== 2) {
    throw new GlbValidationError("INVALID_HEADER", "GLB must use the glTF 2.0 binary header");
  }
  const declaredLength = readUint32(bytes, 8);
  if (declaredLength !== bytes.byteLength) {
    throw new GlbValidationError("INVALID_LENGTH", "GLB declared length does not match the supplied bytes");
  }

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = readUint32(bytes, offset);
    const chunkType = readUint32(bytes, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.byteLength) throw new GlbValidationError("INVALID_LENGTH", "GLB chunk exceeds the declared file length");
    if (chunkType === 0x4e4f534a) {
      try {
        return JSON.parse(new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd))) as GlbDocument;
      } catch {
        throw new GlbValidationError("INVALID_JSON", "GLB JSON chunk is not valid JSON");
      }
    }
    offset = chunkEnd;
  }
  throw new GlbValidationError("MISSING_JSON", "GLB does not contain a JSON chunk");
}

function nodePaths(document: GlbDocument): Map<number, string> {
  const paths = new Map<number, string>();
  const nodes = document.nodes ?? [];
  const scene = (document.scenes ?? [])[document.scene ?? 0];
  const visit = (index: number, parent: string): void => {
    if (paths.has(index)) throw new GlbValidationError("INVALID_COMPONENTS", `GLB node ${index} is referenced more than once`);
    const node = nodes[index];
    if (!node) throw new GlbValidationError("INVALID_COMPONENTS", `GLB references missing node ${index}`);
    const path = parent ? `${parent}/${node.name ?? `Node${index}`}` : (node.name ?? `Node${index}`);
    paths.set(index, path);
    for (const child of node.children ?? []) visit(child, path);
  };
  for (const root of scene?.nodes ?? []) visit(root, "");
  return paths;
}

export function readEmbeddedGlbImages(bytes:Uint8Array):Uint8Array[]{
  const document=readJsonChunk(bytes);
  let offset=12,binary:Uint8Array|undefined;
  while(offset+8<=bytes.length){const length=readUint32(bytes,offset);if(offset+8+length>bytes.length)throw new GlbValidationError('INVALID_LENGTH','Invalid binary chunk');if(readUint32(bytes,offset+4)===0x004e4942)binary=bytes.subarray(offset+8,offset+8+length);offset+=8+length;}
  return (document.images??[]).map(image=>{const view=image.bufferView===undefined?undefined:document.bufferViews?.[image.bufferView];if(image.uri||!view||view.buffer!==undefined&&view.buffer!==0||!binary||!Number.isSafeInteger(view.byteLength)||view.byteLength<1||!Number.isSafeInteger(view.byteOffset??0)||(view.byteOffset??0)<0||(view.byteOffset??0)+view.byteLength>binary.length)throw new GlbValidationError('INVALID_LENGTH','Textures must be embedded with valid byte bounds');return binary.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);});
}

export function createGlbModelManifest(bytes: Uint8Array, sourceHash?: string, textureHash?:(image:Uint8Array)=>string): ModelManifest {
  const document = readJsonChunk(bytes);
  const nodes = document.nodes ?? [];
  const paths = nodePaths(document);
  const components: ModelComponentManifest[] = nodes.flatMap((node, index) => {
    const componentId = node.extras?.componentId;
    if (!componentId) return [];
    const interaction = node.extras?.interaction;
    return [{
      componentId,
      nodePath: paths.get(index) ?? node.name ?? `Node${index}`,
      displayName: node.extras?.displayName ?? node.name ?? componentId,
      aliases: [],
      interactionCapabilities: interaction ? [interaction] : []
    }];
  });
  for (const node of nodes) {
    const extras = node.extras;
    if (!extras?.interactionTargetOwner || !extras.interactionTargetId) continue;
    const owner = components.find((component) => component.componentId === extras.interactionTargetOwner);
    if (!owner) continue;
    const target = {
      targetId: extras.interactionTargetId,
      nodePath: paths.get(nodes.indexOf(node)) ?? node.name ?? extras.interactionTargetId,
      displayName: extras.interactionTargetDisplayName ?? node.name ?? extras.interactionTargetId,
      ...(extras.interactionType !== undefined ? { interactionType: extras.interactionType } : {}),
      ...(extras.pressDepthMeters !== undefined ? { pressDepthMeters: extras.pressDepthMeters } : {}),
      ...(extras.pressAxis !== undefined ? { pressAxis: extras.pressAxis } : {}),
      ...(extras.turnSensitivity !== undefined ? { turnSensitivity: extras.turnSensitivity } : {}),
      ...(extras.turnMinRadians !== undefined ? { turnMinRadians: extras.turnMinRadians } : {}),
      ...(extras.turnMaxRadians !== undefined ? { turnMaxRadians: extras.turnMaxRadians } : {}),
      ...(extras.openRotationRadians !== undefined ? { openRotationRadians: extras.openRotationRadians } : {}),
      ...(extras.openRotationSpace !== undefined ? { openRotationSpace: extras.openRotationSpace } : {}),
      ...(extras.touchTapSlopPixels !== undefined ? { touchTapSlopPixels: extras.touchTapSlopPixels } : {}),
      ...(extras.openLiftMeters !== undefined ? { openLiftMeters: extras.openLiftMeters } : {}),
      ...(extras.openTranslationMeters !== undefined ? { openTranslationMeters: extras.openTranslationMeters } : {})
    } satisfies ModelInteractionTarget;
    owner.interactionTargets = [...(owner.interactionTargets ?? []), target];
  }
  const ids = new Set(components.map((component) => component.componentId));
  if (components.length === 0 || ids.size !== components.length) {
    throw new GlbValidationError("INVALID_COMPONENTS", "GLB must expose unique component IDs on reachable nodes");
  }

  const accessors = document.accessors ?? [];
  const triangleCount = (document.meshes ?? []).reduce((total, mesh) => total + (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
    const accessor = primitive.indices === undefined ? undefined : accessors[primitive.indices];
    return meshTotal + (accessor?.count ? Math.floor(accessor.count / 3) : 0);
  }, 0), 0);
  const scaleMeters = document.extras?.scaleMeters ?? 1;
  const upAxis = document.extras?.upAxis ?? "Y";
  const handedness = document.extras?.handedness ?? "right";
  const origin = document.extras?.origin ?? "bounding-box-center";
  const forwardAxis = document.extras?.forwardAxis ?? "-Z";
  const images=readEmbeddedGlbImages(bytes);
  const textures=(document.textures??[]).map((texture,index)=>{const image=texture.source===undefined?undefined:images[texture.source];if(!image)throw new GlbValidationError('INVALID_LENGTH','Texture image is missing');const hash=textureHash?.(image);if(!hash||!/^[a-f0-9]{64}$/.test(hash))throw new GlbValidationError('INVALID_LENGTH','Texture hashing is required');return {textureId:`texture-${index}`,sha256:hash,byteLength:image.length};});
  const preparation=document.extras?.preparation;
  if(preparation&&(preparation.schemaVersion!=='candidate-preparation.v1'||preparation.approved!==false||typeof preparation.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(preparation.sourceHash)||JSON.stringify(preparation).length>32768))throw new GlbValidationError('INVALID_COMPONENTS','Invalid author preparation evidence');

  return {
    schemaVersion: "model-manifest.v1",
    format: "glb",
    sourceHash,
    unitSystem: "meter",
    scaleMeters,
    upAxis,
    handedness,
    origin,
    forwardAxis,
    normalizationStatus: scaleMeters === 1 && upAxis === "Y" && handedness === "right" && origin === "bounding-box-center" && forwardAxis === "-Z" ? "CANONICAL" : "REQUIRES_NORMALIZATION",
    sceneNodeCount: paths.size,
    meshCount: document.meshes?.length ?? 0,
    materialCount: document.materials?.length ?? 0,
    textureCount: document.textures?.length??0,
    triangleCount,
    materials: (document.materials ?? []).map((_, index) => ({ materialId: `material-${index}`, name: `Material ${index + 1}` })),
    textures,
    ...(preparation?{preparation}:{}),
    ...(document.extras?.fidelity ? { fidelity: document.extras.fidelity } : {}),
    components
  };
}
