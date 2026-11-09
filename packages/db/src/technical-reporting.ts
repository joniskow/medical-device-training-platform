import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';
import {learningReportingOperations} from './learning-reports.js';

/** Reports read authoritative records; no answer keys or learner contact fields. */
/** Passing an existing client lets an asynchronous export keep all pages in the same transaction snapshot. */
export function createTechnicalReportingStore(pool:Pool,transactionClient?:PoolClient){
 const snapshot=<T>(tenant:TenantContext,read:(client:PoolClient)=>Promise<T>)=>transactionClient?read(transactionClient):withTenantTransaction(pool,tenant,read,{isolation:'repeatable read'});
 return {
 ...learningReportingOperations(pool,transactionClient),
 async evidence(tenant:TenantContext,releaseId:string){
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(releaseId))throw Error('REPORT_CURSOR_INVALID');
  return snapshot(tenant,async client=>{await client.query("SET LOCAL statement_timeout='5000ms'");await requireLifecycleAdmin(client,tenant);
   const release=(await client.query(`SELECT release_id AS "releaseId",release_hash AS "releaseHash",course_version_id AS "courseVersionId",status,created_at AS "publishedAt",manifest->'content'->'policy'->>'policyId' AS "policyId",manifest->'content'->'policy'->'version' AS "policyVersion",manifest->'content'->'policy'->'expirationDays' AS "expirationDays",encode(sha256(convert_to((manifest->'content'->'policy')::text,'UTF8')),'hex') AS "policyHash" FROM release_manifests WHERE organization_id=$1 AND release_id=$2`,[tenant.organizationId,releaseId])).rows[0];if(!release)throw Error('EXPORT_NOT_FOUND');
   const sourceArtifacts=(await client.query(`SELECT source->>'assetVersionId' AS "assetVersionId",source->>'sha256' AS sha256 FROM release_manifests r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.manifest->'sourceArtifacts')='array' THEN r.manifest->'sourceArtifacts' ELSE '[]'::jsonb END) source WHERE r.organization_id=$1 AND r.release_id=$2 LIMIT 1001`,[tenant.organizationId,releaseId])).rows;
   const modelBindings=(await client.query(`SELECT release_binding_id AS "releaseBindingId",model_version_id AS "modelVersionId",manifest_hash AS "manifestHash" FROM release_model_bindings WHERE organization_id=$1 AND release_id=$2 LIMIT 1001`,[tenant.organizationId,releaseId])).rows;
   const reviews=(await client.query(`SELECT decision_id AS "decisionId",target_type AS "targetType",target_id AS "targetId",decision,revision,created_at AS "createdAt" FROM course_review_decisions WHERE organization_id=$1 AND course_version_id=$2 ORDER BY decision_id LIMIT 1001`,[tenant.organizationId,release.courseVersionId])).rows;
   const attempts=(await client.query(`SELECT session_id AS "attemptId",'assessment'::text AS kind,status,activity_id AS "activityId",policy_id AS "policyId",policy_version AS "policyVersion",attempt_number AS "attemptNumber",CASE WHEN jsonb_typeof(result->'score')='number' THEN result->'score' END AS score,CASE WHEN jsonb_typeof(result->'maxScore')='number' THEN result->'maxScore' END AS "maxScore",started_at AS "startedAt",submitted_at AS "endedAt" FROM assessment_sessions WHERE organization_id=$1 AND release_id=$2 UNION ALL SELECT simulation_attempt_id,'simulation',status,activity_id,policy_id,NULL,attempt_number,NULL,NULL,started_at,completed_at FROM simulation_attempts WHERE organization_id=$1 AND release_id=$2 LIMIT 1001`,[tenant.organizationId,releaseId])).rows;
   const credentials=(await client.query(`SELECT credential_id AS "credentialId",status,issued_at AS "issuedAt",expires_at AS "expiresAt",superseded_by AS "supersededBy",policy_id AS "policyId",policy_version AS "policyVersion",release_hash AS "releaseHash" FROM credentials WHERE organization_id=$1 AND release_id=$2 ORDER BY credential_id LIMIT 1001`,[tenant.organizationId,releaseId])).rows;
   const credentialEvents=(await client.query(`SELECT e.credential_event_id AS "eventId",e.credential_id AS "credentialId",e.event_type AS "eventType",e.created_at AS "createdAt" FROM credential_events e JOIN credentials c ON c.organization_id=e.organization_id AND c.credential_id=e.credential_id WHERE e.organization_id=$1 AND c.release_id=$2 ORDER BY e.credential_event_id LIMIT 1001`,[tenant.organizationId,releaseId])).rows;
   if([sourceArtifacts,modelBindings,reviews,attempts,credentials,credentialEvents].some(rows=>rows.length>1000))throw Error('EXPORT_TOO_LARGE');
   return {schemaVersion:'evidence-lineage.v1',generatedAt:new Date().toISOString(),release,sourceArtifacts,modelBindings,reviews,attempts,credentials,credentialEvents,omittedFields:['identity/contact fields','source prose','assessment definitions/answers/answer keys','arbitrary audit payloads','private blob locations']};
  });
 },
 async summary(tenant:TenantContext){return snapshot(tenant,async client=>{
  await client.query("SET LOCAL statement_timeout='5000ms'");
  await requireLifecycleAdmin(client,tenant);
  const enrollments=(await client.query(`SELECT status,count(*)::int AS count FROM enrollments WHERE organization_id=$1 GROUP BY status ORDER BY status`,[tenant.organizationId])).rows;
  const credentials=(await client.query(`SELECT CASE WHEN status='ACTIVE' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status,count(*)::int AS count FROM credentials WHERE organization_id=$1 GROUP BY 1 ORDER BY 1`,[tenant.organizationId])).rows;
  const usage=(await client.query(`SELECT meter_key AS "meterKey",sum(quantity)::text AS quantity,count(*)::int AS events FROM usage_meter_events WHERE organization_id=$1 GROUP BY meter_key ORDER BY meter_key LIMIT 201`,[tenant.organizationId])).rows;
  const authoring=(await client.query(`SELECT count(*)::int AS "draftRevisions",count(DISTINCT course_id)::int AS courses FROM course_versions WHERE organization_id=$1`,[tenant.organizationId])).rows[0];
  const finance=(await client.query(`SELECT meter_key,sum(quantity)::text AS quantity,count(*)::int AS events FROM usage_meter_events WHERE organization_id=$1 AND meter_key IN ('cost.usd.billed','cost.usd.estimated','effort.seconds.authoring','effort.seconds.review') GROUP BY meter_key`,[tenant.organizationId])).rows;
  const meter=(key:string)=>finance.find(row=>row.meter_key===key);
  return {schemaVersion:'technical-report.v1',generatedAt:new Date().toISOString(),enrollments,credentials,usage:usage.slice(0,200),usageTruncated:usage.length>200,authoring:{...authoring,effortSeconds:{authoring:meter('effort.seconds.authoring')?.quantity??null,review:meter('effort.seconds.review')?.quantity??null,source:'SELF_REPORTED'}},cost:{currency:'USD',providerBilled:meter('cost.usd.billed')?.quantity??null,estimated:meter('cost.usd.estimated')?.quantity??null},limitations:['Source meter units, estimated costs and provider-billed costs are separate. Missing cost/effort events are reported as null, not a measured zero. Human effort is explicitly self-reported.']};
 });},
 async credentials(tenant:TenantContext,after?:string){
  if(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('REPORT_CURSOR_INVALID');
  return snapshot(tenant,async client=>{await client.query("SET LOCAL statement_timeout='5000ms'");await requireLifecycleAdmin(client,tenant);
   const rows=(await client.query(`SELECT credential_id AS "credentialId",course_version_id AS "courseVersionId",release_id AS "releaseId",release_hash AS "releaseHash",policy_version AS "policyVersion",CASE WHEN status='ACTIVE' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status,evidence->>'title' AS title,issued_at AS "issuedAt",expires_at AS "expiresAt" FROM credentials WHERE organization_id=$1 AND ($2::text IS NULL OR credential_id>$2) ORDER BY credential_id LIMIT 101`,[tenant.organizationId,after??null])).rows;
   return {items:rows.slice(0,100),nextCursor:rows.length>100?rows[99].credentialId:null};
  });
 },
 async usage(tenant:TenantContext,after?:string){
  if(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('REPORT_CURSOR_INVALID');
  return snapshot(tenant,async client=>{await client.query("SET LOCAL statement_timeout='5000ms'");await requireLifecycleAdmin(client,tenant);
   const rows=(await client.query(`SELECT usage_event_id AS "usageEventId",meter_key AS "meterKey",quantity::text AS quantity,created_at AS "createdAt" FROM usage_meter_events WHERE organization_id=$1 AND ($2::text IS NULL OR usage_event_id>$2) ORDER BY usage_event_id LIMIT 101`,[tenant.organizationId,after??null])).rows;
   return {items:rows.slice(0,100),nextCursor:rows.length>100?rows[99].usageEventId:null};
  });
 }
};}
