import type {ServiceBusClient,ServiceBusReceivedMessage} from '@azure/service-bus';
import type {EmailDeliveryReport} from '@medical-device/db';
import type {TenantContext} from '@medical-device/contracts';
import {parseAzureEmailDeliveryEvents} from './email-delivery-event.js';
interface ReportHandlerOptions {
 expected:{topic:string;sender:string};workerId:string;
 resolveOrganization(operationId:string):Promise<string|null>;
 apply(tenant:TenantContext,report:EmailDeliveryReport):Promise<unknown>;
}
export async function handleEmailReportMessage(options:ReportHandlerOptions&{
 message:Pick<ServiceBusReceivedMessage,'body'|'deliveryCount'>;
 settle:{complete():Promise<void>;abandon():Promise<void>;deadLetter(reason:string):Promise<void>};
}){
 let reports:EmailDeliveryReport[];
 try{reports=parseAzureEmailDeliveryEvents(options.message.body,options.expected);}
 catch{await options.settle.deadLetter('EMAIL_DELIVERY_EVENT_INVALID');return 'DEAD_LETTERED';}
 try{
  for(const report of reports){
   const organizationId=await options.resolveOrganization(report.operationId);
   if(!organizationId)throw Error('EMAIL_REPORT_ROUTING_PENDING');
   await options.apply({organizationId,actorId:options.workerId,correlationId:report.id},report);
  }
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(['EMAIL_REPORT_INVALID','EMAIL_REPORT_CONFLICT','EMAIL_REPORT_UNMATCHED'].includes(code)){await options.settle.deadLetter(code);return 'DEAD_LETTERED';}
  if((options.message.deliveryCount??0)>=5){await options.settle.deadLetter('EMAIL_REPORT_RETRY_EXHAUSTED');return 'DEAD_LETTERED';}
  await options.settle.abandon();return 'ABANDONED';
 }
 // Settlement failures propagate: the broker can redeliver and receipts deduplicate.
 await options.settle.complete();return 'COMPLETED';
}
export function createEmailReportConsumer(options:ReportHandlerOptions&{client:ServiceBusClient;queueName:string;onError?:(error:Error)=>Promise<void>|void}){
 const receiver=options.client.createReceiver(options.queueName,{receiveMode:'peekLock',maxAutoLockRenewalDurationInMs:60000});
 const subscription=receiver.subscribe({
  processMessage:message=>handleEmailReportMessage({...options,message,settle:{complete:()=>receiver.completeMessage(message),abandon:()=>receiver.abandonMessage(message),deadLetter:reason=>receiver.deadLetterMessage(message,{deadLetterReason:reason,deadLetterErrorDescription:'Delivery report could not be processed. Review using the restricted operator workflow.'})}}).then(()=>{}),
  processError:async()=>{await options.onError?.(Error('EMAIL_REPORT_RECEIVER_FAILED'));}
 },{autoCompleteMessages:false,maxConcurrentCalls:2});
 let closed=false;
 return {async close(){if(closed)return;closed=true;try{await subscription.close();}finally{await receiver.close();}}};
}
