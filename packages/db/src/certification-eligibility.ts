import type { PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { projectCourseStoryFacts, evaluateCertification, type PolicyActivity, type PolicyEvidence } from "@medical-device/simulation-schema";
import { contentAcknowledgements } from './content-progress.js';
import { reviewedAttempts } from './attempt-review-evidence.js';
import { moduleRequalification } from './module-requalification.js';

async function enrollmentEvidence(client:PoolClient,tenant:TenantContext,enrollmentId:string,releaseId:string,releaseHash:string,content:Record<string,any>) {
  const activities:PolicyActivity[]=[];
  for(const [index,module] of (content.modules??[]).entries())for(const activity of module.activities??[]) {
    const kind=["multiple_choice","multi_select","ordered_step"].includes(activity.type)?"assessment":["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(activity.type)?"simulation":"content";
    activities.push({activityId:activity.activityId,moduleId:module.moduleId??`module:${index}`,kind,...(kind==='simulation'?{faultIds:content.simulation?.definition?.faults?.map((fault:Record<string,any>)=>fault.faultId)}:{}),passScore:kind==="assessment"?activity.assessment?.passScore:kind==="simulation"?content.simulation?.definition?.scoring?.passScore:0});
  }
  const assessmentRows=await client.query(`SELECT session_id,activity_id,attempt_number,status,result,release_hash,policy_id,policy_version,assessment_id,assessment_version,
    COALESCE(submitted_at,expires_at) AS ended_at,expires_at<=now() AS expired
    FROM assessment_sessions WHERE organization_id=$1 AND learner_id=$2 AND enrollment_id=$3 AND release_id=$4`,[tenant.organizationId,tenant.actorId,enrollmentId,releaseId]);
  const evidence:PolicyEvidence[]=[];
  for(const row of assessmentRows.rows) {
    const activity=(content.modules??[]).flatMap((module:Record<string,any>)=>module.activities??[]).find((a:Record<string,any>)=>a.activityId===row.activity_id);
    if(activity?.assessment?.assessmentId!==row.assessment_id || activity.assessment.version!==row.assessment_version)continue;
    evidence.push({evidenceId:row.session_id,activityId:row.activity_id,attemptNumber:row.attempt_number,
      releaseId,releaseHash:row.release_hash,policyId:row.policy_id,policyVersion:row.policy_version,
      status:row.status==="IN_PROGRESS"&&row.expired?"EXPIRED":row.status,score:row.result?.score??0,maxScore:row.result?.maxScore??0,endedAt:new Date(row.ended_at).getTime()});
  }
  const simulationRows=await client.query(`SELECT a.*,p.payload,
    a.started_at+$5*interval '1 second' AS expires_at FROM simulation_attempts a
    LEFT JOIN progress_events p ON p.organization_id=a.organization_id AND p.enrollment_id=a.enrollment_id AND p.learner_id=a.learner_id AND p.progress_event_id='progress:'||a.simulation_attempt_id AND p.event_type='simulation.completed'
    WHERE a.organization_id=$1 AND a.learner_id=$2 AND a.enrollment_id=$3 AND a.release_id=$4`,[tenant.organizationId,tenant.actorId,enrollmentId,releaseId,Number.isSafeInteger(content.policy?.attemptTtlSeconds)?content.policy.attemptTtlSeconds:0]);
  const now=Number((await client.query(`SELECT extract(epoch FROM CURRENT_TIMESTAMP)*1000 AS now`)).rows[0].now);
  for(const row of simulationRows.rows) {
    const binding=content.runtimeBindings?.activities?.find((a:Record<string,any>)=>a.runtimeActivityId===row.activity_id);
    if(!binding || binding.simulationDefinitionId!==row.simulation_definition_id || binding.policyId!==row.policy_id)continue;
    const payload=row.payload;
    const validPayload=payload?.releaseId===releaseId && payload.releaseHash===releaseHash && payload.policyId===binding.policyId && payload.policyVersion===content.policy?.version
      && payload.simulationDefinitionId===binding.simulationDefinitionId && payload.modelVersionId===content.model?.modelVersionId && payload.attemptId===row.simulation_attempt_id;
    const status=row.status==="COMPLETED"?(validPayload?(payload.passed?"PASSED":"FAILED"):"INVALIDATED"):row.status==="ACTIVE"?(new Date(row.expires_at).getTime()<=now?"EXPIRED":"IN_PROGRESS"):row.status;
    evidence.push({evidenceId:row.simulation_attempt_id,activityId:binding.activityId,releaseId,releaseHash,policyId:content.policy?.policyId,policyVersion:content.policy?.version,
      ...(validPayload?{faultOutcomes:{diagnosedFaultIds:payload.diagnosedFaultIds,resolvedFaultIds:payload.resolvedFaultIds}}:{}),
      attemptNumber:row.attempt_number,status,score:validPayload?payload.score:0,maxScore:validPayload?payload.maxScore:0,endedAt:new Date(row.completed_at??row.expires_at).getTime()});
  }
  for(const row of await contentAcknowledgements(client,tenant,enrollmentId,releaseId,releaseHash,content))evidence.push({
    evidenceId:row.progress_event_id,activityId:row.payload.activityId,releaseId,releaseHash,policyId:row.payload.policyId,policyVersion:row.payload.policyVersion,
    attemptNumber:1,status:'PASSED',score:1,maxScore:1,endedAt:new Date(row.created_at).getTime()
  });
  return {activities,evidence,now};
}

export async function enrollmentEligibility(client:PoolClient,tenant:TenantContext,enrollmentId:string,releaseId:string,releaseHash:string,content:Record<string,any>) {
  const {activities,evidence,now}=await enrollmentEvidence(client,tenant,enrollmentId,releaseId,releaseHash,content);
  const reviewedThrough=await reviewedAttempts(client,tenant,enrollmentId,releaseId,releaseHash,content.policy);
  const resetThrough=await reviewedAttempts(client,tenant,enrollmentId,releaseId,releaseHash,content.policy,true);
  const requalification=await moduleRequalification(client,tenant,releaseId,content,activities);
  const evaluation=evaluateCertification({policy:requalification?.policy??content.policy,activities,evidence,releaseId,releaseHash,now,reviewedThrough,resetThrough});
  return {...evaluation,...(requalification?{requalification,evidenceIds:[...new Set([...evaluation.evidenceIds,...requalification.sourceEvidenceIds])]}:{})};
}

/** Called inside a tenant transaction. Derives the release and policy from the owned active enrollment. */
export async function enrollmentStoryFacts(client:PoolClient,tenant:TenantContext,enrollmentId:string) {
 if(!tenant.actorId)throw Error('ENROLLMENT_NOT_FOUND');
 const result=await client.query(`SELECT r.release_id,r.release_hash,r.manifest FROM enrollments e
 JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
 WHERE e.organization_id=$1 AND e.learner_id=$2 AND e.enrollment_id=$3 AND e.status='ACTIVE' AND r.status='PUBLISHED'`,[tenant.organizationId,tenant.actorId,enrollmentId]);
 const row=result.rows[0];if(!row)throw Error('ENROLLMENT_NOT_FOUND');
 const content=row.manifest.content;
 const {activities,evidence,now}=await enrollmentEvidence(client,tenant,enrollmentId,row.release_id,row.release_hash,content);
 return projectCourseStoryFacts({policy:content.policy,activities,evidence,releaseId:row.release_id,releaseHash:row.release_hash,now});
}

