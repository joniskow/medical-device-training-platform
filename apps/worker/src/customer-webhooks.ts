import {createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {createCustomerWebhookStore,validateWebhookEndpoint,deriveCustomerWebhookSecret,createMachineWebhookProjection} from '@medical-device/db';
import {boundedHttpsRequest} from './provider-egress.js';

export const deriveWebhookSecret=deriveCustomerWebhookSecret;
export function createCustomerWebhookProcessor(pool:Pool,options:{keys:ReadonlyMap<string,Buffer>;transport?:typeof boundedHttpsRequest}){
 for(const [id,key] of options.keys)if(!/^[A-Za-z0-9._:-]{1,64}$/.test(id)||key.length<32)throw Error('WEBHOOK_KEY_INVALID');
 const store=createCustomerWebhookStore(pool),transport=options.transport??boundedHttpsRequest,projectMachine=createMachineWebhookProjection(pool);
 return {async process(tenant:TenantContext,deliveryId:string){
  const claimed=await store.claim(tenant,deliveryId);if(!claimed)return {state:'SKIPPED'};
  try{
   const projected=await projectMachine(tenant,{subscriptionId:claimed.subscription_id,deliveryId,eventId:claimed.event_id,payload:claimed.payload});
   if(!projected.allowed)return store.finish(tenant,deliveryId,claimed.leaseToken,false);
   const endpoint=validateWebhookEndpoint(claimed.endpoint),timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(projected.payload);
   const keyIds=[claimed.key_id,...(claimed.previous_key_id&&new Date(claimed.previous_key_expires_at)>new Date()?[claimed.previous_key_id]:[])];
   const signatures=keyIds.map(id=>{const master=options.keys.get(id);if(!master)throw Error('WEBHOOK_KEY_UNAVAILABLE');return id+':'+createHmac('sha256',deriveWebhookSecret(master,tenant.organizationId,claimed.subscription_id)).update(timestamp+'.'+body).digest('hex');});
   await transport({url:endpoint,origins:new Set([new URL(endpoint).origin]),method:'POST',headers:{'Content-Type':'application/json','X-Training-Event-ID':projected.eventId,'X-Training-Delivery-ID':projected.deliveryId,'X-Training-Timestamp':timestamp,'X-Training-Signature':signatures.join(',')},body,maxBytes:16*1024,timeoutMs:10000});
   return store.finish(tenant,deliveryId,claimed.leaseToken,true);
  }catch{return store.finish(tenant,deliveryId,claimed.leaseToken,false);}
 }};
}
