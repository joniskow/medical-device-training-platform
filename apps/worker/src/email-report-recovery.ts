import {createHash} from 'node:crypto';
import Long from 'long';
import type {ServiceBusReceiver,ServiceBusReceivedMessage} from '@azure/service-bus';
import type {EmailDeliveryReport} from '@medical-device/db';
import type {TenantContext} from '@medical-device/contracts';
import {parseAzureEmailDeliveryEvents} from './email-delivery-event.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const retryable=new Set(['EMAIL_REPORT_RETRY_EXHAUSTED','MaxDeliveryCountExceeded','TTLExpiredException']);
interface RecoveryOptions {
 receiver:Pick<ServiceBusReceiver,'peekMessages'|'receiveMessages'|'abandonMessage'|'completeMessage'>;
 expected:{topic:string;sender:string};
 authorize(tenant:TenantContext):Promise<void>;
 resolveOrganization(operationId:string):Promise<string|null>;
 apply(tenant:TenantContext,report:EmailDeliveryReport):Promise<unknown>;
 audit(tenant:TenantContext,input:{requestId:string;snapshot:string;reason:string;stage:'STARTED'|'COMPLETED'}):Promise<void>;
}
function sequence(value:string){if(!/^[0-9]{1,19}$/.test(value)||BigInt(value)>9223372036854775807n)throw Error('EMAIL_RECOVERY_REQUEST_INVALID');return Long.fromString(value);}
export function createEmailReportRecovery(options:RecoveryOptions){
 async function inspect(tenant:TenantContext,message:ServiceBusReceivedMessage){
  if(!message.sequenceNumber)return null;
  let reports:EmailDeliveryReport[];try{reports=parseAzureEmailDeliveryEvents(message.body,options.expected);}catch{return null;}
  for(const report of reports)if(await options.resolveOrganization(report.operationId)!==tenant.organizationId)return null;
  const snapshot=digest([message.sequenceNumber.toString(),message.messageId,message.deadLetterReason,reports]);
  return {reports,projection:{sequenceNumber:message.sequenceNumber.toString(),snapshot,recoverable:retryable.has(message.deadLetterReason??''),reason:retryable.has(message.deadLetterReason??'')?message.deadLetterReason:'NON_RETRYABLE',reportCount:reports.length}};
 }
 return {
  async list(tenant:TenantContext,after?:string){
   await options.authorize(tenant);
   const cursor=after===undefined?undefined:sequence(after);
   if(cursor?.equals(Long.MAX_VALUE))return {items:[],nextCursor:null};
   const from=cursor?.add(1);
   const messages=await options.receiver.peekMessages(20,from?{fromSequenceNumber:from}:undefined);
   const items=[];for(const message of messages){const item=await inspect(tenant,message);if(item)items.push(item.projection);}
   return {items,nextCursor:messages.length===20?messages.at(-1)?.sequenceNumber?.toString()??null:null};
  },
  async replay(tenant:TenantContext,input:{sequenceNumber:string;snapshot:string;reason:string;requestId:string;maxScan?:number}){
   sequence(input.sequenceNumber);
   if(!/^[a-f0-9]{64}$/.test(input.snapshot)||!input.reason.trim()||input.reason.length>2000||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId))throw Error('EMAIL_RECOVERY_REQUEST_INVALID');
   const maxScan=input.maxScan??200;if(!Number.isInteger(maxScan)||maxScan<20||maxScan>10000)throw Error('EMAIL_RECOVERY_REQUEST_INVALID');
   await options.authorize(tenant);
   const locked:ServiceBusReceivedMessage[]=[];
   let completed:ServiceBusReceivedMessage|undefined;
   try{
    while(locked.length<maxScan&&!locked.some(item=>item.sequenceNumber?.toString()===input.sequenceNumber)){
     const batch=await options.receiver.receiveMessages(Math.min(20,maxScan-locked.length),{maxWaitTimeInMs:1000});
     if(!batch.length)break;locked.push(...batch);
    }
    const message=locked.find(item=>item.sequenceNumber?.toString()===input.sequenceNumber);
    if(!message)throw Error('EMAIL_RECOVERY_MESSAGE_UNAVAILABLE');
    const item=await inspect(tenant,message);
    if(!item||item.projection.snapshot!==input.snapshot||!item.projection.recoverable)throw Error('EMAIL_RECOVERY_MESSAGE_CHANGED');
    await options.authorize(tenant);
    const auditInput={requestId:input.requestId,snapshot:input.snapshot,reason:input.reason.trim()};
    await options.audit(tenant,{...auditInput,stage:'STARTED'});
    for(const report of item.reports)await options.apply({...tenant,correlationId:input.requestId},report);
    await options.audit(tenant,{...auditInput,stage:'COMPLETED'});
    await options.receiver.completeMessage(message);completed=message;
    return {state:'COMPLETED',reportCount:item.reports.length};
   }finally{
    const released=await Promise.allSettled(locked.filter(message=>message!==completed).map(message=>options.receiver.abandonMessage(message)));
    if(released.some(result=>result.status==='rejected'))throw Error('EMAIL_RECOVERY_LOCK_RELEASE_FAILED');
   }
  }
 };
}
