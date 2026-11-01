import assert from 'node:assert/strict';
import { createSourceGroundedDraftService, createDeterministicAiGateway } from '../packages/ai-gateway/dist/index.js';

let revision = 4;
let recorded = false;
let generated = false;
const tenant = { organizationId: 'org', actorId: 'author', courseVersionId: 'course', correlationId: 'race' };
const gateway = createDeterministicAiGateway();
const service = createSourceGroundedDraftService({
  knowledge: { listForAssetVersions: async (_tenant,_ids,limit,query) => {assert.equal(limit,32);assert.equal(query,'Focus on pressure relief');return [{ assetVersionId: 'source', text: 'Approved source text.', citation: { page: 1 } }];} },
  gateway: { execute: async request => { generated = true; revision++; return gateway.execute(request); } },
  aiRuns: { record: async () => { recorded = true; return 'ai:retained'; } },
  draftStore: {
    get: async () => ({ courseVersion: { revision, status: revision === 99 ? 'PUBLISHED' : 'DRAFT' } }),
    saveGeneratedDraft: async input => { assert.equal(input.revision, 4); return input.revision === revision; }
  }
});
const result = await service.generate(tenant, { sourceArtifactIds: ['source'],userInstruction:'Focus on pressure relief' });
assert.equal(recorded, true);
assert.equal(result.aiRunId, 'ai:retained');
assert.equal(result.appliedToCourse, false);
assert.equal(result.result.status, 'DRAFT');
revision = 99;
generated = false;
await assert.rejects(service.generate(tenant, { sourceArtifactIds: ['source'],userInstruction:'Focus on pressure relief' }), /COURSE_VERSION_IMMUTABLE/);
assert.equal(generated, false);
assert.equal(result.sourceCoverage[0].totalPassages,null);
assert.ok(result.result.warnings.some(w=>w.code==='SOURCE_COVERAGE_UNKNOWN'));
await assert.rejects(service.generate(tenant,{sourceArtifactIds:Array.from({length:33},(_,i)=>'source:'+i)}),/COURSE_VERSION_IMMUTABLE/);
revision=4;
await assert.rejects(service.generate(tenant,{sourceArtifactIds:Array.from({length:33},(_,i)=>'source:'+i)}),/SOURCE_ARTIFACTS_INVALID/);
console.log('AI generation race passed: captured revision, retained generated result, no stale overwrite, and no provider call for published content.');
