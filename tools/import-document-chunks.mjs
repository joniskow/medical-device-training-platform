import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresKnowledgeStore } from "../packages/db/dist/index.js";

const root = resolve(process.cwd());
const extractionPath = resolve(process.env.EXTRACTION_JSON ?? "output/fixture-import/aic-001-document-extraction.json");
const extraction = JSON.parse(await readFile(extractionPath, "utf8"));
assert.equal(extraction.schemaVersion, "document-extraction.v1");
assert.equal(extraction.status, "READY");
assert.ok(Array.isArray(extraction.chunks) && extraction.chunks.length > 0);

const sourcePath = resolve(root, extraction.sourcePath);
const sourceStats = await stat(sourcePath);
const sourceBytes = await readFile(sourcePath);
assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), extraction.sourceSha256);
const organizationId = process.env.IMPORT_ORGANIZATION_ID ?? "org_fixture";
const actorId = process.env.IMPORT_ACTOR_ID ?? "document-importer";
const tenant = { organizationId, actorId, correlationId: "corr_document_import" };
const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });

try {
  await applyProcessingJobMigration(pool);
  await pool.query("DELETE FROM knowledge_chunks WHERE asset_version_id = $1", [extraction.inputAssetVersionId]);
  await pool.query("DELETE FROM asset_versions WHERE asset_version_id = $1", [extraction.inputAssetVersionId]);
  await pool.query("DELETE FROM assets WHERE asset_id = $1", [`asset:${extraction.inputAssetVersionId}`]);
  await pool.query(
    `INSERT INTO assets (asset_id, organization_id, product_id, source_type, status, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, NULL, 'pdf', 'READY_FOR_REVIEW', $3, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`asset:${extraction.inputAssetVersionId}`, organizationId, actorId]
  );
  await pool.query(
    `INSERT INTO asset_versions (
       asset_version_id, asset_id, organization_id, product_id, source_type, blob_key, file_name,
       content_type, size_bytes, sha256, state, reason, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, NULL, 'pdf', $4, $5, 'application/pdf', $6, $7, 'READY_FOR_REVIEW', 'DOCUMENT_IMPORT', $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      extraction.inputAssetVersionId,
      `asset:${extraction.inputAssetVersionId}`,
      organizationId,
      `${organizationId}/reference/${extraction.inputAssetVersionId}.pdf`,
      sourcePath.split(/[\\/]/).pop(),
      sourceStats.size,
      extraction.sourceSha256,
      actorId
    ]
  );
  const knowledge = createPostgresKnowledgeStore(pool);
  await knowledge.replaceForAssetVersion(tenant, extraction.inputAssetVersionId, extraction.chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    organizationId,
    assetVersionId: extraction.inputAssetVersionId,
    text: chunk.text,
    citation: chunk.citation
  })));
  const found = await knowledge.search(tenant, "blocked line", 8);
  assert.ok(found.length > 0);
  assert.ok(found.every((chunk) => chunk.organizationId === organizationId && chunk.assetVersionId === extraction.inputAssetVersionId));
  console.log(`Document import passed: ${extraction.inputAssetVersionId} -> ${extraction.chunks.length} tenant-scoped cited chunks; retrieval returned ${found.length}.`);
} finally {
  await pool.end();
}
