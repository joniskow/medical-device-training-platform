import type { VideoLessonCitation, VideoLessonScene } from './video-lesson.js';

export interface DirectionEvidence { citation: VideoLessonCitation; quote: string }
export interface LessonBeat {
  sceneId: string;
  sourceEvidence: DirectionEvidence[];
  startingCondition: string;
  subject: string;
  framing: 'context' | 'operator' | 'detail' | 'action' | 'result';
  attentionTarget: string;
  action: string;
  result: string;
  narration: string;
  callouts: Array<{ text: string; target: string; startSeconds: number; endSeconds: number }>;
  observationHoldSeconds: number;
  prerequisites: string[];
  warnings: string[];
  exactLabels: string[];
  causalExplanation?: DirectionEvidence & { text: string };
  hiddenMechanics?: DirectionEvidence & { text: string };
}
export interface LessonDirection {
  schemaVersion: 'lesson-direction.v1';
  openingProblem: string;
  outcome: string;
  beats: LessonBeat[];
}
export interface DirectionFinding { code: string; path: string; message: string }
export interface DirectionSource { assetVersionId: string; citation?: unknown; text?: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 4000;
const canonical = (value: unknown): string => object(value) ? JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))) : '';

/** JSONB may reorder every nested object's keys while preserving the reviewed content. */
export function lessonDirectionRevision(direction: unknown): string {
  const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)])) : value;
  return JSON.stringify(normalize(direction));
}

/** Exact preservation is deliberately conservative; semantic fidelity still requires human source review. */
export function requiredSourceStatements(quote: string): string[] {
  return (quote.match(/[^.!?\n]+[.!?]?/g) ?? []).map(s => s.trim()).filter(s => /\b(warning|caution|only if|only after|before|prerequisite|must|do not|never)\b/i.test(s));
}

export function validateLessonDirection(value: unknown, scenes: readonly VideoLessonScene[], sources?: readonly DirectionSource[]): { valid: boolean; findings: DirectionFinding[] } {
  const findings: DirectionFinding[] = [];
  const fail = (code: string, path: string, message: string) => findings.push({ code, path, message });
  if (!object(value) || value.schemaVersion !== 'lesson-direction.v1' || !Array.isArray(value.beats)) return { valid: false, findings: [{ code: 'LESSON_DIRECTION_REQUIRED', path: 'direction', message: 'Provide a coordinated script and shot plan.' }] };
  if (!text(value.openingProblem) || !text(value.outcome)) fail('LESSON_DIRECTION_OPENING_REQUIRED', 'direction', 'State the opening problem and intended outcome.');
  if (value.beats.length !== scenes.length) fail('LESSON_DIRECTION_SCENE_MISMATCH', 'direction.beats', 'Every scene needs exactly one instructional beat.');
  const seen = new Set<string>();
  for (const [index, beat] of value.beats.entries()) {
    const path = `direction.beats[${index}]`;
    if (!object(beat)) { fail('LESSON_DIRECTION_INVALID', path, 'A beat must be an object.'); continue; }
    const scene = scenes.find(scene => object(scene) && scene.sceneId === beat.sceneId);
    if (!scene || seen.has(String(beat.sceneId))) { fail('LESSON_DIRECTION_SCENE_MISMATCH', path, 'Bind each beat to a unique scene.'); continue; }
    seen.add(scene.sceneId);
    if (typeof scene.narration !== 'string' || !Array.isArray(scene.citations) || !scene.citations.every(object)) { fail('LESSON_DIRECTION_SCENE_MISMATCH', path, 'A beat requires valid narration and scene citations.'); continue; }
    for (const key of ['startingCondition', 'subject', 'attentionTarget', 'action', 'result', 'narration']) if (!text(beat[key])) fail('LESSON_DIRECTION_FIELD_REQUIRED', `${path}.${key}`, `Provide ${key}.`);
    if (!['context', 'operator', 'detail', 'action', 'result'].includes(String(beat.framing))) fail('LESSON_DIRECTION_FRAMING_INVALID', path, 'Choose purposeful context, operator, detail, action or result framing.');
    if (beat.narration !== scene.narration) fail('LESSON_DIRECTION_SCRIPT_MISMATCH', path, 'Shot narration must match the rendered scene script.');
    const duration = scene.endSeconds - scene.startSeconds;
    if (typeof beat.observationHoldSeconds !== 'number' || !Number.isFinite(beat.observationHoldSeconds) || beat.observationHoldSeconds < 1 || beat.observationHoldSeconds >= duration) fail('LESSON_DIRECTION_HOLD_INVALID', path, 'Reserve a finite observation hold of at least one second inside the scene.');
    const evidence = Array.isArray(beat.sourceEvidence) ? beat.sourceEvidence : [];
    if (!evidence.length || evidence.length > 32) fail('LESSON_DIRECTION_EVIDENCE_REQUIRED', path, 'Bind one to 32 exact source excerpts.');
    const validEvidence = (item: unknown): item is DirectionEvidence => {
      if (!object(item) || !text(item.quote) || !object(item.citation) || !scene.citations.some(c => canonical(c) === canonical(item.citation))) return false;
      return sources === undefined || sources.some(source => canonical({ ...(object(source.citation) ? source.citation : {}), assetVersionId: source.assetVersionId }) === canonical(item.citation) && typeof source.text === 'string' && source.text.includes(item.quote as string));
    };
    for (const item of evidence) if (!validEvidence(item)) fail('LESSON_DIRECTION_EVIDENCE_INVALID', path, 'Evidence must quote the selected source exactly at the scene citation.');
    const quotes = evidence.filter(validEvidence).map(item => item.quote);
    for (const key of ['startingCondition', 'action', 'result']) if (text(beat[key]) && !quotes.some(quote => quote.includes(beat[key] as string))) fail('LESSON_DIRECTION_ACTION_UNSUPPORTED', `${path}.${key}`, 'State, action and result must preserve source wording; review any requested rewrite against the source.');
    for (const key of ['prerequisites', 'warnings', 'exactLabels']) {
      const entries = beat[key];
      if (!Array.isArray(entries) || entries.length > 64 || !entries.every(text)) { fail('LESSON_DIRECTION_REQUIREMENTS_INVALID', `${path}.${key}`, 'Use bounded source-supported requirements.'); continue; }
      for (const entry of entries as string[]) {
        if (!quotes.some(quote => quote.includes(entry))) fail('LESSON_DIRECTION_REQUIREMENT_UNSUPPORTED', `${path}.${key}`, 'Requirements must preserve exact source wording.');
        if (!scene.narration.includes(entry)) fail('LESSON_DIRECTION_REQUIRED_CLAIM_OMITTED', `${path}.${key}`, 'Keep required warnings, prerequisites and labels in concise narration.');
        if (key !== 'exactLabels' && scene.narration.indexOf(entry) > scene.narration.indexOf(String(beat.action)) && scene.narration.includes(String(beat.action))) fail('LESSON_DIRECTION_WARNING_ORDER', path, 'State the prerequisite or warning before the affected action.');
      }
    }
    for (const quote of quotes) for (const required of requiredSourceStatements(quote)) if (!scene.narration.includes(required)) fail('LESSON_DIRECTION_REQUIRED_CLAIM_OMITTED', path, 'Retain source conditions and warnings verbatim before acting.');
    for (const key of ['causalExplanation', 'hiddenMechanics']) {
      const claim = beat[key];
      if (claim !== undefined && (!validEvidence(claim) || !object(claim) || claim.text !== claim.quote || !scene.narration.includes(String(claim.text)))) fail(key === 'hiddenMechanics' ? 'LESSON_DIRECTION_UNSUPPORTED_MECHANICS' : 'LESSON_DIRECTION_UNSUPPORTED_RATIONALE', `${path}.${key}`, 'Explanations and internal mechanics need a verbatim source-supported narrated statement.');
    }
    if (beat.causalExplanation === undefined) fail('LESSON_DIRECTION_RATIONALE_MISSING', path, 'Source rationale is absent. Ask the author for reviewed evidence; do not invent an explanation.');
    for (const sentence of scene.narration.match(/[^.!?\n]+[.!?]?/g) ?? []) if (/\b(because|therefore|so that|in order to)\b/i.test(sentence) && !quotes.some(quote => quote.includes(sentence.trim()))) fail('LESSON_DIRECTION_UNSUPPORTED_RATIONALE', path, 'Causal narration must preserve the exact source explanation.');
    if (!Array.isArray(beat.callouts) || beat.callouts.length > 12) fail('LESSON_DIRECTION_CALLOUT_INVALID', path, 'Provide at most 12 timed callouts.');
    else for (const callout of beat.callouts) if (!object(callout) || !text(callout.text) || !text(callout.target) || callout.target !== beat.attentionTarget || typeof callout.startSeconds !== 'number' || typeof callout.endSeconds !== 'number' || !Number.isFinite(callout.startSeconds) || !Number.isFinite(callout.endSeconds) || callout.startSeconds < 0 || callout.endSeconds <= callout.startSeconds || callout.endSeconds > duration) fail('LESSON_DIRECTION_CALLOUT_INVALID', path, 'Callouts must target the named attention feature within the scene.');
  }
  return { valid: !findings.some(f => f.code !== 'LESSON_DIRECTION_RATIONALE_MISSING'), findings };
}
