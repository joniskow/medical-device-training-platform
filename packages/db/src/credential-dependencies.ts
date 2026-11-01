import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';

// The caller holds the learner/course qualification lock; snapshots contain transitive ancestors.
export async function revokeDependentCredentials(client:PoolClient,tenant:TenantContext,learnerId:string,sourceCredentialId:string,reason:string){
  const rows=(await client.query(`SELECT credential_id,status,public_id_hash FROM credentials WHERE organization_id=$1 AND learner_id=$2
    AND evidence->'evaluation'->'requalification'->'sourceCredentialIds' ? $3 AND status<>'REVOKED' ORDER BY credential_id FOR UPDATE`,[tenant.organizationId,learnerId,sourceCredentialId])).rows;
  for(const row of rows){
    const details=JSON.stringify({reason,sourceCredentialId,previousStatus:row.status,status:'REVOKED',actorId:tenant.actorId});
    await client.query(`UPDATE credentials SET status='REVOKED',updated_at=now() WHERE organization_id=$1 AND credential_id=$2`,[tenant.organizationId,row.credential_id]);
    await client.query(`UPDATE credential_verifications SET status='REVOKED' WHERE public_id_hash=$1`,[row.public_id_hash]);
    await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at) VALUES($1,$2,$3,'REVOKED',$4::jsonb,now())`,[randomUUID(),tenant.organizationId,row.credential_id,details]);
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_REVOKED','credential',$4,$5::jsonb,now())`,[randomUUID(),tenant.organizationId,tenant.actorId,row.credential_id,details]);
    await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'credential.revoked',$3,$4::jsonb,'PENDING',now(),now(),now())`,[randomUUID(),tenant.organizationId,`credential.REVOKED:${row.credential_id}`,JSON.stringify({credentialId:row.credential_id,learnerId,status:'REVOKED',sourceCredentialId,notificationRequested:true})]);
  }
}
