import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {expireCredential} from './credential-expiration.js';
const types:Record<string,{event:string;message:string}>={
  'credential.expired':{event:'EXPIRED',message:'A training credential expired. Contact your training organization about renewal.'},
  'credential.issued':{event:'ISSUED',message:'A training credential was issued. Open your wallet to review its current status.'},
  'credential.revoked':{event:'REVOKED',message:'A training credential was revoked. Contact your training organization for guidance.'},
  'credential.superseded':{event:'SUPERSEDED',message:'A training credential was superseded by an updated credential. Open your wallet to review both records.'}
};
export function createCredentialNotificationStore(pool:Pool){return {
  async process(tenant:TenantContext,eventId:string){return withTenantTransaction(pool,tenant,async client=>{
    const event=(await client.query(`SELECT * FROM outbox_events WHERE organization_id=$1 AND outbox_event_id=$2 AND event_type=ANY($3::text[]) AND state='PENDING' AND available_at<=now() FOR UPDATE SKIP LOCKED`,[tenant.organizationId,eventId,[...Object.keys(types),'credential.expire']])).rows[0];
    if(!event)return {state:'SKIPPED'};
    await client.query('SAVEPOINT credential_notice');
    try{
      if(event.event_type==='credential.expire')return await expireCredential(client,tenant,event);
      const kind=types[event.event_type];
      const credential=(await client.query(`SELECT c.credential_id,c.learner_id,c.evidence->>'title' AS title,e.created_at AS occurred_at FROM credentials c
        JOIN credential_events e ON e.organization_id=c.organization_id AND e.credential_id=c.credential_id AND e.event_type=$3
        WHERE c.organization_id=$1 AND c.credential_id=$2 ORDER BY e.created_at LIMIT 1`,[tenant.organizationId,event.payload?.credentialId,kind.event])).rows[0];
      if(!credential||credential.learner_id!==event.payload?.learnerId)throw Error('CREDENTIAL_NOTICE_INVALID');
      const key=createHash('sha256').update(JSON.stringify([tenant.organizationId,credential.credential_id,kind.event])).digest('hex');
      await client.query(`INSERT INTO notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at)
        VALUES($1,$2,$3,'CREDENTIAL_LIFECYCLE',$4::jsonb,$5,now()) ON CONFLICT(organization_id,idempotency_key) DO NOTHING`,['notice:'+key,tenant.organizationId,credential.learner_id,JSON.stringify({credentialId:credential.credential_id,title:credential.title??'Training credential',message:kind.message,lifecycleEvent:kind.event,occurredAt:new Date(credential.occurred_at).toISOString()}),'credential-notice:'+key]);
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_NOTICE_DELIVERED','credential',$4,$5::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`,['credential-notice:'+key,tenant.organizationId,tenant.actorId,credential.credential_id,JSON.stringify({lifecycleEvent:kind.event})]);
      await client.query(`UPDATE outbox_events SET state='PUBLISHED',attempt_count=0,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,eventId]);
      return {state:'PUBLISHED'};
    }catch(error){
      await client.query('ROLLBACK TO SAVEPOINT credential_notice');
      const code=error instanceof Error&&error.message==='CREDENTIAL_NOTICE_INVALID'?error.message:'CREDENTIAL_NOTICE_DELIVERY_FAILED';
      const changed=await client.query(`UPDATE outbox_events SET attempt_count=attempt_count+1,state=CASE WHEN attempt_count>=4 THEN 'FAILED' ELSE 'PENDING' END,last_error_code=$3,available_at=now()+interval '30 seconds',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2 RETURNING state`,[tenant.organizationId,eventId,code]);
      return {state:changed.rows[0].state,errorCode:code};
    }
  });}
};}
