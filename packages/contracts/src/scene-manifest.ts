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

export interface TrainingSceneManifest {
  schemaVersion: 'training-scene.v1';
  sceneId: string;
  video: TrainingSceneVideo;
  model: TrainingSceneModel;
  camera: TrainingSceneCamera;
  render: TrainingSceneRenderPolicy;
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
  const camera = record(value); exactKeys(camera, ['projection', 'focalLengthPixels', 'principalPointPixels', 'distortion']);
  if (camera.projection !== 'perspective') fail('PROJECTION_INVALID');
  const principal = vector2(camera.principalPointPixels, 0, 1_000_000);
  const distortion = camera.distortion === undefined ? undefined : (() => {
    const item = record(camera.distortion); exactKeys(item, ['radial', 'tangential']);
    return { radial: vector(item.radial, -100, 100), tangential: vector2(item.tangential, -100, 100) };
  })();
  return { projection: 'perspective', focalLengthPixels: finite(camera.focalLengthPixels, 1, 1_000_000), principalPointPixels: principal, ...(distortion ? { distortion } : {}) };
}

function parseRender(value: unknown): TrainingSceneRenderPolicy {
  const render = record(value); exactKeys(render, ['opacity', 'receiveShadows', 'castShadows']);
  return { opacity: finite(render.opacity, 0, 1), receiveShadows: boolean(render.receiveShadows), castShadows: boolean(render.castShadows) };
}

export function validateTrainingSceneManifest(value: unknown): TrainingSceneManifest {
  const root = record(value); exactKeys(root, ['schemaVersion', 'sceneId', 'video', 'model', 'camera', 'render']);
  if (root.schemaVersion !== 'training-scene.v1') fail('SCHEMA_VERSION_UNSUPPORTED');
  const video = parseVideo(root.video); const camera = parseCamera(root.camera);
  if (camera.principalPointPixels[0] > video.width || camera.principalPointPixels[1] > video.height) fail('PRINCIPAL_POINT_OUT_OF_BOUNDS');
  return { schemaVersion: 'training-scene.v1', sceneId: text(root.sceneId, 200), video, model: parseModel(root.model), camera, render: parseRender(root.render) };
}
