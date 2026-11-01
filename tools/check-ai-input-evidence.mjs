import assert from 'node:assert/strict';
import {aiInputEvidence} from '../packages/db/dist/ai-input-evidence.js';
const request={operation:'generate_course_draft',sourceArtifactIds:['source'],outputSchemaVersion:'course-draft.v1',tokenBudget:2000,tenant:{organizationId:'org',correlationId:'run'},input:{userInstruction:'PRIVATE INSTRUCTION',retrievalVersion:'english-lexical-interleaved.v1',sourceChunks:[{chunkId:'chunk',assetVersionId:'source',sourceHash:'a'.repeat(64),text:'PRIVATE SOURCE TEXT',citation:{page:3,section:'PRIVATE SECTION'}}],sourceCoverage:[{assetVersionId:'source',selectedPassages:1,totalPassages:4}],modelContext:{modelVersionId:'model',manifestHash:'b'.repeat(64),manifest:{secret:'PRIVATE MODEL DATA'}},mediaContext:[{assetVersionId:'image',sourceType:'image',contentType:'image/png'}]}};
const evidence=aiInputEvidence(request,'prompt:v1');
assert.equal(evidence.schemaVersion,'ai-input-evidence.v1');assert.equal(evidence.passages[0].chunkId,'chunk');assert.deepEqual(evidence.sourceCoverage,request.input.sourceCoverage);
assert.ok(!JSON.stringify(evidence).includes('PRIVATE'));assert.match(evidence.requestHash,/^[a-f0-9]{64}$/);
assert.deepEqual(aiInputEvidence(structuredClone(request),'prompt:v1'),evidence);
const reordered={...request,input:Object.fromEntries(Object.entries(request.input).reverse())};assert.equal(aiInputEvidence(reordered,'prompt:v1').requestHash,evidence.requestHash);
for(const mutate of [r=>r.input.userInstruction+=' changed',r=>r.input.sourceChunks[0].text+=' changed',r=>r.input.sourceChunks[0].citation.page++,r=>r.tokenBudget++,r=>r.input.retrievalVersion='new',r=>r.input.modelContext.manifestHash='new',r=>r.input.mediaContext[0].assetVersionId='new']){const next=structuredClone(request);mutate(next);assert.notEqual(aiInputEvidence(next,'prompt:v1').requestHash,evidence.requestHash);}
assert.notEqual(aiInputEvidence(request,'prompt:v2').requestHash,evidence.requestHash);
assert.equal(aiInputEvidence({...request,tenant:{...request.tenant,correlationId:'retry'}},'prompt:v1').requestHash,evidence.requestHash);
console.log('AI input evidence passed: stable fingerprints, changed source/settings detection, passage/coverage metadata and no raw instruction/source/model content.');
