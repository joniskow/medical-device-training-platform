/** Saved scene alternatives use the complete immutable source/shot input, not a mutable scene ID alone. */
export interface TakeLesson { [key: string]: unknown; scenes: Array<{ sceneId: string; startSeconds: number; endSeconds: number; [key: string]: unknown }>; direction?: { beats: Array<{ sceneId: string; startingCondition: string; result: string; [key: string]: unknown }> } }
export interface SceneTake {
  takeId: string; sceneId: string; binding: string;
  correction: { atSeconds: number; defect: string; requestedCorrection: string };
  provenance: { provider: string; model: string; configuration: Record<string, string | number | boolean> };
  artifact: { path: string; sha256: string; mimeType: 'video/mp4'; durationSeconds: number };
  startingState: string; endingState: string;
}
export interface SceneTakeState { schemaVersion: 'lesson-scene-takes.v1'; maxPerScene: number; budget: number; attempts: Array<{ attemptId: string; sceneId: string; binding: string }>; takes: SceneTake[]; selected: Record<string, string> }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function sceneTakeBinding(lesson: TakeLesson, sceneId: string): string {
  const scene = lesson.scenes.find(s => s.sceneId === sceneId), beat = lesson.direction?.beats.find(b => b.sceneId === sceneId);
  if (!scene || !beat) throw Error('SCENE_TAKE_SHOT_REQUIRED');
  return stable({ lessonId: lesson.lessonId, scene, beat, citations: lesson.citations, sourceRevision: lesson.sourceRevision, brief: lesson.brief, briefBinding: lesson.briefBinding, briefSnapshot: lesson.briefSnapshot, referencePack: lesson.referencePack, identity: lesson.identity, variantIdentity: lesson.variantIdentity });
}
export function sceneTakeState(lesson: TakeLesson): SceneTakeState {
  if (!lesson.sceneTakes) lesson.sceneTakes = { schemaVersion: 'lesson-scene-takes.v1', maxPerScene: 3, budget: 12, attempts: [], takes: [], selected: {} } satisfies SceneTakeState;
  return lesson.sceneTakes as SceneTakeState;
}
export function reserveSceneTake(lesson: TakeLesson, sceneId: string, attemptId: string): string {
  const state = sceneTakeState(lesson), binding = sceneTakeBinding(lesson, sceneId);
  if (!validateSceneTakeState(lesson).valid) throw Error('SCENE_TAKE_STATE_INVALID');
  if (!attemptId || state.attempts.some(a => a.attemptId === attemptId)) throw Error('SCENE_TAKE_ATTEMPT_DUPLICATE');
  if (state.attempts.length >= state.budget || state.attempts.filter(a => a.sceneId === sceneId).length >= state.maxPerScene) throw Error('SCENE_TAKE_BUDGET_EXHAUSTED');
  state.attempts.push({ attemptId, sceneId, binding }); return binding;
}
export function addSceneTake(lesson: TakeLesson, take: SceneTake): void {
  const state = sceneTakeState(lesson);
  if (!state.attempts.some(a => a.attemptId === take.takeId && a.sceneId === take.sceneId && a.binding === take.binding) || take.binding !== sceneTakeBinding(lesson, take.sceneId) || state.takes.some(t => t.takeId === take.takeId)) throw Error('SCENE_TAKE_STALE_OR_UNRESERVED');
  const candidate = structuredClone(lesson); sceneTakeState(candidate).takes.push(take);
  if (!validateSceneTakeState(candidate).valid) throw Error('SCENE_TAKE_INVALID');
  state.takes.push(take);
}
export function selectedSceneTake(lesson: TakeLesson, sceneId: string): SceneTake | undefined {
  const state = lesson.sceneTakes as SceneTakeState | undefined;
  const take = state?.takes.find(t => t.takeId === state.selected[sceneId] && t.sceneId === sceneId);
  if (state?.selected[sceneId] && !take) throw Error('SCENE_TAKE_SELECTION_MISSING');
  if (take) {
    if (take.binding !== sceneTakeBinding(lesson, sceneId)) throw Error('SCENE_TAKE_SELECTION_STALE');
    const beat = lesson.direction!.beats.find(b => b.sceneId === sceneId)!;
    if (take.startingState !== beat.startingCondition || take.endingState !== beat.result) throw Error('SCENE_TAKE_CONTINUITY_INVALID');
  }
  return take;
}
export function selectSceneTake(lesson: TakeLesson, sceneId: string, takeId: string, expectedBinding: string): void {
  const state = sceneTakeState(lesson), take = state.takes.find(t => t.takeId === takeId && t.sceneId === sceneId);
  if (!take || expectedBinding !== sceneTakeBinding(lesson, sceneId) || take.binding !== expectedBinding) throw Error('SCENE_TAKE_SELECTION_STALE');
  const beat = lesson.direction!.beats.find(b => b.sceneId === sceneId)!;
  if (take.startingState !== beat.startingCondition || take.endingState !== beat.result) throw Error('SCENE_TAKE_CONTINUITY_INVALID');
  const index = lesson.scenes.findIndex(s => s.sceneId === sceneId);
  for (const neighbor of [lesson.scenes[index - 1], lesson.scenes[index + 1]]) {
    if (!neighbor) continue;
    const other = selectedSceneTake(lesson, neighbor.sceneId);
    const neighborBeat = lesson.direction!.beats.find(b => b.sceneId === neighbor.sceneId)!;
    const before = neighbor.startSeconds < lesson.scenes[index]!.startSeconds;
    if (before ? (other?.endingState ?? neighborBeat.result) !== take.startingState : take.endingState !== (other?.startingState ?? neighborBeat.startingCondition)) throw Error('SCENE_TAKE_ADJACENT_CONTINUITY_INVALID');
  }
  state.selected[sceneId] = takeId;
  for (const key of ['render', 'renderOutput', 'renderArtifact', 'finalReview', 'review', 'roughCut', 'previewAcceptance']) delete lesson[key];
}
export function validateSceneTakeState(lesson: TakeLesson): { valid: boolean; findings: Array<{ code: string; path: string; message: string }> } {
  try { return inspectSceneTakeState(lesson); } catch { return { valid: false, findings: [{ code: 'SCENE_TAKE_INVALID', path: 'sceneTakes', message: 'Malformed scene take state.' }] }; }
}
function inspectSceneTakeState(lesson: TakeLesson): { valid: boolean; findings: Array<{ code: string; path: string; message: string }> } {
  const state = lesson.sceneTakes as SceneTakeState | undefined, findings: Array<{ code: string; path: string; message: string }> = [];
  const fail = (message: string) => findings.push({ code: 'SCENE_TAKE_INVALID', path: 'sceneTakes', message });
  if (!state) return { valid: true, findings };
  if (state.schemaVersion !== 'lesson-scene-takes.v1' || !Number.isInteger(state.maxPerScene) || state.maxPerScene < 1 || state.maxPerScene > 4 || !Number.isInteger(state.budget) || state.budget < 1 || state.budget > 48 || !Array.isArray(state.attempts) || !Array.isArray(state.takes) || !state.selected || typeof state.selected !== 'object') { fail('Use a bounded scene generation budget.'); return { valid: false, findings }; }
  if (state.attempts.length > state.budget || new Set(state.attempts.map(a => a?.attemptId)).size !== state.attempts.length) fail('Attempts must be unique and within budget, including failed attempts.');
  for (const scene of lesson.scenes) if (state.attempts.filter(a => a?.sceneId === scene.sceneId).length > state.maxPerScene) fail('Scene take limit exceeded.');
  for (const a of state.attempts) if (!a || typeof a.attemptId !== 'string' || !a.attemptId.trim() || typeof a.binding !== 'string' || !lesson.scenes.some(s => s.sceneId === a.sceneId)) fail('Invalid attempt reservation.');
  if (new Set(state.takes.map(t => t?.takeId)).size !== state.takes.length) fail('Take IDs must be unique.');
  for (const take of state.takes) {
    const scene = lesson.scenes.find(s => s.sceneId === take?.sceneId);
    if (!take || !scene || !state.attempts.some(a => a.attemptId === take.takeId && a.binding === take.binding && a.sceneId === take.sceneId) || typeof take.binding !== 'string' || !take.provenance?.provider?.trim() || !take.provenance?.model?.trim() || !take.provenance.configuration || typeof take.provenance.configuration !== 'object' || Object.values(take.provenance.configuration).some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) || !take.correction?.defect?.trim() || !take.correction.requestedCorrection?.trim() || !Number.isFinite(take.correction.atSeconds) || take.correction.atSeconds < scene.startSeconds || take.correction.atSeconds >= scene.endSeconds || !take.artifact || take.artifact.mimeType !== 'video/mp4' || !/^[a-f0-9]{64}$/.test(take.artifact.sha256) || !take.artifact.path?.trim() || Math.abs(take.artifact.durationSeconds - (scene.endSeconds - scene.startSeconds)) > 0.1 || !Number.isFinite(take.artifact.durationSeconds) || !take.startingState?.trim() || !take.endingState?.trim()) fail('Take must preserve source, shot duration, timestamp correction and full provider provenance.');
  }
  for (const [sceneId, takeId] of Object.entries(state.selected)) {
    const take = state.takes.find(t => t.takeId === takeId && t.sceneId === sceneId);
    try {
      if (!take || take.binding !== sceneTakeBinding(lesson, sceneId)) { fail('Selected take is stale.'); continue; }
      const copy = structuredClone(lesson); selectSceneTake(copy, sceneId, takeId, take.binding);
    } catch { fail('Selected scene or adjacent state continuity is stale or unsupported.'); }
  }
  return { valid: !findings.length, findings };
}
