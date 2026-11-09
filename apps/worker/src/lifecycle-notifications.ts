import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {createLifecycleNotificationStore} from '@medical-device/db';
import type {InvitationEmailSender} from './invitation-email.js';
export function createLifecycleNotificationProcessor(pool:Pool,options:{sender:InvitationEmailSender}){
 const store=createLifecycleNotificationStore(pool);
 return {async process(tenant:TenantContext,eventId:string){const claim=await store.claim(tenant,eventId);if(!claim)return {state:'SKIPPED'};
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([options.sender.send({recipient:claim.recipient,subject:'Training account update',plainText:'There is an update in your training account. Sign in to review your notifications and current status. This email does not contain training evidence or contact details.',eventId,operationId:claim.operationId,signal:controller.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('NOTIFICATION_PROVIDER_TIMEOUT'));},30000);})]);
   if(result.providerMessageId!==claim.operationId)throw Error('NOTIFICATION_PROVIDER_RESULT_INVALID');return store.finish(tenant,eventId,claim.operationId,true);
  }catch{return store.finish(tenant,eventId,claim.operationId,false);}finally{clearTimeout(timer);}
 }};
}
