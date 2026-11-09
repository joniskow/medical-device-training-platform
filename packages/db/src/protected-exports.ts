import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext,PrivateObjectStoragePort} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';
import {createTechnicalReportingStore} from './technical-reporting.js';

export const PROTECTED_EXPORT_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.protected_exports(
 export_id text PRIMARY KEY,organization_id text NOT NULL,requester_id text NOT NULL,request_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','CLAIMED','SUCCEEDED','FAILED')),blob_key text NOT NULL,sha256 text,
 lease_token text,lease_expires_at timestamptz,attempts integer NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,requester_id,request_key));
ALTER TABLE public.protected_exports ENABLE ROW LEVEL SECURITY;ALTER TABLE public.protected_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.protected_exports;
CREATE POLICY tenant_isolation ON public.protected_exports USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''));
ALTER TABLE public.protected_exports ADD COLUMN IF NOT EXISTS export_kind text NOT NULL DEFAULT 'summary';
ALTER TABLE public.protected_exports ADD COLUMN IF NOT EXISTS export_format text NOT NULL DEFAULT 'json';
ALTER TABLE public.protected_exports ADD COLUMN IF NOT EXISTS artifact_keys text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.protected_exports ADD COLUMN IF NOT EXISTS release_id text;
CREATE OR REPLACE FUNCTION public.due_lifecycle_deliveries() RETURNS TABLE(kind text,organization_id text,work_id text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 (SELECT 'webhook'::text,d.organization_id,d.delivery_id FROM public.customer_webhook_deliveries d JOIN public.outbox_events e ON e.organization_id=d.organization_id AND e.outbox_event_id=d.delivery_id WHERE d.state IN ('PENDING','CLAIMED') AND d.available_at<=now() AND (d.state='PENDING' OR d.lease_expires_at<=now()) ORDER BY d.available_at,d.delivery_id LIMIT 10)
 UNION ALL
 (SELECT 'export'::text,x.organization_id,x.export_id FROM public.protected_exports x JOIN public.outbox_events e ON e.organization_id=x.organization_id AND e.outbox_event_id=x.export_id WHERE x.state IN ('PENDING','CLAIMED') AND x.expires_at>now() AND x.attempts<5 AND e.available_at<=now() AND (x.state='PENDING' OR x.lease_expires_at<=now()) ORDER BY e.available_at,x.export_id LIMIT 10)
$$;
REVOKE ALL ON FUNCTION public.due_lifecycle_deliveries() FROM PUBLIC;
`;
export function csvExportCell(value:unknown){const raw=value===null||value===undefined?'':value instanceof Date?value.toISOString():String(value);const safe=/^[\s]*[=+@-]|^[\t\r\n]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';}
export function createProtectedExportStore(pool:Pool,storage?:PrivateObjectStoragePort){return {
 async request(tenant:TenantContext,idempotencyKey:string,kind:'summary'|'credential-register'|'evidence-lineage'='summary',format:'json'|'csv'='json',releaseId?:string){
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)||!['summary','credential-register','evidence-lineage'].includes(kind)||!['json','csv'].includes(format)||kind!=='credential-register'&&format==='csv'||kind==='evidence-lineage'&&(!releaseId||!/^[A-Za-z0-9._:-]{1,128}$/.test(releaseId))||kind!=='evidence-lineage'&&releaseId!==undefined)throw Error('EXPORT_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('exports:'||$1,0))",[tenant.organizationId]);
   const existing=(await client.query('SELECT export_id,state,expires_at,export_kind,export_format,release_id FROM protected_exports WHERE organization_id=$1 AND requester_id=$2 AND request_key=$3',[tenant.organizationId,tenant.actorId,idempotencyKey])).rows[0];if(existing){if(existing.export_kind!==kind||existing.export_format!==format||existing.release_id!==(releaseId??null))throw Error('IDEMPOTENCY_KEY_REUSED');return {exportId:existing.export_id,state:existing.state,expiresAt:existing.expires_at};}
   if((await client.query("SELECT count(*)::int n FROM protected_exports WHERE organization_id=$1 AND created_at>now()-interval '1 hour'",[tenant.organizationId])).rows[0].n>=10)throw Error('EXPORT_RATE_LIMITED');
   const id='export:'+randomUUID(),blobKey=tenant.organizationId+'/exports/'+id+'.'+format;
   if(releaseId&&!(await client.query('SELECT 1 FROM release_manifests WHERE organization_id=$1 AND release_id=$2',[tenant.organizationId,releaseId])).rowCount)throw Error('EXPORT_NOT_FOUND');
   const row=(await client.query("INSERT INTO protected_exports(export_id,organization_id,requester_id,request_key,state,blob_key,expires_at,export_kind,export_format,release_id) VALUES($1,$2,$3,$4,'PENDING',$5,now()+interval '24 hours',$6,$7,$8) RETURNING expires_at",[id,tenant.organizationId,tenant.actorId,idempotencyKey,blobKey,kind,format,releaseId??null])).rows[0];
   await client.query("INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'protected.export.create',$1,$3::jsonb,'PENDING',now(),now(),now())",[id,tenant.organizationId,JSON.stringify({exportId:id})]);
   await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'PROTECTED_EXPORT_REQUESTED','export',$1,'{}',now())",[id,tenant.organizationId,tenant.actorId]);
   return {exportId:id,state:'PENDING',expiresAt:row.expires_at};
  });
 },
 async get(tenant:TenantContext,id:string){return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);const row=(await client.query('SELECT export_id,state,expires_at FROM protected_exports WHERE organization_id=$1 AND requester_id=$2 AND export_id=$3',[tenant.organizationId,tenant.actorId,id])).rows[0];if(!row)throw Error('EXPORT_NOT_FOUND');return {exportId:row.export_id,state:new Date(row.expires_at)<=new Date()?'EXPIRED':row.state,expiresAt:row.expires_at};});},
 async content(tenant:TenantContext,id:string){
  if(!storage)throw Error('EXPORT_STORAGE_UNAVAILABLE');
  const selected=await withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);const row=(await client.query("SELECT blob_key,sha256,export_format FROM protected_exports WHERE organization_id=$1 AND requester_id=$2 AND export_id=$3 AND state='SUCCEEDED' AND expires_at>now()",[tenant.organizationId,tenant.actorId,id])).rows[0];if(!row)throw Error('EXPORT_UNAVAILABLE');return row;});
  const object=await storage.readObject({blobKey:selected.blob_key,maxBytes:1024*1024});
  // Storage I/O can outlive a role revocation or expiry; check again before releasing any bytes.
  await withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);if(!(await client.query("SELECT 1 FROM protected_exports WHERE organization_id=$1 AND requester_id=$2 AND export_id=$3 AND state='SUCCEEDED' AND expires_at>now()",[tenant.organizationId,tenant.actorId,id])).rowCount)throw Error('EXPORT_UNAVAILABLE');});
  if(createHash('sha256').update(object.bytes).digest('hex')!==selected.sha256)throw Error('EXPORT_HASH_MISMATCH');return {bytes:object.bytes,contentType:selected.export_format==='csv'?'text/csv; charset=utf-8':'application/json'};
 },
 async process(tenant:TenantContext,id:string){
  if(!storage)throw Error('EXPORT_STORAGE_UNAVAILABLE');
  const token=randomUUID(),artifactKey=tenant.organizationId+'/exports/'+id+'/'+token;
  const selected=await withTenantTransaction(pool,tenant,async client=>{
   const row=(await client.query("SELECT * FROM protected_exports WHERE organization_id=$1 AND export_id=$2 AND expires_at>now() AND attempts<5 AND (state='PENDING' OR (state='CLAIMED' AND lease_expires_at<=now())) FOR UPDATE SKIP LOCKED",[tenant.organizationId,id])).rows[0];if(!row)return null;
   await client.query("UPDATE protected_exports SET state='CLAIMED',lease_token=$3,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1,artifact_keys=array_append(artifact_keys,$4),updated_at=now() WHERE organization_id=$1 AND export_id=$2",[tenant.organizationId,id,token,artifactKey]);return row;
  });if(!selected)return {state:'SKIPPED'};
  try{
   const requester={...tenant,actorId:selected.requester_id};
   const report=await withTenantTransaction(pool,requester,async client=>{const reportStore=createTechnicalReportingStore(pool,client);let report:unknown;
   if(selected.export_kind==='credential-register'){
    const items:Record<string,unknown>[]=[];let cursor:string|undefined;
    do{const page=await reportStore.credentials(requester,cursor);items.push(...page.items);if(items.length>10000)throw Error('EXPORT_TOO_LARGE');cursor=page.nextCursor??undefined;}while(cursor);
    if(selected.export_format==='csv'){const columns=['credentialId','courseVersionId','releaseId','releaseHash','policyVersion','status','title','issuedAt','expiresAt'];report=[columns.map(csvExportCell).join(','),...items.map(row=>columns.map(column=>csvExportCell(row[column])).join(','))].join('\r\n');}
    else report={schemaVersion:'credential-register.v1',generatedAt:new Date().toISOString(),items};
   }else if(selected.export_kind==='evidence-lineage')report=await reportStore.evidence(requester,selected.release_id);
   else report=await reportStore.summary(requester);
   return report;},{isolation:'repeatable read'});
   const bytes=Buffer.from(typeof report==='string'?report:JSON.stringify(report));if(bytes.length>1024*1024)throw Error('EXPORT_TOO_LARGE');
   // Attempt-specific objects prevent an expired worker from overwriting a newer winning snapshot.
   await storage.putObject({blobKey:artifactKey,bytes,contentType:selected.export_format==='csv'?'text/csv; charset=utf-8':'application/json'});
   return withTenantTransaction(pool,tenant,async client=>{const result=await client.query("UPDATE protected_exports SET state='SUCCEEDED',sha256=$4,blob_key=$5,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND export_id=$2 AND lease_token=$3 RETURNING export_id",[tenant.organizationId,id,token,createHash('sha256').update(bytes).digest('hex'),artifactKey]);if(result.rowCount)await client.query("UPDATE outbox_events SET state='PUBLISHED',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2",[tenant.organizationId,id]);return {state:result.rowCount?'SUCCEEDED':'STALE'};});
  }catch{return withTenantTransaction(pool,tenant,async client=>{const result=await client.query("UPDATE protected_exports SET state=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND export_id=$2 AND lease_token=$3 RETURNING state",[tenant.organizationId,id,token]);if(result.rowCount)await client.query("UPDATE outbox_events SET state=CASE WHEN $3='FAILED' THEN 'FAILED' ELSE 'PENDING' END,available_at=now()+interval '1 minute',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2",[tenant.organizationId,id,result.rows[0].state]);return {state:result.rows[0]?.state??'STALE'};});}
 }
};}
