import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';

/** Server/provider hook: currency values carry provenance and never substitute for source meter units. */
export async function recordTechnicalCost(client:PoolClient,tenant:TenantContext,input:{eventId:string;microUsd:number;provenance:'PROVIDER_BILLED'|'ESTIMATED_RATE';provider:string;operation:string}){
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(input.eventId)||!Number.isSafeInteger(input.microUsd)||input.microUsd<0||input.microUsd>1000000000000||!['PROVIDER_BILLED','ESTIMATED_RATE'].includes(input.provenance)||!/^[A-Za-z0-9._:-]{1,80}$/.test(input.provider)||!/^[A-Za-z0-9._:-]{1,80}$/.test(input.operation))throw Error('TECHNICAL_COST_INVALID');
 const id='cost:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,input.eventId])).digest('hex'),quantity=(input.microUsd/1000000).toFixed(6),metadata=JSON.stringify({provenance:input.provenance,provider:input.provider,operation:input.operation});
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
 const prior=(await client.query('SELECT quantity::text,metadata FROM usage_meter_events WHERE organization_id=$1 AND usage_event_id=$2',[tenant.organizationId,id])).rows[0];
 if(prior){if(Number(prior.quantity)!==input.microUsd/1000000||prior.metadata.provenance!==input.provenance||prior.metadata.provider!==input.provider||prior.metadata.operation!==input.operation)throw Error('IDEMPOTENCY_KEY_REUSED');return {usageEventId:id};}
 await client.query('INSERT INTO usage_meter_events(usage_event_id,organization_id,meter_key,quantity,deduplication_key,metadata,created_at) VALUES($1,$2,$3,$4,$1,$5,now())',[id,tenant.organizationId,input.provenance==='PROVIDER_BILLED'?'cost.usd.billed':'cost.usd.estimated',quantity,metadata]);return {usageEventId:id};
}
export function createTechnicalMeteringStore(pool:Pool){return {
 async effort(tenant:TenantContext,input:{courseVersionId:string;durationSeconds:number;kind:'AUTHORING'|'REVIEW';idempotencyKey:string}){
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(input.courseVersionId)||!Number.isSafeInteger(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>28800||!['AUTHORING','REVIEW'].includes(input.kind)||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('TECHNICAL_EFFORT_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   if(!(await client.query(`SELECT 1 FROM organization_memberships m JOIN organizations o ON o.organization_id=m.organization_id JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE m.organization_id=$1 AND m.subject=$2 AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role=ANY($3::text[]) AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=$1)`,[tenant.organizationId,tenant.actorId,['organization_admin',input.kind==='AUTHORING'?'author':'reviewer']])).rowCount)throw Error('TECHNICAL_EFFORT_ROLE_REQUIRED');
   if(!(await client.query('SELECT 1 FROM course_versions WHERE organization_id=$1 AND course_version_id=$2',[tenant.organizationId,input.courseVersionId])).rowCount)throw Error('TECHNICAL_EFFORT_COURSE_NOT_FOUND');
   const id='effort:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,input.idempotencyKey])).digest('hex'),metadata={kind:input.kind,courseVersionId:input.courseVersionId,source:'SELF_REPORTED'},signature=createHash('sha256').update(JSON.stringify([input.durationSeconds,metadata])).digest('hex');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
   const prior=(await client.query('SELECT metadata FROM usage_meter_events WHERE organization_id=$1 AND usage_event_id=$2',[tenant.organizationId,id])).rows[0];if(prior){if(prior.metadata.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return {usageEventId:id};}
   await client.query('INSERT INTO usage_meter_events(usage_event_id,organization_id,meter_key,quantity,deduplication_key,metadata,created_at) VALUES($1,$2,$3,$4,$1,$5::jsonb,now())',[id,tenant.organizationId,'effort.seconds.'+input.kind.toLowerCase(),input.durationSeconds,JSON.stringify({...metadata,signature})]);
   await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'TECHNICAL_EFFORT_RECORDED','course_version',$4,$5::jsonb,now())",[id,tenant.organizationId,tenant.actorId,input.courseVersionId,JSON.stringify({durationSeconds:input.durationSeconds,kind:input.kind,source:'SELF_REPORTED'})]);
   return {usageEventId:id};
  });
 }
};}
