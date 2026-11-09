import {randomUUID,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {createAzureEmbeddingProvider} from '../packages/ai-gateway/dist/embeddings.js';
import {withTenantTransaction,prepareKnowledgeEmbeddings,writeKnowledgeEmbeddings,assertHybridRetrievalAvailable,createSourceUsageMeteringStore,readSourceUsageRates,createOperationsStore,withOperationalAdmission} from '../packages/db/dist/index.js';

/** Operator batch, outside HTTP requests. Resumable by stable chunk cursor; persisted vectors deduplicate retries. */
export async function backfillKnowledgeEmbeddings(env,args){
 const [organizationId,assetVersionId,after='']=args;
 const valid=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
 if(args.length<2||args.length>3||!valid(organizationId)||!valid(assetVersionId)||(after&&!valid(after))||env.EMBEDDING_BACKFILL_CONFIRM_ORGANIZATION!==organizationId||!env.DATABASE_URL)throw Error('EMBEDDING_BACKFILL_CONFIRMATION_REQUIRED');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
 const tenant={organizationId,actorId:'operator:embedding-backfill',correlationId:randomUUID()};
 const usage=createSourceUsageMeteringStore(pool,{rates:readSourceUsageRates(env.SOURCE_USAGE_RATES_JSON),telemetrySecret:env.OPERATIONAL_KEY_SECRET});
 try{
  const secret=env.OPERATIONAL_KEY_SECRET;
  if(!secret||Buffer.byteLength(secret)<32)throw Error('EMBEDDING_BACKFILL_ADMISSION_REQUIRED');
  const cost=Number(env.EMBEDDING_MAX_RUN_COST_CENTS??10);if(!Number.isSafeInteger(cost)||cost<1||cost>50000)throw Error('EMBEDDING_BACKFILL_ADMISSION_INVALID');
  const provider=createAzureEmbeddingProvider(env,{onUsage:usage.record,admit:(context,action)=>withOperationalAdmission({store:createOperationsStore(pool),key:createHmac('sha256',secret).update(JSON.stringify([context.organizationId,randomUUID()])).digest('hex'),estimateCents:cost,action:async signal=>{signal.throwIfAborted();const result=await action();signal.throwIfAborted();return result;}})});if(!provider)throw Error('HYBRID_RETRIEVAL_CONFIGURATION_REQUIRED');await assertHybridRetrievalAvailable(pool);
  const chunks=await withTenantTransaction(pool,tenant,async client=>{
   const rows=await client.query(`SELECT k.* FROM knowledge_chunks k JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id WHERE k.organization_id=$1 AND k.asset_version_id=$2 AND k.chunk_id>$3 AND k.source_hash=v.sha256 AND NOT public.lifecycle_asset_suppressed(v.asset_version_id) AND v.state IN ('READY_FOR_REVIEW','APPROVED') ORDER BY k.chunk_id LIMIT 101`,[organizationId,assetVersionId,after]);
   return rows.rows.map(row=>({chunkId:row.chunk_id,organizationId,assetVersionId,text:row.chunk_text,citation:row.citation,heading:row.heading??undefined}));
  });
  const batch=chunks.slice(0,100);if(!batch.length)return {indexed:0,nextCursor:null};
  const prepared=await prepareKnowledgeEmbeddings(pool,tenant,assetVersionId,batch,provider);
  await withTenantTransaction(pool,tenant,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['lifecycle:'+organizationId]);
   const current=await client.query(`SELECT sha256 FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 AND sha256=$3 AND state IN ('READY_FOR_REVIEW','APPROVED') AND NOT public.lifecycle_asset_suppressed(asset_version_id) FOR SHARE`,[organizationId,assetVersionId,prepared.sourceHash]);
   if(!current.rowCount)throw Error('EMBEDDING_SOURCE_CHANGED');
   // Chunk text can change independently in a re-extraction; bind it again before storing vectors.
   for(const chunk of batch){const row=(await client.query('SELECT chunk_text FROM knowledge_chunks WHERE organization_id=$1 AND asset_version_id=$2 AND chunk_id=$3 FOR SHARE',[organizationId,assetVersionId,chunk.chunkId])).rows[0];if(row?.chunk_text!==chunk.text)throw Error('EMBEDDING_SOURCE_CHANGED');}
   await writeKnowledgeEmbeddings(client,tenant,batch,prepared.vectors,provider,prepared.sourceHash);
   await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'KNOWLEDGE_EMBEDDINGS_BACKFILLED','asset_version',$4,$5::jsonb,now())`,['embedding:'+randomUUID(),organizationId,tenant.actorId,assetVersionId,JSON.stringify({count:batch.length,configurationId:provider.configurationId,sourceHash:prepared.sourceHash})]);
  });
  return {indexed:batch.length,nextCursor:chunks.length>100?batch.at(-1).chunkId:null};
 }finally{await pool.end();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 backfillKnowledgeEmbeddings(process.env,process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('EMBEDDING_BACKFILL_FAILED');process.exitCode=1;});
}
