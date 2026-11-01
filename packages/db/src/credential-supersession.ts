import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {validReleaseChange} from '@medical-device/simulation-schema';

export async function prepareCredentialSupersession(client:PoolClient,tenant:TenantContext,release:Record<string,any>){
  const content=release.manifest.content,change=content.releaseChange,lineage=content._lineage;
  if(!['supersede_on_completion','update_modules'].includes(change?.decision))return null;
  if(!validReleaseChange(change,content.modules??[])||!lineage?.sourceReleaseId||!lineage.sourceReleaseHash)throw Error('CREDENTIAL_CHANGE_INVALID');
  const source=(await client.query(`SELECT r.release_id,r.release_hash FROM release_manifests r
    JOIN course_versions old ON old.organization_id=r.organization_id AND old.course_version_id=r.course_version_id
    JOIN course_versions current ON current.organization_id=old.organization_id AND current.course_id=old.course_id AND current.revision>old.revision
    WHERE r.organization_id=$1 AND r.release_id=$2 AND r.release_hash=$3 AND current.course_version_id=$4`,[tenant.organizationId,lineage.sourceReleaseId,lineage.sourceReleaseHash,release.course_version_id])).rows[0];
  if(!source)throw Error('CREDENTIAL_CHANGE_INVALID');
  const effective=(await client.query(`SELECT $1::timestamptz<=now() AS effective`,[change.effectiveAt])).rows[0].effective;
  if(!effective)return {deferred:true as const,credentials:[],sourceReleaseId:source.release_id,sourceReleaseHash:source.release_hash,reason:change.rationale};
  const credentials=change.decision==='update_modules'?[]:(await client.query(`SELECT credential_id,status,public_id_hash FROM credentials WHERE organization_id=$1 AND learner_id=$2 AND release_id=$3 AND release_hash=$4 AND status IN ('ACTIVE','EXPIRED') ORDER BY credential_id FOR UPDATE`,[tenant.organizationId,tenant.actorId,source.release_id,source.release_hash])).rows;
  return {deferred:false as const,credentials,sourceReleaseId:source.release_id,sourceReleaseHash:source.release_hash,reason:change.rationale};
}
export async function applyCredentialSupersession(client:PoolClient,tenant:TenantContext,replacementId:string,releaseId:string,plan:NonNullable<Awaited<ReturnType<typeof prepareCredentialSupersession>>>){
  for(const previous of plan.credentials){
    const details=JSON.stringify({reason:plan.reason,previousStatus:previous.status,status:'SUPERSEDED',replacementId,releaseId,sourceReleaseId:plan.sourceReleaseId,authorization:'published_release_decision'});
    await client.query(`UPDATE credentials SET status='SUPERSEDED',superseded_by=$3,updated_at=now() WHERE organization_id=$1 AND credential_id=$2`,[tenant.organizationId,previous.credential_id,replacementId]);
    await client.query(`UPDATE credential_verifications SET status='SUPERSEDED' WHERE public_id_hash=$1`,[previous.public_id_hash]);
    await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at) VALUES($1,$2,$3,'SUPERSEDED',$4::jsonb,now())`,[randomUUID(),tenant.organizationId,previous.credential_id,details]);
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_SUPERSEDED','credential',$4,$5::jsonb,now())`,[randomUUID(),tenant.organizationId,tenant.actorId,previous.credential_id,details]);
    await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'credential.superseded',$3,$4::jsonb,'PENDING',now(),now(),now())`,[randomUUID(),tenant.organizationId,`credential.SUPERSEDED:${previous.credential_id}`,JSON.stringify({credentialId:previous.credential_id,learnerId:tenant.actorId,status:'SUPERSEDED',replacementId,notificationRequested:true})]);
  }
}
