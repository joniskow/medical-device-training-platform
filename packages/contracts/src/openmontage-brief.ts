import type { TrainingSceneManifest } from './scene-manifest.js';
import { validateTrainingSceneManifest } from './scene-manifest.js';

export type OpenMontageIntegrationMode = 'LOCKED_INTERACTIVE' | 'CINEMATIC';

export interface OpenMontageSceneBrief {
  schemaVersion: 'openmontage-scene-brief.v1';
  sceneId: string;
  sourceScene: {
    videoAssetVersionId: string;
    videoSourceHash: string;
    modelVersionId: string;
    modelSourceHash: string;
  };
  foreground: {
    modelVersionId: string;
    sourceHash: string;
    mode: 'MODEL_LOCKED_OVERLAY';
    preserveGeometry: true;
  };
  background: {
    prompt: string;
    mode: OpenMontageIntegrationMode;
    width: number;
    height: number;
    frameRate: number;
    durationSeconds: number;
    preserveCameraComposition: boolean;
    avoidOcclusion: true;
    noDeviceReplacement: true;
    safeRegion?: [number, number, number, number];
  };
  provenance: {
    requestedPipeline: 'OPENMONTAGE';
    promptHash: string;
    sourceRefs: string[];
    rightsReview: 'REQUIRED';
  };
}

export interface OpenMontageRenderArtifact {
  schemaVersion: 'openmontage-render-artifact.v1';
  brief: {
    sceneId: string;
    modelVersionId: string;
    modelSourceHash: string;
    promptHash: string;
  };
  video: {
    assetVersionId: string;
    sourceHash: string;
    contentType: 'video/mp4' | 'video/webm';
    width: number;
    height: number;
    frameRate: number;
    durationSeconds: number;
    byteLength: number;
  };
  status: 'REVIEW_REQUIRED' | 'APPROVED';
  review?: { reviewerId: string; reviewRef: string };
  mode?: OpenMontageIntegrationMode;
  provider?: { name: string; jobId?: string; model?: string };
}

const fail = (message: string): never => { throw new Error(`OPENMONTAGE_SCENE_BRIEF_INVALID:${message}`); };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('OBJECT_REQUIRED');
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]): void => { const allowedSet = new Set(allowed); if (Object.keys(value).some((key) => !allowedSet.has(key))) fail('UNKNOWN_FIELD'); };
const text = (value: unknown, max: number): string => typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail('TEXT_INVALID');
const hash = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : fail('HASH_INVALID');
const number = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail('NUMBER_INVALID');

export function createOpenMontageSceneBrief(sceneValue: unknown, prompt: string, promptHash: string, mode: OpenMontageIntegrationMode = 'LOCKED_INTERACTIVE'): OpenMontageSceneBrief {
  const scene = validateTrainingSceneManifest(sceneValue);
  return {
    schemaVersion: 'openmontage-scene-brief.v1',
    sceneId: scene.sceneId,
    sourceScene: { videoAssetVersionId: scene.video.assetVersionId, videoSourceHash: scene.video.sourceHash, modelVersionId: scene.model.modelVersionId, modelSourceHash: scene.model.sourceHash },
    foreground: { modelVersionId: scene.model.modelVersionId, sourceHash: scene.model.sourceHash, mode: 'MODEL_LOCKED_OVERLAY', preserveGeometry: true },
    background: { prompt: text(prompt, 4000), mode, width: scene.video.width, height: scene.video.height, frameRate: scene.video.frameRate, durationSeconds: scene.video.durationSeconds, preserveCameraComposition: mode === 'LOCKED_INTERACTIVE', avoidOcclusion: true, noDeviceReplacement: true, safeRegion: [0.15, 0.12, 0.7, 0.82] },
    provenance: { requestedPipeline: 'OPENMONTAGE', promptHash: hash(promptHash), sourceRefs: [scene.video.assetVersionId, scene.sceneId], rightsReview: 'REQUIRED' }
  };
}

export function validateOpenMontageSceneBrief(value: unknown): OpenMontageSceneBrief {
  const root = record(value); exactKeys(root, ['schemaVersion', 'sceneId', 'sourceScene', 'foreground', 'background', 'provenance']);
  if (root.schemaVersion !== 'openmontage-scene-brief.v1') fail('SCHEMA_VERSION_UNSUPPORTED');
  const sourceScene = record(root.sourceScene); exactKeys(sourceScene, ['videoAssetVersionId', 'videoSourceHash', 'modelVersionId', 'modelSourceHash']);
  const source = { videoAssetVersionId: text(sourceScene.videoAssetVersionId, 200), videoSourceHash: hash(sourceScene.videoSourceHash), modelVersionId: text(sourceScene.modelVersionId, 200), modelSourceHash: hash(sourceScene.modelSourceHash) };
  const foreground = record(root.foreground); exactKeys(foreground, ['modelVersionId', 'sourceHash', 'mode', 'preserveGeometry']);
  const foregroundValue = { modelVersionId: text(foreground.modelVersionId, 200), sourceHash: hash(foreground.sourceHash), mode: foreground.mode, preserveGeometry: foreground.preserveGeometry };
  if (foregroundValue.mode !== 'MODEL_LOCKED_OVERLAY' || foregroundValue.preserveGeometry !== true || foregroundValue.modelVersionId !== source.modelVersionId || foregroundValue.sourceHash !== source.modelSourceHash) fail('FOREGROUND_BINDING_INVALID');
  const background = record(root.background); exactKeys(background, ['prompt', 'mode', 'width', 'height', 'frameRate', 'durationSeconds', 'preserveCameraComposition', 'avoidOcclusion', 'noDeviceReplacement', 'safeRegion']);
  const mode = background.mode === undefined ? 'LOCKED_INTERACTIVE' : background.mode === 'LOCKED_INTERACTIVE' || background.mode === 'CINEMATIC' ? background.mode : fail('INTEGRATION_MODE_INVALID');
  const safeRegion = background.safeRegion === undefined ? undefined : (() => { if (!Array.isArray(background.safeRegion) || background.safeRegion.length !== 4 || !(background.safeRegion as unknown[]).every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) fail('SAFE_REGION_INVALID'); return background.safeRegion as [number, number, number, number]; })();
  const backgroundValue = { prompt: text(background.prompt, 4000), mode, width: number(background.width, 256, 16384), height: number(background.height, 256, 16384), frameRate: number(background.frameRate, 1, 120), durationSeconds: number(background.durationSeconds, 0.1, 3600), preserveCameraComposition: background.preserveCameraComposition, avoidOcclusion: background.avoidOcclusion, noDeviceReplacement: background.noDeviceReplacement, ...(safeRegion ? { safeRegion } : {}) };
  if (backgroundValue.preserveCameraComposition !== true || backgroundValue.avoidOcclusion !== true || backgroundValue.noDeviceReplacement !== true) fail('BACKGROUND_GUARD_INVALID');
  const provenance = record(root.provenance); exactKeys(provenance, ['requestedPipeline', 'promptHash', 'sourceRefs', 'rightsReview']);
  if (provenance.requestedPipeline !== 'OPENMONTAGE' || provenance.rightsReview !== 'REQUIRED' || !Array.isArray(provenance.sourceRefs) || provenance.sourceRefs.length === 0 || provenance.sourceRefs.length > 32) fail('PROVENANCE_INVALID');
  const provenanceValue = { requestedPipeline: 'OPENMONTAGE' as const, promptHash: hash(provenance.promptHash), sourceRefs: (provenance.sourceRefs as unknown[]).map((ref: unknown) => text(ref, 500)), rightsReview: 'REQUIRED' as const };
  return { schemaVersion: 'openmontage-scene-brief.v1', sceneId: text(root.sceneId, 200), sourceScene: source, foreground: foregroundValue as OpenMontageSceneBrief['foreground'], background: backgroundValue as OpenMontageSceneBrief['background'], provenance: provenanceValue };
}

export function createOpenMontageRenderArtifact(briefValue: unknown, input: OpenMontageRenderArtifact['video']): OpenMontageRenderArtifact {
  const brief = validateOpenMontageSceneBrief(briefValue);
  const artifact: OpenMontageRenderArtifact = {
    schemaVersion: 'openmontage-render-artifact.v1',
    brief: { sceneId: brief.sceneId, modelVersionId: brief.sourceScene.modelVersionId, modelSourceHash: brief.sourceScene.modelSourceHash, promptHash: brief.provenance.promptHash },
    video: input,
    status: 'REVIEW_REQUIRED',
    mode: brief.background.mode
  };
  return validateOpenMontageRenderArtifact(artifact);
}

export function validateOpenMontageRenderArtifact(value: unknown): OpenMontageRenderArtifact {
  const root = record(value); exactKeys(root, ['schemaVersion', 'brief', 'video', 'status', 'review', 'mode', 'provider']);
  if (root.schemaVersion !== 'openmontage-render-artifact.v1') fail('RENDER_ARTIFACT_SCHEMA_UNSUPPORTED');
  const brief = record(root.brief); exactKeys(brief, ['sceneId', 'modelVersionId', 'modelSourceHash', 'promptHash']);
  const briefValue = { sceneId: text(brief.sceneId, 200), modelVersionId: text(brief.modelVersionId, 200), modelSourceHash: hash(brief.modelSourceHash), promptHash: hash(brief.promptHash) };
  const video = record(root.video); exactKeys(video, ['assetVersionId', 'sourceHash', 'contentType', 'width', 'height', 'frameRate', 'durationSeconds', 'byteLength']);
  const contentType: OpenMontageRenderArtifact['video']['contentType'] = video.contentType === 'video/mp4' || video.contentType === 'video/webm' ? video.contentType : fail('RENDER_ARTIFACT_VIDEO_TYPE_INVALID');
  const videoValue = { assetVersionId: text(video.assetVersionId, 200), sourceHash: hash(video.sourceHash), contentType, width: number(video.width, 256, 16384), height: number(video.height, 256, 16384), frameRate: number(video.frameRate, 1, 120), durationSeconds: number(video.durationSeconds, 0.1, 3600), byteLength: number(video.byteLength, 1, 10_000_000_000) };
  const status: OpenMontageRenderArtifact['status'] = root.status === 'REVIEW_REQUIRED' || root.status === 'APPROVED' ? root.status : fail('RENDER_ARTIFACT_STATUS_INVALID');
  const review = root.review === undefined ? undefined : record(root.review);
  if (status === 'APPROVED' && !review) fail('RENDER_ARTIFACT_REVIEW_REQUIRED');
  const reviewValue = review === undefined ? undefined : { reviewerId: text(review.reviewerId, 200), reviewRef: text(review.reviewRef, 500) };
  const artifactMode = root.mode === undefined ? undefined : root.mode === 'LOCKED_INTERACTIVE' || root.mode === 'CINEMATIC' ? root.mode : fail('INTEGRATION_MODE_INVALID');
  const provider = root.provider === undefined ? undefined : (() => { const item = record(root.provider); exactKeys(item, ['name', 'jobId', 'model']); return { name: text(item.name, 200), ...(item.jobId === undefined ? {} : { jobId: text(item.jobId, 200) }), ...(item.model === undefined ? {} : { model: text(item.model, 200) }) }; })();
  return { schemaVersion: 'openmontage-render-artifact.v1', brief: briefValue, video: videoValue, status, ...(reviewValue ? { review: reviewValue } : {}), ...(artifactMode ? { mode: artifactMode } : {}), ...(provider ? { provider } : {}) };
}

export function approveOpenMontageRenderArtifact(value: unknown, reviewerId: string, reviewRef: string): OpenMontageRenderArtifact {
  const artifact = validateOpenMontageRenderArtifact(value);
  if (artifact.status !== 'REVIEW_REQUIRED') fail('RENDER_ARTIFACT_ALREADY_APPROVED');
  return validateOpenMontageRenderArtifact({ ...artifact, status: 'APPROVED', review: { reviewerId: text(reviewerId, 200), reviewRef: text(reviewRef, 500) } });
}

export function createOpenMontageSceneManifest(sceneValue: unknown, artifactValue: unknown): TrainingSceneManifest {
  const scene = validateTrainingSceneManifest(sceneValue);
  const artifact = validateOpenMontageRenderArtifact(artifactValue);
  const review = artifact.review;
  if (artifact.status !== 'APPROVED') fail('RENDER_ARTIFACT_NOT_APPROVED');
  if (!review) fail('RENDER_ARTIFACT_NOT_APPROVED');
  const approvedReview = review as { reviewerId: string; reviewRef: string };
  if (artifact.brief.sceneId !== scene.sceneId || artifact.brief.modelVersionId !== scene.model.modelVersionId || artifact.brief.modelSourceHash !== scene.model.sourceHash) fail('RENDER_ARTIFACT_SCENE_BINDING_INVALID');
  if (artifact.video.width !== scene.video.width || artifact.video.height !== scene.video.height || artifact.video.frameRate !== scene.video.frameRate || Math.abs(artifact.video.durationSeconds - scene.video.durationSeconds) > 0.05) fail('RENDER_ARTIFACT_VIDEO_PROFILE_INVALID');
  const { byteLength: _byteLength, ...sceneVideo } = artifact.video;
  return validateTrainingSceneManifest({ ...scene, video: sceneVideo, production: { pipeline: 'OPENMONTAGE', sourceRefs: [artifact.video.assetVersionId, scene.sceneId], promptHash: artifact.brief.promptHash, rightsReview: 'APPROVED', reviewerId: approvedReview.reviewerId, reviewRef: approvedReview.reviewRef, integrationMode: artifact.mode ?? 'LOCKED_INTERACTIVE', modelRevision: artifact.brief.modelSourceHash } });
}
