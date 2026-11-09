import type {Pool,PoolClient} from 'pg';
import type {KnowledgeChunkRecord,SourceEmbeddingProvider,TenantContext} from '@medical-device/contracts';
import {validateEmbedding} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {createHash} from 'node:crypto';

// Installing the extension is a privileged migration; the steady-state runtime cannot install it.
// Plain local PostgreSQL remains usable for lexical regressions. Hybrid startup fails explicitly.
export const KNOWLEDGE_EMBEDDINGS_MIGRATION_SQL=`
DO $migration$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS knowledge_embeddings(
   organization_id text NOT NULL,chunk_id text NOT NULL REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE,
   source_hash text NOT NULL,configuration_id text NOT NULL,text_hash text NOT NULL,
   embedding vector(1536) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(organization_id,chunk_id,configuration_id)
  );
  ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE knowledge_embeddings FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='knowledge_embeddings' AND policyname='tenant_isolation') THEN
   CREATE POLICY tenant_isolation ON knowledge_embeddings USING(organization_id=current_setting('app.organization_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true));
  END IF;
 END IF;
END $migration$;
`;

export async function assertHybridRetrievalAvailable(pool:Pool):Promise<void>{
 const result=await pool.query(`SELECT to_regclass('public.knowledge_embeddings') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS available`);
 if(result.rows[0]?.available!==true)throw Error('HYBRID_RETRIEVAL_MIGRATION_REQUIRED');
}

export async function writeKnowledgeEmbeddings(client:PoolClient,tenant:TenantContext,chunks:readonly KnowledgeChunkRecord[],vectors:readonly (readonly number[])[],provider:SourceEmbeddingProvider,sourceHash:string):Promise<void>{
 if(vectors.length!==chunks.length)throw Error('EMBEDDING_COUNT_INVALID');
 for(let index=0;index<chunks.length;index++){
  const vector=vectors[index]!;validateEmbedding(vector);
  await client.query(`INSERT INTO knowledge_embeddings(organization_id,chunk_id,source_hash,configuration_id,text_hash,embedding) VALUES($1,$2,$3,$4,$5,$6::vector) ON CONFLICT(organization_id,chunk_id,configuration_id) DO UPDATE SET source_hash=excluded.source_hash,text_hash=excluded.text_hash,embedding=excluded.embedding,created_at=now()`,[tenant.organizationId,chunks[index]!.chunkId,sourceHash,provider.configurationId,createHash('sha256').update(chunks[index]!.text).digest('hex'),JSON.stringify(vector)]);
 }
}

export async function prepareKnowledgeEmbeddings(pool:Pool,tenant:TenantContext,assetVersionId:string,chunks:readonly KnowledgeChunkRecord[],provider:SourceEmbeddingProvider){
 if(chunks.length>10000||chunks.some(chunk=>chunk.organizationId!==tenant.organizationId||chunk.assetVersionId!==assetVersionId))throw Error('EMBEDDING_SOURCE_INVALID');
 const state=await withTenantTransaction(pool,tenant,async client=>{
  const source=(await client.query(`SELECT sha256 FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 AND NOT public.lifecycle_asset_suppressed(asset_version_id) AND state IN ('PROCESSING','READY_FOR_REVIEW','APPROVED')`,[tenant.organizationId,assetVersionId])).rows[0];
  if(!source)throw Error('SOURCE_ARTIFACT_NOT_FOUND');
  const cached=(await client.query(`SELECT e.chunk_id,e.text_hash,e.embedding::text FROM knowledge_embeddings e JOIN knowledge_chunks k ON k.chunk_id=e.chunk_id AND k.organization_id=e.organization_id WHERE e.organization_id=$1 AND k.asset_version_id=$2 AND e.source_hash=$3 AND e.configuration_id=$4`,[tenant.organizationId,assetVersionId,source.sha256,provider.configurationId])).rows;
  return {sourceHash:source.sha256 as string,cached:new Map(cached.map(row=>[row.chunk_id,row]))};
 });
 const vectors:Array<readonly number[]>=new Array(chunks.length);const missing:number[]=[];
 chunks.forEach((chunk,index)=>{const prior=state.cached.get(chunk.chunkId);if(prior?.text_hash===createHash('sha256').update(chunk.text).digest('hex')){vectors[index]=JSON.parse(prior.embedding);validateEmbedding(vectors[index]!);}else missing.push(index);});
 for(let offset=0;offset<missing.length;offset+=16){const batch=missing.slice(offset,offset+16),result=await provider.embed(tenant,batch.map(index=>chunks[index]!.text));if(result.length!==batch.length)throw Error('EMBEDDING_COUNT_INVALID');batch.forEach((index,position)=>{validateEmbedding(result[position]!);vectors[index]=result[position]!;});}
 return {vectors,sourceHash:state.sourceHash};
}

export async function hybridKnowledgeRows(pool:Pool,tenant:TenantContext,ids:readonly string[]|undefined,query:string,limit:number,provider:SourceEmbeddingProvider){
 const [vector]=await provider.embed(tenant,[query]);if(!vector)throw Error('EMBEDDING_COUNT_INVALID');validateEmbedding(vector);
 return withTenantTransaction(pool,tenant,async client=>{
  const missing=await client.query(`SELECT 1 FROM knowledge_chunks k JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id WHERE k.organization_id=$1 AND ($2::text[] IS NULL OR k.asset_version_id=ANY($2)) AND k.source_hash=v.sha256 AND NOT public.lifecycle_asset_suppressed(v.asset_version_id) AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED') AND NOT EXISTS(SELECT 1 FROM knowledge_embeddings e WHERE e.organization_id=k.organization_id AND e.chunk_id=k.chunk_id AND e.source_hash=v.sha256 AND e.configuration_id=$3) LIMIT 1`,[tenant.organizationId,ids??null,provider.configurationId]);
  if(missing.rowCount)throw Error('SOURCE_EMBEDDINGS_REQUIRED');
  const result=await client.query(`WITH permitted AS (
   SELECT k.*,e.embedding FROM knowledge_chunks k
   JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id
   JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
   JOIN knowledge_embeddings e ON e.organization_id=k.organization_id AND e.chunk_id=k.chunk_id AND e.source_hash=v.sha256 AND e.configuration_id=$4
   WHERE k.organization_id=$1 AND ($2::text[] IS NULL OR k.asset_version_id=ANY($2)) AND k.source_hash=v.sha256
    AND NOT public.lifecycle_asset_suppressed(v.asset_version_id) AND v.state IN ('READY_FOR_REVIEW','APPROVED')
    AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
  ),scored AS (
   SELECT *,CASE WHEN numnode(plainto_tsquery('english',$3))=0 THEN NULL ELSE ts_rank_cd(to_tsvector('english',chunk_text),plainto_tsquery('english',$3))::float8 END AS lexical_score,
    (1-(embedding <=> $5::vector))::float8 AS semantic_score FROM permitted
  ),ranked AS (
   SELECT *,row_number() OVER(ORDER BY lexical_score DESC,chunk_id) AS lexical_rank,
    row_number() OVER(ORDER BY semantic_score DESC,chunk_id) AS semantic_rank,
    count(*) OVER(PARTITION BY asset_version_id)::int AS source_chunk_count FROM scored
  ),fused AS (
   SELECT *,((CASE WHEN lexical_score>0 THEN 1.0/(60+lexical_rank) ELSE 0 END)+1.0/(60+semantic_rank))::float8 AS ranking_score FROM ranked
  ),balanced AS (
   SELECT *,row_number() OVER(PARTITION BY asset_version_id ORDER BY ranking_score DESC,chunk_id) AS source_rank FROM fused
  ) SELECT chunk_id,organization_id,asset_version_id,chunk_text,citation,heading,source_hash,source_chunk_count,
    lexical_score AS retrieval_score,ranking_score AS retrieval_rank_score,$4::text AS retrieval_configuration_id
    FROM balanced ORDER BY source_rank,ranking_score DESC,chunk_id LIMIT $6`,[tenant.organizationId,ids??null,query,provider.configurationId,JSON.stringify(vector),limit]);
  return result.rows;
 });
}
