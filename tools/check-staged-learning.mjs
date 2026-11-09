import assert from 'node:assert/strict';
import { createStagedLearningGateway, learningEvidenceCategories } from '../packages/ai-gateway/dist/staged-learning.js';
import { createAzureOpenAiGateway, createSourceGroundedDraftService } from '../packages/ai-gateway/dist/index.js';
import { learningEvaluationSummary } from './evaluate-learning-models.mjs';

const citation = { assetVersionId: 'manual', page: 1 };
const request = { operation: 'generate_course_draft', tenant: { organizationId: 'org' }, sourceArtifactIds: ['manual'], outputSchemaVersion: 'course-draft.v1', tokenBudget: 4000,
  input: { sourceChunks: [{ assetVersionId: 'manual', citation, text: 'Check Ready before continuing.' }] } };
const evidence = learningEvidenceCategories.map((category, i) => ({ evidenceId: `e:${i}`, category, status: i === 0 ? 'SUPPORTED' : 'MISSING', summary: i === 0 ? 'Check Ready.' : 'Not present in selected evidence.', ...(i === 0 ? { citations: [citation] } : {}) }));
const plan = { schemaVersion: 'learning-plan.v1', title: 'Readiness', evidence, modules: [1, 2].map(i => ({ moduleId: `m:${i}`, title: `Task ${i}`, objectives: [{ objectiveId: `o:${i}`, text: 'Verify Ready', evidenceIds: ['e:0'] }], evidenceIds: ['e:0'] })) };
const metadata = { provider: 'azure-openai', deployment: 'fixture', model: 'fixture', apiVersion: 'fixture' };
const draft = output => ({ operation: request.operation, status: 'DRAFT', output, citations: ['manual'], warnings: [], metrics: { inputTokens: 10, outputTokens: 20 }, providerMetadata: metadata });
function provider(options = {}) {
  const calls = [];
  return { calls, async execute(req) {
    calls.push(structuredClone(req));
    if (options.failAt === calls.length) return { ...draft(undefined), status: 'REJECTED', failure: { class: 'VALIDATION', code: 'AI_OUTPUT_INCOMPLETE', message: 'Incomplete' } };
    if (calls.length === 1) return draft(options.plan ?? plan);
    const module = plan.modules[calls.length - 2];
    return draft({ schemaVersion: 'course-draft.v1', title: plan.title, citations: [citation], modules: [{ moduleId: module.moduleId, title: module.title, activities: [
      { activityId: `${module.moduleId}:teach`, type: 'rich_text', text: 'Check Ready.', objectiveIds: [`o:${calls.length - 1}`], evidenceIds: options.omitEvidence ? [] : ['e:0'], citations: [citation] },
      { activityId: `${module.moduleId}:check`, type: 'multiple_choice', objectiveIds: [`o:${calls.length - 1}`], evidenceIds: ['e:0'], assessment: {
        schemaVersion: 'assessment-definition.v1', assessmentId: `${module.moduleId}:assessment`, version: 1, passScore: 0.8,
        questions: [{ questionId: 'q:1', type: 'multiple_choice', prompt: 'Which state permits continuing?', options: [{ optionId: 'ready', text: 'Ready' }, { optionId: 'blocked', text: 'Blocked' }], correctOptionIds: ['ready'], points: 1, competencyIds: [`o:${calls.length - 1}`], rationale: 'Ready permits continuing. Blocked does not satisfy the Ready check; review the state and retry.', citations: [citation] }]
      }, citations: [citation] }
    ] }] });
  } };
}
const source = provider();
const result = await createStagedLearningGateway(source).execute(request);
assert.equal(result.status, 'DRAFT');
assert.equal(source.calls.length, 3);
assert.equal(source.calls[0].tokenBudget, 1500, 'The eight-category outline must have sufficient room within the shared ceiling.');
assert.equal(source.calls[1].tokenBudget, 1250);
assert(source.calls.reduce((sum, item) => sum + item.tokenBudget, 0) <= request.tokenBudget);
assert.equal(result.output.modules.length, 2);
assert.deepEqual(result.metrics, { inputTokens: 30, outputTokens: 60 });
assert(result.warnings.some(w => w.code === 'LEARNING_EVIDENCE_MISSING'));
assert.equal(result.output.learningCompleteness.semanticSupportVerified, false);
assert.equal(result.output.learningCompleteness.objectives.length, 2);
const summary = learningEvaluationSummary(result);
assert.equal(summary.taughtAndAssessedObjectives, 2);
assert.equal(summary.missingEvidenceCount, 7);
assert.equal(summary.humanReviewRequired, true);
assert.equal(learningEvaluationSummary({ ...result, status: 'REJECTED', output: undefined }).objectiveCount, null);
assert(result.output.learningCompleteness.objectives.every(o => o.taught && o.assessed));
assert.equal(source.calls[1].input.learningStage.kind, 'module');
assert.deepEqual(source.calls[1].input.sourceChunks, request.input.sourceChunks);
const singlePlan = { ...structuredClone(plan), modules: [structuredClone(plan.modules[0])] };
const small = provider({ plan: singlePlan });
assert.equal((await createStagedLearningGateway(small).execute({ ...request, tokenBudget: 2000 })).status, 'DRAFT');
assert(small.calls.reduce((sum, item) => sum + item.tokenBudget, 0) <= 2000);
const reversedProvider = provider();
const reversed = await createStagedLearningGateway({ execute: async req => {
  const result = await reversedProvider.execute(req);
  if (result.output.schemaVersion === 'course-draft.v1') result.output.modules[0].activities.reverse();
  return result;
} }).execute(request);
assert(reversed.output.learningCompleteness.objectives.every(objective => objective.taught && !objective.assessed), 'An assessment before teaching cannot satisfy a later application check.');
const videoProvider = provider({ plan: singlePlan });
const video = await createStagedLearningGateway({ execute: async req => {
  const result = await videoProvider.execute(req);
  if (result.output.schemaVersion === 'course-draft.v1') result.output.videoLessons = [{ schemaVersion: 'video-lesson.v1', lessonId: 'm:1:video', title: 'Readiness', durationSeconds: 30, learningObjectives: ['Verify Ready'], safetyBoundary: 'Review the source before operation.', citations: [citation], scenes: [{ sceneId: 'm:1:scene', startSeconds: 0, endSeconds: 30, narration: 'Check Ready before continuing.', onScreenText: ['Ready'], visual: { kind: 'source_image', assetVersionId: 'image', label: 'Readiness' }, citations: [citation] }] }];
  return result;
} }).execute({ ...request, input: { ...request.input, videoLesson: true } });
assert.equal(video.status, 'DRAFT');
assert.equal(video.output.videoLessons.length, 1);
assert.equal(videoProvider.calls[0].input.learningStage.maxModules, 1);
assert.equal((await createStagedLearningGateway(provider({ plan: singlePlan })).execute({ ...request, input: { ...request.input, videoLesson: true } })).failure.code, 'LEARNING_MODULE_INVALID');
const invalid = structuredClone(plan); invalid.evidence[0].citations[0].page = 99;
const invalidSource = provider({ plan: invalid });
assert.equal((await createStagedLearningGateway(invalidSource).execute(request)).failure.code, 'LEARNING_PLAN_INVALID');
assert.equal(invalidSource.calls.length, 1);
const duplicate = structuredClone(plan); duplicate.modules[1].moduleId = duplicate.modules[0].moduleId;
assert.equal((await createStagedLearningGateway(provider({ plan: duplicate })).execute(request)).status, 'REJECTED');
const arrayStatus = structuredClone(plan); arrayStatus.evidence[1].status = ['MISSING'];
assert.equal((await createStagedLearningGateway(provider({ plan: arrayStatus })).execute(request)).failure.code, 'LEARNING_PLAN_INVALID');
const mismatchedProvider = provider();
const inconsistent = await createStagedLearningGateway({ execute: async req => {
  const response = await mismatchedProvider.execute(req);
  if (response.output.schemaVersion === 'course-draft.v1') for (const activity of response.output.modules[0].activities) activity.citations = [{ assetVersionId: 'other', page: 1 }];
  return response;
} }).execute({ ...request, input: { sourceChunks: [...request.input.sourceChunks, { assetVersionId: 'other', citation: { assetVersionId: 'other', page: 1 }, text: 'Other evidence.' }] } });
assert(inconsistent.output.learningCompleteness.objectives.every(o => !o.taught && !o.assessed), 'An unrelated allowed citation must not receive evidence coverage credit.');
assert.deepEqual(inconsistent.output.learningCompleteness.untaughtEvidenceIds, ['e:0']);
const partial = await createStagedLearningGateway(provider({ failAt: 3 })).execute(request);
assert(partial.warnings.some(w => w.code === 'LEARNING_STAGE_FAILED' && w.message.includes('module')));
const failedPlan = await createStagedLearningGateway(provider({ failAt: 1 })).execute(request);
assert.equal(failedPlan.output, undefined);
assert(failedPlan.warnings.some(w => w.code === 'LEARNING_STAGE_FAILED' && w.message.includes('plan')));
assert.equal(partial.output, undefined);
assert.equal(partial.status, 'REJECTED');
assert.deepEqual(partial.metrics, { inputTokens: 30, outputTokens: 60 });
const omitted = await createStagedLearningGateway(provider({ omitEvidence: true })).execute(request);
assert(omitted.warnings.some(w => w.code === 'LEARNING_EVIDENCE_UNTAUGHT'));
const noBudget = provider();
assert.equal((await createStagedLearningGateway(noBudget).execute({ ...request, tokenBudget: 1000 })).failure.code, 'LEARNING_BUDGET_TOO_SMALL');
assert.equal(noBudget.calls.length, 0);
let saved, recorded;
const serviceProvider = provider();
const service = createSourceGroundedDraftService({ knowledge: { listForAssetVersions: async () => request.input.sourceChunks }, gateway: createStagedLearningGateway(serviceProvider), defaultTokenBudget: 4000,
  aiRuns: { record: async input => { recorded = input; return 'run:staged'; } },
  draftStore: { get: async () => ({ courseVersion: { status: 'DRAFT', revision: 1, content: {} } }), saveGeneratedDraft: async input => { saved = input; return true; } } });
const accepted = await service.generate({ organizationId: 'org', courseVersionId: 'course' }, { sourceArtifactIds: ['manual'] });
assert.equal(accepted.result.status, 'DRAFT');
assert.equal(accepted.appliedToCourse, true);
assert.equal(saved.content.learningPlan.schemaVersion, 'learning-plan.v1');
assert.equal(recorded.result.metrics.outputTokens, 60);
assert.equal(recorded.request.tokenBudget, 4000);
saved = undefined;
const failingService = createSourceGroundedDraftService({ knowledge: { listForAssetVersions: async () => request.input.sourceChunks }, gateway: createStagedLearningGateway(provider({ failAt: 3 })), defaultTokenBudget: 4000,
  aiRuns: { record: async input => { recorded = input; return 'run:failed'; } },
  draftStore: { get: async () => ({ courseVersion: { status: 'DRAFT', revision: 1, content: {} } }), saveGeneratedDraft: async input => { saved = input; return true; } } });
assert.equal((await failingService.generate({ organizationId: 'org', courseVersionId: 'course' }, { sourceArtifactIds: ['manual'] })).appliedToCourse, false);
assert.equal(saved, undefined);
assert.equal(recorded.result.output, undefined);
assert.equal(recorded.result.metrics.outputTokens, 60);
let prompt;
const azure = createAzureOpenAiGateway({ endpoint: 'https://example.test', apiKey: 'fixture', deployment: 'fixture', model: 'fixture', apiVersion: 'fixture', fetchImpl: async (_url, init) => {
  prompt = JSON.parse(init.body).messages[1].content;
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] });
} });
await azure.execute(source.calls[0]);
assert(prompt.includes('learning-plan.v1'));
assert(prompt.includes('NOT_APPLICABLE'));
assert(prompt.includes('untrusted data'));
await azure.execute(source.calls[1]);
assert(prompt.includes('objectiveIds'));
assert(prompt.includes('evidenceIds'));
console.log('Staged learning passed: bounded sequential generation, evidence locators, completeness, aggregate usage and atomic failures.');
