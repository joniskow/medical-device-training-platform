import { requiredSourceStatements, validateLessonDirection, type DirectionSource, type LessonDirection, type VideoLessonPlan } from '@medical-device/simulation-schema';
import type { AiGatewayResult } from '@medical-device/contracts';
import { createLessonVariant, type LessonVariantKind } from '@medical-device/simulation-schema';

/** Author-requested deterministic formats only; variant planning never rewrites approved clinical language. */
export function planReviewedLessonVariant(source: VideoLessonPlan & Record<string, any>, input: {kind:LessonVariantKind;lessonId:string;targetSceneIds?:string[]}): VideoLessonPlan & Record<string, any> {
  return createLessonVariant(source,input.kind,input.lessonId,input.targetSceneIds);
}

export const directionInstructions = `For every videoLesson include direction with schemaVersion=lesson-direction.v1, openingProblem (a concrete task/problem), outcome, and one beat per scene. Each beat has sceneId, sourceEvidence:[{citation,quote}] quoting supplied passages exactly, startingCondition, subject, framing (context/operator/detail/action/result), attentionTarget, action, result, narration identical to scene narration, callouts:[{text,target,startSeconds,endSeconds}] relative to scene start, observationHoldSeconds (at least 1, shorter than scene), prerequisites:[], warnings:[], exactLabels:[]. Preserve prerequisite and warning sentences verbatim before the affected action, and all bound labels verbatim. Narration should follow orient, observe, act, verify, explain. Never infer an action, prerequisite, state or hidden mechanism from an attractive image. Include causalExplanation or hiddenMechanics only as {text,quote,citation} with text identical to an authoritative source quote present in narration. If rationale is absent, omit causalExplanation so the author receives a missing-evidence finding. No invented causal explanation. Hold results visibly after actions; do not cut during critical movement, mirror labels, crop warnings or obscure controls. Keep captions away from the attention target. All directions remain drafts for author review before rendering.`;

/** Deterministic fallback copies source language instead of fabricating procedural narration. */
export function createSourceDirection(lesson: VideoLessonPlan, sources: readonly DirectionSource[]): LessonDirection {
  const key = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  const beats = lesson.scenes.map((scene, index) => {
    const evidence = sources.filter(source => typeof source.text === 'string' && scene.citations.some(c => c.assetVersionId === source.assetVersionId && key(c) === key({ ...(source.citation as object), assetVersionId: source.assetVersionId }))).map(source => ({ citation: { ...(source.citation as object), assetVersionId: source.assetVersionId }, quote: source.text! }));
    const narration = evidence.map(item => item.quote).join(' ');
    if (narration) scene.narration = narration;
    const sentences = narration.match(/[^.!?]+[.!?]?/g)?.map(s => s.trim()) ?? [];
    const first = sentences[0] ?? scene.narration;
    return {
      sceneId: scene.sceneId, sourceEvidence: evidence, startingCondition: first,
      subject: scene.visual.label, framing: index === 0 ? 'operator' as const : 'detail' as const,
      attentionTarget: scene.visual.label, action: sentences.at(-1) ?? first, result: sentences.at(-1) ?? first,
      narration: scene.narration, callouts: [{ text: scene.visual.label, target: scene.visual.label, startSeconds: 0, endSeconds: Math.min(4, scene.endSeconds - scene.startSeconds) }],
      observationHoldSeconds: 2, prerequisites: evidence.flatMap(item => requiredSourceStatements(item.quote)).filter(item => !/\b(warning|caution)\b/i.test(item)),
      warnings: evidence.flatMap(item => requiredSourceStatements(item.quote)).filter(item => /\b(warning|caution)\b/i.test(item)), exactLabels: []
    };
  });
  return { schemaVersion: 'lesson-direction.v1', openingProblem: `What observable cues help you complete ${lesson.title}?`, outcome: lesson.learningObjectives.join(' '), beats };
}

/** The caller supplies authoritative retrieved passages; model-supplied evidence cannot authorize itself. */
export function validateDraftDirections(result: AiGatewayResult, input: Record<string, unknown>): AiGatewayResult {
  if (result.status !== 'DRAFT' || !input.lessonBrief) return result;
  const output = result.output as Record<string, unknown> | undefined;
  if (!Array.isArray(output?.videoLessons) || !output.videoLessons.length) return input.videoLesson !== true ? result : { ...result, status: 'REJECTED', output: undefined, warnings: [...result.warnings, { code: 'LESSON_DIRECTION_REQUIRED', severity: 'error', message: 'Video generation must return a source-linked lesson and shot plan.' }], failure: { class: 'VALIDATION', code: 'LESSON_DIRECTION_REQUIRED', message: 'Video generation returned no lesson.' } };
  const sources = Array.isArray(input.sourceChunks) ? input.sourceChunks as DirectionSource[] : [];
  const brief = input.lessonBrief as { referencePack?: { exactLabels?: string[] } };
  const findings = output.videoLessons.flatMap((lesson: VideoLessonPlan) => {
    if (!lesson || typeof lesson !== 'object' || !Array.isArray(lesson.scenes) || lesson.scenes.some(scene => !scene || typeof scene !== 'object' || typeof scene.narration !== 'string')) return [{ code: 'LESSON_DIRECTION_REQUIRED', path: 'videoLessons', message: 'Provide a structured lesson and scene plan.' }];
    const report = validateLessonDirection(lesson.direction, lesson.scenes ?? [], sources);
    const script = (lesson.scenes ?? []).map(scene => scene.narration).join(' ');
    for (const label of brief.referencePack?.exactLabels ?? []) if (!script.includes(label)) report.findings.push({ code: 'LESSON_DIRECTION_LABEL_MISSING', path: 'direction', message: `Preserve exact approved terminology: ${label}` });
    // Conditions cannot be evaded by dropping the corresponding excerpt from the generated beat.
    for (const source of sources) for (const required of requiredSourceStatements(source.text ?? '')) if (!script.includes(required)) report.findings.push({ code: 'LESSON_DIRECTION_REQUIRED_CLAIM_OMITTED', path: 'direction', message: `Retain selected source warning or prerequisite: ${required}` });
    return report.findings;
  });
  const warnings = findings.map(finding => ({ code: finding.code, message: `${finding.path}: ${finding.message}`, severity: finding.code === 'LESSON_DIRECTION_RATIONALE_MISSING' ? 'warning' as const : 'error' as const }));
  const blocking = warnings.find(warning => warning.severity === 'error');
  return blocking ? { ...result, status: 'REJECTED', output: undefined, warnings: [...result.warnings, ...warnings], failure: { class: 'VALIDATION', code: blocking.code, message: blocking.message } } : { ...result, warnings: [...result.warnings, ...warnings] };
}
