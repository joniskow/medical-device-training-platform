import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,seedActiveOrganizationMembership} from '../packages/db/dist/index.js';
import {createNotificationService} from '../apps/api/dist/notification-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const prefix='context:'+randomUUID(),subject=prefix+':user',orgs=[prefix+':a',prefix+':b'],store=createPostgresOrganizationMembershipStore(runtime);
let addedRoleRead=false;
let addedOrganizationRead=false;
try{
 await applyProcessingJobMigration(pool);
 if(!(await pool.query("SELECT has_table_privilege('local_runtime','organizations','SELECT') allowed")).rows[0].allowed){await pool.query('GRANT SELECT ON organizations TO local_runtime');addedOrganizationRead=true;}
 if(!(await pool.query(`SELECT has_table_privilege('local_runtime','role_assignments','SELECT') AS allowed`)).rows[0].allowed){await pool.query('GRANT SELECT ON role_assignments TO local_runtime');addedRoleRead=true;}
 await seedActiveOrganizationMembership(pool,{subject,organizationId:orgs[0],roles:['organization_admin']});
 await seedActiveOrganizationMembership(pool,{subject,organizationId:orgs[1],roles:['learner']});
 await seedActiveOrganizationMembership(pool,{subject,organizationId:orgs[0]});assert.deepEqual(await store.resolveOrganizationRoles(subject,orgs[0]),['organization_admin']);
 await assert.rejects(seedActiveOrganizationMembership(pool,{subject,organizationId:orgs[1],roles:['operator']}),/MEMBERSHIP_ROLES_INVALID/);
 for(const [index,organizationId] of orgs.entries())await pool.query(`INSERT INTO notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at) VALUES($1,$2,$3,'COURSE_CHANGE',$4,$1,now())`,[prefix+':notice:'+index,organizationId,subject,{title:'Private '+index,message:'Organization '+index}]);
 const seen=[];
 const http=createJobStatusHttpServer({statusService:{get:async()=>null,retry:async()=>null},notificationService:createNotificationService(runtime),credentialService:{list:async tenant=>{seen.push(tenant.organizationId);return {items:[]};}},organizationContextResolver:store,authenticator:{authenticate:async req=>req.headers.authorization?{subject,roles:[req.headers.authorization==='Bearer operator'?'operator':'organization_admin'],organizationId:'forged-token-org'}:null}});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 try{
  const root=`http://127.0.0.1:${http.address().port}/api/v1`,headers={authorization:'Bearer user'};
  assert.equal((await fetch(root+'/organization-contexts')).status,401);
  const list=await fetch(root+'/organization-contexts',{headers});assert.equal(list.status,200);assert.deepEqual((await list.json()).items.map(o=>o.organizationId),orgs);
  assert.equal((await fetch(root+'/notifications',{headers})).status,409);
  assert.equal((await fetch(root+'/notifications',{headers:{...headers,'x-organization-id':'foreign'}})).status,403);
  for(const [index,organizationId] of orgs.entries()){
   const result=await fetch(root+'/notifications',{headers:{...headers,'x-organization-id':organizationId}});assert.equal(result.status,200);const items=(await result.json()).items;assert.equal(items.length,1);assert.equal(items[0].title,'Private '+index);
  }
  assert.equal((await fetch(root+'/credentials?learnerId=other',{headers:{...headers,'x-organization-id':orgs[0]}})).status,200);
  assert.equal((await fetch(root+'/credentials?learnerId=other',{headers:{...headers,'x-organization-id':orgs[1]}})).status,403);assert.deepEqual(seen,[orgs[0]]);
  assert.equal((await fetch(root+'/credentials?learnerId=other',{headers:{authorization:'Bearer operator','x-organization-id':orgs[1]}})).status,200);
  const select=(organizationId,key='selection',body={})=>fetch(root+'/organization-contexts/'+organizationId+'/select',{method:'POST',headers:{...headers,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
  assert.equal((await select('foreign')).status,403);assert.equal((await select(orgs[0],'spoof',{roles:['operator']})).status,422);
  const selected=await Promise.all([select(orgs[0]),select(orgs[0])]);assert(selected.every(r=>r.status===200));
  assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='ORGANIZATION_CONTEXT_SELECTED'`,[orgs[0]])).rows[0].n,1);
  const brokenPool={async connect(){const c=await runtime.connect();return {query(sql,args){if(String(sql).includes('INSERT INTO audit_events'))throw Error('Injected selection audit failure');return c.query(sql,args);},release(){c.release();}};}};
  await assert.rejects(createPostgresOrganizationMembershipStore(brokenPool).selectOrganization(subject,orgs[1],'fail','test'),/Injected selection/);
  await pool.query(`DELETE FROM role_assignments WHERE subject=$1 AND organization_id=$2`,[subject,orgs[0]]);
  assert.equal((await fetch(root+'/credentials?learnerId=other',{headers:{...headers,'x-organization-id':orgs[0]}})).status,403);
  await pool.query(`UPDATE organization_memberships SET status='SUSPENDED' WHERE subject=$1 AND organization_id=$2`,[subject,orgs[1]]);
  assert.equal((await select(orgs[1],'suspended')).status,403);assert.equal((await fetch(root+'/notifications',{headers:{...headers,'x-organization-id':orgs[1]}})).status,403);
  assert.equal((await fetch(root+'/notifications',{headers})).status,200,'A single remaining membership remains usable without an explicit header');
 }finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
 console.log('Organization context passed: active membership selection, scoped role denial despite global claims, live role/suspension changes, tenant data isolation, operator boundary, audit rollback and concurrent replay.');
}finally{try{for(const table of ['notifications','audit_events','role_assignments','organization_memberships'])await pool.query(`DELETE FROM ${table} WHERE organization_id=ANY($1::text[])`,[orgs]);}finally{if(addedRoleRead)await pool.query('REVOKE SELECT ON role_assignments FROM local_runtime');if(addedOrganizationRead)await pool.query('REVOKE SELECT ON organizations FROM local_runtime');await runtime.end();await pool.end();}}
