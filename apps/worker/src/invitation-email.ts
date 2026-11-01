import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {createInvitationEmailStore,invitationDeliveryToken,type InvitationEmailRateLimit} from '@medical-device/db';
export interface InvitationEmailSender {
 send(message:{recipient:string;subject:string;plainText:string;eventId:string;operationId:string;signal:AbortSignal}):Promise<{providerMessageId:string}>;
}
export function createInvitationEmailProcessor(pool:Pool,options:{sender:InvitationEmailSender;keys:ReadonlyMap<string,Buffer>;applicationOrigin:string;rateLimit:InvitationEmailRateLimit;timeoutMs?:number}){
 const origin=new URL(options.applicationOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('INVITATION_EMAIL_ORIGIN_INVALID');
 const timeoutMs=options.timeoutMs??30000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('INVITATION_EMAIL_TIMEOUT_INVALID');
 if(!options.rateLimit||!options.rateLimit.scope||options.rateLimit.scope.length>256||!Number.isInteger(options.rateLimit.globalPerMinute)||options.rateLimit.globalPerMinute<1||options.rateLimit.globalPerMinute>1000000||!Number.isInteger(options.rateLimit.organizationPerMinute)||options.rateLimit.organizationPerMinute<1||options.rateLimit.organizationPerMinute>options.rateLimit.globalPerMinute)throw Error('INVITATION_EMAIL_RATE_INVALID');
 const store=createInvitationEmailStore(pool,options.rateLimit);
 return {async process(tenant:TenantContext,eventId:string){
  const claimed=await store.claim(tenant,eventId);if(!claimed)return {state:'SKIPPED'};
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const token=invitationDeliveryToken(claimed.invitationId,claimed.keyId,options.keys);
   if(createHash('sha256').update(token).digest('hex')!==claimed.tokenHash)throw Error('INVITATION_KEY_MISMATCH');
   const link=new URL('/invitations',origin);link.hash=new URLSearchParams({organizationId:tenant.organizationId,invitationId:claimed.invitationId,token}).toString();
   // At-least-once delivery: the event ID stays stable across retries; no secret is persisted.
   const message={operationId:claimed.leaseToken,recipient:claimed.email,subject:'Organization training invitation',plainText:`You have been invited to join ${claimed.organizationName} as ${claimed.role.replaceAll('_',' ')}.\n\nSign in with the email address that received this invitation, then review the organization and role before accepting:\n${link.href}\n\nIf you were not expecting this invitation, you can ignore it.\nReference: ${eventId}`,eventId,signal:controller.signal};
   const result=await Promise.race([options.sender.send(message),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('INVITATION_EMAIL_TIMEOUT'));},timeoutMs);})]);
   if(result.providerMessageId!==claimed.leaseToken||typeof result.providerMessageId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(result.providerMessageId))throw Error('INVITATION_PROVIDER_RESULT_INVALID');
   const saved=await store.finish(tenant,eventId,claimed.leaseToken,{accepted:true,providerMessageId:result.providerMessageId});
   return {state:saved?'PUBLISHED':'STALE'};
  }catch{
   const saved=await store.finish(tenant,eventId,claimed.leaseToken,{accepted:false});
   return {state:saved?'RETRY_OR_FAILED':'STALE',errorCode:'INVITATION_EMAIL_SEND_FAILED'};
  }finally{if(timer)clearTimeout(timer);}
 }};
}
