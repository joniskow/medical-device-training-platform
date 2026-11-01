import {randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
async function record(client:PoolClient,tenant:TenantContext,eventId:string,invitationId:string,status:string,metadata:Record<string,unknown>={}){
 await client.query(`INSERT INTO email_deliveries(email_delivery_id,organization_id,recipient_id,template_key,payload,status,created_at,updated_at) VALUES($1,$2,$3,'organization-invitation.v1',$4::jsonb,$5,now(),now()) ON CONFLICT(email_delivery_id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()`,['email:'+eventId,tenant.organizationId,invitationId,JSON.stringify({eventId,invitationId,...metadata}),status]);
}
export interface InvitationEmailRateLimit {scope:string;globalPerMinute:number;organizationPerMinute:number}
export function createInvitationEmailStore(pool:Pool,rateLimit?:InvitationEmailRateLimit){return {
 async claim(tenant:TenantContext,eventId:string){return withTenantTransaction(pool,tenant,async client=>{
  const event=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type='organization.invitation.deliver' AND state IN ('PENDING','CLAIMED') AND available_at<=clock_timestamp() FOR UPDATE SKIP LOCKED`,[tenant.organizationId,eventId])).rows[0];
  if(!event)return null;
  const invitationId=event.payload?.invitationId;
  if(typeof invitationId!=='string'||!invitationId||invitationId.length>128){await client.query(`UPDATE outbox_events SET state='FAILED',last_error_code='INVITATION_EVENT_INVALID',updated_at=now(),delivery_lease_token=NULL WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);return null;}
  if(event.attempt_count>=5){
   await record(client,tenant,eventId,invitationId,'FAILED',{errorCode:'INVITATION_DELIVERY_EXHAUSTED'});
   await client.query(`UPDATE outbox_events SET state='FAILED',last_error_code='INVITATION_DELIVERY_EXHAUSTED',updated_at=now(),delivery_lease_token=NULL WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);return null;
  }
  const invitation=(await client.query(`SELECT i.invitation_id,i.intended_email,i.token_key_id,i.token_hash,i.role,o.name FROM organization_invitations i JOIN organizations o ON o.organization_id=i.organization_id
   WHERE i.organization_id=$1 AND i.invitation_id=$2 AND i.status='PENDING' AND i.expires_at>clock_timestamp() AND o.status='ACTIVE'
   AND EXISTS(SELECT 1 FROM organization_memberships m JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE m.organization_id=i.organization_id AND m.subject=i.inviter_id AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=i.organization_id))`,[tenant.organizationId,invitationId])).rows[0];
  if(!invitation){
   await record(client,tenant,eventId,invitationId,'SKIPPED',{reason:'INVITATION_NO_LONGER_VALID'});
   await client.query(`UPDATE outbox_events SET state='PUBLISHED',last_error_code=NULL,delivery_lease_token=NULL,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);return null;
  }
  const recipientHash=createHash('sha256').update(invitation.intended_email.trim().toLowerCase()).digest('hex');
  if((await client.query(`SELECT 1 FROM email_recipient_suppressions WHERE organization_id=$1 AND recipient_hash=$2 AND released_at IS NULL`,[tenant.organizationId,recipientHash])).rowCount){
   await record(client,tenant,eventId,invitationId,'SUPPRESSED');
   await client.query(`UPDATE outbox_events SET state='PUBLISHED',last_error_code=NULL,delivery_lease_token=NULL,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);return null;
  }
  if(rateLimit){
   const retryAt=(await client.query(`SELECT public.reserve_invitation_email_capacity($1,$2,$3) AS retry_at`,[rateLimit.scope,rateLimit.globalPerMinute,rateLimit.organizationPerMinute])).rows[0].retry_at;
   if(retryAt){
    await record(client,tenant,eventId,invitationId,'RATE_LIMITED');
    await client.query(`UPDATE outbox_events SET state='PENDING',delivery_lease_token=NULL,last_error_code=NULL,available_at=$3,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,retryAt]);
    return null;
   }
  }
  const leaseToken=randomUUID();
  await client.query(`UPDATE outbox_events SET state='CLAIMED',delivery_lease_token=$3,attempt_count=attempt_count+1,available_at=clock_timestamp()+interval '60 seconds',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId,leaseToken]);
  await record(client,tenant,eventId,invitationId,'SENDING');
  await client.query(`SELECT public.record_invitation_email_attempt($1,$2)`,[eventId,leaseToken]);
  return {eventId,invitationId,leaseToken,email:invitation.intended_email,keyId:invitation.token_key_id,tokenHash:invitation.token_hash,role:invitation.role,organizationName:invitation.name};
 });},
 async finish(tenant:TenantContext,eventId:string,leaseToken:string,result:{accepted:true;providerMessageId:string}|{accepted:false}){return withTenantTransaction(pool,tenant,async client=>{
  const event=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type='organization.invitation.deliver' AND state='CLAIMED' AND delivery_lease_token=$3 AND available_at>clock_timestamp() FOR UPDATE`,[tenant.organizationId,eventId,leaseToken])).rows[0];
  if(!event)return false;
  const state=result.accepted?'PUBLISHED':event.attempt_count>=5?'FAILED':'PENDING';
  await record(client,tenant,eventId,event.payload.invitationId,result.accepted?'ACCEPTED':state==='FAILED'?'FAILED':'RETRY_PENDING',result.accepted?{providerMessageId:result.providerMessageId}:{errorCode:'INVITATION_EMAIL_SEND_FAILED'});
  await client.query(`UPDATE outbox_events SET state=$4,delivery_lease_token=NULL,last_error_code=$5,available_at=clock_timestamp()+interval '30 seconds',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2 AND delivery_lease_token=$3`,[tenant.organizationId,eventId,leaseToken,state,result.accepted?null:'INVITATION_EMAIL_SEND_FAILED']);
  await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,$4,'invitation',$5,$6::jsonb,now())`,['invitation-email:'+leaseToken,tenant.organizationId,tenant.actorId,result.accepted?'INVITATION_EMAIL_ACCEPTED':'INVITATION_EMAIL_FAILED',event.payload.invitationId,JSON.stringify({eventId,state,attempt:event.attempt_count})]);
  return true;
 });}
};}
