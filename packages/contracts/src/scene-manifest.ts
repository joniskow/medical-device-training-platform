export type TrainingSceneContentType = 'video/mp4' | 'video/webm';

export interface TrainingSceneVideo {
  assetVersionId: string;
  sourceHash: string;
  contentType: TrainingSceneContentType;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
}

export interface TrainingSceneModel {
  modelVersionId: string;
  sourceHash: string;
  translationMeters: [number, number, number];
  rotationRadians: [number, number, number];
  scale: number;
}

export interface TrainingSceneCamera {
  projection: 'perspective';
  focalLengthPixels: number;
  principalPointPixels: [number, number];
  orbit?: { alpha: number; beta: number; radius: number; target: [number, number, number] };
  distortion?: {
    radial: [number, number, number];
    tangential: [number, number];
  };
}

export interface TrainingSceneRenderPolicy {
  opacity: number;
  receiveShadows: boolean;
  castShadows: boolean;
}

export interface TrainingSceneInteractionCue {
  startSeconds: number;
  endSeconds: number;
  componentId?: string;
  targetId?: string;
  allowedActions: string[];
  label: string;
}

export interface TrainingSceneInteraction {
  mode: 'PASSIVE' | 'INTERACTIVE_OVERLAY' | 'INTERACTIVE_SPLIT';
  equivalentPath: 'TEXT_KEYBOARD';
  cues: TrainingSceneInteractionCue[];
}

export interface TrainingSceneProduction {
  pipeline: 'OPENMONTAGE' | 'MANUAL' | 'OTHER';
  sourceRefs: string[];
  promptHash?: string;
  rightsReview: 'APPROVED';
  reviewerId?: string;
  reviewRef?: string;
}

export interface TrainingSceneManifest {
  schemaVersion: 'training-scene.v1';
  sceneId: string;
  video: TrainingSceneVideo;
  model: TrainingSceneModel;
  camera: TrainingSceneCamera;
  render: TrainingSceneRenderPolicy;
  interaction?: TrainingSceneInteraction;
  production?: TrainingSceneProduction;
}

const fail = (message: string): never => { throw new Error(`TRAINING_SCENE_MANIFEST_INVALID:${message}`); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('OBJECT_REQUIRED');
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) fail('UNKNOWN_FIELD');
};
const text = (value: unknown, max: number): string => typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail('TEXT_INVALID');
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : fail('HASH_INVALID');
const finite = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail('NUMBER_INVALID');
const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : fail('BOOLEAN_INVALID');
function vector(value: unknown, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail('VECTOR_INVALID');
  const items = value as unknown[];
  return [finite(items[0], min, max), finite(items[1], min, max), finite(items[2], min, max)];
}
function vector2(value: unknown, min: number, max: number): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail('VECTOR_INVALID');
  const items = value as unknown[];
  return [finite(items[0], min, max), finite(items[1], min, max)];
}

function parseVideo(value: unknown): TrainingSceneVideo {
  const video = record(value); exactKeys(video, ['assetVersionId', 'sourceHash', 'contentType', 'width', 'height', 'frameRate', 'durationSeconds']);
  const width = finite(video.width, 256, 16384); const height = finite(video.height, 256, 16384);
  const contentType = video.contentType === 'video/mp4' || video.contentType === 'video/webm' ? video.contentType : fail('VIDEO_TYPE_INVALID');
  return { assetVersionId: text(video.assetVersionId, 200), sourceHash: hash(video.sourceHash), contentType, width, height, frameRate: finite(video.frameRate, 1, 120), durationSeconds: finite(video.durationSeconds, 0.1, 3600) };
}

function parseModel(value: unknown): TrainingSceneModel {
  const model = record(value); exactKeys(model, ['modelVersionId', 'sourceHash', 'translationMeters', 'rotationRadians', 'scale']);
  return { modelVersionId: text(model.modelVersionId, 200), sourceHash: hash(model.sourceHash), translationMeters: vector(model.translationMeters, -1000, 1000), rotationRadians: vector(model.rotationRadians, -1000, 1000), scale: finite(model.scale, 0.0001, 1000) };
}

function parseCamera(value: unknown): TrainingSceneCamera {
  const camera = record(value); exactKeys(camera, ['projection', 'focalLengthPixels', 'principalPointPixels', 'orbit', 'distortion']);
  if (camera.projection !== 'perspective') fail('PROJECTION_INVALID');
  const principal = vector2(camera.principalPointPixels, 0, 1_000_000);
  const orbit = camera.orbit === undefined ? undefined : (() => {
    const item = record(camera.orbit); exactKeys(item, ['alpha', 'beta', 'radius', 'target']);
    return { alpha: finite(item.alpha, -1000, 1000), beta: finite(item.beta, 0.001, Math.PI - 0.001), radius: finite(item.radius, 0.001, 1000), target: vector(item.target, -1000, 1000) };
  })();
  const distortion = camera.distortion === undefined ? undefined : (() => {
    const item = record(camera.distortion); exactKeys(item, ['radial', 'tangential']);
    return { radial: vector(item.radial, -100, 100), tangential: vector2(item.tangential, -100, 100) };
  })();
  return { projection: 'perspective', focalLengthPixels: finite(camera.focalLengthPixels, 1, 1_000_000), principalPointPixels: principal, ...(orbit ? { orbit } : {}), ...(distortion ? { distortion } : {}) };
}

function parseRender(value: unknown): TrainingSceneRenderPolicy {
  const render = record(value); exactKeys(render, ['opacity', 'receiveShadows', 'castShadows']);
  return { opacity: finite(render.opacity, 0, 1), receiveShadows: boolean(render.receiveShadows), castShadows: boolean(render.castShadows) };
}

function parseInteraction(value: unknown, durationSeconds: number): TrainingSceneInteraction {
  const interaction = record(value); exactKeys(interaction, ['mode', 'equivalentPath', 'cues']);
  const mode = interaction.mode === 'PASSIVE' || interaction.mode === 'INTERACTIVE_OVERLAY' || interaction.mode === 'INTERACTIVE_SPLIT' ? interaction.mode : fail('INTERACTION_MODE_INVALID');
  if (interaction.equivalentPath !== 'TEXT_KEYBOARD') fail('EQUIVALENT_PATH_INVALID');
  if (!Array.isArray(interaction.cues) || interaction.cues.length > 100) fail('INTERACTION_CUES_INVALID');
  const cues = (interaction.cues as unknown[]).map((value: unknown) => {
    const cue = record(value); exactKeys(cue, ['startSeconds', 'endSeconds', 'componentId', 'targetId', 'allowedActions', 'label']);
    const startSeconds = finite(cue.startSeconds, 0, durationSeconds); const endSeconds = finite(cue.endSeconds, 0, durationSeconds);
    if (endSeconds <= startSeconds) fail('INTERACTION_CUE_RANGE_INVALID');
    const componentId = cue.componentId === undefined ? undefined : text(cue.componentId, 200);
    const targetId = cue.targetId === undefined ? undefined : text(cue.targetId, 200);
    if (!componentId && !targetId) fail('INTERACTION_CUE_TARGET_REQUIRED');
    if (!Array.isArray(cue.allowedActions) || cue.allowedActions.length === 0 || cue.allowedActions.length > 16 || !cue.allowedActions.every((action) => typeof action === 'string' && action.length > 0 && action.length <= 100)) fail('INTERACTION_CUE_ACTIONS_INVALID');
    return { startSeconds, endSeconds, ...(componentId ? { componentId } : {}), ...(targetId ? { targetId } : {}), allowedActions: cue.allowedActions as string[], label: text(cue.label, 200) };
  });
  return { mode, equivalentPath: 'TEXT_KEYBOARD', cues };
}

function parseProduction(value: unknown): TrainingSceneProduction {
  const production = record(value); exactKeys(production, ['pipeline', 'sourceRefs', 'promptHash', 'rightsReview', 'reviewerId', 'reviewRef']);
  const pipeline = production.pipeline === 'OPENMONTAGE' || production.pipeline === 'MANUAL' || production.pipeline === 'OTHER' ? production.pipeline : fail('PRODUCTION_PIPELINE_INVALID');
  if (!Array.isArray(production.sourceRefs) || production.sourceRefs.length === 0 || production.sourceRefs.length > 32) fail('PRODUCTION_SOURCES_INVALID');
  const sourceRefs = (production.sourceRefs as unknown[]).map((source: unknown) => text(source, 500));
  const promptHash = production.promptHash === undefined ? undefined : hash(production.promptHash);
  if (production.rightsReview !== 'APPROVED') fail('PRODUCTION_RIGHTS_REVIEW_REQUIRED');
  const reviewerId = production.reviewerId === undefined ? undefined : text(production.reviewerId, 200);
  const reviewRef = production.reviewRef === undefined ? undefined : text(production.reviewRef, 500);
  if (pipeline === 'OPENMONTAGE' && (!reviewerId || !reviewRef)) fail('PRODUCTION_REVIEW_EVIDENCE_REQUIRED');
  return { pipeline, sourceRefs, ...(promptHash ? { promptHash } : {}), rightsReview: 'APPROVED', ...(reviewerId ? { reviewerId } : {}), ...(reviewRef ? { reviewRef } : {}) };
}

export function validateTrainingSceneManifest(value: unknown): TrainingSceneManifest {
  const root = record(value); exactKeys(root, ['schemaVersion', 'sceneId', 'video', 'model', 'camera', 'render', 'interaction', 'production']);
  if (root.schemaVersion !== 'training-scene.v1') fail('SCHEMA_VERSION_UNSUPPORTED');
  const video = parseVideo(root.video); const camera = parseCamera(root.camera);
  if (camera.principalPointPixels[0] > video.width || camera.principalPointPixels[1] > video.height) fail('PRINCIPAL_POINT_OUT_OF_BOUNDS');
  const interaction = root.interaction === undefined ? undefined : parseInteraction(root.interaction, video.durationSeconds);
  const production = root.production === undefined ? undefined : parseProduction(root.production);
  return { schemaVersion: 'training-scene.v1', sceneId: text(root.sceneId, 200), video, model: parseModel(root.model), camera, render: parseRender(root.render), ...(interaction ? { interaction } : {}), ...(production ? { production } : {}) };
}
