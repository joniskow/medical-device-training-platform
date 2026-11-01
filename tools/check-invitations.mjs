import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,seedActiveOrganizationMembership} from '../packages/db/dist/index.js';
import {createInvitationService,invitationDeliveryToken} from '../apps/api/dist/invitation-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {readInvitationConfiguration} from '../apps/api/dist/invitation-configuration.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const subject='invites:'+randomUUID(),keys=new Map([['test',randomBytes(32)]]),config={activeKeyId:'test',keys,expiryHours:72},service=createInvitationService(runtime,config),grants=[];
let org;const functions=['public.accept_organization_invitation(text,text,text,text,text,text)','public.create_organization_invitation(text,text,text,text,text,text,text,integer,text)','public.revoke_organization_invitation(text,text,text,text)'],executions=[];
try{
 await applyProcessingJobMigration(pool);
 for(const [table,privileges] of [['email_deliveries',['SELECT']],['organizations',['SELECT']],['role_assignments',['SELECT']],['organization_invitations',['SELECT']]])for(const privilege of privileges){
  if(!(await pool.query(`SELECT has_table_privilege('local_runtime',$1,$2) allowed`,[table,privilege])).rows[0].allowed){await pool.query(`GRANT ${privilege} ON ${table} TO local_runtime`);grants.push([table,privilege]);}
 }
 for(const fn of functions)if(!(await pool.query(`SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed`,[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);executions.push(fn);}
 org=(await createPostgresOrganizationMembershipStore(pool).createOrganization(subject,'Invitation fixture','fixture','test')).organizationId;
 const admin={organizationId:org,actorId:subject,correlationId:'test'},learner={...admin,actorId:subject+':learner'};
 const request={email:' Candidate@Example.test ',role:'author',idempotencyKey:'first'};
 const [invite,replay]=await Promise.all([service.create(admin,request),service.create(admin,request)]);
 assert.deepEqual(invite,replay);assert.equal(invite.intendedEmail,'candidate@example.test');
 const token=invitationDeliveryToken(invite.invitationId,'test',keys),acceptance={invitationId:invite.invitationId,token,role:'author'};
 const stored=(await pool.query(`SELECT row_to_json(i)::text value FROM organization_invitations i WHERE organization_id=$1`,[org])).rows[0].value;
 assert.ok(!stored.includes(token));assert.ok(!JSON.stringify(await service.list(admin)).includes(token));
 for(const table of ['outbox_events','audit_events'])assert.ok(!(await pool.query(`SELECT row_to_json(t)::text value FROM ${table} t WHERE organization_id=$1`,[org])).rows.some(r=>r.value.includes(token)));
 await assert.rejects(service.create(admin,{...request,role:'publisher'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(service.create(admin,{...request,role:'operator'}),/INVITATION_REQUEST_INVALID/);
 await assert.rejects(service.create(learner,{...request,idempotencyKey:'denied'}),/INVITATION_ADMIN_REQUIRED/);
 for(const email of [undefined,'wrong@example.test'])await assert.rejects(service.accept(learner,email,acceptance),/INVITATION_UNAVAILABLE/);
 await assert.rejects(service.accept({...learner,organizationId:'foreign'},'candidate@example.test',acceptance),/INVITATION_UNAVAILABLE/);
 await assert.rejects(service.accept(learner,'candidate@example.test',{...acceptance,role:'publisher'}),/INVITATION_UNAVAILABLE/);
 await assert.rejects(service.accept(learner,'candidate@example.test',{...acceptance,token:'x'.repeat(43)}),/INVITATION_UNAVAILABLE/);
 const brokenPool={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit failure');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createInvitationService(brokenPool,config).accept(learner,'candidate@example.test',acceptance),/Injected commit/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM organization_memberships WHERE subject=$1`,[learner.actorId])).rows[0].n,0);
 assert.equal((await pool.query(`SELECT status FROM organization_invitations WHERE invitation_id=$1`,[invite.invitationId])).rows[0].status,'PENDING');
 const outcomes=await Promise.allSettled([service.accept(learner,'candidate@example.test',acceptance),service.accept(learner,'candidate@example.test',acceptance)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.message==='INVITATION_UNAVAILABLE').length,1);
 assert.deepEqual(await createPostgresOrganizationMembershipStore(runtime).resolveOrganizationRoles(learner.actorId,org),['author']);
 await assert.rejects(service.revoke(admin,invite.invitationId,'Too late'),/INVITATION_UNAVAILABLE/);
 await assert.rejects(service.accept({...learner,actorId:subject+':different'},'candidate@example.test',acceptance),/INVITATION_UNAVAILABLE/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='ORGANIZATION_INVITATION_ACCEPTED'`,[org])).rows[0].n,1);
 const make=async key=>{const i=await service.create(admin,{email:'candidate@example.test',role:'learner',idempotencyKey:key});return {invitationId:i.invitationId,role:'learner',token:invitationDeliveryToken(i.invitationId,'test',keys)};};
 const revoked=await make('revoked');
 await assert.rejects(createInvitationService(brokenPool,config).revoke(admin,revoked.invitationId,'Rollback'),/Injected commit/);
 assert.equal((await pool.query('SELECT status FROM organization_invitations WHERE invitation_id=$1',[revoked.invitationId])).rows[0].status,'PENDING');
 await service.revoke(admin,revoked.invitationId,'Withdrawn');await service.revoke(admin,revoked.invitationId,'Retry');
 await assert.rejects(service.accept(learner,'candidate@example.test',revoked),/INVITATION_UNAVAILABLE/);
 const expired=await make('expired');await pool.query(`UPDATE organization_invitations SET expires_at=now()-interval '1 second' WHERE invitation_id=$1`,[expired.invitationId]);
 await assert.rejects(service.accept(learner,'candidate@example.test',expired),/INVITATION_UNAVAILABLE/);
 assert.equal((await service.list(admin)).items.find(i=>i.invitationId===expired.invitationId).status,'EXPIRED');
 const suspended=await make('suspended');await pool.query(`UPDATE organization_memberships SET status='SUSPENDED' WHERE organization_id=$1 AND subject=$2`,[org,learner.actorId]);
 await assert.rejects(service.accept(learner,'candidate@example.test',suspended),/INVITATION_UNAVAILABLE/);
 await pool.query(`UPDATE organization_memberships SET status='REMOVED' WHERE organization_id=$1 AND subject=$2`,[org,learner.actorId]);
 await service.accept(learner,'candidate@example.test',suspended);
 assert.deepEqual(await createPostgresOrganizationMembershipStore(runtime).resolveOrganizationRoles(learner.actorId,org),['learner'],'Rejoining removed member inherited stale author permission');
 const inactive=await make('inactive-org');await pool.query(`UPDATE organizations SET status='SUSPENDED' WHERE organization_id=$1`,[org]);
 await assert.rejects(service.accept(learner,'candidate@example.test',inactive),/INVITATION_UNAVAILABLE/);
 await pool.query(`UPDATE organizations SET status='ACTIVE' WHERE organization_id=$1`,[org]);
 await pool.query(`DELETE FROM role_assignments WHERE organization_id=$1 AND subject=$2`,[org,subject]);
 await assert.rejects(service.accept(learner,'candidate@example.test',inactive),/INVITATION_UNAVAILABLE/);
 await seedActiveOrganizationMembership(pool,{organizationId:org,subject,roles:['organization_admin']});
 const racing=await make('race');const race=await Promise.allSettled([service.revoke(admin,racing.invitationId,'Withdrawn'),service.accept(learner,'candidate@example.test',racing)]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await runtime.query('SELECT * FROM organization_invitations')).rowCount,0);
 assert.equal((await runtime.query(`SELECT public.accept_organization_invitation($1,$2,$3,$4,$5,$6) accepted`,[inactive.invitationId,'0'.repeat(64),'candidate@example.test',learner.actorId,'learner','test'])).rows[0].accepted,false);
 await assert.rejects(runtime.query("UPDATE organization_invitations SET status='ACCEPTED' WHERE false"),/permission denied/);
 await assert.rejects(runtime.query('INSERT INTO organization_invitations SELECT * FROM organization_invitations WHERE false'),/permission denied/);
 await assert.rejects(runtime.query(`UPDATE organization_memberships SET status='ACTIVE' WHERE false`),/permission denied/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname IN ('accept_organization_invitation','create_organization_invitation','revoke_organization_invitation') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n,0);
 // Creation and its delivery envelope must roll back together.
 await assert.rejects(createInvitationService(brokenPool,config).create(admin,{...request,idempotencyKey:'rollback'}),/Injected commit/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM organization_invitations WHERE organization_id=$1`,[org])).rows[0].n,6);
 for(let i=0;i<45;i++)await service.create(admin,{email:`page${i}@example.test`,role:'learner',idempotencyKey:'page:'+i});
 const page1=await service.list(admin),page2=await service.list(admin,page1.nextCursor);
 assert.equal(page1.items.length,50);assert.equal(page2.items.length,1);assert.equal(page2.nextCursor,null);
 assert.equal(new Set([...page1.items,...page2.items].map(i=>i.invitationId)).size,51);
 const signing=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=signing.publicKey.export({format:'jwk'});
 const authenticator=createEntraRequestAuthenticator({tenantId:'test-tenant',audience:'invitation-api',openIdConfigurationUrl:'https://identity.example.test/discovery',fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/discovery')?{issuer:'https://identity.example.test',jwks_uri:'https://identity.example.test/keys'}:{keys:[{...jwk,kid:'test',use:'sig',alg:'RS256'}]}))});
 const bearer=(actor,claims={})=>{
  const data=[{alg:'RS256',kid:'test'},{sub:actor,iss:'https://identity.example.test',aud:'invitation-api',tid:'test-tenant',exp:Math.floor(Date.now()/1000)+300,...claims}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return 'Bearer '+data+'.'+sign('RSA-SHA256',Buffer.from(data),signing.privateKey).toString('base64url');
 };
 const http=createJobStatusHttpServer({statusService:{get:async()=>null,retry:async()=>null},organizationContextResolver:createPostgresOrganizationMembershipStore(runtime),invitationService:service,authenticator});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 try{
  const root=`http://127.0.0.1:${http.address().port}/api/v1/invitations`,adminHeaders={authorization:bearer(subject),'content-type':'application/json','idempotency-key':'http'};
  const post=(path,body,headers=adminHeaders)=>fetch(root+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post('',{email:'http@example.test',role:'learner'},{})).status,401);
  assert.equal((await post('',{email:'http@example.test',role:'learner',organizationId:'forged'})).status,422);
  assert.equal((await post('',{email:'http@example.test',role:'learner'},{...adminHeaders,authorization:bearer(learner.actorId,{roles:['organization_admin']})})).status,403);
  const created=await post('',{email:'http@example.test',role:'learner'});assert.equal(created.status,200);assert.equal(created.headers.get('cache-control'),'no-store');
  const httpInvite=await created.json(),httpToken=invitationDeliveryToken(httpInvite.invitationId,'test',keys);
  assert.ok(!JSON.stringify(httpInvite).includes(httpToken));
  const payload={organizationId:org,invitationId:httpInvite.invitationId,token:httpToken,role:'learner',confirmed:true};
  const acceptedHeaders={authorization:bearer(subject+':http',{email:'http@example.test',email_verified:true}),'content-type':'application/json'};
  const previewPayload={organizationId:org,invitationId:httpInvite.invitationId,token:httpToken};
  const previewResponse=await post('/preview',previewPayload,acceptedHeaders);assert.equal(previewResponse.status,200);
  const preview=await previewResponse.json();assert.equal(preview.organizationName,'Invitation fixture');assert.equal(preview.role,'learner');assert.ok(!JSON.stringify(preview).includes(httpToken));
  assert.equal((await post('/preview',previewPayload,{...acceptedHeaders,authorization:bearer(subject+':http',{email:'wrong@example.test',email_verified:true})})).status,422);
  const responseBodies=[];
  for(const claims of [{email:'http@example.test'},{email:'http@example.test',email_verified:'true'},{email:'wrong@example.test',email_verified:true}]){
   const r=await post('/accept',payload,{...acceptedHeaders,authorization:bearer(subject+':http',claims)});assert.equal(r.status,422);responseBodies.push(await r.text());
  }
  assert.equal(new Set(responseBodies).size,1,'Identity failure leaked invitation state');
  for(const body of [{...payload,confirmed:false},{...payload,verifiedEmail:'http@example.test'},{...payload,subject:subject},{...payload,role:'organization_admin'},{...payload,organizationId:'foreign'}])assert.equal((await post('/accept',body,acceptedHeaders)).status,422);
  assert.equal((await fetch(root+'/accept',{headers:acceptedHeaders})).status,405);
  const accepted=await post('/accept',payload,acceptedHeaders);assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{organizationId:org,role:'learner'});
  assert.equal((await post('/accept',payload,acceptedHeaders)).status,422);
  assert.equal((await post('/preview',previewPayload,acceptedHeaders)).status,422);
  assert.deepEqual(await createPostgresOrganizationMembershipStore(runtime).resolveOrganizationRoles(subject+':http',org),['learner']);
  assert.equal((await fetch(root,{headers:acceptedHeaders})).status,403);
  const revokeInvite=await (await post('',{email:'revoke@example.test',role:'author'},{...adminHeaders,'idempotency-key':'http-revoke'})).json();
  assert.equal((await post('/'+encodeURIComponent(revokeInvite.invitationId)+'/revoke',{reason:'Withdrawn'})).status,200);
  assert.equal((await fetch(root,{headers:adminHeaders})).status,200);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));}
 assert.equal(readInvitationConfiguration({}).keys.size,0);
 assert.equal(readInvitationConfiguration({INVITATION_TOKEN_KEYS_JSON:JSON.stringify({test:'ab'.repeat(32)}),INVITATION_ACTIVE_KEY_ID:'test'}).keys.get('test').length,32);
 for(const env of [{INVITATION_TOKEN_KEYS_JSON:'secret-not-json'},{INVITATION_ACTIVE_KEY_ID:'missing'},{INVITATION_TOKEN_KEYS_JSON:JSON.stringify({test:'short'})},{INVITATION_EXPIRY_HOURS:'0'}])assert.throws(()=>readInvitationConfiguration(env),/^Error: INVITATION_CONFIGURATION_INVALID$/);
 console.log('Invitations passed: hashed secrets, scoped authority, atomic create/accept, single-use concurrency, expiry/revoke, verified-email requirement, suspended-member denial, safe rejoin and tenant isolation.');
}finally{
 try{if(org)for(const table of ['outbox_events','audit_events','organization_invitations','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);}
 finally{for(const fn of executions)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);for(const [table,privilege] of grants)await pool.query(`REVOKE ${privilege} ON ${table} FROM local_runtime`);await runtime.end();await pool.end();}
}
