import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration} from '../packages/db/dist/index.js';
import {createCourseChangeService} from '../apps/api/dist/course-change-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='recovery:'+randomUUID(),tenant={organizationId:org,actorId:'operator',correlationId:org},service=createCourseChangeService(runtime);
try{
 await applyProcessingJobMigration(pool);
 const types=['course.change.notify','course.change.assign','credential.qualify'];
 for(let i=0;i<51;i++)await pool.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at,attempt_count,last_error_code) VALUES($1,$2,$3,$1,$4,'FAILED',now(),now(),now(),5,'DELIVERY_FAILED')`,[`${org}:${String(i).padStart(3,'0')}`,org,types[i%3],{releaseId:'release:test',releaseHash:'a'.repeat(64),afterRecipient:'completed-learner',deliveredCount:50,skippedCount:2,privateBody:'must-not-leak'}]);
 await pool.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'unrelated.event',$1,'{}','FAILED',now(),now(),now())`,[org+':unsupported',org]);
 const first=await service.failedJobs(tenant),second=await service.failedJobs(tenant,first.nextCursor);
 assert.equal(first.items.length,50);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert(!JSON.stringify(first).includes('must-not-leak'));assert(!JSON.stringify(first).includes('completed-learner'));
 assert.deepEqual((await service.failedJobs({...tenant,organizationId:'foreign'})).items,[]);
 const item=first.items[0],request={reason:'Resolved transient storage failure',retryToken:item.retryToken,idempotencyKey:'retry'};
 const before=(await pool.query(`SELECT payload,created_at FROM outbox_events WHERE outbox_event_id=$1`,[item.jobId])).rows[0];
 const brokenPool={async connect(){const c=await runtime.connect();return {query(sql,args){if(String(sql).includes('INSERT INTO audit_events'))throw Error('Injected audit failure');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createCourseChangeService(brokenPool).retry(tenant,item.jobId,request),/Injected audit/);
 assert.equal((await service.failedJobs(tenant)).items[0].retryToken,item.retryToken);
 await Promise.all([service.retry(tenant,item.jobId,request),service.retry(tenant,item.jobId,request)]);
 const after=(await pool.query(`SELECT * FROM outbox_events WHERE outbox_event_id=$1`,[item.jobId])).rows[0];assert.equal(after.state,'PENDING');assert.equal(after.attempt_count,0);assert.equal(after.last_error_code,null);assert.deepEqual(after.payload,before.payload);assert.deepEqual(after.created_at,before.created_at);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_CHANGE_JOB_RETRIED'`,[org])).rows[0].n,1);
 await assert.rejects(service.retry(tenant,item.jobId,{...request,reason:'Changed reason'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(service.retry(tenant,item.jobId,{...request,idempotencyKey:'new'}),/COURSE_CHANGE_JOB_CHANGED/);
 await assert.rejects(service.retry({...tenant,organizationId:'foreign'},item.jobId,request),/COURSE_CHANGE_JOB_NOT_FOUND/);
 await assert.rejects(service.retry(tenant,org+':unsupported',{...request,idempotencyKey:'unsupported'}),/COURSE_CHANGE_JOB_NOT_FOUND/);
 // An interrupted old response must not restart a later failure cycle.
 await pool.query(`UPDATE outbox_events SET state='FAILED',attempt_count=5,updated_at=now() WHERE outbox_event_id=$1`,[item.jobId]);
 assert.equal((await service.retry(tenant,item.jobId,request)).state,'FAILED');
 await assert.rejects(service.retry(tenant,item.jobId,{...request,idempotencyKey:'stale'}),/COURSE_CHANGE_JOB_CHANGED/);
 const refreshed=(await service.failedJobs(tenant)).items.find(row=>row.jobId===item.jobId);
 assert.equal((await service.retry(tenant,item.jobId,{...request,idempotencyKey:'new-cycle',retryToken:refreshed.retryToken})).state,'PENDING');
 const http=createJobStatusHttpServer({courseChangeService:service,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization?{subject:'operator',roles:[req.headers.authorization.slice(7)]}:null},organizationContextResolver:{resolveActiveOrganizations:async()=>[org]}});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${http.address().port}/api/v1/course-change-jobs`;
  assert.equal((await fetch(base)).status,401);
  for(const role of ['learner','reviewer','organization_admin'])assert.equal((await fetch(base,{headers:{authorization:'Bearer '+role}})).status,403);
  const headers={authorization:'Bearer operator','content-type':'application/json','idempotency-key':'http'};
  const listing=await fetch(base,{headers});assert.equal(listing.status,200);const job=(await listing.json()).items[0];
  const post=(body,extra={})=>fetch(base+'/'+job.jobId+'/retry',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await post({reason:'Repair',retryToken:job.retryToken,organizationId:'foreign'})).status,422);
  assert.equal((await post({reason:'Repair',retryToken:job.retryToken},{authorization:'Bearer organization_admin'})).status,403);
  assert.equal((await post({reason:'',retryToken:job.retryToken})).status,422);
  assert.equal((await post({reason:'Repair',retryToken:job.retryToken})).status,200);
  assert.equal((await post({reason:'Repair',retryToken:job.retryToken},{'idempotency-key':'http-stale'})).status,409);
 }finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
 console.log('Course-change recovery passed: restricted-runtime paging/projections, operator HTTP roles, preserved checkpoints, audit rollback, concurrent retries, stale snapshots and delayed replay.');
}finally{await pool.query(`DELETE FROM outbox_events WHERE organization_id=$1`,[org]);await pool.query(`DELETE FROM audit_events WHERE organization_id=$1`,[org]);await runtime.end();await pool.end();}
