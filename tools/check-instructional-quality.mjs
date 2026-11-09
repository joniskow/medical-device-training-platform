import assert from 'node:assert/strict';
import { reviewInstructionalQuality } from '../packages/ai-gateway/dist/instructional-design.js';
import { createAzureOpenAiGateway, createSourceGroundedDraftService } from '../packages/ai-gateway/dist/index.js';

const citation = { assetVersionId: 'source:manual', page: 1 };
const assessment = { activityId: 'check:1', type: 'multiple_choice', title: 'Decision', citations: [citation], assessment: {
  schemaVersion: 'assessment-definition.v1', assessmentId: 'assessment:1', version: 1, passScore: 0.8,
  questions: [{ questionId: 'q:1', type: 'multiple_choice', prompt: 'Which state permits continuing?', options: [{ optionId: 'ready', text: 'Ready' }, { optionId: 'blocked', text: 'Blocked' }], correctOptionIds: ['ready'], points: 1, competencyIds: ['verify-readiness'], rationale: 'The source requires Ready before continuing. Blocked is not Ready.', citations: [citation] }]
} };
const lesson = { lessonId: 'lesson:1', learningObjectives: ['Verify readiness'], durationSeconds: 60, scenes: [
  { sceneId: 'scene:1', startSeconds: 0, endSeconds: 30, narration: 'Confirm Ready before continuing.', onScreenText: ['Ready'], checkpointActivityId: 'check:1' },
  { sceneId: 'scene:2', startSeconds: 30, endSeconds: 60, narration: 'Review the verification cue.', onScreenText: [] }
] };
const result = { operation: 'generate_video_lesson', status: 'DRAFT', warnings: [], citations: ['source:manual'], metrics: {}, output: {
  schemaVersion: 'course-draft.v1', title: 'Readiness', citations: [citation], modules: [{ moduleId: 'module:1', title: 'Readiness', activities: [assessment] }], videoLessons: [lesson]
} };
const original = structuredClone(result);
const reviewed = reviewInstructionalQuality(result);
assert.deepEqual(result, original, 'Quality review must not rewrite generated content.');
assert.equal(reviewed.status, 'DRAFT');
assert(reviewed.warnings.some(w => w.code === 'LEARNING_FINAL_CHECK_MISSING'));
assert(!reviewed.warnings.some(w => w.code === 'LEARNING_MODULE_ASSESSMENT_MISSING'));
const thin = structuredClone(result);
thin.output.modules[0].activities = [];
delete thin.output.videoLessons[0].scenes[0].checkpointActivityId;
thin.output.videoLessons[0].scenes[0].narration = 'word '.repeat(150);
thin.output.videoLessons[0].scenes[0].onScreenText = ['word '.repeat(45)];
const warnings = reviewInstructionalQuality(thin).warnings;
for (const code of ['LEARNING_MODULE_ASSESSMENT_MISSING', 'LEARNING_CHECKPOINT_MISSING', 'LEARNING_NARRATION_TOO_FAST', 'LEARNING_ONSCREEN_TEXT_DENSE']) assert(warnings.some(w => w.code === code), code);
const complete = structuredClone(result);
complete.output.videoLessons[0].scenes[1].checkpointActivityId = 'check:2';
complete.output.modules[0].activities.push({ ...structuredClone(assessment), activityId: 'check:2' });
assert.deepEqual(reviewInstructionalQuality(complete).warnings, []);
const repeatedFinal = structuredClone(complete);
repeatedFinal.output.videoLessons[0].scenes.splice(1, 0, { ...lesson.scenes[0], checkpointActivityId: 'check:2' });
assert(reviewInstructionalQuality(repeatedFinal).warnings.some(w => w.code === 'LEARNING_FINAL_CHECK_MISSING'), 'Repeating a formative question is not a distinct final check.');
const accelerated = structuredClone(thin);
accelerated.output.videoLessons[0].scenes[0].narrationDelivery = { rate: 1.25 };
assert(reviewInstructionalQuality(accelerated).warnings.some(w => w.code === 'LEARNING_NARRATION_TOO_FAST'), 'Faster delivery cannot hide an overfilled script.');
const paused = structuredClone(complete);
paused.output.videoLessons[0].scenes[0].narrationDelivery = { pauses: [{ afterText: 'Ready', milliseconds: 29000 }] };
assert(reviewInstructionalQuality(paused).warnings.some(w => w.code === 'LEARNING_NARRATION_TOO_FAST'), 'Pause and observation time must be reserved.');
const failed = { ...result, status: 'REJECTED', output: undefined };
assert.deepEqual(reviewInstructionalQuality(failed), failed);

let prompt;
const gateway = createAzureOpenAiGateway({ endpoint: 'https://example.test', apiKey: 'test', deployment: 'test', model: 'test', apiVersion: 'test', fetchImpl: async (_url, init) => {
  prompt = JSON.parse(init.body).messages[1].content;
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result.output) } }] });
} });
await gateway.execute({ operation: 'generate_video_lesson', tenant: { organizationId: 'org:test' }, sourceArtifactIds: ['source:manual'], outputSchemaVersion: 'course-draft.v1', tokenBudget: 4000, input: { videoLesson: true, sourceChunks: [] } });
for (const phrase of ['30-300 seconds', 'worked example', 'plausible distractors', '110-150 spoken words', 'checkpointActivityId', 'missing evidence']) assert(prompt.includes(phrase), phrase);
assert(!prompt.includes('90-120 second'));

let saved;
const service = createSourceGroundedDraftService({
  knowledge: { listForAssetVersions: async () => [{ assetVersionId: 'source:manual', citation, text: 'Confirm Ready before continuing.' }] },
  gateway: { execute: async () => ({ ...structuredClone(result), output: { ...structuredClone(result.output), videoLessons: undefined, modules: [{ moduleId: 'module:1', title: 'Readiness', activities: [{ activityId: 'read:1', type: 'rich_text', text: 'Confirm Ready before continuing.', citations: [citation] }] }] } }) },
  aiRuns: { record: async input => { saved = input; return 'run:1'; } }
});
const generated = await service.generate({ organizationId: 'org:test' }, { sourceArtifactIds: ['source:manual'] });
assert(generated.result.warnings.some(w => w.code === 'LEARNING_MODULE_ASSESSMENT_MISSING'));
assert(saved.result.warnings.some(w => w.code === 'LEARNING_MODULE_ASSESSMENT_MISSING'));
assert.equal(saved.promptVersion, 'course-draft.v2');
console.log('Instructional quality passed: review findings, nonmutation, generation instructions and audited service integration.');
