import {resolvePublishedExploration} from './model-exploration.js';
import {resolvePublishedMediaAsset} from './media-asset-service.js';
import {assertStoryActivityAccess} from '@medical-device/db';
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { withTenantTransaction,assignEnrollmentInTransaction } from "@medical-device/db";
import { enrollmentEligibility } from "./certification-eligibility.js";
import { contentAcknowledgements } from './content-progress.js';
import { issueCredentialInTransaction } from './credential-service.js';

export interface EnrollmentService {
  inspect?(tenant:TenantContext,enrollmentId:string,activityId:string):Promise<unknown>;
  acknowledge(tenant: TenantContext, enrollmentId: string, activityId: string): Promise<unknown>;
  options(tenant: TenantContext, kind: "members" | "releases", after?: string): Promise<unknown>;
  assign(tenant: TenantContext, learnerId: string, releaseId: string): Promise<unknown>;
  list(tenant: TenantContext, after?: string): Promise<unknown>;
  get(tenant: TenantContext, enrollmentId: string): Promise<unknown>;
}
type Row = Record<string, any>;
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
function summary(row: Row) {
  return { enrollmentId: row.enrollment_id, releaseId: row.release_id, courseVersionId: row.course_version_id,
    title: text(row.manifest?.content?.title), status: row.status };
}
// Explicit projection: release manifests contain private assessment keys and simulation rules.
function learnerContent(content: Row) {
  return { title: text(content.title), hasStory: content.story!==undefined, modules: (Array.isArray(content.modules) ? content.modules : []).map((module: Row) => ({
    moduleId: text(module.moduleId), title: text(module.title),
    activities: (Array.isArray(module.activities) ? module.activities : []).map((activity: Row) => ({
      activityId: text(activity.activityId), type: text(activity.type), title: text(activity.title),
      instructions: text(activity.instructions),
      ...(["text", "rich_text"].includes(activity.type) ? { text: text(activity.text) } : {})
    }))
  })) };
}
const joined = `SELECT e.enrollment_id,e.course_version_id,e.status,r.release_id,r.release_hash,r.manifest
  FROM enrollments e JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
  WHERE e.organization_id=$1 AND e.learner_id=$2 AND e.status='ACTIVE' AND r.status='PUBLISHED'`;

export function createPostgresEnrollmentService(pool: Pool): EnrollmentService {
  return {
    async inspect(tenant,enrollmentId,activityId){
      if(!tenant.actorId||!identifier(enrollmentId)||!identifier(activityId))throw Error('EXPLORATION_NOT_FOUND');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`${joined} AND e.enrollment_id=$3 FOR SHARE OF e,r`,[tenant.organizationId,tenant.actorId,enrollmentId]);
        if(result.rows.length!==1)throw Error('EXPLORATION_NOT_FOUND');
        const row=result.rows[0],content=row.manifest?.content??{};
        const activities=(content.modules??[]).flatMap((m:Row)=>m.activities??[]).filter((a:Row)=>a.activityId===activityId);
        if(activities.length!==1)throw Error('EXPLORATION_NOT_FOUND');
        await assertStoryActivityAccess(client,tenant,enrollmentId,row.release_id,activityId);
        return resolvePublishedExploration(client,tenant,row.release_id,content,activities[0]);
      });
    },
    async acknowledge(tenant,enrollmentId,activityId) {
      if(!tenant.actorId || !identifier(enrollmentId) || !identifier(activityId))throw new Error('ENROLLMENT_NOT_FOUND');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`${joined} AND e.enrollment_id=$3 FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,tenant.actorId,enrollmentId]);
        const row=result.rows[0];if(!row)throw new Error('ENROLLMENT_NOT_FOUND');
        await assertStoryActivityAccess(client,tenant,enrollmentId,row.release_id,activityId);
        const content=row.manifest?.content??{};
        const activities=(content.modules??[]).flatMap((module:Row)=>module.activities??[]).filter((activity:Row)=>activity.activityId===activityId);
        if(activities.length!==1 || !['text','rich_text','image','video','3d_viewer','hotspot'].includes(activities[0].type))throw new Error('ENROLLMENT_NOT_FOUND');
        if(['image','video'].includes(activities[0].type))await resolvePublishedMediaAsset(client,tenant,row.manifest,activities[0]);
        if(['3d_viewer','hotspot'].includes(activities[0].type))await resolvePublishedExploration(client,tenant,row.release_id,content,activities[0]);
        const eventId='content:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,enrollmentId,row.release_id,activityId])).digest('hex');
        await client.query(`INSERT INTO progress_events(progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at)
          VALUES($1,$2,$3,$4,'content.acknowledged',$5::jsonb,now()) ON CONFLICT(progress_event_id) DO NOTHING`,
          [eventId,tenant.organizationId,enrollmentId,tenant.actorId,JSON.stringify({activityId,releaseId:row.release_id,releaseHash:row.release_hash,policyId:content.policy?.policyId??null,policyVersion:content.policy?.version??null})]);
        await issueCredentialInTransaction(client,tenant,enrollmentId,true);
        return {activityId,status:'ACKNOWLEDGED'};
      });
    },
    async options(tenant, kind, after) {
      if (!tenant.actorId || !["members","releases"].includes(kind) || (after !== undefined && (!after.length || after.length > (kind === "members" ? 256 : 128)))) throw new Error("ENROLLMENT_REQUEST_INVALID");
      return withTenantTransaction(pool,tenant,async client => {
        const result = kind === "members"
          ? await client.query(`SELECT subject FROM organization_memberships WHERE organization_id=$1 AND status='ACTIVE' AND ($2::text IS NULL OR subject>$2) ORDER BY subject LIMIT 51`,[tenant.organizationId,after ?? null])
          : await client.query(`SELECT release_id,course_version_id,manifest->'content'->>'title' AS title FROM release_manifests WHERE organization_id=$1 AND status='PUBLISHED' AND ($2::text IS NULL OR release_id>$2) ORDER BY release_id LIMIT 51`,[tenant.organizationId,after ?? null]);
        const rows = result.rows.slice(0,50);
        const items = rows.map(row => kind === "members" ? {learnerId:row.subject} : {releaseId:row.release_id,courseVersionId:row.course_version_id,title:text(row.title)});
        return { items, nextCursor: result.rows.length > 50 ? kind === "members" ? rows[49].subject : rows[49].release_id : null };
      });
    },
    async assign(tenant, learnerId, releaseId) {
      if (!tenant.actorId || typeof learnerId !== "string" || !learnerId.trim() || learnerId.length > 256 || !identifier(releaseId)) throw new Error("ENROLLMENT_REQUEST_INVALID");
      return withTenantTransaction(pool, tenant, async client => {
        return assignEnrollmentInTransaction(client,tenant,learnerId,releaseId);
      });
    },
    async list(tenant, after) {
      if (!tenant.actorId || (after !== undefined && !identifier(after))) throw new Error("ENROLLMENT_REQUEST_INVALID");
      return withTenantTransaction(pool,tenant,async client => {
        const result = await client.query(`${joined} AND ($3::text IS NULL OR e.enrollment_id>$3) ORDER BY e.enrollment_id LIMIT 51`,[tenant.organizationId,tenant.actorId,after ?? null]);
        const rows = result.rows.slice(0,50);
        return { items: rows.map(summary), nextCursor: result.rows.length > 50 ? rows[49].enrollment_id : null };
      });
    },
    async get(tenant, enrollmentId) {
      if (!tenant.actorId || !identifier(enrollmentId)) throw new Error("ENROLLMENT_NOT_FOUND");
      return withTenantTransaction(pool,tenant,async client => {
        const result = await client.query(`${joined} AND e.enrollment_id=$3`,[tenant.organizationId,tenant.actorId,enrollmentId]);
        if (!result.rows[0]) throw new Error("ENROLLMENT_NOT_FOUND");
        const row = result.rows[0];
        const sessions = await client.query(`SELECT DISTINCT ON (activity_id) activity_id,session_id,
          CASE WHEN status='IN_PROGRESS' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status,result
          FROM assessment_sessions WHERE organization_id=$1 AND learner_id=$2 AND enrollment_id=$3 AND release_id=$4 ORDER BY activity_id,attempt_number DESC`,[tenant.organizationId,tenant.actorId,enrollmentId,row.release_id]);
        const simulations = await client.query(`SELECT DISTINCT ON (a.activity_id) a.activity_id,a.status,a.attempt_number,p.payload,
          a.started_at + COALESCE((r.manifest->'content'->'policy'->>'attemptTtlSeconds')::integer,86400)*interval '1 second'<=now() AS expired
          FROM simulation_attempts a JOIN release_manifests r ON r.organization_id=a.organization_id AND r.release_id=a.release_id
          LEFT JOIN progress_events p ON p.organization_id=a.organization_id AND p.enrollment_id=a.enrollment_id AND p.learner_id=a.learner_id
            AND p.progress_event_id='progress:'||a.simulation_attempt_id AND p.event_type='simulation.completed' AND p.payload->>'releaseId'=a.release_id
          WHERE a.organization_id=$1 AND a.learner_id=$2 AND a.enrollment_id=$3 AND a.release_id=$4 ORDER BY a.activity_id,a.attempt_number DESC`,[tenant.organizationId,tenant.actorId,enrollmentId,row.release_id]);
        const bindings=row.manifest?.content?.runtimeBindings?.activities ?? [];
        const progress=sessions.rows.map(session=>({activityId:session.activity_id,status:session.status,...(session.result&&session.status!=='INVALIDATED'?{score:session.result.score,maxScore:session.result.maxScore}:{})}));
        for(const attempt of simulations.rows) {
          const binding=bindings.find((item:Row)=>item.runtimeActivityId===attempt.activity_id);
          if(!binding)continue;
          const completed=attempt.status==='COMPLETED' && attempt.payload;
          progress.push({activityId:binding.activityId,status:completed?(attempt.payload.passed?'PASSED':'FAILED'):attempt.status==='ACTIVE'?(attempt.expired?'EXPIRED':'IN_PROGRESS'):attempt.status,
            ...(completed?{score:attempt.payload.score,maxScore:attempt.payload.maxScore}:{})});
        }
        const eligibility=await enrollmentEligibility(client,tenant,enrollmentId,row.release_id,row.release_hash,row.manifest?.content??{});
        for(const acknowledgement of await contentAcknowledgements(client,tenant,enrollmentId,row.release_id,row.release_hash,row.manifest?.content??{}))progress.push({activityId:acknowledgement.payload.activityId,status:'ACKNOWLEDGED'});
        const learnerEligibility={...eligibility,...(eligibility.requalification?{requalification:{sourceCredentialId:eligibility.requalification.sourceCredentialId,updateModuleIds:eligibility.requalification.updateModuleIds}}:{})};
        return { ...summary(row), content: learnerContent(row.manifest?.content ?? {}), progress, eligibility:learnerEligibility,
          assessmentSessions: sessions.rows.map(session => ({activityId:session.activity_id,sessionId:session.session_id,status:session.status})) };
      });
    }
  };
}
