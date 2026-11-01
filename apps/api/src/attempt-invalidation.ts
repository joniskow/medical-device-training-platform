import { createHash,randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { TenantContext } from '@medical-device/contracts';
import { withTenantTransaction } from '@medical-device/db';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const tables={assessment:{table:'assessment_sessions',key:'session_id'},simulation:{table:'simulation_attempts',key:'simulation_attempt_id'}} as const;
type Kind=keyof typeof tables;
async function affected(client:PoolClient,tenant:TenantContext,attempt:Record<string,any>,lock=false){
  return (await client.query(`SELECT credential_id,status,public_id_hash FROM credentials WHERE organization_id=$1 AND learner_id=$2
    AND evidence->'evaluation'->'evidenceIds' ? $3 ORDER BY credential_id ${lock?'FOR UPDATE':''}`,[tenant.organizationId,attempt.learner_id,attempt.attempt_id])).rows;
}
function preview(attempt:Record<string,any>,credentials:Record<string,any>[]){
  const impacted=credentials.filter(c=>c.status!=='REVOKED').map(c=>({credentialId:c.credential_id,status:c.status}));
  return {kind:attempt.kind,attemptId:attempt.attempt_id,activityId:attempt.activity_id,attemptNumber:attempt.attempt_number,status:attempt.status,
    affectedCredentials:impacted,previewToken:hash([attempt.kind,attempt.attempt_id,attempt.status,impacted])};
}
export function createAttemptInvalidationService(pool:Pool){return {
  async list(tenant:TenantContext,learnerId:string,after?:string){
    if(!learnerId||learnerId.length>256||(after!==undefined&&(!after.length||after.length>160)))throw Error('ATTEMPT_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const rows=await client.query(`SELECT * FROM (
        SELECT 'assessment' AS kind,'assessment:'||session_id AS cursor,session_id AS attempt_id,activity_id,attempt_number,status,learner_id,release_id FROM assessment_sessions WHERE organization_id=$1 AND learner_id=$2
        UNION ALL SELECT 'simulation','simulation:'||simulation_attempt_id,simulation_attempt_id,activity_id,attempt_number,status,learner_id,release_id FROM simulation_attempts WHERE organization_id=$1 AND learner_id=$2
      ) a WHERE ($3::text IS NULL OR cursor>$3) ORDER BY cursor LIMIT 51`,[tenant.organizationId,learnerId,after??null]);
      const items=[];for(const row of rows.rows.slice(0,50))items.push(preview(row,await affected(client,tenant,row)));
      return {items,nextCursor:rows.rows.length>50?rows.rows[49].cursor:null};
    });
  },
  async invalidate(tenant:TenantContext,kind:Kind,attemptId:string,request:{reason:string;previewToken:string;idempotencyKey:string}){
    if(!Object.hasOwn(tables,kind)||!identifier(attemptId)||!identifier(request.idempotencyKey)||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>2000||!/^[a-f0-9]{64}$/.test(request.previewToken))throw Error('ATTEMPT_REQUEST_INVALID');
    const {table,key}=tables[kind];
    return withTenantTransaction(pool,tenant,async client=>{
      const eventId='invalidation:'+hash([tenant.organizationId,tenant.actorId,request.idempotencyKey]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[eventId]);
      const signature=hash([kind,attemptId,request.reason,request.previewToken]);
      const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,eventId])).rows[0];
      if(prior){if(prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return prior.details.result;}
      const initial=(await client.query(`SELECT * FROM ${table} WHERE organization_id=$1 AND ${key}=$2`,[tenant.organizationId,attemptId])).rows[0];if(!initial)throw Error('ATTEMPT_NOT_FOUND');
      // Match completion/issuance lock order, including duplicate enrollment qualification locks.
      await client.query(`SELECT enrollment_id FROM enrollments WHERE organization_id=$1 AND enrollment_id=$2 FOR UPDATE`,[tenant.organizationId,initial.enrollment_id]);
      const release=(await client.query(`SELECT r.manifest,v.course_id FROM release_manifests r JOIN course_versions v ON v.organization_id=r.organization_id AND v.course_version_id=r.course_version_id WHERE r.organization_id=$1 AND r.release_id=$2`,[tenant.organizationId,initial.release_id])).rows[0];
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify(['course-credential',tenant.organizationId,initial.learner_id,release?.course_id])]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify([tenant.organizationId,initial.learner_id,initial.release_id,release?.manifest?.content?.policy?.version,'initial'])]);
      const row=(await client.query(`SELECT *,${key} AS attempt_id FROM ${table} WHERE organization_id=$1 AND ${key}=$2 FOR UPDATE`,[tenant.organizationId,attemptId])).rows[0];row.kind=kind;
      const credentials=await affected(client,tenant,row,true),expected=preview(row,credentials);
      if(expected.previewToken!==request.previewToken||row.status==='INVALIDATED')throw Error('ATTEMPT_PREVIEW_CHANGED');
      await client.query(`UPDATE ${table} SET status='INVALIDATED' WHERE organization_id=$1 AND ${key}=$2`,[tenant.organizationId,attemptId]);
      for(const credential of credentials.filter(c=>c.status!=='REVOKED')){
        const details=JSON.stringify({reason:request.reason.trim(),attemptId,kind,previousStatus:credential.status,status:'REVOKED',actorId:tenant.actorId});
        await client.query(`UPDATE credentials SET status='REVOKED',updated_at=now() WHERE organization_id=$1 AND credential_id=$2`,[tenant.organizationId,credential.credential_id]);
        await client.query(`UPDATE credential_verifications SET status='REVOKED' WHERE public_id_hash=$1`,[credential.public_id_hash]);
        await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at) VALUES($1,$2,$3,'REVOKED',$4::jsonb,now())`,[randomUUID(),tenant.organizationId,credential.credential_id,details]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_REVOKED','credential',$4,$5::jsonb,now())`,[randomUUID(),tenant.organizationId,tenant.actorId,credential.credential_id,details]);
        await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'credential.revoked',$3,$4::jsonb,'PENDING',now(),now(),now())`,[randomUUID(),tenant.organizationId,`credential.REVOKED:${credential.credential_id}`,JSON.stringify({credentialId:credential.credential_id,learnerId:row.learner_id,status:'REVOKED',attemptId,notificationRequested:true})]);
      }
      const result={status:'INVALIDATED',revokedCredentialIds:expected.affectedCredentials.map(c=>c.credentialId)};
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'ATTEMPT_INVALIDATED','attempt',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,attemptId,JSON.stringify({signature,reason:request.reason.trim(),kind,previousStatus:row.status,enrollmentId:row.enrollment_id,releaseId:row.release_id,result})]);
      return result;
    });
  }
};}
