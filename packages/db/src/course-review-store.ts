import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CourseReviewDecisionRecord,
  CourseReviewSnapshot,
  CourseReviewStorePort,
  ReleaseManifestRecord,
  ReleaseArtifactPublisherPort,
  ReviewDecision,
  ReviewTargetType,
  TenantContext
} from "@medical-device/contracts";
import { CoursePublicationValidationError, validateCourseForPublication,validateModelExploration,validateLessonBrief,invalidateBriefArtifacts } from "@medical-device/simulation-schema";
import { validateBrowserModelManifest,validateSimulationModelActions } from "@medical-device/model-runtime";
import { withTenantTransaction } from "./tenant-transaction.js";
import { publishSimulationRuntime } from "./publish-runtime.js";
import {draftHistoryOperations} from './draft-history.js';
import {draftSimulationOperations} from './draft-simulation.js';
import { isCurrentLessonRenderManifest } from '@medical-device/contracts';
import { lessonFinalPublicationBindingError } from '@medical-device/simulation-schema';
import { lessonInstructionAuthors, type LessonAuthorHistoryRow } from './lesson-review-authors.js';

type JsonObject = Record<string, unknown>;

interface CourseVersionRow {
  course_version_id: string;
  revision: number;
  status: CourseReviewSnapshot["courseVersion"]["status"];
  content: JsonObject;
  created_by: string;
  release_manifest_id: string | null;
}

interface DecisionRow {
  decision_id: string;
  organization_id: string;
  course_version_id: string;
  target_type: ReviewTargetType;
  target_id: string;
  decision: ReviewDecision;
  rationale: string;
  actor_id: string;
  revision: number;
  created_at: Date | string;
}

interface ReleaseRow {
  release_id: string;
  organization_id: string;
  course_version_id: string;
  status: ReleaseManifestRecord["status"];
  manifest: JsonObject;
  release_hash: string;
  published_by: string;
  created_at: Date | string;
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const json = (value: unknown): string => JSON.stringify(value);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

export function bindModelVariants(manifest: JsonObject, modelVersionId: string, releaseBindingId: string): JsonObject {
  if (!text(modelVersionId) || !text(releaseBindingId)) throw new Error("MODEL_VARIANT_BINDING_INVALID");
  if (manifest.variants === undefined) return { ...manifest, modelVersionId, releaseBindingId };
  if (!Array.isArray(manifest.variants)) throw new Error("MODEL_VARIANT_BINDING_INVALID");
  const ids = new Set<string>();
  const variants = manifest.variants.map((item) => {
    const variant = object(item);
    const variantId = text(variant?.variantId);
    const sourceHash = text(variant?.sourceHash);
    const modelBlobKey = text(variant?.modelBlobKey);
    const manifestBlobKey = text(variant?.manifestBlobKey);
    if (!variantId || variantId === "full" || !/^[A-Za-z0-9._-]{1,64}$/.test(variantId) || ids.has(variantId) || !sourceHash || !/^[0-9a-f]{64}$/i.test(sourceHash) || !modelBlobKey || !manifestBlobKey) throw new Error("MODEL_VARIANT_BINDING_INVALID");
    ids.add(variantId);
    return { ...variant, variantId, modelVersionId, releaseBindingId, sourceHash, modelBlobKey, manifestBlobKey };
  });
  return { ...manifest, modelVersionId, releaseBindingId, variants };
}

export function bindReleaseModelManifest(manifest: JsonObject, modelVersionId: string, releaseBindingId: string, manifestHash: string): JsonObject {
  if (!text(modelVersionId) || !text(releaseBindingId) || !/^[0-9a-f]{64}$/i.test(manifestHash)) throw new Error("MODEL_RELEASE_MANIFEST_INVALID");
  const releaseCandidate = { ...manifest, modelVersionId, releaseBindingId, sourceHash: manifestHash };
  try { validateBrowserModelManifest(releaseCandidate); } catch { throw new Error("MODEL_RELEASE_MANIFEST_INVALID"); }
  return bindModelVariants(releaseCandidate, modelVersionId, releaseBindingId);
}

function decisionFromRow(row: DecisionRow): CourseReviewDecisionRecord {
  return {
    decisionId: row.decision_id,
    organizationId: row.organization_id,
    courseVersionId: row.course_version_id,
    targetType: row.target_type,
    targetId: row.target_id,
    decision: row.decision,
    rationale: row.rationale,
    actorId: row.actor_id,
    revision: row.revision,
    createdAt: iso(row.created_at)
  };
}

function releaseFromRow(row: ReleaseRow): ReleaseManifestRecord {
  return {
    releaseId: row.release_id,
    organizationId: row.organization_id,
    courseVersionId: row.course_version_id,
    status: row.status,
    releaseHash: row.release_hash,
    manifest: row.manifest,
    publishedBy: row.published_by,
    createdAt: iso(row.created_at)
  };
}

async function courseVersion(client: { query: Pool["query"] }, tenant: TenantContext, courseVersionId: string, lock = false): Promise<CourseVersionRow | null> {
  const result = await client.query<CourseVersionRow>(
    `SELECT course_version_id, revision, status, content, created_by, release_manifest_id
     FROM course_versions
     WHERE organization_id = $1 AND course_version_id = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [tenant.organizationId, courseVersionId]
  );
  return result.rows[0] ?? null;
}

export function createPostgresCourseReviewStore(pool: Pool, options: { releaseArtifacts?: ReleaseArtifactPublisherPort } = {}): CourseReviewStorePort {
  return {
    async getApprovedMediaForGeneration(tenant, assetVersionIds) {
      if (assetVersionIds.length > 128 || assetVersionIds.some(id=>!/^[A-Za-z0-9._:-]{1,128}$/.test(id))) throw new Error("MEDIA_REQUEST_INVALID");
      return withTenantTransaction(pool, tenant, async client => {
        const rows = (await client.query(`SELECT v.asset_version_id,v.source_type,v.content_type FROM asset_versions v
          JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id
          WHERE v.organization_id=$1 AND v.asset_version_id=ANY($2::text[]) AND v.state='APPROVED' AND a.status='APPROVED'
          AND ((v.source_type='image' AND v.content_type IN ('image/png','image/jpeg','image/webp')) OR (v.source_type='video' AND v.content_type IN ('video/mp4','video/webm')))
          ORDER BY v.asset_version_id`, [tenant.organizationId, assetVersionIds])).rows;
        return rows.map(row=>({assetVersionId:row.asset_version_id,sourceType:row.source_type,contentType:row.content_type}));
      });
    },
    ...draftSimulationOperations(pool),
    ...draftHistoryOperations(pool),
    async createRevision({tenant,courseVersionId,reason,idempotencyKey}) {
      if(!tenant.actorId||![courseVersionId,idempotencyKey].every(value=>/^[A-Za-z0-9._:-]{1,128}$/.test(value))||!text(reason)||reason.length>2000)throw Error('COURSE_DRAFT_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const eventId='revision:'+hash([tenant.organizationId,tenant.actorId,idempotencyKey]),signature=hash([courseVersionId,reason]);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[eventId]);
        const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,eventId])).rows[0];
        if(prior){if(prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return prior.details.result;}
        const source=(await client.query(`SELECT v.*,r.release_id,r.release_hash,r.manifest FROM course_versions v JOIN release_manifests r ON r.organization_id=v.organization_id AND r.course_version_id=v.course_version_id
          WHERE v.organization_id=$1 AND v.course_version_id=$2 AND v.status='PUBLISHED' AND r.status='PUBLISHED'`,[tenant.organizationId,courseVersionId])).rows[0];
        if(!source)throw Error('COURSE_VERSION_NOT_FOUND');
        await client.query(`SELECT course_id FROM courses WHERE organization_id=$1 AND course_id=$2 FOR UPDATE`,[tenant.organizationId,source.course_id]);
        const versions=(await client.query(`SELECT revision,status FROM course_versions WHERE organization_id=$1 AND course_id=$2`,[tenant.organizationId,source.course_id])).rows;
        if(versions.some(row=>['DRAFT','IN_REVIEW'].includes(row.status)))throw Error('COURSE_REVISION_ALREADY_OPEN');
        if(versions.some(row=>row.revision>source.revision))throw Error('COURSE_REVISION_SOURCE_STALE');
        const content=structuredClone(source.content);
        delete content.runtimeBindings;
        delete content.releaseChange;
        const inheritedAiRunId=source.manifest.aiRun?.aiRunId;
        content._lineage={sourceCourseVersionId:courseVersionId,sourceReleaseId:source.release_id,sourceReleaseHash:source.release_hash,inheritedAiRunId:inheritedAiRunId??null,reason:reason.trim()};
        if(inheritedAiRunId)content._source={aiRunId:inheritedAiRunId};
        if(content.policy)content.policy.version=(content.policy.version??0)+1;
        if(content.simulation?.definition)content.simulation.definition.version=(content.simulation.definition.version??0)+1;
        for(const module of content.modules??[])for(const activity of module.activities??[])if(activity.assessment)activity.assessment.version=(activity.assessment.version??0)+1;
        const nextId=`course-version:${randomUUID()}`,revision=Math.max(...versions.map(row=>row.revision))+1;
        await client.query(`INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,'DRAFT',$6,now(),now())`,[nextId,source.course_id,tenant.organizationId,revision,json(content),tenant.actorId]);
        const result={courseId:source.course_id,courseVersionId:nextId};
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'COURSE_REVISION_CREATED','course_version',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,nextId,json({signature,result,sourceCourseVersionId:courseVersionId,sourceReleaseId:source.release_id,reason:reason.trim(),revision})]);
        return result;
      });
    },
    async createDraft({ tenant, title, idempotencyKey }) {
      title = title.trim();
      if (!tenant.actorId || !title || title.length > 240 || !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) throw new Error("COURSE_DRAFT_INVALID");
      return withTenantTransaction(pool, tenant, async client => {
        const courseId = `course:${randomUUID()}`;
        const courseVersionId = `${courseId}:v1`;
        const requestHash = hash({ title });
        const inserted = await client.query(
          `INSERT INTO courses (course_id, organization_id, name, status, created_by, creation_key, creation_hash, created_at, updated_at)
           VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT (organization_id, created_by, creation_key) WHERE creation_key IS NOT NULL DO NOTHING RETURNING course_id`,
          [courseId, tenant.organizationId, title, tenant.actorId, idempotencyKey, requestHash]
        );
        if (!inserted.rowCount) {
          const existing = await client.query(`SELECT course_id, creation_hash FROM courses WHERE organization_id=$1 AND created_by=$2 AND creation_key=$3`, [tenant.organizationId, tenant.actorId, idempotencyKey]);
          const row = existing.rows[0];
          if (!row || row.creation_hash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          return { courseId: row.course_id, courseVersionId: `${row.course_id}:v1` };
        }
        await client.query(
          `INSERT INTO course_versions (course_version_id, course_id, organization_id, revision, content, status, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,1,$4::jsonb,'DRAFT',$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          [courseVersionId, courseId, tenant.organizationId, json({ schemaVersion: "course-draft.v1", title, modules: [], citations: [] }), tenant.actorId]
        );
        await client.query(
          `INSERT INTO audit_events (audit_event_id, organization_id, actor_id, event_type, resource_type, resource_id, details, created_at)
           VALUES ($1,$2,$3,'COURSE_CREATED','course_version',$4,$5::jsonb,CURRENT_TIMESTAMP)`,
          [`audit:${randomUUID()}`, tenant.organizationId, tenant.actorId, courseVersionId, json({ courseId, revision: 1 })]
        );
        return { courseId, courseVersionId };
      });
    },

    async listDrafts(tenant, after) {
      return withTenantTransaction(pool, tenant, async client => {
        const result = await client.query(
          `SELECT course_version_id, content->>'title' AS title, revision, status FROM course_versions
           WHERE organization_id=$1 AND ($2::text IS NULL OR course_version_id > $2)
           ORDER BY course_version_id LIMIT 51`, [tenant.organizationId, after ?? null]
        );
        const items = result.rows.slice(0, 50).map(row => ({ courseVersionId: row.course_version_id, title: row.title ?? "Untitled course", revision: row.revision, status: row.status }));
        return { items, ...(result.rows.length > 50 ? { nextCursor: items[49].courseVersionId } : {}) };
      });
    },

    async saveDraft({ tenant, courseVersionId, revision, content }) {
      if (!tenant.actorId || !Number.isSafeInteger(revision) || revision < 1 || !object(content) || content.schemaVersion !== "course-draft.v1" || !text(content.title)) throw new Error("COURSE_DRAFT_INVALID");
      if (content.lessonBrief !== undefined && !validateLessonBrief(content.lessonBrief).valid) throw new Error('LESSON_BRIEF_INVALID');
      return withTenantTransaction(pool, tenant, async (client) => {
        const version = await courseVersion(client, tenant, courseVersionId, true);
        if (!version) return null;
        if (version.status === "PUBLISHED" || version.status === "RETIRED") throw new Error("COURSE_VERSION_IMMUTABLE");
        if (version.revision !== revision) throw new Error("COURSE_VERSION_STALE");
        // Provenance belongs to the saved source, never to a browser-supplied field.
        const { _source: ignoredSource, _lineage: ignoredLineage, ...editable } = content;
        const next = invalidateBriefArtifacts(version.content, { ...editable, ...(version.content._source ? { _source: version.content._source } : {}),...(version.content._lineage?{_lineage:version.content._lineage}:{}) });
        if (hash(next) === hash(version.content)) return { revision };
        await client.query(
          `INSERT INTO audit_events (audit_event_id, organization_id, actor_id, event_type, resource_type, resource_id, details, created_at)
           VALUES ($1, $2, $3, 'COURSE_DRAFT_EDITED', 'course_version', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [`audit:${randomUUID()}`, tenant.organizationId, tenant.actorId, courseVersionId, json({ revision, nextRevision: revision + 1, before: version.content, after: next })]
        );
        await client.query(
          `UPDATE course_versions SET content = $3::jsonb, revision = revision + 1, status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND course_version_id = $2`,
          [tenant.organizationId, courseVersionId, json(next)]
        );
        return { revision: revision + 1 };
      });
    },

    async saveGeneratedDraft({ tenant, courseVersionId, revision, aiRunId, content }) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("COURSE_VERSION_STALE");
      return withTenantTransaction(pool, tenant, async (client) => {
        const previous = await courseVersion(client, tenant, courseVersionId, true);
        if (!previous || previous.revision !== revision || !["DRAFT", "IN_REVIEW"].includes(previous.status)) return false;
        const {_lineage: ignoredLineage,...generated}=content;
        const next={...generated,_source:{aiRunId},...(previous.content._lineage?{_lineage:previous.content._lineage}:{})};
        const result = await client.query(
          `UPDATE course_versions
           SET content = $3::jsonb, revision = revision + 1,
               status = CASE WHEN status = 'DRAFT' THEN 'IN_REVIEW' ELSE status END,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND course_version_id = $2 AND revision = $4 AND status IN ('DRAFT', 'IN_REVIEW')`,
          [tenant.organizationId, courseVersionId, json(next), revision]
        );
        await client.query(
          `INSERT INTO audit_events (audit_event_id, organization_id, actor_id, event_type, resource_type, resource_id, details, created_at)
           VALUES ($1, $2, $3, 'COURSE_DRAFT_GENERATED', 'course_version', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [`audit:${randomUUID()}`, tenant.organizationId, tenant.actorId ?? "unknown", courseVersionId, json({ revision, nextRevision: revision + 1, aiRunId, before: previous.content, after: next })]
        );
        return result.rowCount === 1;
      });
    },

    async get(tenant, courseVersionId) {
      return withTenantTransaction(pool, tenant, async (client) => {
        const version = await courseVersion(client, tenant, courseVersionId);
        if (!version) return null;
        const decisions = await client.query<DecisionRow>(
          `SELECT decision_id, organization_id, course_version_id, target_type, target_id,
                  decision, rationale, actor_id, revision, created_at
           FROM course_review_decisions
           WHERE organization_id = $1 AND course_version_id = $2
           ORDER BY created_at, decision_id`,
          [tenant.organizationId, courseVersionId]
        );
        const release = await client.query<ReleaseRow>(
          `SELECT release_id, organization_id, course_version_id, status, manifest, release_hash, published_by, created_at
           FROM release_manifests
           WHERE organization_id = $1 AND course_version_id = $2`,
          [tenant.organizationId, courseVersionId]
        );
        return {
          courseVersion: {
            courseVersionId: version.course_version_id,
            revision: version.revision,
            status: version.status,
            content: version.content,
            createdBy: version.created_by,
            ...(version.release_manifest_id ? { releaseManifestId: version.release_manifest_id } : {})
          },
          decisions: decisions.rows.map(decisionFromRow),
          ...(release.rows[0] ? { release: releaseFromRow(release.rows[0]) } : {})
        };
      });
    },

    async recordDecision(input) {
      const rationale = input.rationale.trim();
      if (!rationale || rationale.length > 4_000) throw new Error("REVIEW_RATIONALE_INVALID");
      return withTenantTransaction(pool, input.tenant, async (client) => {
        const existing = await client.query<DecisionRow & { request_hash: string }>(
          `SELECT decision_id, organization_id, course_version_id, target_type, target_id,
                  decision, rationale, actor_id, revision, created_at, request_hash
           FROM course_review_decisions
           WHERE organization_id = $1 AND idempotency_key = $2`,
          [input.tenant.organizationId, input.idempotencyKey]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_hash !== input.requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          return decisionFromRow(existing.rows[0]);
        }
        const version = await courseVersion(client, input.tenant, input.courseVersionId, true);
        if (!version) return null;
        if (version.status === "PUBLISHED" || version.status === "RETIRED") throw new Error("COURSE_VERSION_IMMUTABLE");
        if (version.revision !== input.revision) throw new Error("COURSE_VERSION_STALE");
        const decisionId = `review:${randomUUID()}`;
        const result = await client.query<DecisionRow>(
          `INSERT INTO course_review_decisions (
             decision_id, organization_id, course_version_id, target_type, target_id,
             decision, rationale, actor_id, revision, idempotency_key, request_hash, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
           RETURNING decision_id, organization_id, course_version_id, target_type, target_id,
                     decision, rationale, actor_id, revision, created_at`,
          [decisionId, input.tenant.organizationId, input.courseVersionId, input.targetType, input.targetId, input.decision, rationale, input.tenant.actorId ?? "unknown", input.revision, input.idempotencyKey, input.requestHash]
        );
        await client.query(
          `INSERT INTO audit_events (audit_event_id, organization_id, actor_id, event_type, resource_type, resource_id, details, created_at)
           VALUES ($1, $2, $3, 'COURSE_REVIEW_DECISION', 'course_version', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [`audit:${randomUUID()}`, input.tenant.organizationId, input.tenant.actorId ?? "unknown", input.courseVersionId, json({ targetType: input.targetType, targetId: input.targetId, decision: input.decision, revision: input.revision })]
        );
        await client.query(
          `UPDATE course_versions SET status = 'IN_REVIEW', updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND course_version_id = $2 AND status = 'DRAFT'`,
          [input.tenant.organizationId, input.courseVersionId]
        );
        return decisionFromRow(result.rows[0]);
      });
    },

    async publish(input) {
      return withTenantTransaction(pool, input.tenant, async (client) => {
        // Lock before source/version rows; withdrawal takes the same order, avoiding publication deadlocks.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[input.tenant.organizationId]);
        const existingKey = await client.query<ReleaseRow & { request_hash: string }>(
          `SELECT release_id, organization_id, course_version_id, status, manifest, release_hash, published_by, created_at, request_hash
           FROM release_manifests WHERE organization_id = $1 AND idempotency_key = $2`,
          [input.tenant.organizationId, input.idempotencyKey]
        );
        if (existingKey.rows[0]) {
          if (existingKey.rows[0].request_hash !== input.requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          return releaseFromRow(existingKey.rows[0]);
        }
        const version = await courseVersion(client, input.tenant, input.courseVersionId, true);
        if (!version) return null;
        if (!options.releaseArtifacts) throw new Error("RELEASE_ARTIFACT_PUBLISHER_REQUIRED");
        const existingRelease = await client.query<ReleaseRow>(
          `SELECT release_id, organization_id, course_version_id, status, manifest, release_hash, published_by, created_at
           FROM release_manifests WHERE organization_id = $1 AND course_version_id = $2`,
          [input.tenant.organizationId, input.courseVersionId]
        );
        if (existingRelease.rows[0]) return releaseFromRow(existingRelease.rows[0]);
        if (version.status !== "IN_REVIEW") throw new Error("COURSE_NOT_PUBLISHABLE");
        const decisions = await client.query<DecisionRow>(
          `SELECT decision_id, organization_id, course_version_id, target_type, target_id,
                  decision, rationale, actor_id, revision, created_at
           FROM course_review_decisions
           WHERE organization_id = $1 AND course_version_id = $2 AND revision = $3
           ORDER BY created_at DESC, decision_id DESC`,
          [input.tenant.organizationId, input.courseVersionId, version.revision]
        );
        const latest = new Map<string, DecisionRow>();
        for (const decision of decisions.rows) {
          const key=`${decision.target_type}:${decision.target_id}`;
          if (!latest.has(key)) latest.set(key, decision);
        }
        const courseApproval = [...latest.values()].find((item) => item.target_type === "COURSE" && item.target_id === input.courseVersionId);
        const aiApproval = [...latest.values()].find((item) => item.target_type === "AI_DRAFT" && item.decision === "APPROVE");
        const sourceArtifactIds = Array.isArray(version.content.sourceArtifactIds)
          ? version.content.sourceArtifactIds.filter((item): item is string => typeof item === "string")
          : [];
        const aiRun = await client.query<{ ai_run_id: string; source_artifact_ids: string[]; prompt_version: string; output_schema_version: string; provider: string; deployment: string; model: string; api_version: string; warnings: unknown }>(
          `SELECT ai_run_id, source_artifact_ids, prompt_version, output_schema_version, provider, deployment, model, api_version, warnings
           FROM ai_runs WHERE organization_id = $1 AND (course_version_id = $2 OR ai_run_id=$3) AND status = 'DRAFT'
           ORDER BY (course_version_id=$2) DESC,created_at DESC LIMIT 1`,
          [input.tenant.organizationId, input.courseVersionId,object(version.content._lineage)?.inheritedAiRunId??null]
        );
        if (!courseApproval || courseApproval.decision !== "APPROVE" || !aiApproval || !aiRun.rows[0] || aiApproval.target_id !== aiRun.rows[0].ai_run_id) throw new Error("COURSE_REVIEW_REQUIRED");
        if (courseApproval.actor_id === version.created_by) throw new Error("ROLE_SEPARATION_REQUIRED");
        const mediaSourceIds=(Array.isArray(version.content.modules)?version.content.modules:[]).flatMap(module=>{
          const activities=object(module)?.activities;
          return (Array.isArray(activities)?activities:[]).flatMap(activity=>{
            const value=object(activity);const id=text(object(value?.media)?.assetVersionId);
            return value&&['image','video'].includes(String(value.type))&&id?[id]:[];
          });
        });
        const videoLessonMediaIds=(Array.isArray(version.content.videoLessons)?version.content.videoLessons:[]).flatMap(lesson=>{
          const scenes=object(lesson)?.scenes;
          return [...(text(object(object(lesson)?.finalReview)?.assetVersionId)?[String(object(object(lesson)?.finalReview)?.assetVersionId)]:[]),...(Array.isArray(scenes)?scenes:[]).flatMap(scene=>{
            const visual=object(scene)?.visual;const id=text(object(visual)?.assetVersionId);return id?[id]:[];
          })];
        });
        const combinedSourceIds = [...new Set([...sourceArtifactIds, ...(aiRun.rows[0]?.source_artifact_ids ?? []),...mediaSourceIds,...videoLessonMediaIds])];
        const sources = combinedSourceIds.length === 0 ? [] : (await client.query<{ asset_version_id: string; sha256: string; state: string; source_type:string; content_type:string }>(
          `SELECT asset_version_id, sha256, state, source_type, content_type FROM asset_versions
           WHERE organization_id = $1 AND asset_version_id = ANY($2::text[]) FOR SHARE`,
          [input.tenant.organizationId, combinedSourceIds]
        )).rows;
        if (sources.length !== combinedSourceIds.length || sources.some((source) => source.state !== "APPROVED")) throw new Error("SOURCE_ARTIFACT_NOT_APPROVED");
        const lessonAuthorHistory = Array.isArray(version.content.videoLessons) && version.content.videoLessons.length ? (await client.query<LessonAuthorHistoryRow>(
          `WITH RECURSIVE ancestry AS (
             SELECT course_version_id, content, created_by FROM course_versions WHERE organization_id=$1 AND course_version_id=$2
             UNION
             SELECT parent.course_version_id, parent.content, parent.created_by FROM course_versions parent
             JOIN ancestry child ON parent.course_version_id=child.content #>> '{_lineage,sourceCourseVersionId}'
             WHERE parent.organization_id=$1
           )
           SELECT ancestry.created_by, audit.actor_id, audit.details FROM ancestry
           LEFT JOIN audit_events audit ON audit.organization_id=$1 AND audit.resource_type='course_version' AND audit.resource_id=ancestry.course_version_id
             AND jsonb_typeof(audit.details->'before')='object' AND jsonb_typeof(audit.details->'after')='object'`,
          [input.tenant.organizationId, input.courseVersionId]
        )).rows : [];
        for (const item of Array.isArray(version.content.videoLessons)?version.content.videoLessons:[]) {
          const lesson=object(item), review=object(lesson?.finalReview), artifact=object(lesson?.renderArtifact);
          const media=sources.find(source=>source.asset_version_id===review?.assetVersionId);
          const approval=latest.get(`VIDEO_LESSON:${lesson?.lessonId}`);
          if (!lesson || !isCurrentLessonRenderManifest(artifact,lesson)) throw new Error('LESSON_FINAL_RENDER_STALE');
          const bindingError=lessonFinalPublicationBindingError(lesson,{media:media?{assetVersionId:media.asset_version_id,sha256:media.sha256,sourceType:media.source_type,state:media.state}:undefined,approval:approval?{decision:approval.decision,actorId:approval.actor_id,revision:approval.revision}:undefined,authorId:version.created_by,authorIds:lessonInstructionAuthors(lesson,lessonAuthorHistory),revision:version.revision});
          if(bindingError)throw new Error(bindingError);
        }
        const publicationValidation = validateCourseForPublication({
          course: version.content,
          approvedSourceArtifactIds: sources.map((source) => source.asset_version_id),
          approvedMediaAssets:sources.map(source=>({assetVersionId:source.asset_version_id,sourceType:source.source_type,contentType:source.content_type})),
          approvedReviewTargets: [...latest.values()].filter((decision) => decision.decision === "APPROVE").map((decision) => `${decision.target_type}:${decision.target_id}`),
          aiWarnings: Array.isArray(aiRun.rows[0].warnings) ? aiRun.rows[0].warnings.filter((warning): warning is { code: string; severity: "info" | "warning" | "error"; message?: string } => Boolean(warning) && typeof warning === "object" && typeof (warning as { code?: unknown }).code === "string" && ["info", "warning", "error"].includes(String((warning as { severity?: unknown }).severity))) : []
        });
        if (!publicationValidation.valid) throw new CoursePublicationValidationError(publicationValidation.findings);
        const releaseId = `release:${randomUUID()}`;
        const sourceModel = object(object(version.content)?.model);
        const modelVersionId = text(sourceModel?.modelVersionId);
        const manifestHash = text(sourceModel?.manifestHash);
        let releaseContent = version.content;
        let releaseModelBinding: { modelVersionId: string; manifestHash: string; releaseBindingId: string; modelBlobKey: string; manifestBlobKey: string; manifest: JsonObject } | null = null;
        if (modelVersionId || manifestHash) {
          if (!modelVersionId || !manifestHash || !/^[0-9a-f]{64}$/i.test(manifestHash)) throw new Error("MODEL_RELEASE_BINDING_INVALID");
          const model = await client.query<{ model_version_id: string; blob_key: string; manifest_blob_key: string | null; manifest: unknown }>(
            `SELECT model_version_id, blob_key, manifest_blob_key, manifest
             FROM model_versions
             WHERE organization_id = $1 AND model_version_id = $2 AND status = 'APPROVED' FOR SHARE`,
            [input.tenant.organizationId, modelVersionId]
          );
          const modelRow = model.rows[0];
          const sourceManifest = object(modelRow?.manifest);
          const sourceHash = text(sourceManifest?.sourceHash);
          if (!modelRow || !modelRow.manifest_blob_key || !sourceManifest || sourceHash !== manifestHash) throw new Error("MODEL_RELEASE_ASSET_NOT_APPROVED");
          const releaseBindingId = `releasebind:${releaseId}:${modelVersionId}`;
          const boundManifest = bindReleaseModelManifest(sourceManifest, modelVersionId, releaseBindingId, manifestHash);
          if(object(version.content.simulation)?.definition){
            const modelFindings=validateSimulationModelActions(object(version.content.simulation)!.definition,{modelVersionId,manifestHash,manifest:boundManifest});
            if(modelFindings.length)throw new CoursePublicationValidationError(modelFindings);
          }
          const approvedComponents=(Array.isArray(boundManifest.components)?boundManifest.components:[]).map(c=>String(object(c)?.componentId??''));
          for(const [mi,module] of (Array.isArray(version.content.modules)?version.content.modules:[]).entries()){
            const activities=object(module)?.activities;
            for(const [ai,activity] of (Array.isArray(activities)?activities:[]).entries()){
              const value=object(activity);if(!value||!['3d_viewer','hotspot'].includes(String(value.type)))continue;
              const report=validateModelExploration(value.type,value.exploration,approvedComponents);
              if(!report.valid)throw new CoursePublicationValidationError(report.findings.map(f=>({...f,severity:'error' as const,path:`course.modules[${mi}].activities[${ai}].exploration`})));
            }
          }
          const materialized = await options.releaseArtifacts.materializeModelArtifacts({
            organizationId: input.tenant.organizationId,
            releaseId,
            modelVersionId,
            releaseBindingId,
            modelBlobKey: modelRow.blob_key,
            manifestBlobKey: modelRow.manifest_blob_key,
            manifest: boundManifest
          });
          releaseModelBinding = {
            modelVersionId,
            manifestHash,
            releaseBindingId,
            modelBlobKey: materialized.modelBlobKey,
            manifestBlobKey: materialized.manifestBlobKey,
            manifest: materialized.manifest
          };
          releaseContent = {
            ...version.content,
            model: { ...sourceModel, modelVersionId, manifestHash, releaseBindingId, manifest: materialized.manifest }
          };
        }
        releaseContent = await publishSimulationRuntime(client,input.tenant,input.courseVersionId,releaseId,releaseContent);
        const releaseManifestBlobKey = options.releaseArtifacts.releaseManifestBlobKey({ organizationId: input.tenant.organizationId, releaseId });
        const manifest = {
          schemaVersion: "release-manifest.v1",
          courseVersionId: input.courseVersionId,
          revision: version.revision,
          content: releaseContent,
          sourceArtifacts: sources.map((source) => ({ assetVersionId: source.asset_version_id, sha256: source.sha256 })),
          aiRun: aiRun.rows[0] ? {
            aiRunId: aiRun.rows[0].ai_run_id,
            provider: aiRun.rows[0].provider,
            deployment: aiRun.rows[0].deployment,
            model: aiRun.rows[0].model,
            apiVersion: aiRun.rows[0].api_version,
            promptVersion: aiRun.rows[0].prompt_version,
            outputSchemaVersion: aiRun.rows[0].output_schema_version
          } : null,
          reviewDecisions: decisions.rows.map(decisionFromRow),
          releaseArtifact: { manifestBlobKey: releaseManifestBlobKey }
        } satisfies JsonObject;
        const releaseHash = hash(manifest);
        await options.releaseArtifacts.materializeReleaseManifest({ blobKey: releaseManifestBlobKey, manifest, releaseHash });
        const inserted = await client.query<ReleaseRow>(
          `INSERT INTO release_manifests (
             release_id, organization_id, course_version_id, status, manifest, release_hash,
             published_by, idempotency_key, request_hash, created_at
           ) VALUES ($1, $2, $3, 'PUBLISHED', $4::jsonb, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           RETURNING release_id, organization_id, course_version_id, status, manifest, release_hash, published_by, created_at`,
          [releaseId, input.tenant.organizationId, input.courseVersionId, json(manifest), releaseHash, input.tenant.actorId ?? "unknown", input.idempotencyKey, input.requestHash]
        );
        if (releaseModelBinding) {
          await client.query(
            `INSERT INTO release_model_bindings (
               release_model_binding_id, organization_id, release_id, model_version_id,
               release_binding_id, manifest_hash, model_blob_key, manifest_blob_key, manifest, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, CURRENT_TIMESTAMP)`,
            [
              `release-model:${randomUUID()}`,
              input.tenant.organizationId,
              releaseId,
              releaseModelBinding.modelVersionId,
              releaseModelBinding.releaseBindingId,
              releaseModelBinding.manifestHash,
              releaseModelBinding.modelBlobKey,
              releaseModelBinding.manifestBlobKey,
              json(releaseModelBinding.manifest)
            ]
          );
        }
        await client.query(
          `UPDATE course_versions SET status = 'PUBLISHED', release_manifest_id = $3, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND course_version_id = $2`,
          [input.tenant.organizationId, input.courseVersionId, releaseId]
        );
        await client.query(
          `UPDATE courses SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND course_id = (SELECT course_id FROM course_versions WHERE course_version_id = $2)`,
          [input.tenant.organizationId, input.courseVersionId]
        );
        await client.query(
          `INSERT INTO outbox_events (outbox_event_id, organization_id, event_type, deduplication_key, payload, state, available_at, created_at, updated_at)
           VALUES ($1, $2, 'course.release.published', $3, $4::jsonb, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [`outbox:${randomUUID()}`, input.tenant.organizationId, `course.release.published:${releaseId}`, json({ releaseId, courseVersionId: input.courseVersionId, releaseHash,...(version.content._lineage?{sourceReleaseId:object(version.content._lineage)?.sourceReleaseId,releaseChange:version.content.releaseChange,changeApplicationRequested:true}:{}) })]
        );
        await client.query(
          `INSERT INTO audit_events (audit_event_id, organization_id, actor_id, event_type, resource_type, resource_id, details, created_at)
           VALUES ($1, $2, $3, 'COURSE_RELEASE_PUBLISHED', 'release_manifest', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [`audit:${randomUUID()}`, input.tenant.organizationId, input.tenant.actorId ?? "unknown", releaseId, json({ courseVersionId: input.courseVersionId, releaseHash })]
        );
        if(version.content._lineage)await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
          VALUES($1,$2,'course.change.notify',$3,$4::jsonb,'PENDING',now(),now(),now())`,[`outbox:${randomUUID()}`,input.tenant.organizationId,`course.change.notify:${releaseId}`,json({releaseId,releaseHash})]);
        const change=object(version.content.releaseChange);
        if(version.content._lineage&&['full_retake','supersede_on_completion','update_modules'].includes(String(change?.decision)))await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
          VALUES($1,$2,'course.change.assign',$3,$4::jsonb,'PENDING',$5,now(),now())`,[`outbox:${randomUUID()}`,input.tenant.organizationId,`course.change.assign:${releaseId}`,json({releaseId,releaseHash}),change?.effectiveAt]);
        return releaseFromRow(inserted.rows[0]);
      });
    }
  };
}
