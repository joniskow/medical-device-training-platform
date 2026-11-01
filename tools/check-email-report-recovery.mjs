import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createEmailReportRecovery} from '../apps/worker/dist/email-report-recovery.js';
const require=createRequire(new URL('../apps/worker/package.json',import.meta.url)),Long=require('long');
const tenant={organizationId:'org:one',actorId:'operator',correlationId:'test'},expected={topic:'/subscriptions/test/acs',sender:'sender@example.test'};
const raw={id:randomUUID(),topic:expected.topic,eventType:'Microsoft.Communication.EmailDeliveryReportReceived',dataVersion:'1.0',data:{sender:expected.sender,recipient:'private@example.test',messageId:randomUUID(),status:'Delivered',deliveryAttemptTimeStamp:new Date().toISOString(),deliveryStatusDetails:{statusMessage:'PRIVATE_DETAILS'}}};
const messages=Array.from({length:24},(_,i)=>({sequenceNumber:Long.fromNumber(i+1),messageId:'message:'+i,deadLetterReason:'EMAIL_REPORT_RETRY_EXHAUSTED',body:{...raw,id:'report:'+i}}));
let pending=[],released=[],completed=[],effects=[],audits=[],authorized=0,deny=false,auditFail=false,applyFail=false,completeFail=false;
const receiver={async peekMessages(count,options){return messages.filter(m=>!options||m.sequenceNumber.greaterThanOrEqual(options.fromSequenceNumber)).slice(0,count);},async receiveMessages(count){return pending.splice(0,count);},async abandonMessage(m){released.push(m.sequenceNumber.toString());},async completeMessage(m){if(completeFail)throw Error('lock lost');completed.push(m.sequenceNumber.toString());}};
const recovery=createEmailReportRecovery({receiver,expected,authorize:async context=>{authorized++;assert.equal(context.organizationId,tenant.organizationId);if(deny)throw Error('EMAIL_RECOVERY_OPERATOR_REQUIRED');},resolveOrganization:async id=>id===raw.data.messageId?tenant.organizationId:'foreign',apply:async(context,report)=>{if(applyFail)throw Error('report failed');assert.equal(context.actorId,'operator');effects.push(report.id);},audit:async(context,input)=>{if(auditFail)throw Error('audit failed');assert.equal(context.actorId,'operator');audits.push(input.stage);}});
const page=await recovery.list(tenant);assert.equal(page.items.length,20);assert.equal(page.nextCursor,'20');assert.ok(!JSON.stringify(page).includes('private@example.test'));assert.ok(!JSON.stringify(page).includes('PRIVATE_DETAILS'));
const next=await recovery.list(tenant,page.nextCursor);assert.equal(next.items.length,4);assert.equal(next.nextCursor,null);
const chosen=next.items[2],request={sequenceNumber:chosen.sequenceNumber,snapshot:chosen.snapshot,reason:'Database restored',requestId:'replay:one',maxScan:40};
const reset=()=>{pending=[...messages];released=[];completed=[];effects=[];audits=[];authorized=0;};
reset();assert.equal((await recovery.replay(tenant,request)).state,'COMPLETED');assert.deepEqual(completed,['23']);assert.equal(released.length,23);assert.deepEqual(audits,['STARTED','COMPLETED']);assert.deepEqual(effects,['report:22']);assert.equal(authorized,2);
reset();await assert.rejects(recovery.replay(tenant,{...request,snapshot:'0'.repeat(64)}),/MESSAGE_CHANGED/);assert.equal(effects.length,0);assert.equal(audits.length,0);assert.equal(released.length,24);
reset();auditFail=true;await assert.rejects(recovery.replay(tenant,request),/audit failed/);assert.equal(effects.length,0);assert.equal(completed.length,0);assert.equal(released.length,24);auditFail=false;
reset();applyFail=true;await assert.rejects(recovery.replay(tenant,request),/report failed/);assert.deepEqual(audits,['STARTED']);assert.equal(completed.length,0);applyFail=false;
reset();completeFail=true;await assert.rejects(recovery.replay(tenant,request),/lock lost/);assert.deepEqual(audits,['STARTED','COMPLETED']);assert.equal(released.length,24);completeFail=false;
reset();deny=true;await assert.rejects(recovery.list(tenant),/OPERATOR_REQUIRED/);await assert.rejects(recovery.replay(tenant,request),/OPERATOR_REQUIRED/);assert.equal(pending.length,24);deny=false;
reset();await assert.rejects(recovery.replay(tenant,{...request,maxScan:20}),/MESSAGE_UNAVAILABLE/);assert.equal(effects.length,0);assert.equal(released.length,20);
messages[22].deadLetterReason='EMAIL_REPORT_CONFLICT';const blocked=(await recovery.list(tenant,'20')).items[2];assert.equal(blocked.recoverable,false);reset();await assert.rejects(recovery.replay(tenant,{...request,snapshot:blocked.snapshot}),/MESSAGE_CHANGED/);assert.equal(effects.length,0);
messages[22].body={...raw,data:{...raw.data,messageId:randomUUID()}};assert.equal((await recovery.list(tenant,'20')).items.length,3);
for(const after of ['-1','not-a-number','9223372036854775808'])await assert.rejects(recovery.list(tenant,after),/REQUEST_INVALID/);
assert.deepEqual(await recovery.list(tenant,'9223372036854775807'),{items:[],nextCursor:null});
// Authority can disappear during the broker scan; recheck before audit or effects.
messages[22].deadLetterReason='EMAIL_REPORT_RETRY_EXHAUSTED';
messages[22].body=[{...raw,id:'batch:one'},{...raw,id:'batch:two'}];
const batchItem=(await recovery.list(tenant,'20')).items[2];
const batchRequest={...request,snapshot:batchItem.snapshot};
let authCalls=0,batchFailure=true;
const batchRecovery=createEmailReportRecovery({receiver,expected,
 authorize:async()=>{if(++authCalls===2&&deny)throw Error('EMAIL_RECOVERY_OPERATOR_REQUIRED');},
 resolveOrganization:async()=>tenant.organizationId,
 audit:async(_,input)=>audits.push(input.stage),
 apply:async(_,report)=>{if(report.id==='batch:two'&&batchFailure)throw Error('partial batch');effects.push(report.id);}
});
reset();deny=true;await assert.rejects(batchRecovery.replay(tenant,batchRequest),/OPERATOR_REQUIRED/);
assert.equal(effects.length,0);assert.equal(audits.length,0);assert.equal(released.length,24);deny=false;
reset();await assert.rejects(batchRecovery.replay(tenant,batchRequest),/partial batch/);
assert.deepEqual(effects,['batch:one']);assert.deepEqual(audits,['STARTED']);assert.equal(completed.length,0);assert.equal(released.length,24);
reset();batchFailure=false;await batchRecovery.replay(tenant,batchRequest);
assert.deepEqual(effects,['batch:one','batch:two']);assert.deepEqual(completed,['23']);
console.log('Report recovery passed: private paginated inspection, exact snapshot, multi-batch scan, authorization, audit-before-effects, non-retryable/foreign denial, failed-commit retention and lock release.');
