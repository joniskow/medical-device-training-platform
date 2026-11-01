import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,createOrganizationLifecycleStore,createOrganizationProfileStore} from '../packages/db/dist/index.js';
import {createPublicVerificationService} from '../apps/api/dist/public-verification-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const actor='lifecycle:'+randomUUID(),added=[],fn='public.set_organization_status(text,integer,text,text,text,text)',publicId=randomBytes(32).toString('base64url'),digest=s=>createHash('sha256').update(s).digest('hex');
let org,execution=false,allowed=true;
try{
 await applyProcessingJobMigration(pool);
 for(const table of ['organizations','role_assignments'])if(!(await pool.query("SELECT has_table_privilege('local_runtime',$1,'SELECT') allowed",[table])).rows[0].allowed){await pool.query(`GRANT SELECT ON ${table} TO local_runtime`);added.push(table);}
 if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);execution=true;}
 org=(await createPostgresOrganizationMembershipStore(pool).createOrganization(actor,'Lifecycle fixture','fixture','test')).organizationId;
 const tenant={organizationId:org,actorId:actor,correlationId:'test'},memberships=createPostgresOrganizationMembershipStore(runtime);
 const authorize=async()=>{if(!allowed)throw Error('OPERATOR_REQUIRED');},store=createOrganizationLifecycleStore(runtime,authorize);
 await pool.query("INSERT INTO courses(course_id,organization_id,name,status,created_by,created_at,updated_at) VALUES($1,$2,'History','ACTIVE',$3,now(),now())",[actor,org,actor]);
 await pool.query("INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$1,$2,1,'{}','PUBLISHED',$3,now(),now())",[actor,org,actor]);
 await pool.query("INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,$1,$1,'ACTIVE',now(),now())",[actor,org]);
 await pool.query("INSERT INTO progress_events(progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at) VALUES($1,$2,$1,$1,'fixture.completed','{}',now())",[actor,org]);
 await pool.query("INSERT INTO credentials(credential_id,organization_id,learner_id,course_version_id,public_id,public_id_hash,status,issued_at,created_at,updated_at,evidence) VALUES($1,$2,$1,$1,$3,$4,'ACTIVE',now(),now(),now(),'{\"fixture\":true}')",[actor,org,publicId,digest(publicId)]);
 await pool.query("INSERT INTO credential_verifications(public_id_hash,public_fields,status,issued_at) VALUES($1,'{\"issuerName\":\"Lifecycle fixture\",\"courseTitle\":\"History\"}','ACTIVE',now())",[digest(publicId)]);
 const historyTables=['organization_memberships','role_assignments','courses','course_versions','enrollments','progress_events','credentials'];
 const history=async()=>Promise.all(historyTables.map(async table=>(await pool.query(`SELECT row_to_json(t) value FROM ${table} t WHERE organization_id=$1`,[org])).rows));
 const before=await history(),verifier=createPublicVerificationService(pool);
 const input={status:'SUSPENDED',revision:1,reason:'Incident investigation',idempotencyKey:'suspend',confirmed:true};
 assert.equal((await store.get(tenant)).status,'ACTIVE');
 allowed=false;await assert.rejects(store.get(tenant),/OPERATOR_REQUIRED/);await assert.rejects(store.setStatus(tenant,input),/OPERATOR_REQUIRED/);allowed=true;
 await assert.rejects(store.setStatus(tenant,{...input,confirmed:false}),/LIFECYCLE_INVALID/);
 await assert.rejects(store.setStatus({...tenant,organizationId:'foreign'},input),/ACCESS_DENIED/);
 await assert.rejects(store.setStatus({...tenant,actorId:'foreign'},input),/ACCESS_DENIED/);
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createOrganizationLifecycleStore(broken,authorize).setStatus(tenant,input),/Injected commit/);
 assert.equal((await store.get(tenant)).revision,1);
 const server=createJobStatusHttpServer({statusService:{get:async()=>({state:'SUCCEEDED'}),retry:async()=>null},organizationContextResolver:memberships,organizationProfileStore:createOrganizationProfileStore(runtime),authenticator:{authenticate:async()=>({subject:actor,roles:['operator']})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/v1/organization-profile`,headers={'x-organization-id':org};
  assert.equal((await fetch(url,{headers})).status,200);
  const results=await Promise.all([store.setStatus(tenant,input),store.setStatus(tenant,input)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].revision,2);
  assert.equal((await store.get(tenant)).status,'SUSPENDED','Operator cannot inspect a suspended organization');
  assert.deepEqual(await memberships.resolveActiveOrganizations(actor),[]);assert.deepEqual(await memberships.resolveOrganizationRoles(actor,org),[]);
  assert.equal((await fetch(url,{headers})).status,403);
  await assert.rejects(memberships.selectOrganization(actor,org,'select','test'),/MEMBERSHIP_REQUIRED/);
  await assert.rejects(createOrganizationProfileStore(runtime).get(tenant),/ADMIN_REQUIRED/);
  assert.equal((await verifier.verify(publicId,actor)).status,'ACTIVE');
  assert.deepEqual(await history(),before,'Suspension modified historical or membership records');
  await assert.rejects(store.setStatus(tenant,{...input,reason:'Changed'}),/IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(store.setStatus(tenant,{...input,idempotencyKey:'stale'}),/LIFECYCLE_CHANGED/);
  const active=await store.setStatus(tenant,{...input,status:'ACTIVE',revision:2,idempotencyKey:'reactivate',reason:'Incident resolved'});assert.equal(active.revision,3);
  assert.equal((await fetch(url,{headers})).status,200);
  assert.deepEqual(await memberships.resolveOrganizationRoles(actor,org),['organization_admin']);
  assert.equal((await store.setStatus(tenant,input)).status,'ACTIVE','Old suspension replay reverted reactivation');
  assert.deepEqual(await history(),before);
  await pool.query("UPDATE organization_memberships SET status='SUSPENDED' WHERE organization_id=$1 AND subject=$2",[org,actor]);
  await assert.rejects(store.get(tenant),/ACCESS_DENIED/);await assert.rejects(store.setStatus(tenant,{...input,revision:3,idempotencyKey:'lost-access'}),/ACCESS_DENIED/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='ORGANIZATION_STATUS_CHANGED'",[org])).rows[0].n,2);
 await assert.rejects(runtime.query("UPDATE organizations SET status='SUSPENDED' WHERE false"),/permission denied/);
 await assert.rejects(runtime.query('SELECT public.set_organization_status($1,$2,$3,$4,$5,$6)',['SUSPENDED',1,actor,'no-tenant','reason','test']),/LIFECYCLE_INVALID/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='set_organization_status' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
 console.log('Organization lifecycle passed: operator/membership boundaries, confirmation, tenant isolation, concurrent retries, rollback, stale and non-reverting replay, suspended HTTP/context denial, reactivation and preserved history/public verification.');
}finally{
 try{
  await pool.query('DELETE FROM public_verification_limits WHERE bucket_key=ANY($1::text[])',[[digest('address:'+actor),digest('credential:'+publicId)]]);
  if(org)for(const table of ['progress_events','credentials','enrollments','course_versions','courses','audit_events','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
 }finally{if(execution)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);for(const table of added)await pool.query(`REVOKE SELECT ON ${table} FROM local_runtime`);await runtime.end();await pool.end();}
}
