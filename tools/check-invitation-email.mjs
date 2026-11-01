import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,createInvitationEmailStore,withTenantTransaction} from '../packages/db/dist/index.js';
import {createInvitationService,invitationDeliveryToken} from '../apps/api/dist/invitation-service.js';
import {createInvitationEmailProcessor} from '../apps/worker/dist/invitation-email.js';
import {createCourseChangeService} from '../apps/api/dist/course-change-service.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const actor='invite-mail:'+randomUUID(),keys=new Map([['test',randomBytes(32)]]),config={activeKeyId:'test',keys,expiryHours:72},added=[];
let org,org2,addedRateExecution=false,addedAttemptExecution=false;const rateLimit={scope:'test:'+randomUUID(),globalPerMinute:1000,organizationPerMinute:1000};const scopes=[rateLimit.scope];
try{
 await applyProcessingJobMigration(pool);
 if(!(await pool.query("SELECT has_function_privilege('local_runtime','public.record_invitation_email_attempt(text,text)','EXECUTE') allowed")).rows[0].allowed){await pool.query('GRANT EXECUTE ON FUNCTION public.record_invitation_email_attempt(text,text) TO local_runtime');addedAttemptExecution=true;}
 if(!(await pool.query("SELECT has_function_privilege('local_runtime','public.reserve_invitation_email_capacity(text,integer,integer)','EXECUTE') allowed")).rows[0].allowed){await pool.query('GRANT EXECUTE ON FUNCTION public.reserve_invitation_email_capacity(text,integer,integer) TO local_runtime');addedRateExecution=true;}
 for(const [table,permissions] of [['email_delivery_attempts',['SELECT']],['email_recipient_suppressions',['SELECT']],['organizations',['SELECT']],['role_assignments',['SELECT']],['organization_invitations',['SELECT']],['email_deliveries',['SELECT','INSERT','UPDATE']]])for(const permission of permissions)if(!(await pool.query(`SELECT has_table_privilege('local_runtime',$1,$2) allowed`,[table,permission])).rows[0].allowed){await pool.query(`GRANT ${permission} ON ${table} TO local_runtime`);added.push([table,permission]);}
 org=(await createPostgresOrganizationMembershipStore(pool).createOrganization(actor,'Email fixture','fixture','test')).organizationId;
 const tenant={organizationId:org,actorId:actor,correlationId:'test'},service=createInvitationService(pool,config),store=createInvitationEmailStore(runtime);
 const make=async key=>{const invitation=await service.create(tenant,{email:'recipient@example.test',role:'learner',idempotencyKey:key});return {...invitation,eventId:'deliver:'+invitation.invitationId};};
 const due=async id=>pool.query(`UPDATE outbox_events SET available_at=now()-interval '1 second' WHERE outbox_event_id=$1`,[id]);
 const state=async id=>(await pool.query(`SELECT * FROM outbox_events WHERE outbox_event_id=$1`,[id])).rows[0];
 const delivery=async id=>(await pool.query('SELECT * FROM email_deliveries WHERE email_delivery_id=$1',['email:'+id])).rows[0];
 const sent=[];
 const sender={async send(message){
  // Proves the external call happens after the claim transaction has committed.
  await withTenantTransaction(runtime,tenant,c=>c.query('SELECT outbox_event_id FROM outbox_events WHERE outbox_event_id=$1 FOR UPDATE NOWAIT',[message.eventId]));
  sent.push(message);return {providerMessageId:message.operationId};
 }};
 const processor=createInvitationEmailProcessor(runtime,{rateLimit,sender,keys,applicationOrigin:'https://training.example.test'});
 const first=await make('first');await Promise.all([processor.process(tenant,first.eventId),processor.process(tenant,first.eventId)]);
 assert.equal(sent.length,1);assert.equal((await state(first.eventId)).state,'PUBLISHED');assert.equal((await delivery(first.eventId)).status,'ACCEPTED');
 await processor.process(tenant,first.eventId);assert.equal(sent.length,1);
 const link=new URL(sent[0].plainText.split('\n').find(line=>line.startsWith('https://')));assert.equal(link.search,'');assert.equal(link.pathname,'/invitations');
 const token=invitationDeliveryToken(first.invitationId,'test',keys);assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),token);
 for(const table of ['email_deliveries','outbox_events','audit_events'])assert.ok(!(await pool.query(`SELECT row_to_json(t)::text value FROM ${table} t WHERE organization_id=$1`,[org])).rows.some(r=>r.value.includes(token)));
 const revoked=await make('revoked');await service.revoke(tenant,revoked.invitationId,'Withdrawn');await processor.process(tenant,revoked.eventId);assert.equal((await delivery(revoked.eventId)).status,'SKIPPED');assert.equal(sent.length,1);
 const expired=await make('expired');await pool.query(`UPDATE organization_invitations SET expires_at=now() WHERE invitation_id=$1`,[expired.invitationId]);await processor.process(tenant,expired.eventId);assert.equal((await delivery(expired.eventId)).status,'SKIPPED');
 const crashed=await make('crashed');const lease1=await store.claim(tenant,crashed.eventId);assert.ok(lease1);assert.equal(await store.claim(tenant,crashed.eventId),null);await due(crashed.eventId);const lease2=await store.claim(tenant,crashed.eventId);assert.notEqual(lease1.leaseToken,lease2.leaseToken);
 assert.equal(await store.finish(tenant,crashed.eventId,lease1.leaseToken,{accepted:true,providerMessageId:'stale'}),false);
 assert.equal(await store.finish(tenant,crashed.eventId,lease2.leaseToken,{accepted:true,providerMessageId:'new'}),true);
 const failing=await make('failing'),bad=createInvitationEmailProcessor(runtime,{rateLimit,keys,applicationOrigin:'https://training.example.test',sender:{async send(){throw Error('Secret '+token);}}});
 for(let i=0;i<5;i++){await due(failing.eventId);await bad.process(tenant,failing.eventId);assert.equal((await state(failing.eventId)).attempt_count,i+1);}
 assert.equal((await state(failing.eventId)).state,'FAILED');assert.equal((await delivery(failing.eventId)).status,'FAILED');assert.ok(!JSON.stringify(await state(failing.eventId)).includes(token));
 const recovery=createCourseChangeService(runtime),failed=await recovery.failedJobs(tenant);const row=failed.items.find(x=>x.jobId===failing.eventId);assert.ok(row);
 await recovery.retry(tenant,failing.eventId,{reason:'Sender restored',retryToken:row.retryToken,idempotencyKey:'retry'});await processor.process(tenant,failing.eventId);assert.equal((await state(failing.eventId)).state,'PUBLISHED');
 const missing=await make('missing-key');await createInvitationEmailProcessor(runtime,{rateLimit,sender,keys:new Map(),applicationOrigin:'https://training.example.test'}).process(tenant,missing.eventId);assert.equal((await state(missing.eventId)).state,'PENDING');
 const timed=await make('timeout');let aborted=false;await createInvitationEmailProcessor(runtime,{rateLimit,keys,applicationOrigin:'https://training.example.test',timeoutMs:5,sender:{send(message){message.signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}}}).process(tenant,timed.eventId);assert.ok(aborted);assert.equal((await delivery(timed.eventId)).status,'RETRY_PENDING');
 const foreign=await make('foreign');assert.equal(await store.claim({...tenant,organizationId:'foreign'},foreign.eventId),null);assert.equal((await state(foreign.eventId)).attempt_count,0);
 const fifth=await make('fifth');await pool.query(`UPDATE outbox_events SET attempt_count=5,state='CLAIMED',available_at=now() WHERE outbox_event_id=$1`,[fifth.eventId]);await processor.process(tenant,fifth.eventId);assert.equal((await state(fifth.eventId)).state,'FAILED');
 const rollback=await make('rollback');const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createInvitationEmailStore(broken).claim(tenant,rollback.eventId),/Injected commit/);assert.equal((await state(rollback.eventId)).state,'PENDING');assert.equal(await delivery(rollback.eventId),undefined);
 const claimed=await store.claim(tenant,rollback.eventId);await assert.rejects(createInvitationEmailStore(broken).finish(tenant,rollback.eventId,claimed.leaseToken,{accepted:true,providerMessageId:'accepted'}),/Injected commit/);assert.equal((await state(rollback.eventId)).state,'CLAIMED');assert.equal((await delivery(rollback.eventId)).status,'SENDING');
 for(const applicationOrigin of ['http://training.example.test','https://user:password@example.test','https://training.example.test/path','https://training.example.test/#token'])assert.throws(()=>createInvitationEmailProcessor(runtime,{rateLimit,sender,keys,applicationOrigin}));
 const quota={scope:'quota:'+randomUUID(),globalPerMinute:3,organizationPerMinute:2};scopes.push(quota.scope);
 const limited=createInvitationEmailProcessor(runtime,{sender,keys,applicationOrigin:'https://training.example.test',rateLimit:quota});
 const batch=await Promise.all(['quota1','quota2','quota3'].map(make)),before=sent.length;
 await Promise.all(batch.map(item=>limited.process(tenant,item.eventId)));
 assert.equal(sent.length-before,2,'Concurrent workers exceeded organization quota');
 const deferred=(await Promise.all(batch.map(async item=>({...item,event:await state(item.eventId)})))).find(item=>item.event.state==='PENDING');
 assert.ok(deferred);assert.equal(deferred.event.attempt_count,0);assert.equal((await delivery(deferred.eventId)).status,'RATE_LIMITED');assert.ok(new Date(deferred.event.available_at)>new Date());
 org2=(await createPostgresOrganizationMembershipStore(pool).createOrganization(actor,'Second email fixture','second','test')).organizationId;
 const tenant2={...tenant,organizationId:org2};
 const other=await service.create(tenant2,{email:'other@example.test',role:'learner',idempotencyKey:'other1'}),other2=await service.create(tenant2,{email:'other2@example.test',role:'learner',idempotencyKey:'other2'});
 await limited.process(tenant2,'deliver:'+other.invitationId);assert.equal(sent.length-before,3);
 await limited.process(tenant2,'deliver:'+other2.invitationId);assert.equal(sent.length-before,3,'Other tenant bypassed shared provider quota');assert.equal((await state('deliver:'+other2.invitationId)).attempt_count,0);
 await due(deferred.eventId);await limited.process(tenant,deferred.eventId);assert.equal((await state(deferred.eventId)).attempt_count,0,'Repeated rate deferral consumed retries');
 const bucketKeys=(await pool.query(`SELECT 'global:'||encode(sha256(convert_to($1,'UTF8')),'hex') AS key UNION ALL SELECT 'organization:'||encode(sha256(convert_to(jsonb_build_array($1::text,o)::text,'UTF8')),'hex') FROM unnest($2::text[]) o`,[quota.scope,[org,org2]])).rows.map(row=>row.key);
 assert.equal((await pool.query('SELECT reserved_count FROM email_rate_buckets WHERE bucket_key=$1',[bucketKeys.find(key=>key.startsWith('global:'))])).rows[0].reserved_count,3);
 await pool.query(`UPDATE email_rate_buckets SET window_started_at=now()-interval '61 seconds' WHERE bucket_key=ANY($1::text[])`,[bucketKeys]);
 await due(deferred.eventId);await limited.process(tenant,deferred.eventId);assert.equal((await state(deferred.eventId)).state,'PUBLISHED');
 const quotaRollback=await make('quota-rollback');const beforeRollback=(await pool.query('SELECT reserved_count FROM email_rate_buckets WHERE bucket_key=$1',[bucketKeys.find(key=>key.startsWith('global:'))])).rows[0].reserved_count;
 await assert.rejects(createInvitationEmailStore(broken,quota).claim(tenant,quotaRollback.eventId),/Injected commit/);
 assert.equal((await state(quotaRollback.eventId)).attempt_count,0);assert.equal((await pool.query('SELECT reserved_count FROM email_rate_buckets WHERE bucket_key=$1',[bucketKeys.find(key=>key.startsWith('global:'))])).rows[0].reserved_count,beforeRollback,'Failed claim consumed rate capacity');
 await assert.rejects(runtime.query('SELECT * FROM email_rate_buckets'),/permission denied/);
 await assert.rejects(runtime.query('SELECT public.reserve_invitation_email_capacity($1,3,2)',[quota.scope]),/EMAIL_RATE_CONFIGURATION_INVALID/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='reserve_invitation_email_capacity' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n,0);
 console.log('Invitation email passed: durable global/tenant quotas, concurrent limits, no retry consumption on deferral, window rollover, quota rollback, controlled counter access, committed claims, lease fencing, suppression, retries, recovery and safe failures.');
}finally{
 try{if(org)for(const table of ['email_delivery_attempts','email_deliveries','outbox_events','audit_events','organization_invitations','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=ANY($1::text[])`,[[org,org2].filter(Boolean)]);
 for(const scope of scopes)await pool.query("DELETE FROM email_rate_buckets WHERE bucket_key='global:'||encode(sha256(convert_to($1,'UTF8')),'hex') OR bucket_key IN (SELECT 'organization:'||encode(sha256(convert_to(jsonb_build_array($1::text,o)::text,'UTF8')),'hex') FROM unnest($2::text[]) o)",[scope,[org,org2].filter(Boolean)]);}
 finally{if(addedAttemptExecution)await pool.query('REVOKE EXECUTE ON FUNCTION public.record_invitation_email_attempt(text,text) FROM local_runtime');if(addedRateExecution)await pool.query('REVOKE EXECUTE ON FUNCTION public.reserve_invitation_email_capacity(text,integer,integer) FROM local_runtime');for(const [table,permission] of added)await pool.query(`REVOKE ${permission} ON ${table} FROM local_runtime`);await runtime.end();await pool.end();}
}
