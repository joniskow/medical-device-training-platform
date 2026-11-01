import type { Pool } from "pg";
import {randomUUID,createHash} from 'node:crypto';
import type { KnowledgeChunkRecord, KnowledgeStorePort, TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";

interface ChunkRow {
  source_chunk_count?: number;
  source_hash?: string;
  chunk_id: string;
  organization_id: string;
  asset_version_id: string;
  chunk_text: string;
  citation: Record<string, unknown>;
  heading: string | null;
}

function fromRow(row: ChunkRow): KnowledgeChunkRecord {
  return {
    chunkId: row.chunk_id,
    ...(row.source_hash === undefined ? {} : {sourceHash:row.source_hash}),
    ...(row.source_chunk_count === undefined ? {} : {sourceChunkCount: Number(row.source_chunk_count)}),
    organizationId: row.organization_id,
    assetVersionId: row.asset_version_id,
    text: row.chunk_text,
    citation: row.citation,
    heading: row.heading ?? undefined
  };
}

export function createPostgresKnowledgeStore(pool: Pool): KnowledgeStorePort {
  return {
    async reviewSource(tenant, assetVersionId, input) {
      if (!tenant.actorId || !/^[a-f0-9]{64}$/.test(input.sourceHash) || !['APPROVE','REJECT'].includes(input.decision) || !input.rationale.trim() || input.rationale.length>4000 || !input.idempotencyKey || input.idempotencyKey.length>200) throw Error('SOURCE_REVIEW_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`SELECT v.state,v.sha256,a.status FROM asset_versions v JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id WHERE v.organization_id=$1 AND v.asset_version_id=$2 FOR UPDATE OF v,a`,[tenant.organizationId,assetVersionId]);
        const row=result.rows[0];
        if(!row||['QUARANTINED','REJECTED','RETIRED','SUSPENDED'].includes(row.status))throw Error('SOURCE_UNAVAILABLE');
        const requestHash=createHash('sha256').update(JSON.stringify([tenant.actorId,assetVersionId,input.sourceHash,input.decision,input.rationale.trim()])).digest('hex');
        const prior=await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='SOURCE_REVIEW_DECISION' AND details->>'idempotencyKey'=$3`,[tenant.organizationId,assetVersionId,input.idempotencyKey]);
        if(prior.rows[0]){
          if(prior.rows[0].details.requestHash!==requestHash)throw Error('SOURCE_REVIEW_CONFLICT');
          return {state:prior.rows[0].details.state};
        }
        if(row.state!=='READY_FOR_REVIEW'||row.sha256!==input.sourceHash)throw Error('SOURCE_REVIEW_CONFLICT');
        const state=input.decision==='APPROVE'?'APPROVED':'REJECTED';
        await client.query(`UPDATE asset_versions SET state=$3,reason=$4,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND asset_version_id=$2`,[tenant.organizationId,assetVersionId,state,input.rationale.trim()]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'SOURCE_REVIEW_DECISION','asset_version',$4,$5::jsonb,CURRENT_TIMESTAMP)`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,assetVersionId,JSON.stringify({...input,rationale:input.rationale.trim(),requestHash,state})]);
        return {state};
      });
    },
    async readSource(tenant, assetVersionId, after) {
      return withTenantTransaction(pool, tenant, async client => {
        const result = await client.query<ChunkRow & { file_name: string; sha256: string }>(
          `SELECT k.chunk_id, k.organization_id, k.asset_version_id, k.chunk_text, k.citation, k.heading, v.file_name, v.sha256
           FROM knowledge_chunks k JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id
           JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
           WHERE k.organization_id=$1 AND k.asset_version_id=$2 AND ($3::text IS NULL OR k.chunk_id > $3)
             AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
           ORDER BY k.chunk_id LIMIT 21`, [tenant.organizationId, assetVersionId, after ?? null]
        );
        const first = result.rows[0];
        if (!first) return null;
        const items = result.rows.slice(0,20).map(fromRow);
        return { assetVersionId, fileName: first.file_name, sourceHash: first.sha256, items, ...(result.rows.length > 20 ? { nextCursor: items[19].chunkId } : {}) };
      });
    },

    async listSources(tenant, after) {
      return withTenantTransaction(pool, tenant, async client => {
        const result = await client.query(
          `SELECT v.asset_version_id, v.file_name, v.state, count(k.chunk_id)::int AS chunk_count
           FROM asset_versions v JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
           JOIN knowledge_chunks k ON k.asset_version_id=v.asset_version_id AND k.organization_id=v.organization_id
           WHERE v.organization_id=$1 AND v.state IN ('READY_FOR_REVIEW','APPROVED')
             AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
             AND ($2::text IS NULL OR v.asset_version_id > $2)
           GROUP BY v.asset_version_id, v.file_name, v.state ORDER BY v.asset_version_id LIMIT 51`,
          [tenant.organizationId, after ?? null]
        );
        const items = result.rows.slice(0,50).map(row => ({ assetVersionId: row.asset_version_id, fileName: row.file_name, state: row.state, chunkCount: row.chunk_count }));
        return { items, ...(result.rows.length > 50 ? { nextCursor: items[49].assetVersionId } : {}) };
      });
    },

    async replaceForAssetVersion(tenant, assetVersionId, chunks) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const source = await client.query("SELECT sha256 FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2", [tenant.organizationId, assetVersionId]);
        if (!source.rows[0] || chunks.some(chunk => chunk.organizationId !== tenant.organizationId || chunk.assetVersionId !== assetVersionId)) throw new Error("SOURCE_ARTIFACT_NOT_FOUND");
        await client.query("DELETE FROM knowledge_chunks WHERE organization_id=$1 AND asset_version_id=$2", [tenant.organizationId, assetVersionId]);
        for (const chunk of chunks) {
          await client.query(
            `INSERT INTO knowledge_chunks (
               chunk_id, organization_id, asset_version_id, chunk_text, citation, heading,
               source_hash, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [chunk.chunkId, tenant.organizationId, assetVersionId, chunk.text, JSON.stringify(chunk.citation), chunk.heading ?? null, source.rows[0].sha256]
          );
        }
      });
    },

    async search(tenant, query, limit = 8) {
      const normalized = query.trim().slice(0, 256);
      if (!normalized) return [];
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ChunkRow>(
          `SELECT k.chunk_id, k.organization_id, k.asset_version_id, k.chunk_text, k.citation, k.heading
           FROM knowledge_chunks k JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id
           JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
           WHERE k.organization_id=$3 AND v.state IN ('READY_FOR_REVIEW','APPROVED')
             AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
             AND lower(k.chunk_text) LIKE lower($1) ESCAPE '\\'
           ORDER BY k.created_at, k.chunk_id
           LIMIT $2`,
          [`%${normalized.replace(/[\\%_]/g, "\\$&")}%`, Math.min(Math.max(limit, 1), 50), tenant.organizationId]
        );
        return result.rows.map(fromRow);
      });
    },

    async listForAssetVersions(tenant, assetVersionIds, limit = 32, query = "") {
      if (typeof query !== "string" || query.length > 2000) throw new Error("RETRIEVAL_QUERY_INVALID");
      const ids = [...new Set(assetVersionIds.map((value) => value.trim()).filter(Boolean))].slice(0, 32);
      if (ids.length === 0) return [];
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<ChunkRow>(
          `WITH terms AS (
             SELECT to_tsquery('english',coalesce(string_agg(quote_literal(term),' | '),'')) AS query
             FROM unnest(tsvector_to_array(to_tsvector('english',$4::text))) AS words(term)
           ), ranked AS (
             SELECT k.chunk_id, k.organization_id, k.asset_version_id, k.chunk_text, k.citation, k.heading, k.source_hash,
               row_number() OVER (PARTITION BY k.asset_version_id ORDER BY ts_rank_cd(to_tsvector('english',k.chunk_text),terms.query) DESC,k.created_at,k.chunk_id) AS source_rank,
               count(*) OVER (PARTITION BY k.asset_version_id)::int AS source_chunk_count
             FROM knowledge_chunks k CROSS JOIN terms JOIN asset_versions v ON v.asset_version_id=k.asset_version_id AND v.organization_id=k.organization_id
             JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
             WHERE k.organization_id=$3 AND k.asset_version_id = ANY($1::text[]) AND k.source_hash=v.sha256
               AND v.state IN ('READY_FOR_REVIEW','APPROVED')
               AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
           ) SELECT * FROM ranked ORDER BY source_rank,asset_version_id
           LIMIT $2`,
          [ids, Math.min(Math.max(limit, 1), 100), tenant.organizationId, query]
        );
        return result.rows.map(fromRow);
      });
    }
  };
}
