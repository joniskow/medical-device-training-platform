import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {applyProcessingJobMigration,grantRuntimeDomainTables,createPostgresKnowledgeStore,assertHybridRetrievalAvailable,withTenantTransaction} from '../packages/db/dist/index.js';
import {backfillKnowledgeEmbeddings} from './backfill-knowledge-embeddings.mjs';
import {createSourceGroundedDraftService} from '../packages/ai-gateway/dist/index.js';
import {aiInputEvidence} from '../packages/db/dist/ai-input-evidence.js';
const admin=new Pool({connectionString:process.env.VECTOR_DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54339/medical_device'});
const runtime=new Pool({connectionString:process.env.VECTOR_DATABASE_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54339/medical_device'});
const org='hybrid_'+Date.now(),tenant={organizationId:org,actorId:org,correlationId:org};
let calls=0;const unit=i=>Array.from({length:1536},(_,j)=>j===i?1:0);
const provider={configurationId:'test:embedding-v1',dimensions:1536,async embed(t,texts){calls++;assert.equal(t.organizationId,org);return texts.map(text=>text.includes('semantic')||text.includes('synonym')?unit(0):unit(1));}};
const store=createPostgresKnowledgeStore(runtime,provider),asset=org+'_version';
const chunks=[{chunkId:org+'_a',organizationId:org,assetVersionId:asset,text:'The semantic control labelled engage.',citation:{assetVersionId:asset,page:1}},{chunkId:org+'_b',organizationId:org,assetVersionId:asset,text:'Unrelated equipment cover.',citation:{assetVersionId:asset,page:2}}];
try{
 await applyProcessingJobMigration(admin);await grantRuntimeDomainTables(admin,'local_runtime');await assertHybridRetrievalAvailable(runtime);
 await admin.query('GRANT EXECUTE ON FUNCTION operational_reserve(text,uuid,integer,integer),operational_settle(text,uuid,integer),operational_renew(text,uuid,integer) TO local_runtime');
 await admin.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'pdf','APPROVED',$2,$2,now(),now())`,[org,org]);
 await admin.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'pdf',$3||'/manual','manual.pdf','application/pdf',10,$4,'APPROVED',$3,now(),now())`,[asset,org,org,'a'.repeat(64)]);
 await store.replaceForAssetVersion(tenant,asset,chunks);assert.equal(calls,1);
 await store.replaceForAssetVersion(tenant,asset,chunks);assert.equal(calls,1,'Same tenant/source/text/config reuses persisted vectors');
 const ranked=await store.listForAssetVersions(tenant,[asset],8,'synonym');assert.equal(ranked[0].chunkId,chunks[0].chunkId,'Semantic ordering works without lexical overlap');assert.equal(ranked[0].retrievalScore,0);assert(ranked[0].retrievalRankScore>0);assert.equal(ranked[0].retrievalConfigurationId,provider.configurationId);
 let captured;
 const drafting=createSourceGroundedDraftService({knowledge:store,gateway:{async execute(input){captured=input;throw Error('CAPTURED_INPUT');}}});
 await assert.rejects(drafting.generate(tenant,{sourceArtifactIds:[asset],userInstruction:'synonym'}),/CAPTURED_INPUT/);
 assert.equal(captured.input.retrievalVersion,'azure-pgvector-rrf1536.v1');assert.equal(captured.input.sourceCoverage[0].matchingPassages,0,'A positive rank score cannot manufacture lexical support');
 const evidence=aiInputEvidence(captured,'engineering-check');assert.deepEqual(evidence.retrievalConfigurations,[provider.configurationId]);assert.equal(evidence.passages[0].retrievalConfigurationId,provider.configurationId);
 await withTenantTransaction(runtime,{...tenant,organizationId:'foreign'},async client=>assert.equal((await client.query('SELECT * FROM knowledge_embeddings')).rowCount,0));
 const changed=createPostgresKnowledgeStore(runtime,{...provider,configurationId:'test:embedding-v2'});await assert.rejects(changed.listForAssetVersions(tenant,[asset],8,'synonym'),/SOURCE_EMBEDDINGS_REQUIRED/);
 await admin.query(`UPDATE assets SET status='SUSPENDED' WHERE asset_id=$1`,[org]);assert.equal((await changed.listForAssetVersions(tenant,[asset],8,'synonym')).length,0,'Excluded parent assets cannot block search with a missing-index failure');await admin.query(`UPDATE assets SET status='APPROVED' WHERE asset_id=$1`,[org]);
 const originalFetch=globalThis.fetch;let azureCalls=0;
 const backfillEnv={DATABASE_URL:process.env.VECTOR_DATABASE_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54339/medical_device',EMBEDDING_BACKFILL_CONFIRM_ORGANIZATION:org,OPERATIONAL_KEY_SECRET:'engineering-only-backfill-secret-32bytes',RETRIEVAL_MODE:'hybrid',AZURE_EMBEDDING_ENDPOINT:'https://fixture.openai.azure.com/',AZURE_EMBEDDING_DEPLOYMENT:'embedding',AZURE_EMBEDDING_MODEL:'text-embedding-3-small',AZURE_EMBEDDING_API_KEY:'fixture-only'};
 globalThis.fetch=async(_url,input)=>{azureCalls++;return Response.json({data:JSON.parse(input.body).input.map((text,index)=>({index,embedding:text.includes('semantic')?unit(0):unit(1)})),usage:{prompt_tokens:20}});};
 try{await assert.rejects(backfillKnowledgeEmbeddings({...backfillEnv,EMBEDDING_BACKFILL_CONFIRM_ORGANIZATION:'foreign'},[org,asset]),/CONFIRMATION_REQUIRED/);assert.deepEqual(await backfillKnowledgeEmbeddings(backfillEnv,[org,asset]),{indexed:2,nextCursor:null});await backfillKnowledgeEmbeddings(backfillEnv,[org,asset]);assert.equal(azureCalls,1,'Operator backfill retries reuse persisted source/configuration vectors');}finally{globalThis.fetch=originalFetch;}
 await admin.query(`UPDATE asset_versions SET sha256=$2 WHERE asset_version_id=$1`,[asset,'b'.repeat(64)]);assert.equal((await store.listForAssetVersions(tenant,[asset],8,'synonym')).length,0,'Old source hash never enters retrieval');
 await admin.query(`UPDATE asset_versions SET sha256=$2,state='RETIRED' WHERE asset_version_id=$1`,[asset,'a'.repeat(64)]);assert.equal((await store.listForAssetVersions(tenant,[asset],8,'synonym')).length,0);
 console.log('Real pgvector hybrid retrieval passed: persisted cache, semantic ranking, incompatible configuration denial, current source hashes, tenant RLS and withdrawal. Embeddings are controlled vectors; provider quality remains external.');
}finally{
 await admin.query('DELETE FROM audit_events WHERE organization_id=$1',[org]);await admin.query('DELETE FROM usage_meter_events WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM knowledge_chunks WHERE organization_id=$1',[org]);await admin.query('DELETE FROM asset_versions WHERE organization_id=$1',[org]);await admin.query('DELETE FROM assets WHERE organization_id=$1',[org]);await Promise.all([admin.end(),runtime.end()]);
}
