export type VideoLessonVisualKind = 'source_video' | 'source_image' | 'model' | 'cinematic_background';

export interface VideoLessonCitation { assetVersionId: string; [key: string]: unknown; }

export interface VideoLessonScene {
  sceneId: string;
  startSeconds: number;
  endSeconds: number;
  narration: string;
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
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function validateVideoLesson(value: unknown): { valid: boolean; findings: Array<{ code: string; path: string; message: string }> } {
  const findings: Array<{ code: string; path: string; message: string }> = [];
  const fail = (code: string, path: string, message: string) => findings.push({ code, path, message });
  if (!record(value) || value.schemaVersion !== 'video-lesson.v1') return { valid: false, findings: [{ code: 'VIDEO_LESSON_SCHEMA_INVALID', path: 'videoLesson', message: 'A video lesson must use video-lesson.v1.' }] };
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
    if (!Array.isArray(scene.onScreenText) || scene.onScreenText.length > 6 || !scene.onScreenText.every(item => text(item, 240))) fail('VIDEO_LESSON_ONSCREEN_TEXT_INVALID', `${path}.onScreenText`, 'On-screen text must be short and bounded.');
    if (!record(scene.visual) || !['source_video', 'source_image', 'model', 'cinematic_background'].includes(String(scene.visual.kind)) || !text(scene.visual.label, 240)) fail('VIDEO_LESSON_VISUAL_INVALID', `${path}.visual`, 'Every scene needs a bounded visual direction and label.');
    if (record(scene.visual) && ['source_video', 'source_image', 'cinematic_background'].includes(String(scene.visual.kind)) && !id(scene.visual.assetVersionId)) fail('VIDEO_LESSON_VISUAL_ASSET_REQUIRED', `${path}.visual.assetVersionId`, 'Source visuals must bind an approved asset version.');
    if (record(scene.visual) && scene.visual.kind === 'model' && scene.visual.assetVersionId !== undefined) fail('VIDEO_LESSON_MODEL_ASSET_INVALID', `${path}.visual.assetVersionId`, 'Model scenes use the approved course model, not a media asset ID.');
    if (!Array.isArray(scene.citations) || scene.citations.length === 0 || !scene.citations.every(citation => record(citation) && id(citation.assetVersionId))) fail('VIDEO_LESSON_SCENE_CITATIONS_INVALID', `${path}.citations`, 'Every scene needs source citations.');
    if (scene.checkpointActivityId !== undefined && !id(scene.checkpointActivityId)) fail('VIDEO_LESSON_CHECKPOINT_INVALID', `${path}.checkpointActivityId`, 'Checkpoint activity IDs must be stable.');
  }
  if (cursor !== value.durationSeconds) fail('VIDEO_LESSON_TIMELINE_INCOMPLETE', 'scenes', 'The final scene must end at the lesson duration.');
  return { valid: findings.length === 0, findings };
}
