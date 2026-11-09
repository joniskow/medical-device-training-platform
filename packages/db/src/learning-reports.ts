import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';

export interface LearningReportFilter{from:string;to:string;courseId?:string;after?:string}
export const LEARNING_REPORT_MIGRATION_SQL=`
CREATE INDEX IF NOT EXISTS assessment_report_event_idx ON public.assessment_sessions(organization_id,(COALESCE(submitted_at,started_at)));
CREATE INDEX IF NOT EXISTS simulation_report_event_idx ON public.simulation_attempts(organization_id,(COALESCE(completed_at,started_at)));
CREATE INDEX IF NOT EXISTS progress_report_event_idx ON public.progress_events(organization_id,created_at) WHERE event_type='content.acknowledged';
CREATE INDEX IF NOT EXISTS enrollment_report_event_idx ON public.enrollments(organization_id,created_at,course_version_id);
CREATE INDEX IF NOT EXISTS credential_report_event_idx ON public.credentials(organization_id,issued_at,course_version_id);
`;
function filters(input:LearningReportFilter){
 const from=Date.parse(input.from),to=Date.parse(input.to);
 if(typeof input.from!=='string'||typeof input.to!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(input.from)||!/^\d{4}-\d{2}-\d{2}T/.test(input.to)||!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>366*86400000||input.courseId!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(input.courseId))throw Error('REPORT_FILTER_INVALID');
 return [new Date(from).toISOString(),new Date(to).toISOString(),input.courseId??null];
}
function cursor(value:string|undefined,size:number){if(value===undefined)return Array(size).fill('');if(!/^[A-Za-z0-9_-]{1,1024}$/.test(value))throw Error('REPORT_CURSOR_INVALID');let decoded:unknown;try{decoded=JSON.parse(Buffer.from(value,'base64url').toString());}catch{throw Error('REPORT_CURSOR_INVALID');}if(!Array.isArray(decoded)||decoded.length!==size||decoded.some(item=>typeof item!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(item)))throw Error('REPORT_CURSOR_INVALID');return decoded;}
export function learningReportingOperations(pool:Pool,transactionClient?:PoolClient){
 const read=<T>(tenant:TenantContext,action:(client:PoolClient)=>Promise<T>)=>transactionClient?action(transactionClient):withTenantTransaction(pool,tenant,action,{isolation:'repeatable read'});
 return {
  async courses(tenant:TenantContext,input:LearningReportFilter){const [from,to,courseId]=filters(input),[after]=cursor(input.after,1);
   return read(tenant,async client=>{await requireLifecycleAdmin(client,tenant);await client.query("SET LOCAL statement_timeout='5000ms'");
    const rows=(await client.query(`SELECT c.course_id AS "courseId",
     (SELECT count(*)::int FROM enrollments e JOIN course_versions v ON v.organization_id=e.organization_id AND v.course_version_id=e.course_version_id WHERE e.organization_id=c.organization_id AND v.course_id=c.course_id AND e.created_at>=$2 AND e.created_at<$3) AS "enrollmentsCreated",
     (SELECT count(*)::int FROM enrollments e JOIN course_versions v ON v.organization_id=e.organization_id AND v.course_version_id=e.course_version_id WHERE e.organization_id=c.organization_id AND v.course_id=c.course_id AND e.status='COMPLETED' AND e.updated_at>=$2 AND e.updated_at<$3) AS "completedEnrollmentRecords",
     (SELECT count(*)::int FROM credentials cr JOIN course_versions v ON v.organization_id=cr.organization_id AND v.course_version_id=cr.course_version_id WHERE cr.organization_id=c.organization_id AND v.course_id=c.course_id AND cr.issued_at>=$2 AND cr.issued_at<$3) AS "credentialsIssued",
     (SELECT count(DISTINCT cr.learner_id)::int FROM credentials cr JOIN course_versions v ON v.organization_id=cr.organization_id AND v.course_version_id=cr.course_version_id WHERE cr.organization_id=c.organization_id AND v.course_id=c.course_id AND cr.issued_at>=$2 AND cr.issued_at<$3 AND cr.status='ACTIVE' AND (cr.expires_at IS NULL OR cr.expires_at>now())) AS "currentlyCredentialedLearners"
     FROM courses c WHERE c.organization_id=$1 AND ($4::text IS NULL OR c.course_id=$4) AND c.course_id>$5 ORDER BY c.course_id LIMIT 51`,[tenant.organizationId,from,to,courseId,after])).rows;
    return {schemaVersion:'course-report.v1',from,to,asOf:new Date().toISOString(),items:rows.slice(0,50),nextCursor:rows.length>50?Buffer.from(JSON.stringify([rows[49].courseId])).toString('base64url'):null,semantics:'Event windows are [from,to). Completion counts require explicit COMPLETED enrollment records; credential issuance and current validity are reported separately.'};
   });
  },
  async activities(tenant:TenantContext,input:LearningReportFilter){const [from,to,courseId]=filters(input),after=cursor(input.after,3);
   return read(tenant,async client=>{await requireLifecycleAdmin(client,tenant);await client.query("SET LOCAL statement_timeout='5000ms'");
    const rows=(await client.query(`WITH evidence AS (
     SELECT v.course_id,s.course_version_id,s.activity_id,'assessment'::text AS kind,s.learner_id,
      CASE WHEN s.status='IN_PROGRESS' AND s.expires_at<=now() THEN 'EXPIRED' ELSE s.status END AS status
      FROM (SELECT a.*,e.course_version_id FROM assessment_sessions a JOIN enrollments e ON e.organization_id=a.organization_id AND e.enrollment_id=a.enrollment_id AND e.learner_id=a.learner_id WHERE a.organization_id=$1 AND COALESCE(a.submitted_at,a.started_at)>=$2 AND COALESCE(a.submitted_at,a.started_at)<$3) s JOIN course_versions v ON v.organization_id=s.organization_id AND v.course_version_id=s.course_version_id
     UNION ALL
     SELECT v.course_id,v.course_version_id,COALESCE(binding.value->>'activityId',a.activity_id),'simulation',a.learner_id,
      CASE WHEN a.status='COMPLETED' THEN CASE WHEN binding.value IS NOT NULL AND p.payload->>'releaseId'=a.release_id AND p.payload->>'releaseHash'=r.release_hash AND p.payload->>'attemptId'=a.simulation_attempt_id AND p.payload->>'policyId'=a.policy_id AND p.payload->'policyVersion'=r.manifest->'content'->'policy'->'version' AND p.payload->>'simulationDefinitionId'=a.simulation_definition_id AND p.payload->>'modelVersionId'=a.model_version_id THEN CASE WHEN p.payload->'passed'='true'::jsonb THEN 'PASSED' ELSE 'FAILED' END ELSE 'INVALIDATED' END
       WHEN a.status='ACTIVE' THEN CASE WHEN a.started_at+COALESCE((r.manifest->'content'->'policy'->>'attemptTtlSeconds')::integer,86400)*interval '1 second'<=now() THEN 'EXPIRED' ELSE 'IN_PROGRESS' END ELSE a.status END
      FROM simulation_attempts a JOIN enrollments e ON e.organization_id=a.organization_id AND e.enrollment_id=a.enrollment_id AND e.learner_id=a.learner_id JOIN course_versions v ON v.organization_id=e.organization_id AND v.course_version_id=e.course_version_id JOIN release_manifests r ON r.organization_id=a.organization_id AND r.release_id=a.release_id
      LEFT JOIN progress_events p ON p.organization_id=a.organization_id AND p.progress_event_id='progress:'||a.simulation_attempt_id AND p.event_type='simulation.completed' AND p.learner_id=a.learner_id AND p.enrollment_id=a.enrollment_id
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.manifest->'content'->'runtimeBindings'->'activities')='array' THEN r.manifest->'content'->'runtimeBindings'->'activities' ELSE '[]'::jsonb END) binding ON binding.value->>'runtimeActivityId'=a.activity_id
      WHERE a.organization_id=$1 AND COALESCE(a.completed_at,a.started_at)>=$2 AND COALESCE(a.completed_at,a.started_at)<$3
     UNION ALL
     SELECT v.course_id,v.course_version_id,p.payload->>'activityId','acknowledgement',p.learner_id,'PASSED'
      FROM progress_events p JOIN enrollments e ON e.organization_id=p.organization_id AND e.enrollment_id=p.enrollment_id AND e.learner_id=p.learner_id JOIN course_versions v ON v.organization_id=e.organization_id AND v.course_version_id=e.course_version_id JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id AND r.release_id=p.payload->>'releaseId' AND r.release_hash=p.payload->>'releaseHash'
      WHERE p.organization_id=$1 AND p.event_type='content.acknowledged' AND p.created_at>=$2 AND p.created_at<$3 AND p.payload->>'activityId' IS NOT NULL AND (p.payload->'policyId') IS NOT DISTINCT FROM (r.manifest->'content'->'policy'->'policyId') AND (p.payload->'policyVersion') IS NOT DISTINCT FROM (r.manifest->'content'->'policy'->'version')
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.manifest->'content'->'modules')='array' THEN r.manifest->'content'->'modules' ELSE '[]'::jsonb END) module CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(module->'activities')='array' THEN module->'activities' ELSE '[]'::jsonb END) activity WHERE activity->>'activityId'=p.payload->>'activityId' AND activity->>'type' IN ('text','rich_text','image','video','3d_viewer','hotspot'))
    ) SELECT course_id AS "courseId",course_version_id AS "courseVersionId",activity_id AS "activityId",kind,count(*)::int AS "evidenceCount",count(DISTINCT learner_id)::int AS learners,
     count(*) FILTER(WHERE status='PASSED')::int AS passed,count(*) FILTER(WHERE status='FAILED')::int AS failed,count(*) FILTER(WHERE status='INVALIDATED')::int AS invalidated,count(*) FILTER(WHERE status='EXPIRED')::int AS expired,count(*) FILTER(WHERE status='IN_PROGRESS')::int AS "inProgress"
     FROM evidence WHERE ($4::text IS NULL OR course_id=$4) AND (course_version_id,activity_id,kind)>($5,$6,$7) GROUP BY course_id,course_version_id,activity_id,kind ORDER BY course_version_id,activity_id,kind LIMIT 51`,[tenant.organizationId,from,to,courseId,...after])).rows;
    const last=rows[49];return {schemaVersion:'activity-report.v1',from,to,asOf:new Date().toISOString(),items:rows.slice(0,50),nextCursor:rows.length>50?Buffer.from(JSON.stringify([last.courseVersionId,last.activityId,last.kind])).toString('base64url'):null,semantics:'Current authoritative outcomes for evidence whose submitted/completed time (or start time when unfinished) falls in [from,to); invalidated attempts never count as passed.'};
   });
  }
 };
}
