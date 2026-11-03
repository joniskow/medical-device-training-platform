import assert from 'node:assert/strict';
import { createDeterministicAiGateway } from '../packages/ai-gateway/dist/index.js';
import { generatedMediaIds, validateDraftGrounding } from '../packages/ai-gateway/dist/draft-grounding.js';
import { validateCourseForPublication, validateVideoLesson } from '../packages/simulation-schema/dist/index.js';

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

const badCitation = structuredClone(generated);
badCitation.output.videoLessons[0].scenes[0].citations = [{ assetVersionId: 'source:forged', page: 1 }];
const rejectedCitation = validateDraftGrounding(badCitation, [source, sourcePage2], mediaAssets);
assert.equal(rejectedCitation.status, 'REJECTED');
assert.equal(rejectedCitation.failure.code, 'AI_CITATION_INVALID');

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
const approvedPublication = validateCourseForPublication({
  course: publicationCourse,
  approvedSourceArtifactIds: [source.assetVersionId],
  approvedMediaAssets: mediaAssets,
  approvedReviewTargets: [`VIDEO_LESSON:${publicationLesson.lessonId}`]
});
assert.equal(approvedPublication.valid, true, JSON.stringify(approvedPublication.findings));

console.log('Video lesson validation passed: deterministic generation, source/media grounding, media extraction, forged citation rejection, and publication review gating.');
