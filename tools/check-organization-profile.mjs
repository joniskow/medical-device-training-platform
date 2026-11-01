import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,createOrganizationProfileStore} from '../packages/db/dist/index.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const actor='profile:'+randomUUID(),added=[],executions=[],ids=[];
const fn='public.update_organization_profile(text,text,text,integer,text,text,text,text)';
try{
 await applyProcessingJobMigration(pool);
 for(const table of ['organizations','role_assignments'])if(!(await pool.query("SELECT has_table_privilege('local_runtime',$1,'SELECT') allowed",[table])).rows[0].allowed){await pool.query(`GRANT SELECT ON ${table} TO local_runtime`);added.push(table);}
 for(const signature of [fn,'public.create_training_organization(text,text,text,text)'])if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[signature])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${signature} TO local_runtime`);executions.push(signature);}
 const membership=createPostgresOrganizationMembershipStore(runtime),store=createOrganizationProfileStore(runtime);
 const first=await membership.createOrganization(actor,'Original','first','test'),second=await membership.createOrganization(actor,'Other','second','test');ids.push(first.organizationId,second.organizationId);
 const tenant={organizationId:first.organizationId,actorId:actor,correlationId:'test'},profile=await store.get(tenant);
 assert.equal(profile.revision,1);assert.equal(profile.description,'');
 const input={name:'Updated',description:'Organization description',website:'https://example.test/about',revision:1,reason:'Profile correction',idempotencyKey:'update'};
 const results=await Promise.all([store.update(tenant,input),store.update(tenant,input)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].revision,2);
 assert.equal((await membership.listOrganizationContexts(actor)).find(x=>x.organizationId===first.organizationId).name,'Updated');
 assert.equal((await store.get({...tenant,organizationId:second.organizationId})).name,'Other');
 await assert.rejects(store.update(tenant,{...input,name:'Changed'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(store.update(tenant,{...input,idempotencyKey:'stale'}),/PROFILE_CHANGED/);
 for(const website of ['http://example.test','javascript:alert(1)','https://name:password@example.test','https://example.test/has space'])await assert.rejects(store.update(tenant,{...input,website}),/PROFILE_INVALID/);
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createOrganizationProfileStore(broken).update(tenant,{...input,revision:2,idempotencyKey:'rollback',name:'Rollback'}),/Injected commit/);
 assert.equal((await store.get(tenant)).revision,2);
 await store.update(tenant,{...input,name:'Latest',revision:2,idempotencyKey:'later'});
 assert.equal((await store.update(tenant,input)).name,'Latest','Old retry reverted a later profile');
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='ORGANIZATION_PROFILE_UPDATED'",[tenant.organizationId])).rows[0].n,2);
 await assert.rejects(store.get({...tenant,actorId:'foreign'}),/ADMIN_REQUIRED/);
 await assert.rejects(store.update({...tenant,actorId:'foreign'},input),/ADMIN_REQUIRED/);
 await assert.rejects(runtime.query('UPDATE organizations SET name=name WHERE false'),/permission denied/);
 await assert.rejects(runtime.query('SELECT public.update_organization_profile($1,$2,$3,$4,$5,$6,$7,$8)',['Name','','',1,actor,'no-tenant','reason','test']),/PROFILE_INVALID/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='update_organization_profile' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
 const http=createJobStatusHttpServer({statusService:{get:async()=>null,retry:async()=>null},organizationContextResolver:membership,organizationProfileStore:store,authenticator:{authenticate:async request=>request.headers.authorization?{subject:actor,roles:['organization_admin']}:null}});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${http.address().port}/api/v1/organization-profile`,headers={authorization:'Bearer test','x-organization-id':tenant.organizationId,'content-type':'application/json','idempotency-key':'http'};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer test'}})).status,409);
  const read=await fetch(url,{headers});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
  const body={name:'HTTP',description:'Updated in browser',website:'',revision:3,reason:'Correction'};
  for(const extra of [{organizationId:second.organizationId},{actorId:'spoof'},{status:'SUSPENDED'}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,...extra})})).status,422);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'idempotency-key':'stale-http'},body:JSON.stringify(body)})).status,409);
  await pool.query('DELETE FROM role_assignments WHERE organization_id=$1 AND subject=$2',[tenant.organizationId,actor]);
  assert.equal((await fetch(url,{headers})).status,403,'Global admin claim bypassed scoped role downgrade');
  await assert.rejects(store.update(tenant,input),/ADMIN_REQUIRED/);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));}
 console.log('Organization profile passed: scoped administration, normalized profile, concurrent retries, stale revision, non-reverting replay, rollback, strict HTTP fields, unsafe URL denial, role downgrade and restricted database writes.');
}finally{
 try{for(const table of ['audit_events','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=ANY($1::text[])`,[ids]);}
 finally{for(const signature of executions)await pool.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM local_runtime`);for(const table of added)await pool.query(`REVOKE SELECT ON ${table} FROM local_runtime`);await runtime.end();await pool.end();}
}
