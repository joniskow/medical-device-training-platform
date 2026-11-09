import assert from 'node:assert/strict';
import {aiInputEvidence} from '../packages/db/dist/ai-input-evidence.js';
const request={operation:'generate_course_draft',sourceArtifactIds:['source'],outputSchemaVersion:'course-draft.v1',tokenBudget:2000,tenant:{organizationId:'org',correlationId:'run'},input:{userInstruction:'PRIVATE INSTRUCTION',retrievalVersion:'english-lexical-interleaved.v1',sourceChunks:[{chunkId:'chunk',assetVersionId:'source',sourceHash:'a'.repeat(64),text:'PRIVATE SOURCE TEXT',citation:{page:3,section:'PRIVATE SECTION'}}],sourceCoverage:[{assetVersionId:'source',selectedPassages:1,totalPassages:4}],modelContext:{modelVersionId:'model',manifestHash:'b'.repeat(64),manifest:{secret:'PRIVATE MODEL DATA'}},mediaContext:[{assetVersionId:'image',sourceType:'image',contentType:'image/png'}]}};
const evidence=aiInputEvidence(request,'prompt:v1');
assert.equal(evidence.schemaVersion,'ai-input-evidence.v1');assert.equal(evidence.passages[0].chunkId,'chunk');assert.deepEqual(evidence.sourceCoverage,request.input.sourceCoverage);
assert.ok(!JSON.stringify(evidence).includes('PRIVATE'));assert.match(evidence.requestHash,/^[a-f0-9]{64}$/);
assert.deepEqual(aiInputEvidence(structuredClone(request),'prompt:v1'),evidence);
assert.equal(Object.hasOwn(evidence.sourceCoverage[0],'matchingPassages'),false,'Legacy retrieval without rank evidence must omit the optional field');
const hybrid=structuredClone(request);hybrid.input.retrievalVersion='azure-pgvector-rrf1536.v1';hybrid.input.retrievalConfigurations=['test:embedding-v1'];hybrid.input.sourceChunks[0].retrievalConfigurationId='test:embedding-v1';
const hybridUnknownRank=aiInputEvidence(hybrid,'prompt:v1');
assert.deepEqual(hybridUnknownRank.retrievalConfigurations,['test:embedding-v1']);
assert.equal(hybridUnknownRank.passages[0].retrievalConfigurationId,'test:embedding-v1');
assert.equal(Object.hasOwn(hybridUnknownRank.passages[0],'retrievalRankScore'),false);
for(const retrievalRankScore of [0,0.016]){
 hybrid.input.sourceChunks[0].retrievalRankScore=retrievalRankScore;
 const projected=aiInputEvidence(hybrid,'prompt:v1');assert.equal(projected.passages[0].retrievalRankScore,retrievalRankScore);
 assert.notEqual(projected.requestHash,hybridUnknownRank.requestHash,'Changed ordering provenance changes its fingerprint');
 assert(!JSON.stringify(projected).includes('PRIVATE'));
}
for(const matchingPassages of [0,1,null]){
 const ranked=structuredClone(request);ranked.input.sourceCoverage[0].matchingPassages=matchingPassages;
 const rankedEvidence=aiInputEvidence(ranked,'prompt:v1');
 assert.equal(Object.hasOwn(rankedEvidence.sourceCoverage[0],'matchingPassages'),true);
 assert.equal(rankedEvidence.sourceCoverage[0].matchingPassages,matchingPassages,'Known zero matches must remain explicit');
 assert.notEqual(rankedEvidence.requestHash,evidence.requestHash,'Changed retrieval evidence must change its fingerprint');
}
const reordered={...request,input:Object.fromEntries(Object.entries(request.input).reverse())};assert.equal(aiInputEvidence(reordered,'prompt:v1').requestHash,evidence.requestHash);
for(const mutate of [r=>r.input.userInstruction+=' changed',r=>r.input.sourceChunks[0].text+=' changed',r=>r.input.sourceChunks[0].citation.page++,r=>r.tokenBudget++,r=>r.input.retrievalVersion='new',r=>r.input.modelContext.manifestHash='new',r=>r.input.mediaContext[0].assetVersionId='new']){const next=structuredClone(request);mutate(next);assert.notEqual(aiInputEvidence(next,'prompt:v1').requestHash,evidence.requestHash);}
assert.notEqual(aiInputEvidence(request,'prompt:v2').requestHash,evidence.requestHash);
assert.equal(aiInputEvidence({...request,tenant:{...request.tenant,correlationId:'retry'}},'prompt:v1').requestHash,evidence.requestHash);
console.log('AI input evidence passed: stable fingerprints, changed source/settings detection, passage/coverage metadata and no raw instruction/source/model content.');
