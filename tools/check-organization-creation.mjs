import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,withTenantTransaction} from '../packages/db/dist/index.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const subject='creation:'+randomUUID(),store=createPostgresOrganizationMembershipStore(runtime),added=[];
let execution=false;
try{
 await applyProcessingJobMigration(pool);
 for(const table of ['organizations','role_assignments'])if(!(await pool.query(`SELECT has_table_privilege('local_runtime',$1,'SELECT') allowed`,[table])).rows[0].allowed){await pool.query(`GRANT SELECT ON ${table} TO local_runtime`);added.push(table);}
 if(!(await pool.query(`SELECT has_function_privilege('local_runtime','public.create_training_organization(text,text,text,text)','EXECUTE') allowed`)).rows[0].allowed){await pool.query('GRANT EXECUTE ON FUNCTION public.create_training_organization(text,text,text,text) TO local_runtime');execution=true;}
 assert.deepEqual(await store.resolveActiveOrganizations(subject),[]);
 const [first,duplicate]=await Promise.all([store.createOrganization(subject,'  New organization  ','one','test'),store.createOrganization(subject,'New organization','one','test')]);
 assert.deepEqual(first,duplicate);assert.equal(first.name,'New organization');
 assert.deepEqual(await store.resolveOrganizationRoles(subject,first.organizationId),['organization_admin']);
 assert.deepEqual(await store.listOrganizationContexts(subject),[first]);
 await assert.rejects(store.createOrganization(subject,'Changed','one','test'),/IDEMPOTENCY_KEY_REUSED/);
 for(const name of ['', ' '.repeat(3),'x'.repeat(161)])await assert.rejects(store.createOrganization(subject,name,'invalid','test'),/ORGANIZATION_REQUEST_INVALID/);
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit failure');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createPostgresOrganizationMembershipStore(broken).createOrganization(subject,'Rollback','rollback','test'),/Injected commit/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM organizations WHERE created_by=$1`,[subject])).rows[0].n,1);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE actor_id=$1 AND event_type='ORGANIZATION_CREATED'`,[subject])).rows[0].n,1);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM organization_memberships WHERE subject=$1`,[subject])).rows[0].n,1);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM role_assignments WHERE subject=$1`,[subject])).rows[0].n,1);
 await assert.rejects(runtime.query(`INSERT INTO organizations SELECT * FROM organizations WHERE false`),/permission denied/);
 assert.equal((await runtime.query(`SELECT * FROM organizations WHERE organization_id=$1`,[first.organizationId])).rowCount,0);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='create_training_organization' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n,0);
 const tenant={organizationId:first.organizationId,actorId:subject,correlationId:'test'};
 assert.equal((await withTenantTransaction(runtime,tenant,c=>c.query('SELECT * FROM organizations'))).rowCount,1);
 await pool.query(`UPDATE organizations SET status='SUSPENDED' WHERE organization_id=$1`,[first.organizationId]);
 assert.deepEqual(await store.resolveActiveOrganizations(subject),[]);assert.deepEqual(await store.resolveOrganizationRoles(subject,first.organizationId),[]);
 await assert.rejects(store.selectOrganization(subject,first.organizationId,'select','test'),/MEMBERSHIP_REQUIRED/);
 await assert.rejects(store.createOrganization(subject,first.name,'one','test'),/CREATION_UNAVAILABLE/);
 await pool.query(`UPDATE organizations SET status='ACTIVE' WHERE organization_id=$1`,[first.organizationId]);
 await pool.query(`DELETE FROM role_assignments WHERE subject=$1`,[subject]);
 await store.createOrganization(subject,first.name,'one','test');assert.deepEqual(await store.resolveOrganizationRoles(subject,first.organizationId),['learner']);
 await pool.query(`UPDATE organization_memberships SET status='REMOVED' WHERE subject=$1`,[subject]);
 await assert.rejects(store.createOrganization(subject,first.name,'one','test'),/CREATION_UNAVAILABLE/);
 const http=createJobStatusHttpServer({statusService:{get:async()=>null,retry:async()=>null},organizationContextResolver:store,authenticator:{authenticate:async req=>req.headers.authorization?{subject,roles:[],...(req.headers.authorization==='Bearer unverified'?{}:{verifiedEmail:'fixture@example.test'})}:null}});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${http.address().port}/api/v1/organization-contexts`,headers={authorization:'Bearer test','content-type':'application/json','idempotency-key':'http'};
  const post=(body,custom=headers)=>fetch(url,{method:'POST',headers:custom,body:JSON.stringify(body)});
  assert.equal((await post({name:'HTTP'},{})).status,401);
  assert.equal((await post({name:'HTTP'},{...headers,authorization:'Bearer unverified'})).status,403);
  for(const extra of [{subject:'other'},{organizationId:first.organizationId},{roles:['operator']}])assert.equal((await post({name:'HTTP',...extra})).status,422);
  assert.equal((await post({name:'HTTP'})).status,200);
  const result=await (await post({name:'HTTP'})).json();assert.notEqual(result.organizationId,first.organizationId);
  assert.deepEqual(await store.resolveOrganizationRoles(subject,result.organizationId),['organization_admin']);
  assert.equal((await post({name:'Changed'})).status,409);
  assert.deepEqual((await (await fetch(url,{headers})).json()).items,[result]);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));}
 console.log('Organization creation passed: concurrent replay, founder roles, atomic rollback, scope/authentication, restricted privileges, suspension and removal fencing.');
}finally{
 try{
  const ids=(await pool.query('SELECT organization_id FROM organizations WHERE created_by=$1',[subject])).rows.map(r=>r.organization_id);
  for(const table of ['audit_events','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=ANY($1::text[])`,[ids]);
 }finally{
  if(execution)await pool.query('REVOKE EXECUTE ON FUNCTION public.create_training_organization(text,text,text,text) FROM local_runtime');
  for(const table of added)await pool.query(`REVOKE SELECT ON ${table} FROM local_runtime`);
  await runtime.end();await pool.end();
 }
}
