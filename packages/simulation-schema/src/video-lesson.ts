import { validateLessonDirection, type LessonDirection } from './lesson-direction.js';
import { validateSceneTakeState, type TakeLesson } from './lesson-scene-takes.js';
export type VideoLessonVisualKind = 'source_video' | 'source_image' | 'model' | 'cinematic_background';

export interface VideoLessonCitation { assetVersionId: string; [key: string]: unknown; }

export interface VideoLessonScene {
  sceneId: string;
  startSeconds: number;
  endSeconds: number;
  narration: string;
  narrationDelivery?: { rate?: number; emphasis?: 'none' | 'reduced' | 'moderate'; pauses?: Array<{ afterText: string; milliseconds: number }>; pronunciations?: Array<{ term: string; alias: string }> };
  audioMix?: { speechOnly: boolean; instructionalSounds: Array<{ assetVersionId: string; evidenceId: string; sourceStartSeconds: number; durationSeconds: number; atSeconds: number }> };
  onScreenText: string[];
  visual: { kind: VideoLessonVisualKind; assetVersionId?: string; componentId?: string; label: string };
  citations: VideoLessonCitation[];
  checkpointActivityId?: string;
}

export interface VideoLessonPlan {
  schemaVersion: 'video-lesson.v1';
  lessonId: string;
  title: string;
  durationSeconds: number;
  learningObjectives: string[];
  safetyBoundary: string;
  scenes: VideoLessonScene[];
  citations: VideoLessonCitation[];
  direction?: LessonDirection;
  variantIdentity?: import('./lesson-variants.js').LessonVariantIdentity;
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function validNarrationDelivery(narration: unknown, value: unknown): boolean {
  if (typeof narration !== 'string' || !record(value) || Object.keys(value).some(k => !['rate', 'emphasis', 'pauses', 'pronunciations'].includes(k))) return false;
  if (value.rate !== undefined && (typeof value.rate !== 'number' || !Number.isFinite(value.rate) || value.rate < 0.75 || value.rate > 1.25)) return false;
  if (value.emphasis !== undefined && !['none', 'reduced', 'moderate'].includes(String(value.emphasis))) return false;
  if (value.pauses !== undefined && (!Array.isArray(value.pauses) || value.pauses.length > 24 || !value.pauses.every(p => record(p) && Object.keys(p).every(k => ['afterText', 'milliseconds'].includes(k)) && text(p.afterText, 160) && narration.split(p.afterText).length === 2 && typeof p.milliseconds === 'number' && Number.isInteger(p.milliseconds) && p.milliseconds >= 0 && p.milliseconds <= 5000) || new Set(value.pauses.map(p => p.afterText)).size !== value.pauses.length)) return false;
  if (value.pronunciations !== undefined && (!Array.isArray(value.pronunciations) || value.pronunciations.length > 32 || !value.pronunciations.every(p => record(p) && Object.keys(p).every(k => ['term', 'alias'].includes(k)) && text(p.term, 160) && text(p.alias, 160) && narration.includes(p.term)) || new Set(value.pronunciations.map(p => p.term)).size !== value.pronunciations.length)) return false;
  return true;
}

export function validateVideoLesson(value: unknown): { valid: boolean; findings: Array<{ code: string; path: string; message: string }> } {
  const findings: Array<{ code: string; path: string; message: string }> = [];
  const fail = (code: string, path: string, message: string) => findings.push({ code, path, message });
  if (!record(value) || value.schemaVersion !== 'video-lesson.v1') return { valid: false, findings: [{ code: 'VIDEO_LESSON_SCHEMA_INVALID', path: 'videoLesson', message: 'A video lesson must use video-lesson.v1.' }] };
  if (value.generationStatus === 'STALE') fail('VIDEO_LESSON_BRIEF_STALE', 'generationStatus', 'Regenerate the lesson after instructional brief or reference changes.');
  if (!id(value.lessonId)) fail('VIDEO_LESSON_ID_INVALID', 'lessonId', 'The video lesson needs a stable identifier.');
  if (!text(value.title, 240)) fail('VIDEO_LESSON_TITLE_REQUIRED', 'title', 'The video lesson needs a title.');
  if (typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 30 || value.durationSeconds > 300) fail('VIDEO_LESSON_DURATION_INVALID', 'durationSeconds', 'Video lessons must be between 30 and 300 seconds.');
  if (!Array.isArray(value.learningObjectives) || value.learningObjectives.length < 1 || value.learningObjectives.length > 8 || !value.learningObjectives.every(item => text(item, 500))) fail('VIDEO_LESSON_OBJECTIVES_INVALID', 'learningObjectives', 'Provide one to eight concise learning objectives.');
  if (!text(value.safetyBoundary, 2000)) fail('VIDEO_LESSON_SAFETY_BOUNDARY_REQUIRED', 'safetyBoundary', 'A visible safety boundary is required.');
  if (!Array.isArray(value.citations) || value.citations.length === 0 || !value.citations.every(citation => record(citation) && id(citation.assetVersionId))) fail('VIDEO_LESSON_CITATIONS_INVALID', 'citations', 'The lesson needs source citations with stable asset version IDs.');
  const scenes = Array.isArray(value.scenes) ? value.scenes : [];
  if (scenes.length < 1 || scenes.length > 12) fail('VIDEO_LESSON_SCENES_INVALID', 'scenes', 'Provide one to twelve ordered scenes.');
  let cursor = 0;
  const sceneIds = new Set<string>();
  for (const [index, scene] of scenes.entries()) {
    const path = `scenes[${index}]`;
    if (!record(scene)) { fail('VIDEO_LESSON_SCENE_INVALID', path, 'Each scene must be an object.'); continue; }
    if (!id(scene.sceneId) || sceneIds.has(scene.sceneId)) fail('VIDEO_LESSON_SCENE_ID_INVALID', `${path}.sceneId`, 'Scene IDs must be unique and stable.');
    sceneIds.add(String(scene.sceneId));
    const start = scene.startSeconds, end = scene.endSeconds;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start !== cursor || end > Number(value.durationSeconds)) fail('VIDEO_LESSON_TIMELINE_INVALID', path, 'Scenes must be contiguous, ordered, and fit inside the lesson duration.');
    cursor = typeof end === 'number' && Number.isFinite(end) ? end : cursor;
    if (!text(scene.narration, 4000)) fail('VIDEO_LESSON_NARRATION_REQUIRED', `${path}.narration`, 'Every scene needs reviewed narration text.');
    if (scene.narrationDelivery !== undefined && !validNarrationDelivery(scene.narration, scene.narrationDelivery)) fail('VIDEO_LESSON_DELIVERY_INVALID', `${path}.narrationDelivery`, 'Use supported pace, emphasis, unique pause anchors and script terminology.');
    if (scene.audioMix !== undefined) {
      const mix = scene.audioMix;
      const soundsValid = record(mix) && Object.keys(mix).every(k => ['speechOnly', 'instructionalSounds'].includes(k)) && typeof mix.speechOnly === 'boolean' && Array.isArray(mix.instructionalSounds) && mix.instructionalSounds.length <= 8 && mix.instructionalSounds.every(sound => record(sound) && Object.keys(sound).every(k => ['assetVersionId', 'evidenceId', 'sourceStartSeconds', 'durationSeconds', 'atSeconds'].includes(k)) && id(sound.assetVersionId) && id(sound.evidenceId) && record(scene.visual) && scene.visual.kind === 'source_video' && sound.assetVersionId === scene.visual.assetVersionId && Array.isArray(scene.citations) && scene.citations.some(c => record(c) && c.assetVersionId === sound.assetVersionId) && typeof sound.sourceStartSeconds === 'number' && Number.isFinite(sound.sourceStartSeconds) && sound.sourceStartSeconds >= 0 && sound.sourceStartSeconds <= 300 && typeof sound.durationSeconds === 'number' && Number.isFinite(sound.durationSeconds) && sound.durationSeconds > 0 && sound.durationSeconds <= 30 && typeof sound.atSeconds === 'number' && Number.isFinite(sound.atSeconds) && sound.atSeconds >= 0 && sound.atSeconds === sound.sourceStartSeconds && sound.atSeconds + sound.durationSeconds <= Number(end) - Number(start));
      if (!soundsValid) fail('VIDEO_LESSON_AUDIO_MIX_INVALID', `${path}.audioMix`, 'Use bounded reviewed sound intervals from the cited source video; speech-only is the default.');
    }
    if (!Array.isArray(scene.onScreenText) || scene.onScreenText.length > 6 || !scene.onScreenText.every(item => text(item, 240))) fail('VIDEO_LESSON_ONSCREEN_TEXT_INVALID', `${path}.onScreenText`, 'On-screen text must be short and bounded.');
    if (!record(scene.visual) || !['source_video', 'source_image', 'model', 'cinematic_background'].includes(String(scene.visual.kind)) || !text(scene.visual.label, 240)) fail('VIDEO_LESSON_VISUAL_INVALID', `${path}.visual`, 'Every scene needs a bounded visual direction and label.');
    if (record(scene.visual) && ['source_video', 'source_image', 'cinematic_background'].includes(String(scene.visual.kind)) && !id(scene.visual.assetVersionId)) fail('VIDEO_LESSON_VISUAL_ASSET_REQUIRED', `${path}.visual.assetVersionId`, 'Source visuals must bind an approved asset version.');
    if (record(scene.visual) && scene.visual.kind === 'model' && scene.visual.assetVersionId !== undefined) fail('VIDEO_LESSON_MODEL_ASSET_INVALID', `${path}.visual.assetVersionId`, 'Model scenes use the approved course model, not a media asset ID.');
    if (!Array.isArray(scene.citations) || scene.citations.length === 0 || !scene.citations.every(citation => record(citation) && id(citation.assetVersionId))) fail('VIDEO_LESSON_SCENE_CITATIONS_INVALID', `${path}.citations`, 'Every scene needs source citations.');
    if (scene.checkpointActivityId !== undefined && !id(scene.checkpointActivityId)) fail('VIDEO_LESSON_CHECKPOINT_INVALID', `${path}.checkpointActivityId`, 'Checkpoint activity IDs must be stable.');
  }
  if (cursor !== value.durationSeconds) fail('VIDEO_LESSON_TIMELINE_INCOMPLETE', 'scenes', 'The final scene must end at the lesson duration.');
  if (value.direction !== undefined) findings.push(...validateLessonDirection(value.direction, scenes.filter(record) as unknown as VideoLessonScene[]).findings.filter(finding => finding.code !== 'LESSON_DIRECTION_RATIONALE_MISSING'));
  if (value.sceneTakes !== undefined) { try { findings.push(...validateSceneTakeState(value as unknown as TakeLesson).findings); } catch { fail('SCENE_TAKE_INVALID', 'sceneTakes', 'Invalid scene take data.'); } }
  return { valid: findings.length === 0, findings };
}
