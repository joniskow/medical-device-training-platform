import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

// Regression against permanently starving eligible retention work behind a full
// lookahead page of older resources whose jobs are still active.
const owner=new Pool({connectionString:process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const prefix='independent-retention:'+randomUUID(),orgs=Array.from({length:101},(_,n)=>prefix+':'+String(n).padStart(3,'0'));
try{
 for(const [index,org]of orgs.entries()){
  const job=org+':job';
  await owner.query("INSERT INTO processing_jobs(job_id,job_type,organization_id,tenant,attempt,max_attempts,idempotency_key,request_hash,payload,state,created_at,updated_at,available_at,correlation_id) VALUES($1,'lesson.render',$2,$3,1,1,$1,$1,'{}',$4,now(),now(),now(),'fairness')",[job,org,JSON.stringify({organizationId:org,actorId:'independent',correlationId:'fairness'}),index<100?'RUNNING':'SUCCEEDED']);
  await owner.query("INSERT INTO retention_resource_policies(organization_id,policy_id,resource_kind,minimum_age_seconds,reason,approved_by) VALUES($1,'fixture','UNCLASSIFIED',0,'Independent fairness fixture','independent')",[org]);
  await owner.query("INSERT INTO retention_blob_resources(resource_id,organization_id,blob_key,resource_kind,job_id,state,policy_id,purge_after,created_at) VALUES($1,$2,$3,'UNCLASSIFIED',$4,'TOMBSTONED','fixture',now()-interval '3 days'+$5*interval '1 second',now()-interval '4 days')",[org+':resource',org,org+'/fixture',job,index]);
 }
 const eligible=[];
 for(let page=0;page<2;page++)eligible.push(...(await owner.query('SELECT organization_id FROM public.due_retention_resource_organizations()')).rows.map(row=>row.organization_id));
 assert(eligible.includes(orgs[100]),'Eligible retention work permanently starved behind 100 older active-job organizations');
 console.log('Independent retention fairness passed: eligible organization is discovered behind 100 older active-job organizations.');
}finally{
 for(const table of ['retention_blob_resources','retention_resource_policies','processing_job_outbox','processing_jobs','notifications','outbox_events','audit_events'])await owner.query('DELETE FROM '+table+' WHERE organization_id=ANY($1::text[])',[orgs]);await owner.end();
}
