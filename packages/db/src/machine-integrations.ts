import {randomUUID,createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';
export const integrationScopes=['reports:read','exports:read','exports:write','webhooks:read','webhooks:write'] as const;
export type IntegrationScope=typeof integrationScopes[number];
export const integrationApplicationRoles:Readonly<Record<IntegrationScope,string>>={'reports:read':'Training.Reports.Read','exports:read':'Training.Exports.Read','exports:write':'Training.Exports.Write','webhooks:read':'Training.Webhooks.Read','webhooks:write':'Training.Webhooks.Write'};
export const MACHINE_INTEGRATION_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.machine_integrations(
 integration_id uuid PRIMARY KEY,organization_id text NOT NULL,actor_id text NOT NULL UNIQUE,
 issuer text NOT NULL,identity_tenant text NOT NULL,client_id uuid NOT NULL,service_principal_id uuid NOT NULL,
 scopes text[] NOT NULL,status text NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),
 valid_after timestamptz NOT NULL DEFAULT 'epoch',revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,issuer,identity_tenant,client_id,service_principal_id));
CREATE TABLE IF NOT EXISTS public.machine_integration_references(
 reference_id uuid PRIMARY KEY,organization_id text NOT NULL,integration_id uuid NOT NULL REFERENCES public.machine_integrations(integration_id),
 kind text NOT NULL,internal_id text NOT NULL,UNIQUE(integration_id,kind,internal_id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['machine_integrations','machine_integration_references'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_isolation') THEN
 EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (organization_id=NULLIF(current_setting(''app.organization_id'',true),'''')) WITH CHECK (organization_id=NULLIF(current_setting(''app.organization_id'',true),''''))',t);END IF;
 END LOOP;END $$;
REVOKE ALL ON public.machine_integrations,public.machine_integration_references FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.authorize_machine_integration(public_id uuid,issuer_value text,tenant_value text,client_value uuid,principal_value uuid,issued_at timestamptz,scope_value text,roles_value text[])
RETURNS TABLE(organization_id text,actor_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping public.machine_integrations%ROWTYPE;role_value text;
BEGIN
 role_value:=CASE scope_value WHEN 'reports:read' THEN 'Training.Reports.Read' WHEN 'exports:read' THEN 'Training.Exports.Read' WHEN 'exports:write' THEN 'Training.Exports.Write' WHEN 'webhooks:read' THEN 'Training.Webhooks.Read' WHEN 'webhooks:write' THEN 'Training.Webhooks.Write' END;
 IF role_value IS NULL OR issued_at IS NULL OR NOT isfinite(issued_at) OR issued_at>clock_timestamp()+interval '2 minutes' OR NOT COALESCE(role_value=ANY(roles_value),false) THEN RETURN;END IF;
 SELECT * INTO mapping FROM public.machine_integrations m WHERE m.integration_id=public_id AND m.issuer=issuer_value AND m.identity_tenant=tenant_value AND m.client_id=client_value AND m.service_principal_id=principal_value AND m.status='ACTIVE' AND scope_value=ANY(m.scopes) AND issued_at>=m.valid_after FOR SHARE;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM set_config('app.organization_id',mapping.organization_id,true);
 IF NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.organization_id=mapping.organization_id AND o.status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=mapping.organization_id AND m.subject=mapping.actor_id AND m.status='ACTIVE') THEN RETURN;END IF;
 RETURN QUERY SELECT mapping.organization_id,mapping.actor_id;
END $$;
REVOKE ALL ON FUNCTION public.authorize_machine_integration(uuid,text,text,uuid,uuid,timestamptz,text,text[]) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.sync_machine_integration_actor(public_id uuid,administrator text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping public.machine_integrations%ROWTYPE;
BEGIN
 SELECT * INTO mapping FROM public.machine_integrations m WHERE m.integration_id=public_id AND m.organization_id=NULLIF(current_setting('app.organization_id',true),'') FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN public.organizations o ON o.organization_id=m.organization_id WHERE m.organization_id=mapping.organization_id AND m.subject=administrator AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=m.organization_id)) THEN RAISE EXCEPTION 'INTEGRATION_SCOPE_DENIED';END IF;
 IF mapping.actor_id<>'service-integration:'||mapping.integration_id::text THEN RAISE EXCEPTION 'INTEGRATION_SCOPE_DENIED';END IF;
 INSERT INTO public.organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at) VALUES('membership:'||mapping.actor_id,mapping.actor_id,mapping.organization_id,CASE WHEN mapping.status='ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END,now(),now()) ON CONFLICT(subject,organization_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now();
 INSERT INTO public.role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at) VALUES('role:'||mapping.actor_id,mapping.organization_id,mapping.actor_id,'organization_admin','organization',mapping.organization_id,now(),now()) ON CONFLICT(organization_id,subject,role,scope_type,scope_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.sync_machine_integration_actor(uuid,text) FROM PUBLIC;
`;
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export interface MachineIdentity {clientId:string;servicePrincipalId:string;applicationRoles:readonly string[];issuedAt:string}
export function createMachineIntegrationStore(pool:Pool){return {
 async save(tenant:TenantContext,input:{integrationId?:string;issuer:string;identityTenant:string;clientId:string;servicePrincipalId:string;scopes:readonly string[];enabled:boolean;revision:number;validAfter?:string;idempotencyKey?:string}){
  let issuer:URL;try{issuer=new URL(input.issuer);}catch{throw Error('INTEGRATION_INPUT_INVALID');}
  if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.hash||issuer.search||input.issuer.length>512||!uuid(input.identityTenant)||!uuid(input.clientId)||!uuid(input.servicePrincipalId)||!input.scopes.length||input.scopes.some(scope=>!integrationScopes.includes(scope as IntegrationScope))||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.enabled!=='boolean'||input.integrationId&&!uuid(input.integrationId)||input.validAfter!==undefined&&!Number.isFinite(Date.parse(input.validAfter)))throw Error('INTEGRATION_INPUT_INVALID');
  if(input.idempotencyKey!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('INTEGRATION_INPUT_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   await requireLifecycleAdmin(client,tenant);
   const auditId=input.idempotencyKey?'integration-admin:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,input.idempotencyKey])).digest('hex'):'audit:'+randomUUID();
   const signature=createHash('sha256').update(JSON.stringify([input.integrationId??null,input.issuer,input.identityTenant,input.clientId,input.servicePrincipalId,[...new Set(input.scopes)].sort(),input.enabled,input.revision,input.validAfter??null])).digest('hex');
   if(input.idempotencyKey){
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[auditId]);
    const previous=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,auditId])).rows[0];
    if(previous){if(previous.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return previous.details.result;}
   }
   const id=input.integrationId??randomUUID(),actor='service-integration:'+id;
   const existing=(await client.query('SELECT revision,valid_after FROM machine_integrations WHERE organization_id=$1 AND integration_id=$2 FOR UPDATE',[tenant.organizationId,id])).rows[0];
   if(existing?existing.revision!==input.revision:input.revision!==0)throw Error('INTEGRATION_REVISION_CONFLICT');
   if(existing&&input.validAfter&&Date.parse(input.validAfter)<new Date(existing.valid_after).getTime())throw Error('INTEGRATION_ROTATION_CUTOFF_INVALID');
   const validAfter=input.validAfter??existing?.valid_after??new Date(0).toISOString();
   const row=(await client.query(`INSERT INTO machine_integrations(integration_id,organization_id,actor_id,issuer,identity_tenant,client_id,service_principal_id,scopes,status,valid_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(integration_id) DO UPDATE SET issuer=EXCLUDED.issuer,identity_tenant=EXCLUDED.identity_tenant,client_id=EXCLUDED.client_id,service_principal_id=EXCLUDED.service_principal_id,scopes=EXCLUDED.scopes,status=EXCLUDED.status,valid_after=EXCLUDED.valid_after,revision=machine_integrations.revision+1,updated_at=now() WHERE machine_integrations.organization_id=EXCLUDED.organization_id RETURNING integration_id AS "integrationId",scopes,status,revision,valid_after AS "validAfter"`,[id,tenant.organizationId,actor,input.issuer,input.identityTenant,input.clientId,input.servicePrincipalId,[...new Set(input.scopes)],input.enabled?'ACTIVE':'REVOKED',validAfter])).rows[0];
   if(!row)throw Error('INTEGRATION_NOT_AVAILABLE');
   // Dedicated non-human actor is accepted only by the external allowlist router.
   await client.query('SELECT public.sync_machine_integration_actor($1,$2)',[id,tenant.actorId]);
   if(!input.enabled||!input.scopes.includes('webhooks:write'))await client.query(`UPDATE customer_webhook_subscriptions SET enabled=false,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND subscription_id IN (SELECT internal_id FROM machine_integration_references WHERE organization_id=$1 AND integration_id=$2 AND kind='subscriptionId')`,[tenant.organizationId,id]);
   await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,details,created_at) VALUES($1,$2,$3,'integration.client.configured',$4::jsonb,now())`,[auditId,tenant.organizationId,tenant.actorId,JSON.stringify({integrationId:id,scopes:input.scopes,enabled:input.enabled,revision:row.revision,signature,result:row})]);
   return row;
  });
 },
 async list(tenant:TenantContext){return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);return {items:(await client.query('SELECT integration_id AS "integrationId",issuer,identity_tenant AS "identityTenant",client_id AS "clientId",service_principal_id AS "servicePrincipalId",scopes,status,revision,valid_after AS "validAfter" FROM machine_integrations WHERE organization_id=$1 ORDER BY integration_id LIMIT 100',[tenant.organizationId])).rows};});},
 async authorize(input:{integrationId:string;issuer:string;identityTenant:string;machine:MachineIdentity;scope:IntegrationScope;correlationId:string}):Promise<TenantContext|null>{
  if(!uuid(input.integrationId)||!uuid(input.machine.clientId)||!uuid(input.machine.servicePrincipalId)||!Number.isFinite(Date.parse(input.machine.issuedAt)))return null;
  const row=(await pool.query('SELECT * FROM public.authorize_machine_integration($1,$2,$3,$4,$5,$6,$7,$8)',[input.integrationId,input.issuer,input.identityTenant,input.machine.clientId,input.machine.servicePrincipalId,input.machine.issuedAt,input.scope,input.machine.applicationRoles])).rows[0];
  return row?{organizationId:row.organization_id,actorId:row.actor_id,correlationId:input.correlationId}:null;
 },
 async reference(tenant:TenantContext,integrationId:string,kind:string,internalId:string):Promise<string>{return withTenantTransaction(pool,tenant,async client=>{const row=(await client.query(`INSERT INTO machine_integration_references(reference_id,organization_id,integration_id,kind,internal_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(integration_id,kind,internal_id) DO UPDATE SET kind=EXCLUDED.kind RETURNING reference_id`,[randomUUID(),tenant.organizationId,integrationId,kind,internalId])).rows[0];return row.reference_id;});},
 async internal(tenant:TenantContext,integrationId:string,kind:string,referenceId:string):Promise<string|null>{if(!uuid(referenceId))return null;return withTenantTransaction(pool,tenant,async client=>(await client.query('SELECT internal_id FROM machine_integration_references WHERE organization_id=$1 AND integration_id=$2 AND kind=$3 AND reference_id=$4',[tenant.organizationId,integrationId,kind,referenceId])).rows[0]?.internal_id??null);},
 async references(tenant:TenantContext,integrationId:string,kind:string):Promise<ReadonlySet<string>>{return withTenantTransaction(pool,tenant,async client=>new Set((await client.query('SELECT internal_id FROM machine_integration_references WHERE organization_id=$1 AND integration_id=$2 AND kind=$3 LIMIT 1000',[tenant.organizationId,integrationId,kind])).rows.map(row=>String(row.internal_id))));}
};}

export async function projectMachineIntegrationValue(store:ReturnType<typeof createMachineIntegrationStore>,tenant:TenantContext,integrationId:string,value:unknown,key=''):Promise<unknown>{
 if(value===null||value===undefined)return value;
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='string'&&key!=='keyId'&&/Id$|Ref$/.test(key))return store.reference(tenant,integrationId,key,value);
 if(Array.isArray(value))return Promise.all(value.map(item=>projectMachineIntegrationValue(store,tenant,integrationId,item,key.endsWith('Ids')?key.slice(0,-1):key)));
 if(typeof value==='object'){
  const result:Record<string,unknown>={};
  for(const [field,item] of Object.entries(value)){
   if(['organizationId','organization_id','actorId','actor_id','blobKey','blob_key','privateUrl','answerKey','answers','sourceText'].includes(field))continue;
   result[field]=await projectMachineIntegrationValue(store,tenant,integrationId,item,field);
  }return result;
 }return value;
}
/** A machine subscription is bound atomically when created; no raw IDs enter its delivery body or headers. */
export function createMachineWebhookProjection(pool:Pool){
 const store=createMachineIntegrationStore(pool);
 return async (tenant:TenantContext,input:{subscriptionId:string;deliveryId:string;eventId:string;payload:unknown})=>{
  const mapping=await withTenantTransaction(pool,tenant,async client=>(await client.query(`SELECT m.integration_id,m.status,m.scopes,o.status AS organization_status FROM machine_integration_references r JOIN machine_integrations m ON m.integration_id=r.integration_id AND m.organization_id=r.organization_id JOIN organizations o ON o.organization_id=m.organization_id WHERE r.organization_id=$1 AND r.kind='subscriptionId' AND r.internal_id=$2`,[tenant.organizationId,input.subscriptionId])).rows[0]);
  if(!mapping)return {allowed:true,eventId:input.eventId,deliveryId:input.deliveryId,payload:input.payload};
  if(mapping.status!=='ACTIVE'||mapping.organization_status!=='ACTIVE'||!mapping.scopes.includes('webhooks:write'))return {allowed:false,eventId:'',deliveryId:'',payload:null};
  return {allowed:true,eventId:await store.reference(tenant,mapping.integration_id,'eventId',input.eventId),deliveryId:await store.reference(tenant,mapping.integration_id,'deliveryId',input.deliveryId),payload:await projectMachineIntegrationValue(store,tenant,mapping.integration_id,input.payload)};
 };
}
