import type {PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';

export async function expireCredential(client:PoolClient,tenant:TenantContext,event:Record<string,any>){
  const row=(await client.query(`SELECT *,expires_at<=now() AS due FROM credentials WHERE organization_id=$1 AND credential_id=$2 FOR UPDATE`,[tenant.organizationId,event.payload?.credentialId])).rows[0];
  if(!row||row.learner_id!==event.payload?.learnerId)throw Error('CREDENTIAL_NOTICE_INVALID');
  if(['ACTIVE','EXPIRED'].includes(row.status)&&row.expires_at){
    if(!row.due){
      await client.query(`UPDATE outbox_events SET available_at=(SELECT expires_at FROM credentials WHERE organization_id=$1 AND credential_id=$3),updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,event.outbox_event_id,row.credential_id]);
      return {state:'SCHEDULED'};
    }
    await client.query(`UPDATE credentials SET status='EXPIRED',updated_at=now() WHERE organization_id=$1 AND credential_id=$2`,[tenant.organizationId,row.credential_id]);
    await client.query(`UPDATE credential_verifications SET status='EXPIRED' WHERE public_id_hash=$1`,[row.public_id_hash]);
    await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at) VALUES($1,$2,$3,'EXPIRED',$4::jsonb,$5) ON CONFLICT(credential_event_id) DO NOTHING`,['expired:'+row.credential_id,tenant.organizationId,row.credential_id,JSON.stringify({status:'EXPIRED',expiresAt:new Date(row.expires_at).toISOString()}),row.expires_at]);
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_EXPIRED','credential',$4,$5::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`,['expired:'+row.credential_id,tenant.organizationId,tenant.actorId,row.credential_id,JSON.stringify({expiresAt:new Date(row.expires_at).toISOString()})]);
    await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'credential.expired',$1,$3::jsonb,'PENDING',now(),now(),now()) ON CONFLICT(organization_id,deduplication_key) DO NOTHING`,['expired:'+row.credential_id,tenant.organizationId,JSON.stringify({credentialId:row.credential_id,learnerId:row.learner_id,status:'EXPIRED',notificationRequested:true})]);
  }
  // Revoked, superseded and non-expiring credentials must never be reactivated or notified as newly expired.
  await client.query(`UPDATE outbox_events SET state='PUBLISHED',attempt_count=0,last_error_code=NULL,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,event.outbox_event_id]);
  return {state:'PUBLISHED'};
}
