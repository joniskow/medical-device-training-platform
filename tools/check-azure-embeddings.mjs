import assert from 'node:assert/strict';
import {createAzureEmbeddingProvider} from '../packages/ai-gateway/dist/embeddings.js';
const env={RETRIEVAL_MODE:'hybrid',AZURE_EMBEDDING_ENDPOINT:'https://fixture.openai.azure.com/',AZURE_EMBEDDING_DEPLOYMENT:'embedding',AZURE_EMBEDDING_MODEL:'text-embedding-3-small',AZURE_EMBEDDING_API_KEY:'fixture-secret'};
const vector=Array.from({length:1536},(_,i)=>i===0?1:0),tenant={organizationId:'embedding-check',actorId:'author',correlationId:'embedding-check'};
const receipts=[];let calls=0;
const provider=createAzureEmbeddingProvider(env,{onUsage:async(t,r)=>receipts.push({t,r}),fetch:async(url,input)=>{calls++;assert.equal(url.href,'https://fixture.openai.azure.com/openai/v1/embeddings');assert.equal(input.redirect,'error');assert.equal(input.headers['api-key'],'fixture-secret');const body=JSON.parse(input.body);assert.equal(body.dimensions,1536);return Response.json({data:body.input.map((_,index)=>({index,embedding:vector})).reverse(),usage:{prompt_tokens:12}});}});
assert.equal((await provider.embed(tenant,['approved source','query'])).length,2);
assert.equal(receipts.at(-1).r.metrics.input_tokens,12);assert.equal(receipts[0].r.phase,'STARTED');
assert(!JSON.stringify(receipts).includes('approved source'));assert(!JSON.stringify(receipts).includes('fixture-secret'));
await assert.rejects(provider.embed(tenant,['x'.repeat(6001)]),/INPUT_INVALID/);assert.equal(calls,1);
for(const endpoint of ['http://fixture.openai.azure.com','https://fixture.openai.azure.com.evil.test','https://fixture.openai.azure.com/path','https://fixture.openai.azure.com?secret=a'])assert.throws(()=>createAzureEmbeddingProvider({...env,AZURE_EMBEDDING_ENDPOINT:endpoint}));
for(const data of [[{index:0,embedding:[1]}],[{index:0,embedding:vector},{index:0,embedding:vector}],[{index:0,embedding:new Array(1536).fill(0)}]]){
 const bad=createAzureEmbeddingProvider(env,{fetch:async()=>Response.json({data})});await assert.rejects(bad.embed(tenant,['query']));
}
await assert.rejects(createAzureEmbeddingProvider(env,{fetch:async()=>new Response('rejected',{status:429})}).embed(tenant,['query']),/PROVIDER_UNAVAILABLE/);
assert.equal(createAzureEmbeddingProvider({RETRIEVAL_MODE:'lexical'}),undefined);
console.log('Azure embedding boundary passed: fixed origin/configuration, bounded source inputs, response shape/dimensions/indexes, safe source meters and explicit provider failure. Controlled transport only.');
