import type {EmailDeliveryReport} from '@medical-device/db';
/** Normalization is not authentication: call only for messages from the trusted delivery queue. */
export function parseAzureEmailDeliveryEvents(body:unknown,expected:{topic:string;sender:string}):EmailDeliveryReport[]{
 try{
  const serialized=body instanceof Uint8Array?new TextDecoder('utf-8',{fatal:true}).decode(body):typeof body==='string'?body:JSON.stringify(body);
  if(!serialized||Buffer.byteLength(serialized)>65536)throw Error();
  const parsed:unknown=JSON.parse(serialized),events=Array.isArray(parsed)?parsed:[parsed];
  if(!Array.isArray(events)||!events.length||events.length>100||!expected.topic||!expected.sender)throw Error();
  return events.map(event=>{
   const data=event?.data;
   if(event?.eventType!=='Microsoft.Communication.EmailDeliveryReportReceived'||event.dataVersion!=='1.0'||typeof event.topic!=='string'||event.topic.toLowerCase()!==expected.topic.toLowerCase()||typeof data?.sender!=='string'||data.sender.trim().toLowerCase()!==expected.sender.trim().toLowerCase()||typeof event.id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(event.id)||typeof data.messageId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.messageId)||typeof data.recipient!=='string'||data.recipient.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.recipient)||!['Delivered','Suppressed','Bounced','Quarantined','FilteredSpam','Expanded','Failed'].includes(data.status)||typeof data.deliveryAttemptTimeStamp!=='string'||!Number.isFinite(Date.parse(data.deliveryAttemptTimeStamp)))throw Error();
   return {id:event.id,operationId:data.messageId,recipient:data.recipient.trim().toLowerCase(),status:data.status,occurredAt:new Date(data.deliveryAttemptTimeStamp).toISOString()};
  });
 }catch{throw Error('EMAIL_DELIVERY_EVENT_INVALID');}
}
