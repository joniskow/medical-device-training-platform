import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  AssetLifecycleState,
  AssetVersionRecord,
  TenantContext,
  UploadSessionRecord,
  UploadSessionRequest,
  UploadSessionStore
} from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";

interface UploadSessionRow {
  upload_session_id: string;
  organization_id: string;
  actor_id: string;
  product_id: string | null;
  source_type: UploadSessionRecord["sourceType"];
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  blob_key: string;
  status: UploadSessionRecord["status"];
  expires_at: Date;
  completed_asset_version_id: string | null;
}

interface AssetVersionRow {
  asset_version_id: string;
  asset_id: string;
  organization_id: string;
  product_id: string | null;
  source_type: AssetVersionRecord["sourceType"];
  blob_key: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  state: AssetLifecycleState;
  reason: string | null;
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const nowIso = (value?: string): string => value ?? new Date().toISOString();

function sessionFromRow(row: UploadSessionRow): UploadSessionRecord {
  return {
    uploadSessionId: row.upload_session_id,
    organizationId: row.organization_id,
    actorId: row.actor_id,
    productId: row.product_id ?? undefined,
    sourceType: row.source_type,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    blobKey: row.blob_key,
    status: row.status,
    expiresAt: iso(row.expires_at),
    completedAssetVersionId: row.completed_asset_version_id ?? undefined
  };
}

function assetFromRow(row: AssetVersionRow): AssetVersionRecord {
  return {
    assetVersionId: row.asset_version_id,
    assetId: row.asset_id,
    organizationId: row.organization_id,
    productId: row.product_id ?? undefined,
    sourceType: row.source_type,
    blobKey: row.blob_key,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    state: row.state,
    reason: row.reason ?? undefined
  };
}

const sessionColumns = `upload_session_id, organization_id, actor_id, product_id, source_type,
  file_name, content_type, size_bytes, sha256, blob_key, status, expires_at, completed_asset_version_id`;

const assetColumns = `asset_version_id, asset_id, organization_id, product_id, source_type,
  blob_key, file_name, content_type, size_bytes, sha256, state, reason`;

function actorId(input: UploadSessionRequest): string {
  const actor = input.actorId.trim();
  if (!actor || actor.length > 256) throw new Error("ACTOR_REQUIRED");
  return actor;
}

export function createPostgresUploadSessionStore(pool: Pool): UploadSessionStore {
  return {
    async create(input) {
      const timestamp = new Date().toISOString();
      const uploadSessionId = `upload:${randomUUID()}`;
      return withTenantTransaction(pool, input.tenant, async (client) => {
        const result = await client.query<UploadSessionRow>(
          `INSERT INTO upload_sessions (
             upload_session_id, organization_id, actor_id, product_id, source_type,
             file_name, content_type, size_bytes, sha256, blob_key, status, expires_at,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11, $12, $12)
           RETURNING ${sessionColumns}`,
          [
            uploadSessionId,
            input.tenant.organizationId,
            actorId(input),
            input.productId ?? null,
            input.sourceType,
            input.fileName,
            input.contentType,
            input.sizeBytes,
            input.sha256,
            input.blobKey,
            input.expiresAt,
            timestamp
          ]
        );
        return sessionFromRow(result.rows[0]);
      });
    },

    async get(tenant, uploadSessionId) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query<UploadSessionRow>(
          `SELECT ${sessionColumns} FROM upload_sessions WHERE upload_session_id = $1`,
          [uploadSessionId]
        );
        return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
      });
    },

    async complete(input) {
      const timestamp = nowIso(input.now);
      return withTenantTransaction(pool, input.tenant, async (client) => {
        const sessionResult = await client.query<UploadSessionRow>(
          `SELECT ${sessionColumns} FROM upload_sessions WHERE upload_session_id = $1 FOR UPDATE`,
          [input.uploadSessionId]
        );
        const session = sessionResult.rows[0];
        if (!session) return null;

        if (session.status === "COMPLETED" && session.completed_asset_version_id) {
          const existing = await client.query<AssetVersionRow>(
            `SELECT ${assetColumns} FROM asset_versions WHERE asset_version_id = $1`,
            [session.completed_asset_version_id]
          );
          return existing.rows[0] ? { session: sessionFromRow(session), assetVersion: assetFromRow(existing.rows[0]) } : null;
        }
        if (session.status !== "ACTIVE") return null;
        if (new Date(session.expires_at).getTime() <= new Date(timestamp).getTime()) {
          await client.query(
            `UPDATE upload_sessions SET status = 'EXPIRED', updated_at = $2::timestamptz WHERE upload_session_id = $1`,
            [input.uploadSessionId, timestamp]
          );
          return null;
        }
        if (
          session.blob_key !== input.blobKey
          || session.content_type !== input.contentType
          || Number(session.size_bytes) !== input.sizeBytes
          || session.sha256 !== input.sha256
        ) return null;

        const assetId = `asset:${randomUUID()}`;
        const assetVersionId = `assetv:${randomUUID()}`;
        await client.query(
          `INSERT INTO assets (
             asset_id, organization_id, product_id, source_type, status,
             created_by, updated_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, 'READY_FOR_SCAN', $5, $5, $6, $6)`,
          [assetId, session.organization_id, session.product_id, session.source_type, session.actor_id, timestamp]
        );
        const assetResult = await client.query<AssetVersionRow>(
          `INSERT INTO asset_versions (
             asset_version_id, asset_id, organization_id, product_id, source_type,
             blob_key, file_name, content_type, size_bytes, sha256, state,
             created_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'READY_FOR_SCAN', $11, $12, $12)
           RETURNING ${assetColumns}`,
          [
            assetVersionId,
            assetId,
            session.organization_id,
            session.product_id,
            session.source_type,
            session.blob_key,
            session.file_name,
            session.content_type,
            session.size_bytes,
            session.sha256,
            session.actor_id,
            timestamp
          ]
        );
        const updatedSession = await client.query<UploadSessionRow>(
          `UPDATE upload_sessions
           SET status = 'COMPLETED', completed_asset_version_id = $2, updated_at = $3::timestamptz
           WHERE upload_session_id = $1
           RETURNING ${sessionColumns}`,
          [input.uploadSessionId, assetVersionId, timestamp]
        );
        return { session: sessionFromRow(updatedSession.rows[0]), assetVersion: assetFromRow(assetResult.rows[0]) };
      });
    },

    async cancel(tenant, uploadSessionId, now) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const result = await client.query(
          `UPDATE upload_sessions SET status = 'CANCELLED', updated_at = $2::timestamptz
           WHERE upload_session_id = $1 AND status = 'ACTIVE'`,
          [uploadSessionId, nowIso(now)]
        );
        return result.rowCount === 1;
      });
    }
  };
}
