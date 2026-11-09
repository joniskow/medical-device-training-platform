# Evidence planning and instructional generation

Azure course and video-lesson requests now use an evidence map and bounded outline, followed by sequential generation of individual modules. The existing source selection, exact-citation checks, approved asset/model binding, assessment validation, saved brief, source direction checks and independent publication reviews still apply. The deterministic local/demo gateway retains its existing behavior.

The outline covers prerequisites, terminology, preparation, procedure, verification, warnings, exceptions and completion. Each entry is `SUPPORTED`, `MISSING` or `NOT_APPLICABLE`; supported entries must cite exact supplied passage locators. Absence should be reported as missing evidence, not treated as proof that a warning or exception does not apply. A model can still misclassify applicability or support, so a reviewer must compare the outline with the original sources and revision.

Each planned module has observable objectives and assigned evidence. Generated activities bind objective/evidence IDs. The application records whether each objective is taught and subsequently assessed, whether assigned evidence appears in teaching, and which categories lack evidence. Activities receive coverage credit only when their citations include the locators of the referenced evidence. The saved draft includes `learningPlan` and `learningCompleteness`; warning codes identify incomplete objectives and omitted evidence. These are structural review aids, not semantic correctness or exhaustive-document coverage scores. Existing partial/unknown retrieval coverage warnings remain visible.

Module prompts request worked examples, guided practice, distinct application checks, plausible distractors and feedback explaining each option and a retry cue. Module titles and objective text are bound to the validated outline. Normal grounding/schema validation still rejects malformed or unsupported activity bindings. A failed or truncated stage discards all intermediate output, records aggregate usage and never replaces the saved course with a partial result. Successful results remain drafts and preserve normal review and publication requirements.

## Limits and cost

The existing 4,000 output-token run ceiling is shared across the outline and all module calls; it is not granted separately to each call. The API defaults staged requests to that ceiling. Explicit budgets of 2,000–4,000 are supported. The outline gets three eighths of the budget, capped at 1,500; the remainder is split among one or two modules with at least 1,200 output tokens per module. Video requests use one module so narration, directions and checkpoints have the remaining budget. Choose focused tasks; this budget does not promise a complete long-manual course. Oversized input and unfinished output reject rather than silently truncate. Source context is repeated on each provider call, so input-token cost and latency can increase despite the shared output ceiling. Review `AI_MAX_RUN_COST_CENTS` for the selected deployment and up to three provider calls.

All stages use one configured deployment, enabling aggregate input/output metering and the existing deployment-specific cost-rate accounting. Transport failure after paid work can still lack exact usage, as with the existing provider adapter; cost reservations remain conservative estimates rather than Azure invoices.

## Configuration and stronger models

`AI_STAGED_LEARNING=true` is the Azure API default; `false` restores the previous single-call path. The Bicep parameter is `aiStagedLearning`. Existing model/deployment settings remain the default.

To use an evaluated stronger model on the same Azure OpenAI endpoint, configure both `AZURE_OPENAI_INSTRUCTIONAL_DEPLOYMENT` and `AZURE_OPENAI_INSTRUCTIONAL_MODEL` (Bicep: `azureOpenAiInstructionalDeployment`, `azureOpenAiInstructionalModel`). Supplying only one fails startup. Use an available deployment compatible with this adapter's Chat Completions JSON-object response format, `temperature: 0`, and `max_tokens`; support is model/version specific. Set deployment-specific reviewed rates in `AI_COST_RATES_JSON`, review the cost reservation, and retain credentials in the existing secret store. No new model, quota, GPU or cloud deployment is provisioned by this change.

Run a controlled comparison with the same representative evidence and budgets before changing the production model:

```powershell
node tools/evaluate-learning-models.mjs --live private-evidence.json private-comparison.json
```

The input contains `sourceChunks` with `assetVersionId`, `text` and exact `citation` objects (including a positive `page`), optional `sourceChunkCount`, plus optional `userInstruction` and `tokenBudget`. Only rights-cleared evidence should be used. The command uses the existing endpoint/key, compares `AZURE_OPENAI_DEPLOYMENT`/`AZURE_OPENAI_MODEL` with the instructional pair, and makes paid calls only when explicitly invoked with `--live`. Both models use the same staged workflow. It never saves to a course or publishes anything. The private report contains both drafts, structural findings, provider usage and elapsed time; keep it with private project data. It refuses to overwrite an existing report.

Have a reviewer compare missing steps/warnings, claim support, exact terminology, objective alignment, explanations, distractors and audience fit without relying on the model's identity. Track reviewer corrections and acceptance, along with latency and usage. More modules, fewer missing-evidence flags or a larger model do not establish better accuracy. Semantic accuracy and learner outcomes require separate evaluation.

## Verification

Build the AI gateway, then run:

```powershell
node tools/check-ai-gateway.mjs
node tools/check-instructional-quality.mjs
node tools/check-staged-learning.mjs
```

The staged checks cover exact citation rejection, malformed statuses, unrelated citations receiving no coverage credit, evidence gaps, objective teaching/check order, bounded aggregate allocation/usage, stage failure without partial persistence, and integration with existing grounding and draft-save validation. They use controlled provider responses and do not establish live Azure generation quality. See also [narration reuse](production-efficiency.md) and [background profiles](background-rendering.md).
