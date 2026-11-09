/** Review identity excludes review metadata, but includes every audiovisual production input. */
export function lessonRenderRevision(lesson: Record<string, unknown>): string {
  // PostgreSQL JSONB and other serializers may reorder object keys. That is not an audiovisual edit.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(Object.fromEntries(['schemaVersion', 'lessonId', 'title', 'durationSeconds', 'learningObjectives', 'safetyBoundary', 'scenes', 'citations', 'direction', 'brief', 'briefBinding', 'briefSnapshot', 'referencePack', 'sourceRevision', 'identity', 'generationStatus', 'sceneTakes', 'variantIdentity'].map(key => [key, lesson[key]]))));
}
export interface LessonRenderManifest {
  schemaVersion: 'lesson-render.v1';
  mode: 'rough-cut' | 'final';
  artifactId: string;
  sha256: string;
  inputRevision: string;
  durationSeconds: number;
  placeholders: string[];
  scenes: Array<{sceneId: string; startSeconds: number; endSeconds: number; narrationSeconds: number}>;
  outputPath: string;
  captionsPath: string;
  captionsSha256: string;
}
/** Imported metadata must describe the complete current timeline, not merely assert its revision. */
export function isCurrentLessonRenderManifest(value: unknown, lesson: Record<string, unknown>): value is LessonRenderManifest {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const sha = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  const scenes = lesson.scenes;
  if (!object(value) || value.schemaVersion !== 'lesson-render.v1' || !['rough-cut','final'].includes(String(value.mode)) || !sha(value.sha256) || value.artifactId !== `sha256:${value.sha256}` || !sha(value.captionsSha256) || value.inputRevision !== lessonRenderRevision(lesson) || typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || typeof lesson.durationSeconds !== 'number' || !Number.isFinite(lesson.durationSeconds) || lesson.durationSeconds <= 0 || Math.abs(value.durationSeconds - lesson.durationSeconds) > 0.25 || !Array.isArray(scenes) || !scenes.length || !Array.isArray(value.scenes) || value.scenes.length !== scenes.length || !Array.isArray(value.placeholders)) return false;
  if (typeof value.outputPath !== 'string' || !value.outputPath.trim() || typeof value.captionsPath !== 'string' || !value.captionsPath.trim()) return false;
  const sceneIds = new Set(scenes.filter(object).map(scene => scene.sceneId));
  if (sceneIds.size !== scenes.length || new Set(value.placeholders).size !== value.placeholders.length || value.placeholders.some(id => typeof id !== 'string' || !sceneIds.has(id)) || (value.mode === 'final' && value.placeholders.length)) return false;
  return value.scenes.every((scene, index) => {
    const expected = scenes[index];
    return object(scene) && object(expected) && scene.sceneId === expected.sceneId && scene.startSeconds === expected.startSeconds && scene.endSeconds === expected.endSeconds && typeof scene.startSeconds === 'number' && typeof scene.endSeconds === 'number' && Number.isFinite(scene.startSeconds) && Number.isFinite(scene.endSeconds) && scene.endSeconds > scene.startSeconds && typeof scene.narrationSeconds === 'number' && Number.isFinite(scene.narrationSeconds) && scene.narrationSeconds > 0 && scene.narrationSeconds <= scene.endSeconds - scene.startSeconds;
  });
}
export function currentPreviewAccepted(lesson: Record<string, unknown>): boolean {
  const preview = lesson.roughCut as LessonRenderManifest | undefined;
  const acceptance = lesson.previewAcceptance as {inputRevision?: string; artifactId?: string} | undefined;
  return isCurrentLessonRenderManifest(preview, lesson) && preview.mode === 'rough-cut' && acceptance?.inputRevision === preview.inputRevision && acceptance.artifactId === preview.artifactId;
}
