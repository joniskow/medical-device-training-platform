import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAzureOpenAiGateway, createStagedLearningGateway, createSourceGroundedDraftService } from '../packages/ai-gateway/dist/index.js';

/** Structural comparisons support human review; they cannot select a clinically accurate model. */
export function learningEvaluationSummary(result) {
  const modules = result.status === 'DRAFT' && Array.isArray(result.output?.modules) ? result.output.modules : [];
  const completeness = result.output?.learningCompleteness;
  return {
    status: result.status, provider: result.providerMetadata, metrics: result.metrics,
    moduleCount: modules.length,
    objectiveCount: completeness?.objectives?.length ?? null,
    taughtAndAssessedObjectives: completeness?.objectives?.filter(objective => objective.taught && objective.assessed).length ?? null,
    missingEvidenceCount: completeness?.missingEvidenceIds?.length ?? null,
    untaughtEvidenceCount: completeness?.untaughtEvidenceIds?.length ?? null,
    warningCodes: [...new Set(result.warnings.map(warning => warning.code))].sort(),
    failureCode: result.failure?.code ?? null,
    semanticSupportVerified: false, humanReviewRequired: true
  };
}

async function main() {
  const [mode, inputFile, outputFile, extra] = process.argv.slice(2);
  if (mode !== '--live' || !inputFile || !outputFile || extra) throw Error('USAGE: node tools/evaluate-learning-models.mjs --live evidence.json private-report.json (makes paid Azure calls)');
  let outputExists = false;
  try { await access(resolve(outputFile)); outputExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (outputExists) throw Error('LEARNING_EVALUATION_REPORT_EXISTS');
  const fixture = JSON.parse(await readFile(resolve(inputFile), 'utf8'));
  if (!Array.isArray(fixture.sourceChunks) || !fixture.sourceChunks.length || fixture.sourceChunks.length > 32 || fixture.sourceChunks.some(chunk => !chunk || typeof chunk.assetVersionId !== 'string' || typeof chunk.text !== 'string' || !chunk.text.trim() || !chunk.citation)) throw Error('LEARNING_EVALUATION_EVIDENCE_INVALID');
  const required = name => { const value = process.env[name]?.trim(); if (!value) throw Error('LEARNING_EVALUATION_CONFIGURATION_MISSING'); return value; };
  const shared = { endpoint: required('AZURE_OPENAI_ENDPOINT'), apiKey: required('AZURE_OPENAI_API_KEY'), apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || '2024-10-21' };
  const configurations = [
    { ...shared, deployment: required('AZURE_OPENAI_DEPLOYMENT'), model: required('AZURE_OPENAI_MODEL') },
    { ...shared, deployment: required('AZURE_OPENAI_INSTRUCTIONAL_DEPLOYMENT'), model: required('AZURE_OPENAI_INSTRUCTIONAL_MODEL') }
  ];
  if (configurations[0].deployment === configurations[1].deployment) throw Error('LEARNING_EVALUATION_CANDIDATE_MUST_DIFFER');
  const results = [];
  for (const configuration of configurations) {
    const service = createSourceGroundedDraftService({
      knowledge: { listForAssetVersions: async () => structuredClone(fixture.sourceChunks) },
      gateway: createStagedLearningGateway(createAzureOpenAiGateway(configuration)),
      aiRuns: { record: async () => 'evaluation-only' }, defaultTokenBudget: 4000
    });
    const started = Date.now();
    const { result } = await service.generate({ organizationId: 'offline-evaluation' }, {
      sourceArtifactIds: [...new Set(fixture.sourceChunks.map(chunk => chunk.assetVersionId))],
      userInstruction: fixture.userInstruction, tokenBudget: fixture.tokenBudget ?? 4000
    });
    results.push({ summary: { ...learningEvaluationSummary(result), elapsedMs: Date.now() - started }, result });
  }
  await writeFile(resolve(outputFile), JSON.stringify({ schemaVersion: 'learning-model-evaluation.v1',
    scope: 'Identical selected evidence, author instruction, staged workflow and output budget. Private drafts for blinded human review; structural counts are not accuracy or learning-effectiveness scores.',
    reviewCriteria: ['Missing prerequisites, warnings and ordered steps', 'Claim support and exact labels, numbers and units', 'Objective alignment and usefulness of practice', 'Correct answers, plausible distractors and explanatory feedback', 'Audience fit and clarity', 'Latency, provider usage and reviewer correction effort'],
    baseline: results[0], candidate: results[1]
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Learning model comparison saved privately; human review is required before changing the configured model.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(error.message?.startsWith('USAGE:') ? error.message : 'LEARNING_EVALUATION_FAILED');
  process.exitCode = 1;
});
