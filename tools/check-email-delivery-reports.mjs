import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,createInvitationEmailStore,createEmailDeliveryReportStore,createEmailReportRecoveryAudit,createEmailSuppressionReview} from '../packages/db/dist/index.js';
import {createInvitationService} from '../apps/api/dist/invitation-service.js';
import {parseAzureEmailDeliveryEvents} from '../apps/worker/dist/email-delivery-event.js';
import {handleEmailReportMessage} from '../apps/worker/dist/email-report-consumer.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const actor='reports:'+randomUUID(),added=[],executions=[];let org;
const routingRole='report_route_'+randomUUID().replaceAll('-','');let routingCreated=false;
try{
 await applyProcessingJobMigration(pool);
 for(const [table,permissions] of [['organizations',['SELECT']],['role_assignments',['SELECT']],['organization_invitations',['SELECT']],['email_deliveries',['SELECT','INSERT','UPDATE']],['email_delivery_attempts',['SELECT']],['email_delivery_reports',['SELECT']],['email_recipient_suppressions',['SELECT']]])for(const permission of permissions)if(!(await pool.query(`SELECT has_table_privilege('local_runtime',$1,$2) allowed`,[table,permission])).rows[0].allowed){await pool.query(`GRANT ${permission} ON ${table} TO local_runtime`);added.push([table,permission]);}
 for(const fn of ['public.release_email_suppression(text,integer,text,text,text,text)','public.record_invitation_email_attempt(text,text)','public.apply_email_delivery_report(text,text,text,text,timestamptz,text,text)'])if(!(await pool.query(`SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed`,[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);executions.push(fn);}
 org=(await createPostgresOrganizationMembershipStore(pool).createOrganization(actor,'Report fixture','fixture','test')).organizationId;
 const tenant={organizationId:org,actorId:actor,correlationId:'test'},service=createInvitationService(pool,{keys:new Map([['test',randomBytes(32)]]),activeKeyId:'test',expiryHours:72}),store=createInvitationEmailStore(runtime),reports=createEmailDeliveryReportStore(runtime);
 const invite=await service.create(tenant,{email:'recipient@example.test',role:'learner',idempotencyKey:'first'}),eventId='deliver:'+invite.invitationId,claim=await store.claim(tenant,eventId);
 const now=new Date(Date.now()-1000).toISOString(),report={id:randomUUID(),operationId:claim.leaseToken,recipient:'recipient@example.test',status:'Delivered',occurredAt:now};
 const options={topic:'/subscriptions/test/resourceGroups/test/providers/Microsoft.Communication/communicationServices/test',sender:'sender@example.test'};
 const raw={id:report.id,topic:options.topic,eventType:'Microsoft.Communication.EmailDeliveryReportReceived',dataVersion:'1.0',data:{sender:options.sender,recipient:report.recipient,messageId:report.operationId,status:report.status,deliveryAttemptTimeStamp:now,deliveryStatusDetails:{statusMessage:'SECRET_PROVIDER_DIAGNOSTIC'}}};
 assert.deepEqual(parseAzureEmailDeliveryEvents([raw],options),[report]);
 for(const bad of [{...raw,topic:'foreign'},{...raw,data:{...raw.data,sender:'foreign@example.test'}},{...raw,data:{...raw.data,status:'Unknown'}},{...raw,eventType:'Microsoft.Communication.EmailEngagementTrackingReportReceived'}])assert.throws(()=>parseAzureEmailDeliveryEvents([bad],options),/^Error: EMAIL_DELIVERY_EVENT_INVALID$/);
 assert.throws(()=>parseAzureEmailDeliveryEvents('x'.repeat(65537),options),/EVENT_INVALID/);
 await assert.rejects(reports.apply({...tenant,organizationId:'foreign'},report),/EMAIL_REPORT_UNMATCHED/);
 await assert.rejects(reports.apply(tenant,{...report,recipient:'wrong@example.test'}),/EMAIL_REPORT_UNMATCHED/);
 const results=await Promise.all([reports.apply(tenant,report),reports.apply(tenant,report)]);assert.equal(results.filter(r=>r.replayed).length,1);
 await pool.query(`CREATE ROLE ${routingRole} NOLOGIN`);routingCreated=true;
 await pool.query(`GRANT USAGE ON SCHEMA public TO ${routingRole}`);
 await pool.query(`GRANT SELECT(operation_id,organization_id) ON email_delivery_attempts TO ${routingRole}`);
 await pool.query(`CREATE POLICY ${routingRole} ON email_delivery_attempts FOR SELECT TO ${routingRole} USING(true)`);
 const routing=await pool.connect();
 try{
  await routing.query(`SET ROLE ${routingRole}`);
  assert.equal((await routing.query('SELECT organization_id FROM email_delivery_attempts WHERE operation_id=$1',[claim.leaseToken])).rows[0].organization_id,org);
  await assert.rejects(routing.query('SELECT recipient_hash FROM email_delivery_attempts'),/permission denied/);
  await assert.rejects(routing.query("UPDATE email_delivery_attempts SET recipient_hash='forged' WHERE false"),/permission denied/);
  let completed=false;
  const outcome=await handleEmailReportMessage({expected:options,workerId:'report-worker',message:{body:raw,deliveryCount:1},resolveOrganization:async id=>(await routing.query('SELECT organization_id FROM email_delivery_attempts WHERE operation_id=$1',[id])).rows[0]?.organization_id??null,apply:(context,value)=>reports.apply(context,value),settle:{complete:async()=>{completed=true;},abandon:async()=>assert.fail('Unexpected abandon'),deadLetter:async()=>assert.fail('Unexpected DLQ')}});
  assert.equal(outcome,'COMPLETED');assert.ok(completed);
 }finally{await routing.query('RESET ROLE');routing.release();}
 await assert.rejects(reports.apply(tenant,{...report,status:'Bounced'}),/EMAIL_REPORT_CONFLICT/);
 const delivery=async()=>(await pool.query(`SELECT * FROM email_deliveries WHERE email_delivery_id=$1`,['email:'+eventId])).rows[0];
 assert.equal((await delivery()).provider_status,'PROVIDER_DELIVERED');
 await store.finish(tenant,eventId,claim.leaseToken,{accepted:true,providerMessageId:claim.leaseToken});
 assert.equal((await delivery()).provider_status,'PROVIDER_DELIVERED','Late sender acknowledgement erased early delivery report');
 const olderBounce={...report,id:randomUUID(),status:'Bounced',occurredAt:new Date(Date.parse(now)-1000).toISOString()};
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 const recoveryAudit=createEmailReportRecoveryAudit(runtime),request={requestId:'recovery:test',snapshot:'a'.repeat(64),reason:'Database restored',stage:'STARTED'};
 await Promise.all([recoveryAudit(tenant,request),recoveryAudit(tenant,request)]);
 await recoveryAudit(tenant,{...request,stage:'COMPLETED'});
 await recoveryAudit(tenant,{...request,stage:'COMPLETED'});
 await assert.rejects(recoveryAudit(tenant,{...request,reason:'Different reason'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(recoveryAudit(tenant,{...request,requestId:'not-started',stage:'COMPLETED'}),/EMAIL_RECOVERY_NOT_STARTED/);
 await assert.rejects(createEmailReportRecoveryAudit(broken)(tenant,{...request,requestId:'rollback'}),/Injected commit/);
 assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type LIKE 'EMAIL_REPORT_RECOVERY_%'`,[org])).rows[0].n,2);
 await assert.rejects(createEmailDeliveryReportStore(broken).apply(tenant,olderBounce),/Injected commit/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM email_recipient_suppressions WHERE organization_id=$1',[org])).rows[0].n,0);
 await reports.apply(tenant,olderBounce);assert.equal((await delivery()).provider_status,'PROVIDER_DELIVERED','Old status replaced newer delivery');
 assert.equal((await pool.query('SELECT count(*)::int n FROM email_recipient_suppressions WHERE organization_id=$1',[org])).rows[0].n,1);
 await reports.apply(tenant,{...report,id:randomUUID(),status:'Bounced'});assert.equal((await delivery()).provider_status,'PROVIDER_BOUNCED','Equal-timestamp hard bounce lost precedence');
 await reports.apply(tenant,{...report,id:randomUUID(),status:'Delivered'});assert.equal((await delivery()).provider_status,'PROVIDER_BOUNCED');
 const next=await service.create(tenant,{email:'RECIPIENT@example.test',role:'learner',idempotencyKey:'next'});assert.equal(await store.claim(tenant,'deliver:'+next.invitationId),null);
 assert.equal((await pool.query('SELECT status FROM email_deliveries WHERE email_delivery_id=$1',['email:deliver:'+next.invitationId])).rows[0].status,'SUPPRESSED');
 assert.equal((await pool.query('SELECT attempt_count FROM outbox_events WHERE outbox_event_id=$1',['deliver:'+next.invitationId])).rows[0].attempt_count,0);
 await assert.rejects(reports.apply(tenant,{...report,id:randomUUID(),occurredAt:'2099-01-01T00:00:00Z'}),/EMAIL_REPORT_INVALID/);
 const review=createEmailSuppressionReview(runtime,async()=>{}),listed=await review.list(tenant);
 assert.equal(listed.items.length,1);assert.equal(listed.items[0].releasedAt,null);
 const releaseInput={recipientHash:listed.items[0].recipientHash,revision:listed.items[0].revision,requestId:'release:one',reason:'Mailbox repaired and recipient consent verified',confirmed:true};
 await assert.rejects(createEmailSuppressionReview(runtime,async()=>{throw Error('operator required');}).list(tenant),/operator required/);
 assert.deepEqual((await review.list({...tenant,organizationId:'foreign'})).items,[]);
 await assert.rejects(createEmailSuppressionReview(runtime,async()=>{throw Error('operator required');}).release(tenant,releaseInput),/operator required/);
 await assert.rejects(review.release(tenant,{...releaseInput,confirmed:false}),/REQUEST_INVALID/);
 await assert.rejects(review.release({...tenant,organizationId:'foreign'},releaseInput),/ACCESS_DENIED/);
 await assert.rejects(review.release(tenant,{...releaseInput,revision:1}),/CHANGED/);
 await assert.rejects(createEmailSuppressionReview(broken,async()=>{}).release(tenant,releaseInput),/Injected commit/);
 assert.equal((await review.list(tenant)).items[0].releasedAt,null);
 const released=await Promise.all([review.release(tenant,releaseInput),review.release(tenant,releaseInput)]);
 assert.equal(released.filter(r=>r.replayed).length,1);
 assert.ok((await review.list(tenant)).items[0].releasedAt);
 await assert.rejects(review.release(tenant,{...releaseInput,reason:'changed reason'}),/IDEMPOTENCY_KEY_REUSED/);
 const renewed=await service.create(tenant,{email:'recipient@example.test',role:'learner',idempotencyKey:'after-release'});
 assert.ok(await store.claim(tenant,'deliver:'+renewed.invitationId));
 // An identical receipt cannot re-suppress; new bounce evidence must do so.
 await reports.apply(tenant,olderBounce);assert.ok((await review.list(tenant)).items[0].releasedAt);
 await reports.apply(tenant,{...olderBounce,id:randomUUID()});assert.equal((await review.list(tenant)).items[0].releasedAt,null);
 assert.equal((await review.release(tenant,releaseInput)).replayed,true);
 assert.equal((await review.list(tenant)).items[0].releasedAt,null,'Old release replay cleared a new suppression');
 await assert.rejects(review.release(tenant,{...releaseInput,requestId:'release:stale'}),/CHANGED/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='EMAIL_SUPPRESSION_RELEASED'",[org])).rows[0].n,1);
 await assert.rejects(runtime.query('UPDATE email_recipient_suppressions SET released_at=now() WHERE false'),/permission denied/);
 await assert.rejects(runtime.query("SELECT public.release_email_suppression($1,$2,$3,$4,$5,$6)",[releaseInput.recipientHash,releaseInput.revision,'missing-tenant','reason',actor,'test']),/REQUEST_INVALID/);

 for(const table of ['email_delivery_attempts','email_delivery_reports','email_recipient_suppressions']){
  await assert.rejects(runtime.query(`INSERT INTO ${table} SELECT * FROM ${table} WHERE false`),/permission denied/);
  assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount,0);
 }
 assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname IN ('record_invitation_email_attempt','apply_email_delivery_report','release_email_suppression') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].n,0);
 for(const table of ['email_delivery_reports','email_recipient_suppressions','audit_events'])assert.ok(!(await pool.query(`SELECT row_to_json(t)::text value FROM ${table} t WHERE organization_id=$1`,[org])).rows.some(r=>r.value.includes('SECRET_PROVIDER_DIAGNOSTIC')||r.value.includes('recipient@example.test')));
 // Cursor pagination covers released and active rows, without exposing addresses.
 for(let i=0;i<51;i++)await pool.query("INSERT INTO email_recipient_suppressions(organization_id,recipient_hash,reason,report_id,created_at) VALUES($1,$2,'Bounced','pagination',now())",[org,i.toString(16).padStart(64,'0')]);
 const firstPage=await review.list(tenant),lastPage=await review.list(tenant,firstPage.nextCursor);
 assert.equal(firstPage.items.length,50);assert.equal(lastPage.items.length,2);assert.equal(lastPage.nextCursor,null);
 assert.equal(new Set([...firstPage.items,...lastPage.items].map(row=>row.recipientHash)).size,52);
 await assert.rejects(review.list(tenant,'invalid'),/REQUEST_INVALID/);
 console.log('Email reports and suppression review passed: correlation, replay/order, atomic release/audit, confirmation and access denial, stale/concurrent release, rollback, future claim eligibility, re-suppression, non-reverting replay, private pagination and restricted writes.');
}finally{
 try{if(org)for(const table of ['email_delivery_reports','email_recipient_suppressions','email_delivery_attempts','email_deliveries','outbox_events','audit_events','organization_invitations','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);}
 finally{if(routingCreated){await pool.query(`DROP POLICY IF EXISTS ${routingRole} ON email_delivery_attempts`);await pool.query(`REVOKE SELECT(operation_id,organization_id) ON email_delivery_attempts FROM ${routingRole}`);await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${routingRole}`);await pool.query(`DROP ROLE ${routingRole}`);}for(const fn of executions)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);for(const [table,permission] of added)await pool.query(`REVOKE ${permission} ON ${table} FROM local_runtime`);await runtime.end();await pool.end();}
}
