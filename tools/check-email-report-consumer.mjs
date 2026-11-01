import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleEmailReportMessage,createEmailReportConsumer} from '../apps/worker/dist/email-report-consumer.js';
import {readEmailReportConfiguration} from '../apps/worker/dist/email-report-configuration.js';
const expected={topic:'/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test/providers/Microsoft.Communication/communicationServices/test',sender:'sender@example.test'};
const raw={id:randomUUID(),topic:expected.topic,eventType:'Microsoft.Communication.EmailDeliveryReportReceived',dataVersion:'1.0',organizationId:'forged',data:{sender:expected.sender,recipient:'private@example.test',messageId:randomUUID(),status:'Delivered',deliveryAttemptTimeStamp:new Date().toISOString(),deliveryStatusDetails:{statusMessage:'PRIVATE_DIAGNOSTIC'}}};
let settlements=[],applied=[],routes=0,fail=false,missing=false;
const settle={async complete(){settlements.push('complete');},async abandon(){settlements.push('abandon');},async deadLetter(reason){settlements.push(reason);}};
const base={expected,workerId:'worker',resolveOrganization:async id=>{routes++;assert.ok(id);return missing?null:'trusted-org';},apply:async(tenant,report)=>{if(fail)throw Error(typeof fail==='string'?fail:'PRIVATE_DATABASE_FAILURE');assert.equal(tenant.organizationId,'trusted-org');assert.equal(tenant.actorId,'worker');assert.equal(tenant.correlationId,report.id);assert.equal(report.deliveryStatusDetails,undefined);applied.push(report);},settle};
async function run(body=raw,deliveryCount=1){settlements=[];return handleEmailReportMessage({...base,message:{body,deliveryCount}});}
for(const body of [raw,[raw],JSON.stringify(raw),Buffer.from(JSON.stringify([raw]))]){assert.equal(await run(body),'COMPLETED');assert.deepEqual(settlements,['complete']);}
assert.equal(applied.length,4);
const before=routes;assert.equal(await run({...raw,topic:'foreign'}),'DEAD_LETTERED');assert.equal(routes,before);assert.deepEqual(settlements,['EMAIL_DELIVERY_EVENT_INVALID']);
assert.equal(await run([raw,{...raw,eventType:'unknown'}]),'DEAD_LETTERED');assert.equal(routes,before,'Partially processed invalid batch');
missing=true;assert.equal(await run(),'ABANDONED');assert.deepEqual(settlements,['abandon']);assert.equal(await run(raw,5),'DEAD_LETTERED');assert.deepEqual(settlements,['EMAIL_REPORT_RETRY_EXHAUSTED']);missing=false;
fail=true;assert.equal(await run(),'ABANDONED');assert.equal(await run(raw,5),'DEAD_LETTERED');
for(fail of ['EMAIL_REPORT_INVALID','EMAIL_REPORT_UNMATCHED','EMAIL_REPORT_CONFLICT']){assert.equal(await run(),'DEAD_LETTERED');assert.deepEqual(settlements,[fail]);}fail=false;
let partial=0;await handleEmailReportMessage({...base,apply:async()=>{if(++partial===2)throw Error('unavailable');},message:{body:[raw,{...raw,id:randomUUID()}],deliveryCount:1}});assert.equal(settlements.at(-1),'abandon');
await assert.rejects(handleEmailReportMessage({...base,message:{body:raw,deliveryCount:1},settle:{...settle,complete:async()=>{throw Error('Lock lost');}}}),/Lock lost/);
let handlers,subscriptionOptions,receiverOptions,queueName,closed=0,errors=[];
const receiver={subscribe(h,o){handlers=h;subscriptionOptions=o;return {async close(){closed++;}};},async close(){closed++;},async completeMessage(){settlements.push('complete');},async abandonMessage(){settlements.push('abandon');},async deadLetterMessage(message,options){assert.ok(!JSON.stringify(options).includes('PRIVATE'));settlements.push(options.deadLetterReason);}};
const consumer=createEmailReportConsumer({...base,client:{createReceiver(q,o){queueName=q;receiverOptions=o;return receiver;}},queueName:'reports',onError:e=>errors.push(e.message)});
assert.equal(queueName,'reports');assert.equal(receiverOptions.receiveMode,'peekLock');assert.equal(subscriptionOptions.autoCompleteMessages,false);assert.equal(subscriptionOptions.maxConcurrentCalls,2);
await handlers.processMessage({body:raw,deliveryCount:1});assert.equal(settlements.at(-1),'complete');await handlers.processError({error:Error('PRIVATE_DIAGNOSTIC')});assert.deepEqual(errors,['EMAIL_REPORT_RECEIVER_FAILED']);await consumer.close();await consumer.close();assert.equal(closed,2);
assert.equal(readEmailReportConfiguration({}),undefined);assert.equal(readEmailReportConfiguration({EMAIL_REPORTS_ENABLED:'false'}),undefined);
const environment={EMAIL_REPORTS_ENABLED:'true',EMAIL_REPORTS_SERVICE_BUS_NAMESPACE:'reports.servicebus.windows.net',SERVICE_BUS_NAMESPACE:'assets.servicebus.windows.net',EMAIL_REPORTS_QUEUE:'email-reports',ACS_EMAIL_RESOURCE_ID:expected.topic,ACS_EMAIL_SENDER_ADDRESS:expected.sender};
assert.equal(readEmailReportConfiguration(environment).topic,expected.topic);
for(const replacement of [{EMAIL_REPORTS_ENABLED:'yes'},{EMAIL_REPORTS_SERVICE_BUS_NAMESPACE:environment.SERVICE_BUS_NAMESPACE},{EMAIL_REPORTS_SERVICE_BUS_NAMESPACE:'https://example.test'},{EMAIL_REPORTS_QUEUE:'../assets'},{ACS_EMAIL_RESOURCE_ID:''},{ACS_EMAIL_SENDER_ADDRESS:'bad'}])assert.throws(()=>readEmailReportConfiguration({...environment,...replacement}),/^Error: EMAIL_REPORT_CONFIGURATION_INVALID$/);
console.log('Delivery receiver passed: single/batch/binary payloads, trusted tenant routing, atomic settlement boundaries, retry limits, sanitized DLQ/errors, lock-loss propagation, dedicated namespace configuration and idempotent shutdown.');
