import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  approveOpenMontageRenderArtifact,
  createOpenMontageRenderArtifact,
  createOpenMontageSceneBrief,
  createOpenMontageSceneManifest,
  type OpenMontageRenderArtifact,
  type OpenMontageSceneBrief,
  type TrainingSceneManifest,
  validateOpenMontageSceneBrief,
  validateOpenMontageRenderArtifact,
  validateTrainingSceneManifest,
  type TenantContext,
} from '@medical-device/contracts';
import { withTenantTransaction } from '@medical-device/db';
import type { PrivateObjectStoragePort } from '@medical-device/contracts';

type SceneSource = { sceneManifest: TrainingSceneManifest; brief: OpenMontageSceneBrief };
type VideoInput = OpenMontageRenderArtifact['video'];

export interface OpenMontageSceneService {
  createBrief(tenant: TenantContext, input: { sceneManifest: unknown; prompt: string; promptHash?: string; idempotencyKey: string; requestHash: string }): Promise<{ briefId: string; brief: OpenMontageSceneBrief }>;
  ingestRender(tenant: TenantContext, input: { sceneId: string; briefId: string; video: VideoInput; idempotencyKey: string; requestHash: string }): Promise<{ artifactId: string; artifact: OpenMontageRenderArtifact }>;
  getArtifact(tenant: TenantContext, artifactId: string): Promise<{ artifactId: string; artifact: OpenMontageRenderArtifact } | null>;
  approveRender(tenant: TenantContext, input: { artifactId: string; reviewerId: string; reviewRef: string; idempotencyKey: string; requestHash: string }): Promise<{ artifactId: string; artifact: OpenMontageRenderArtifact; sceneManifest: TrainingSceneManifest }>;
  getApprovedScene(tenant: TenantContext, sceneId: string): Promise<{ sceneManifest: TrainingSceneManifest; videoUrl: string } | null>;
  video(tenant: TenantContext, sceneId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const idPattern = /^[A-Za-z0-9._:-]{1,200}$/;
const hashPattern = /^[a-f0-9]{64}$/i;

function requireId(value: string, name: string): string {
  if (!idPattern.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function requireHash(value: string, name: string): string {
  if (!hashPattern.test(value)) throw new Error(`${name}_INVALID`);
  return value.toLowerCase();
}

function digestPrompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function sourceRow(row: any): SceneSource | null {
  if (!row) return null;
  return { sceneManifest: validateTrainingSceneManifest(row.scene_manifest), brief: validateOpenMontageSceneBrief(row.brief) };
}

async function verifySceneSources(client: PoolClient, tenant: TenantContext, scene: TrainingSceneManifest): Promise<void> {
  const video = (await client.query(`
    SELECT v.sha256
    FROM asset_versions v
    JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id
    WHERE v.organization_id=$1 AND v.asset_version_id=$2 AND v.source_type='video'
      AND v.content_type IN ('video/mp4','video/webm') AND v.state='APPROVED'
      AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
      AND EXISTS (SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=v.organization_id AND r.asset_version_id=v.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed=true)
    FOR SHARE OF v`, [tenant.organizationId, scene.video.assetVersionId])).rows[0];
  if (!video || video.sha256 !== scene.video.sourceHash) throw new Error('OPENMONTAGE_SOURCE_VIDEO_UNAVAILABLE');

  const model = (await client.query(`
    SELECT v.sha256
    FROM model_versions m
    JOIN asset_versions v ON v.organization_id=m.organization_id AND v.asset_version_id=m.asset_version_id
    JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id
    WHERE m.organization_id=$1 AND m.model_version_id=$2 AND m.status='APPROVED' AND v.state='APPROVED'
      AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
      AND EXISTS (SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=v.organization_id AND r.asset_version_id=v.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed=true)
    FOR SHARE OF m`, [tenant.organizationId, scene.model.modelVersionId])).rows[0];
  if (!model || model.sha256 !== scene.model.sourceHash) throw new Error('OPENMONTAGE_MODEL_UNAVAILABLE');
}

async function verifyRenderVideo(client: PoolClient, tenant: TenantContext, video: VideoInput, brief: OpenMontageSceneBrief): Promise<void> {
  const row = (await client.query(`
    SELECT v.sha256,v.content_type,v.size_bytes
    FROM asset_versions v
    JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id
    WHERE v.organization_id=$1 AND v.asset_version_id=$2 AND v.source_type='video' AND v.state='APPROVED'
      AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
      AND EXISTS (SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=v.organization_id AND r.asset_version_id=v.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed=true)
    FOR SHARE OF v`, [tenant.organizationId, video.assetVersionId])).rows[0];
  if (!row || row.sha256 !== video.sourceHash || row.content_type !== video.contentType || Number(row.size_bytes) !== video.byteLength) throw new Error('OPENMONTAGE_RENDER_ASSET_MISMATCH');
  if (video.width !== brief.background.width || video.height !== brief.background.height || video.frameRate !== brief.background.frameRate || Math.abs(video.durationSeconds - brief.background.durationSeconds) > 0.05) throw new Error('OPENMONTAGE_RENDER_PROFILE_MISMATCH');
}

function rowArtifact(row: any): { artifactId: string; artifact: OpenMontageRenderArtifact } {
  return { artifactId: row.artifact_id, artifact: validateOpenMontageRenderArtifact(row.artifact) };
}

export function createOpenMontageSceneService(pool: Pool, storage: Pick<PrivateObjectStoragePort, 'readObject'>): OpenMontageSceneService {
  return {
    async createBrief(tenant, input) {
      const scene = validateTrainingSceneManifest(input.sceneManifest);
      const promptHash = digestPrompt(input.prompt);
      if (input.promptHash !== undefined && requireHash(input.promptHash, 'OPENMONTAGE_PROMPT_HASH') !== promptHash) throw new Error('OPENMONTAGE_PROMPT_HASH_MISMATCH');
      const brief = createOpenMontageSceneBrief(scene, input.prompt, promptHash);
      requireId(input.idempotencyKey, 'IDEMPOTENCY_KEY');
      return withTenantTransaction(pool, tenant, async client => {
        const existing = (await client.query('SELECT brief_id,brief FROM openmontage_scene_briefs WHERE organization_id=$1 AND idempotency_key=$2 FOR SHARE', [tenant.organizationId, input.idempotencyKey])).rows[0];
        if (existing) {
          const prior = (await client.query('SELECT request_hash FROM openmontage_scene_briefs WHERE organization_id=$1 AND brief_id=$2', [tenant.organizationId, existing.brief_id])).rows[0];
          if (prior?.request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          return { briefId: existing.brief_id, brief: validateOpenMontageSceneBrief(existing.brief) };
        }
        await verifySceneSources(client, tenant, scene);
        const briefId = `openmontage-brief:${randomUUID()}`;
        const inserted = (await client.query(`INSERT INTO openmontage_scene_briefs (brief_id,organization_id,scene_id,scene_manifest,brief,idempotency_key,request_hash,created_by,created_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,now()) ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING brief_id,brief,request_hash`, [briefId, tenant.organizationId, scene.sceneId, JSON.stringify(scene), JSON.stringify(brief), input.idempotencyKey, input.requestHash, tenant.actorId ?? 'unknown'])).rows[0];
        if (!inserted) {
          const raced = (await client.query('SELECT brief_id,brief,request_hash FROM openmontage_scene_briefs WHERE organization_id=$1 AND idempotency_key=$2 FOR SHARE', [tenant.organizationId, input.idempotencyKey])).rows[0];
          if (!raced || raced.request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          return { briefId: raced.brief_id, brief: validateOpenMontageSceneBrief(raced.brief) };
        }
        return { briefId: inserted.brief_id, brief: validateOpenMontageSceneBrief(inserted.brief) };
      });
    },

    async ingestRender(tenant, input) {
      requireId(input.sceneId, 'SCENE_ID'); requireId(input.briefId, 'BRIEF_ID'); requireId(input.idempotencyKey, 'IDEMPOTENCY_KEY');
      const video = { ...input.video, assetVersionId: requireId(input.video.assetVersionId, 'VIDEO_ASSET_VERSION_ID'), sourceHash: requireHash(input.video.sourceHash, 'VIDEO_SOURCE_HASH') };
      return withTenantTransaction(pool, tenant, async client => {
        const existing = (await client.query('SELECT artifact_id,artifact,request_hash FROM openmontage_render_artifacts WHERE organization_id=$1 AND idempotency_key=$2 FOR SHARE', [tenant.organizationId, input.idempotencyKey])).rows[0];
        if (existing) {
          if (existing.request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          return rowArtifact(existing);
        }
        const source = sourceRow((await client.query('SELECT scene_manifest,brief FROM openmontage_scene_briefs WHERE organization_id=$1 AND brief_id=$2 AND scene_id=$3 FOR SHARE', [tenant.organizationId, input.briefId, input.sceneId])).rows[0]);
        if (!source) throw new Error('OPENMONTAGE_BRIEF_NOT_FOUND');
        const artifact = createOpenMontageRenderArtifact(source.brief, video);
        await verifyRenderVideo(client, tenant, video, source.brief);
        const artifactId = `openmontage-artifact:${randomUUID()}`;
        const inserted = (await client.query(`INSERT INTO openmontage_render_artifacts (artifact_id,organization_id,scene_id,brief_id,artifact,status,request_hash,idempotency_key,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,'REVIEW_REQUIRED',$6,$7,$8,now(),now()) ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING artifact_id,artifact,request_hash`, [artifactId, tenant.organizationId, input.sceneId, input.briefId, JSON.stringify(artifact), input.requestHash, input.idempotencyKey, tenant.actorId ?? 'unknown'])).rows[0];
        if (!inserted) {
          const raced = (await client.query('SELECT artifact_id,artifact,request_hash FROM openmontage_render_artifacts WHERE organization_id=$1 AND idempotency_key=$2 FOR SHARE', [tenant.organizationId, input.idempotencyKey])).rows[0];
          if (!raced || raced.request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          return rowArtifact(raced);
        }
        return { artifactId: inserted.artifact_id, artifact: validateOpenMontageRenderArtifact(inserted.artifact) };
      });
    },

    async getArtifact(tenant, artifactId) {
      if (!idPattern.test(artifactId)) return null;
      return withTenantTransaction(pool, tenant, async client => {
        const row = (await client.query('SELECT artifact_id,artifact FROM openmontage_render_artifacts WHERE organization_id=$1 AND artifact_id=$2', [tenant.organizationId, artifactId])).rows[0];
        return row ? rowArtifact(row) : null;
      });
    },

    async approveRender(tenant, input) {
      requireId(input.artifactId, 'ARTIFACT_ID'); requireId(input.idempotencyKey, 'IDEMPOTENCY_KEY'); requireId(input.reviewerId, 'REVIEWER_ID');
      if (!input.reviewRef.trim() || input.reviewRef.length > 500) throw new Error('OPENMONTAGE_REVIEW_INVALID');
      return withTenantTransaction(pool, tenant, async client => {
        const existingKey = (await client.query('SELECT artifact_id,artifact,scene_manifest,request_hash FROM openmontage_render_artifacts WHERE organization_id=$1 AND idempotency_key=$2 FOR SHARE', [tenant.organizationId, input.idempotencyKey])).rows[0];
        if (existingKey) {
          if (existingKey.request_hash !== input.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
          if (!existingKey.scene_manifest) throw new Error('OPENMONTAGE_APPROVAL_INCOMPLETE');
          return { ...rowArtifact(existingKey), sceneManifest: validateTrainingSceneManifest(existingKey.scene_manifest) };
        }
        const row = (await client.query('SELECT artifact_id,artifact,status,scene_id,brief_id FROM openmontage_render_artifacts WHERE organization_id=$1 AND artifact_id=$2 FOR UPDATE', [tenant.organizationId, input.artifactId])).rows[0];
        if (!row) throw new Error('OPENMONTAGE_ARTIFACT_NOT_FOUND');
        const artifact = validateOpenMontageRenderArtifact(row.artifact);
        if (artifact.status !== 'REVIEW_REQUIRED') throw new Error('OPENMONTAGE_ARTIFACT_ALREADY_APPROVED');
        const sourceRowValue = sourceRow((await client.query('SELECT scene_manifest,brief FROM openmontage_scene_briefs WHERE organization_id=$1 AND brief_id=$2 AND scene_id=$3 FOR SHARE', [tenant.organizationId, row.brief_id, row.scene_id])).rows[0]);
        if (!sourceRowValue) throw new Error('OPENMONTAGE_BRIEF_NOT_FOUND');
        await verifyRenderVideo(client, tenant, artifact.video, sourceRowValue.brief);
        const approved = approveOpenMontageRenderArtifact(artifact, input.reviewerId, input.reviewRef.trim());
        const sceneManifest = createOpenMontageSceneManifest(sourceRowValue.sceneManifest, approved);
        await client.query(`UPDATE openmontage_render_artifacts SET artifact=$3::jsonb,status='APPROVED',scene_manifest=$4::jsonb,reviewer_id=$5,review_ref=$6,request_hash=$7,idempotency_key=$8,updated_at=now() WHERE organization_id=$1 AND artifact_id=$2`, [tenant.organizationId, input.artifactId, JSON.stringify(approved), JSON.stringify(sceneManifest), input.reviewerId, input.reviewRef.trim(), input.requestHash, input.idempotencyKey]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'OPENMONTAGE_RENDER_APPROVED','openmontage_render_artifact',$4,$5::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`, [`openmontage-approval:${input.artifactId}`, tenant.organizationId, tenant.actorId ?? input.reviewerId, input.artifactId, JSON.stringify({ reviewerId: input.reviewerId, reviewRef: input.reviewRef.trim(), sceneId: row.scene_id, videoAssetVersionId: approved.video.assetVersionId })]);
        return { artifactId: input.artifactId, artifact: approved, sceneManifest };
      });
    },

    async getApprovedScene(tenant, sceneId) {
      if (!idPattern.test(sceneId)) return null;
      return withTenantTransaction(pool, tenant, async client => {
        const row = (await client.query('SELECT scene_manifest FROM openmontage_render_artifacts WHERE organization_id=$1 AND scene_id=$2 AND status=\'APPROVED\' ORDER BY updated_at DESC,artifact_id DESC LIMIT 1', [tenant.organizationId, sceneId])).rows[0];
        if (!row) return null;
        const sceneManifest = validateTrainingSceneManifest(row.scene_manifest);
        return { sceneManifest, videoUrl: `/api/v1/openmontage/scenes/${encodeURIComponent(sceneId)}/video` };
      });
    },

    async video(tenant, sceneId) {
      if (!idPattern.test(sceneId)) return null;
      const result = await withTenantTransaction(pool, tenant, async client => {
        const row = (await client.query(`SELECT v.blob_key,v.content_type,v.sha256 FROM openmontage_render_artifacts o JOIN asset_versions v ON v.organization_id=o.organization_id AND v.asset_version_id=(o.artifact->'video'->>'assetVersionId') WHERE o.organization_id=$1 AND o.scene_id=$2 AND o.status='APPROVED' AND v.state='APPROVED' ORDER BY o.updated_at DESC,o.artifact_id DESC LIMIT 1`, [tenant.organizationId, sceneId])).rows[0];
        return row ? { blobKey: row.blob_key as string, contentType: row.content_type as string, sourceHash: row.sha256 as string } : null;
      });
      if (!result || !result.blobKey.startsWith(`${tenant.organizationId}/`)) return null;
      const object = await storage.readObject({ blobKey: result.blobKey, maxBytes: 128 * 1024 * 1024 });
      if (createHash('sha256').update(object.bytes).digest('hex') !== result.sourceHash) throw new Error('OPENMONTAGE_RENDER_CONTENT_MISMATCH');
      return { bytes: object.bytes, contentType: result.contentType };
    },
  };
}
