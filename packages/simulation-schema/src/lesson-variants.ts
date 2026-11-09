import type { VideoLessonPlan } from './video-lesson.js';
import { validateLessonFinalReview } from './lesson-final-review.js';

export type LessonVariantKind = 'beginner' | 'refresher' | 'remediation';
export interface LessonVariantIdentity {
  schemaVersion: 'lesson-variant.v1'; kind: LessonVariantKind; sourceLessonId: string; sourceRevision: string;
  objectiveIds: string[]; targetSceneIds: string[];
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sourceIdentityFields = ['briefSnapshot','brief','briefRevision','briefBinding','referencePack','sourceRevision','identity'] as const;
const sourceIdentity = (lesson:Record<string,any>) => Object.fromEntries(sourceIdentityFields.map(key=>[key,lesson[key]]));
const hasSelectedTakes = (lesson: Record<string, any>) => object(lesson.sceneTakes) && object(lesson.sceneTakes.selected) && Object.keys(lesson.sceneTakes.selected).length > 0;
/** Source identity includes complete evidence and script, never mutable approvals or generated outputs. */
export function lessonVariantSourceRevision(lesson: Record<string, any>): string {
  return JSON.stringify(canonical({lessonId:lesson.lessonId, durationSeconds:lesson.durationSeconds, learningObjectives:lesson.learningObjectives, safetyBoundary:lesson.safetyBoundary,
    citations:lesson.citations, direction:lesson.direction, sourceIdentity:sourceIdentity(lesson),
    scenes:Array.isArray(lesson.scenes)?lesson.scenes.filter(object).map((s: Record<string, unknown>) => ({sceneId:s.sceneId,startSeconds:s.startSeconds,endSeconds:s.endSeconds,narration:s.narration,onScreenText:s.onScreenText,visual:s.visual,citations:s.citations,checkpointActivityId:s.checkpointActivityId})):lesson.scenes}));
}
/** Conservative first cut: change observation time, retain every approved spoken claim verbatim. */
export function createLessonVariant(source: VideoLessonPlan & Record<string, any>, kind: LessonVariantKind, lessonId: string, targetSceneIds: string[] = []): VideoLessonPlan & Record<string, any> {
  if (!['beginner','refresher','remediation'].includes(kind) || source.variantIdentity || !source.direction || !Array.isArray(source.direction.beats) || !Array.isArray(source.scenes) || !source.scenes.every(object) || !validateLessonFinalReview(source).valid) throw Error('An independently reviewed source lesson is required.');
  if (hasSelectedTakes(source)) throw Error('Bind each selected scene take as an approved corrected visual before creating learning variants.');
  if (lessonId === source.lessonId || !/^[A-Za-z0-9._:-]{1,160}$/.test(lessonId)) throw Error('Use a distinct stable variant identity.');
  if (kind === 'remediation' && (!targetSceneIds.length || targetSceneIds.some(id => !source.scenes.some(s => s.sceneId === id)))) throw Error('Select supported remediation scenes.');
  const variant = structuredClone(source);
  for (const key of ['finalReview','renderArtifact','render','renderOutput','roughCut','previewAcceptance','audio','captions','sceneTakes','directionReview']) delete variant[key];
  variant.lessonId = lessonId; variant.title = `${source.title} (${kind})`;
  variant.variantIdentity = {schemaVersion:'lesson-variant.v1',kind,sourceLessonId:source.lessonId,sourceRevision:lessonVariantSourceRevision(source),objectiveIds:[...source.learningObjectives],targetSceneIds:kind==='remediation'?[...new Set(targetSceneIds)]:[]};
  let cursor = 0;
  let reductionBudget = Math.max(0,source.durationSeconds-30);
  let reduced = 0;
  for (const scene of variant.scenes) {
    const original = source.scenes.find(s => s.sceneId === scene.sceneId)!;
    const sourceBeat = source.direction.beats.find(b=>b.sceneId===scene.sceneId);
    const reduction = kind==='refresher' ? Math.min(reductionBudget,Math.max(0,(sourceBeat?.observationHoldSeconds??1)-1)) : 0;
    reductionBudget -= reduction; reduced += reduction;
    const extra = kind === 'beginner' ? 2 : kind === 'remediation' && targetSceneIds.includes(scene.sceneId) ? 3 : -reduction;
    scene.startSeconds = cursor; scene.endSeconds = cursor += original.endSeconds-original.startSeconds+extra;
    // Speech and captions must be generated for this complete variant timeline.
    for (const key of ['audio','captions','audioBinding','captionBinding']) delete (scene as unknown as Record<string, unknown>)[key];
    const beat = variant.direction?.beats.find(b => b.sceneId === scene.sceneId); if (beat) beat.observationHoldSeconds += extra;
  }
  variant.durationSeconds = cursor;
  if (kind==='refresher' && reduced===0) throw Error('No safe observation time can be shortened for a refresher; first review a longer source cut.');
  if (cursor > 300) throw Error('Variant exceeds the supported five-minute timeline.');
  return variant;
}

export function validateLessonVariants(lessons: unknown, activities: unknown[] = []): {valid:boolean; findings:Array<{code:string;path:string;message:string}>} {
  const rows = Array.isArray(lessons) ? lessons.filter(object) : [];
  const findings:Array<{code:string;path:string;message:string}>=[];
  const fail = (code:string,path:string,message:string) => findings.push({code,path,message});
  const ids = new Set<string>();
  const mediaIds = new Set<string>();
  for (const [i,lesson] of rows.entries()) {
    const path=`videoLessons[${i}]`;
    if (ids.has(lesson.lessonId)) fail('LESSON_ID_DUPLICATE',path,'Every source and variant needs its own published lesson identity.'); ids.add(lesson.lessonId);
    if (object(lesson.finalReview) && typeof lesson.finalReview.assetVersionId==='string') {
      if(mediaIds.has(lesson.finalReview.assetVersionId)) fail('LESSON_VARIANT_ARTIFACT_REUSED',path,'Every lesson cut needs its own reviewed final asset version.');
      mediaIds.add(lesson.finalReview.assetVersionId);
    }
    const v=lesson.variantIdentity; if (v===undefined) continue;
    if (!object(v) || v.schemaVersion!=='lesson-variant.v1' || !['beginner','refresher','remediation'].includes(v.kind)) {fail('LESSON_VARIANT_IDENTITY_INVALID',path,'Use a supported explicit variant identity.');continue;}
    const source=rows.find(s=>s.lessonId===v.sourceLessonId && !s.variantIdentity);
    if (!source || source===lesson || !Array.isArray(source.scenes) || !source.scenes.every(object) || !Array.isArray(source.learningObjectives) || v.sourceRevision!==lessonVariantSourceRevision(source)) {fail('LESSON_VARIANT_SOURCE_STALE',path,'Retain the exact approved source revision. Regenerate variants after source edits.');continue;}
    if (hasSelectedTakes(source)) fail('LESSON_VARIANT_SELECTED_TAKE_UNBOUND',path,'Bind the source selected take as an approved corrected visual; variants cannot silently revert to its earlier shot.');
    if (!same(v.objectiveIds,source.learningObjectives) || !same(lesson.learningObjectives,source.learningObjectives) || lesson.safetyBoundary!==source.safetyBoundary || !same(lesson.citations,source.citations)) fail('LESSON_VARIANT_REQUIRED_ELEMENTS_CHANGED',path,'Variants retain the same objectives, safety boundary and source revision.');
    if (sourceIdentityFields.some(key => !same(lesson[key], source[key]))) fail('LESSON_VARIANT_IDENTITY_CHANGED',path,'Variants must retain the approved device revision, reference pack and source identity.');
    if (!Array.isArray(v.targetSceneIds) || (v.kind==='remediation' && !v.targetSceneIds.length) || v.targetSceneIds.some((id:unknown)=>!source.scenes.some((s:any)=>s.sceneId===id)) || (v.kind!=='remediation' && v.targetSceneIds.length)) fail('LESSON_VARIANT_TARGET_INVALID',path,'Remediation targets must identify existing source scenes.');
    if (!Array.isArray(lesson.scenes) || lesson.scenes.length!==source.scenes.length || lesson.scenes.some((scene:any,index:number)=>{
      const original=source.scenes[index];return !object(scene) || !original || !same({...scene,startSeconds:undefined,endSeconds:undefined,narrationDelivery:undefined,audio:undefined,captions:undefined,audioBinding:undefined,captionBinding:undefined},{...original,startSeconds:undefined,endSeconds:undefined,narrationDelivery:undefined,audio:undefined,captions:undefined,audioBinding:undefined,captionBinding:undefined});
    })) fail('LESSON_VARIANT_CLAIMS_CHANGED',path,'Preserve every source scene, instruction, prerequisite, warning and exact label; only delivery/pacing may change.');
    const direction=(d:any)=>object(d)?{...d,beats:Array.isArray(d.beats)?d.beats.map((b:any)=>object(b)?({...b,observationHoldSeconds:undefined,callouts:Array.isArray(b.callouts)?b.callouts.map((c:any)=>object(c)?({...c,startSeconds:undefined,endSeconds:undefined}):c):b.callouts}):b):d.beats}:d;
    if (!same(direction(lesson.direction),direction(source.direction))) fail('LESSON_VARIANT_DIRECTION_CHANGED',path,'Preserve approved source-backed teaching direction.');
    if (lesson.finalReview && lesson.finalReview.assetVersionId===source.finalReview?.assetVersionId) fail('LESSON_VARIANT_ARTIFACT_REUSED',path,'Render and review a separate complete audiovisual artifact for each variant.');
  }
  for (const [i,a] of activities.entries()) {
    if (!object(a)) continue;
    if (a.videoLessonId!==undefined) {
      const lesson=rows.find(l=>l.lessonId===a.videoLessonId);
      if (!lesson || !Array.isArray(lesson.scenes) || !lesson.scenes.every(object) || a.type!=='video' || a.media?.assetVersionId!==lesson.finalReview?.assetVersionId || a.media?.transcript!==lesson.scenes.map((s:any)=>s.narration).join('\n\n')) fail('LESSON_VARIANT_MEDIA_BINDING_INVALID',`activities[${i}]`,'Video activities must bind the exact reviewed lesson artifact and transcript.');
    }
    if (a.remediation!==undefined) {
      const r=a.remediation, lesson=object(r)?rows.find(l=>l.lessonId===r.lessonId):undefined;
      const media=lesson && activities.find(item=>object(item)&&item.videoLessonId===lesson.lessonId);
      if (!object(r) || !lesson || lesson.variantIdentity?.kind!=='remediation' || !Array.isArray(lesson.variantIdentity.targetSceneIds) || !lesson.variantIdentity.targetSceneIds.includes(r.sceneId) || !Array.isArray(lesson.learningObjectives) || !lesson.learningObjectives.includes(r.objective) || !media) fail('LESSON_REMEDIATION_BINDING_INVALID',`activities[${i}]`,'Link a mistake to a reviewed remediation scene and the same learning objective.');
    }
  }
  return {valid:!findings.length,findings};
}

/** Descriptive comparison only. No variant changes assessment scoring or automatically chooses instructions. */
export function compareLessonVariantOutcomes(lessons: Array<Record<string, any>>, outcomes:Array<{lessonId:string;objective:string;correct:boolean;criticalError:boolean}>):Array<{lessonId:string;objective:string;attempts:number;correct:number;criticalErrors:number}> {
  return lessons.flatMap(lesson=>lesson.learningObjectives.map((objective:string)=>{
    const rows=outcomes.filter(o=>o.lessonId===lesson.lessonId&&o.objective===objective);
    return {lessonId:lesson.lessonId,objective,attempts:rows.length,correct:rows.filter(o=>o.correct).length,criticalErrors:rows.filter(o=>o.criticalError).length};
  }));
}
