import assert from 'node:assert/strict';
import { createDeterministicAiGateway } from '../packages/ai-gateway/dist/index.js';
import { generatedMediaIds, validateDraftGrounding } from '../packages/ai-gateway/dist/draft-grounding.js';
import { validateCourseForPublication, validateVideoLesson, lessonFinalReviewRevision, finalReviewDimensions } from '../packages/simulation-schema/dist/index.js';

const source = { assetVersionId: 'source:manual', citation: { assetVersionId: 'source:manual', page: 1 } };
const sourcePage2 = { assetVersionId: 'source:manual', citation: { assetVersionId: 'source:manual', page: 2 } };
const mediaAssets = [
  { assetVersionId: 'media:overview', sourceType: 'image', contentType: 'image/png' },
  { assetVersionId: 'media:demo', sourceType: 'video', contentType: 'video/mp4' }
];
const request = {
  operation: 'generate_video_lesson', sourceArtifactIds: [source.assetVersionId], outputSchemaVersion: 'course-draft.v1', tokenBudget: 2_000,
  tenant: { organizationId: 'org:test', actorId: 'author:test', correlationId: 'video-lesson:test' },
  input: {
    videoLesson: true,
    sourceChunks: [
      { chunkId: 'chunk:1', sourceHash: 'a'.repeat(64), assetVersionId: source.assetVersionId, text: 'Simulation-only training. Identify AIC-C01 control panel, AIC-C02 safety cover, and AIC-C03 line sensor.', citation: source.citation },
      { chunkId: 'chunk:2', sourceHash: 'a'.repeat(64), assetVersionId: source.assetVersionId, text: 'When the line sensor reports Blocked, acknowledge the warning, inspect the simulated line, clear the blockage, confirm Ready, and complete shutdown.', citation: { assetVersionId: source.assetVersionId, page: 2 } }
    ],
    sourceCoverage: [{ assetVersionId: source.assetVersionId, selectedPassages: 2, totalPassages: 2 }],
    mediaContext: mediaAssets
  }
};

const generated = await createDeterministicAiGateway().execute(request);
const grounded = validateDraftGrounding(generated, [source, sourcePage2], mediaAssets);
assert.equal(grounded.status, 'DRAFT');
assert.equal(Array.isArray(grounded.output.videoLessons), true);
assert.equal(validateVideoLesson(grounded.output.videoLessons[0]).valid, true);
assert(grounded.output.videoLessons[0].scenes.some(scene => scene.narration.includes('AIC-C03')));
assert(grounded.output.videoLessons[0].scenes.some(scene => scene.narration.includes('Ready')));
assert.deepEqual(new Set(generatedMediaIds(grounded)), new Set(['media:overview', 'media:demo']));

const missingMedia = validateDraftGrounding(generated, [source, sourcePage2], [mediaAssets[0]]);
assert.equal(missingMedia.status, 'REJECTED');
assert.equal(missingMedia.failure.code, 'AI_VIDEO_LESSON_MEDIA_INVALID');

const contentCheckpoint = structuredClone(generated);
const checkpoint = contentCheckpoint.output.modules.flatMap(module => module.activities).find(activity => activity.activityId === 'checkpoint-priming');
checkpoint.type = 'rich_text';
checkpoint.text = 'Read the procedure again.';
delete checkpoint.assessment;
assert.equal(validateDraftGrounding(contentCheckpoint, [source, sourcePage2], mediaAssets).failure?.code, 'AI_VIDEO_LESSON_CHECKPOINT_INVALID', 'A checkpoint must ask a validated assessment question, not just link to content.');

for (const [code, change] of [
  ['AI_VIDEO_LESSON_MODEL_INVALID', draft => { draft.videoLessons[0].scenes[0].visual = { kind: 'model', label: 'Unbound device' }; }],
  ['AI_VIDEO_LESSON_INVALID', draft => { draft.videoLessons.push(structuredClone(draft.videoLessons[0])); }],
  ['AI_DRAFT_STRUCTURE_INVALID', draft => { draft.modules[0].activities[0].text = '   '; }]
]) {
  const invalid = structuredClone(generated); change(invalid.output);
  assert.equal(validateDraftGrounding(invalid, [source, sourcePage2], mediaAssets).failure?.code, code);
}
const withModel = structuredClone(generated);
withModel.output.model = { modelVersionId: 'model:approved', manifestHash: 'manifest:approved', manifest: { components: [{ componentId: 'control:1' }] } };
withModel.output.videoLessons[0].scenes[0].visual = { kind: 'model', label: 'Approved control', componentId: 'control:1' };
assert.equal(validateDraftGrounding(withModel, [source, sourcePage2], mediaAssets).status, 'DRAFT');
withModel.output.videoLessons[0].scenes[0].visual.componentId = 'control:invented';
assert.equal(validateDraftGrounding(withModel, [source, sourcePage2], mediaAssets).failure?.code, 'AI_VIDEO_LESSON_MODEL_INVALID');

const badCitation = structuredClone(generated);
badCitation.output.videoLessons[0].scenes[0].citations = [{ assetVersionId: 'source:forged', page: 1 }];
const rejectedCitation = validateDraftGrounding(badCitation, [source, sourcePage2], mediaAssets);
assert.equal(rejectedCitation.status, 'REJECTED');
assert.equal(rejectedCitation.failure.code, 'AI_CITATION_INVALID');

// Exercise malformed provider JSON at every nested field, including questions and scenes.
// Some mutations are valid optional data; the invariant is safe DRAFT/REJECTED handling.
const paths=[];
function collectPaths(value,path=[]) {
  if(value && typeof value==='object') for(const [key,child] of Object.entries(value)) {
    paths.push([...path,key]); collectPaths(child,[...path,key]);
  }
}
collectPaths(generated.output);
for(const path of paths) for(const value of [null,undefined,[],{},'',true,10,NaN]) {
  const malformed=structuredClone(generated);let parent=malformed.output;
  for(const key of path.slice(0,-1))parent=parent[key];
  parent[path.at(-1)]=value;
  assert.doesNotThrow(()=>{
    const result=validateDraftGrounding(malformed,[source,sourcePage2],mediaAssets);
    assert(['DRAFT','REJECTED'].includes(result.status));
    if(result.status==='REJECTED')assert.equal(result.output,undefined);
  },'Malformed provider output: '+path.join('.'));
}

const publicationLesson = JSON.parse(JSON.stringify(grounded.output.videoLessons[0]));
for (const scene of publicationLesson.scenes) delete scene.checkpointActivityId;
const publicationCourse = {
  schemaVersion: 'course-draft.v1',
  title: 'Source-grounded video lesson',
  citations: [source.citation],
  modules: [{ moduleId: 'module:video', activities: [{ activityId: 'activity:video', type: 'rich_text', text: 'Review the video lesson.' }] }],
  videoLessons: [publicationLesson]
};
const blockedPublication = validateCourseForPublication({
  course: publicationCourse,
  approvedSourceArtifactIds: [source.assetVersionId],
  approvedMediaAssets: mediaAssets
});
assert.equal(blockedPublication.valid, false);
assert(blockedPublication.findings.some((finding) => finding.code === 'REVIEW_REQUIRED'));
const malformedCourse = structuredClone(publicationCourse); malformedCourse.videoLessons[0].scenes = [null];
assert.equal(validateCourseForPublication({course: malformedCourse, approvedSourceArtifactIds: [source.assetVersionId]}).valid, false);
const planOnlyPublication = validateCourseForPublication({
  course: publicationCourse,
  approvedSourceArtifactIds: [source.assetVersionId],
  approvedMediaAssets: mediaAssets,
  approvedReviewTargets: [`VIDEO_LESSON:${publicationLesson.lessonId}`]
});
assert.equal(planOnlyPublication.valid, false, 'A reviewed storyboard is not a reviewed final video.');
assert(planOnlyPublication.findings.some(finding => finding.code === 'LESSON_FINAL_ARTIFACT_REQUIRED'));
publicationLesson.renderArtifact = { mode: 'final', sha256: 'a'.repeat(64), artifactId: `sha256:${'a'.repeat(64)}`, placeholders: [] };
publicationLesson.finalReview = {
  schemaVersion: 'lesson-final-review.v1', assetVersionId: 'media:final', artifactSha256: 'a'.repeat(64),
  lessonRevision: lessonFinalReviewRevision(publicationLesson), reviewerId: 'reviewer:test', reviewedAt: new Date().toISOString(), disposition: 'APPROVE',
  soundAndMotionReviewed: true, fullVideoReviewed: true, dimensions: Object.fromEntries(finalReviewDimensions.map(d => [d, 'PASS'])),
  intervals: publicationLesson.scenes.map(scene => ({ sceneId: scene.sceneId, startSeconds: scene.startSeconds, endSeconds: scene.endSeconds })), findings: [],
  devices: ['laptop', 'tablet'].map(profile => ({ profile, width: 1280, height: 720, minLabelPixels: 18, minCaptionPixels: 24, maxCaptionOcclusionPercent: 0, maxSyncOffsetMs: 100, clippedSpeechCount: 0, integratedLufs: -16, truePeakDb: -1.5 }))
};
// Synthetic scorecard tests gate structure only; this is not human audiovisual acceptance.
const approvedPublication = validateCourseForPublication({
  course: publicationCourse, approvedSourceArtifactIds: [source.assetVersionId], approvedMediaAssets: mediaAssets,
  approvedReviewTargets: [`VIDEO_LESSON:${publicationLesson.lessonId}`]
});
assert.equal(approvedPublication.valid, true, JSON.stringify(approvedPublication.findings));

console.log('Video lesson validation passed: deterministic generation, source/media grounding, media extraction, forged citation rejection, and publication review gating.');
