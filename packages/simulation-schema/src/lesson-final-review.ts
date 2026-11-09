export const finalReviewDimensions = ['factualProcedural', 'identityContinuity', 'actionVisibility', 'labelCaptionLegibility', 'audioTiming', 'instructionalPurpose'] as const;
export type FinalReviewDimension = typeof finalReviewDimensions[number];
export interface LessonFinalReview {
  schemaVersion: 'lesson-final-review.v1'; assetVersionId: string; artifactSha256: string; lessonRevision: string;
  reviewerId: string; reviewedAt: string; disposition: 'APPROVE' | 'CHANGES_REQUESTED'; soundAndMotionReviewed: boolean; fullVideoReviewed: boolean;
  dimensions: Record<FinalReviewDimension, 'PASS' | 'FAIL' | 'NOT_REVIEWED'>;
  intervals: Array<{ sceneId: string; startSeconds: number; endSeconds: number }>;
  findings: Array<{ dimension: FinalReviewDimension; timestampSeconds: number; severity: 'minor' | 'critical'; description: string; disposition: 'OPEN' | 'CORRECTED' }>;
  devices: Array<{ profile: 'laptop' | 'tablet'; width: number; height: number; minLabelPixels: number; minCaptionPixels: number; maxCaptionOcclusionPercent: number; maxSyncOffsetMs: number; clippedSpeechCount: number; integratedLufs: number; truePeakDb: number }>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])) : v;
/** Binds review to every editable lesson field, including its final render manifest. */
export function lessonFinalReviewRevision(lesson: Record<string, unknown>): string {
  const { finalReview: ignored, ...content } = lesson;
  return JSON.stringify(canonical(content));
}
/** Structural gate only: automation never establishes clinical correctness. */
export function validateLessonFinalReview(lesson: Record<string, unknown>): { valid: boolean; findings: Array<{ code: string; path: string; message: string }> } {
  const findings: Array<{ code: string; path: string; message: string }> = [];
  const fail = (code: string, message: string) => findings.push({ code, path: 'finalReview', message });
  const artifact = object(lesson.renderArtifact) ? lesson.renderArtifact : {};
  const review = object(lesson.finalReview) ? lesson.finalReview : {};
  if (artifact.mode !== 'final' || !sha(artifact.sha256) || artifact.artifactId !== `sha256:${artifact.sha256}` || !Array.isArray(artifact.placeholders) || artifact.placeholders.length) fail('LESSON_FINAL_ARTIFACT_REQUIRED','Upload the complete final audiovisual artifact without placeholders; previews cannot be released.');
  if (review.schemaVersion !== 'lesson-final-review.v1' || !nonempty(review.assetVersionId) || review.artifactSha256 !== artifact.sha256 || !sha(review.artifactSha256) || review.lessonRevision !== lessonFinalReviewRevision(lesson)) fail('LESSON_FINAL_REVIEW_STALE','Review must bind the current lesson and exact final artifact hash.');
  if (!nonempty(review.reviewerId) || !nonempty(review.reviewedAt) || !Number.isFinite(Date.parse(String(review.reviewedAt))) || Date.parse(String(review.reviewedAt)) > Date.now()+60000 || review.disposition !== 'APPROVE') fail('LESSON_FINAL_REVIEW_REQUIRED','An independent identified reviewer must record an approval and timestamp.');
  if (review.soundAndMotionReviewed !== true || review.fullVideoReviewed !== true) fail('LESSON_FINAL_AV_REVIEW_REQUIRED','Watch and listen to the entire final video; sampled frames cannot approve motion or sound.');
  const dimensions = object(review.dimensions) ? review.dimensions : {};
  for (const dimension of finalReviewDimensions) if (dimensions[dimension] !== 'PASS') fail('LESSON_FINAL_DIMENSION_FAILED',`${dimension} requires its own passing review; scores cannot average away defects.`);
  const intervals = Array.isArray(review.intervals) ? review.intervals.filter(object) : [];
  const scenes = Array.isArray(lesson.scenes) ? lesson.scenes.filter(object) : [];
  // Conservatively require each complete scene, including every critical transition and adjacent cut.
  if (!scenes.length || scenes.some(scene=>!intervals.some(i=>i.sceneId===scene.sceneId && i.startSeconds===scene.startSeconds && i.endSeconds===scene.endSeconds))) fail('LESSON_FINAL_INTERVAL_INCOMPLETE','Review complete scene intervals including critical actions, results and transitions.');
  if (!Array.isArray(review.findings) || review.findings.some(f=>!object(f) || !finalReviewDimensions.includes(f.dimension as FinalReviewDimension) || typeof f.timestampSeconds !== 'number' || !Number.isFinite(f.timestampSeconds) || f.timestampSeconds<0 || f.timestampSeconds>Number(lesson.durationSeconds) || !nonempty(f.description) || !['minor','critical'].includes(String(f.severity)) || !['OPEN','CORRECTED'].includes(String(f.disposition)) || (f.severity==='critical' && f.disposition!=='CORRECTED'))) fail('LESSON_FINAL_DEFECT_UNRESOLVED','Record timestamped defect dispositions and correct every critical defect before release.');
  const devices=Array.isArray(review.devices)?review.devices.filter(object):[];
  for(const profile of ['laptop','tablet']) {
    const d=devices.find(d=>d.profile===profile);
    const finite=(key:string)=>!!d && typeof d[key]==='number' && Number.isFinite(d[key]);
    if(!d || !['width','height','minLabelPixels','minCaptionPixels','maxCaptionOcclusionPercent','maxSyncOffsetMs','clippedSpeechCount','integratedLufs','truePeakDb'].every(finite) || Number(d.width)<800 || Number(d.height)<600 || Number(d.minLabelPixels)<18 || Number(d.minCaptionPixels)<24 || d.maxCaptionOcclusionPercent!==0 || Number(d.maxSyncOffsetMs)<0 || Number(d.maxSyncOffsetMs)>200 || d.clippedSpeechCount!==0 || Number(d.integratedLufs)<-20 || Number(d.integratedLufs)>-14 || Number(d.truePeakDb)>-1) fail('LESSON_FINAL_DEVICE_THRESHOLD_FAILED',`Record measured ${profile} playback: labels ≥18px, captions ≥24px, zero task occlusion/clipped speech, sync ≤200ms, loudness -20 to -14 LUFS, peak ≤-1 dBTP. These pilot thresholds require representative-device validation.`);
  }
  return { valid:findings.length===0, findings };
}

/** Inputs must come from the locked tenant asset rows and authenticated review decisions, never browser assertions. */
export function lessonFinalPublicationBindingError(lesson: Record<string,unknown>, input: {
  media?: { assetVersionId:string; sha256:string; sourceType:string; state:string };
  approval?: { decision:string; actorId:string; revision:number };
  authorId:string; authorIds?:string[]; revision:number;
}): string | null {
  const review=object(lesson.finalReview)?lesson.finalReview:{}, artifact=object(lesson.renderArtifact)?lesson.renderArtifact:{};
  const {media,approval}=input;
  if(!media || media.state!=='APPROVED' || media.sourceType!=='video' || media.assetVersionId!==review.assetVersionId || !sha(media.sha256) || media.sha256!==review.artifactSha256 || media.sha256!==artifact.sha256) return 'LESSON_FINAL_ASSET_HASH_MISMATCH';
  if(!approval || approval.decision!=='APPROVE' || approval.actorId!==review.reviewerId || approval.actorId===input.authorId || input.authorIds?.includes(approval.actorId) || approval.revision!==input.revision) return 'LESSON_FINAL_INDEPENDENT_REVIEW_REQUIRED';
  return null;
}
