import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
export const ORGANIZATION_PROFILE_MIGRATION_SQL=`
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS profile_revision integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.update_organization_profile(profile_name text,profile_description text,profile_website text,expected_revision integer,actor text,request_key text,reason text,correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; event_id text; signature_value text; prior jsonb; current_profile public.organizations%ROWTYPE;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR profile_name IS NULL OR length(btrim(profile_name)) NOT BETWEEN 1 AND 160 OR profile_description IS NULL OR length(profile_description)>2000 OR profile_website IS NULL OR length(profile_website)>2048 OR (profile_website<>'' AND profile_website !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$') OR expected_revision IS NULL OR expected_revision<1 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ORGANIZATION_PROFILE_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE m.organization_id=selected_org AND m.subject=actor AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)) THEN RAISE EXCEPTION 'ORGANIZATION_PROFILE_ADMIN_REQUIRED'; END IF;
 SELECT * INTO current_profile FROM public.organizations WHERE organization_id=selected_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORGANIZATION_PROFILE_NOT_FOUND'; END IF;
 IF current_profile.status<>'ACTIVE' THEN RAISE EXCEPTION 'ORGANIZATION_PROFILE_ADMIN_REQUIRED'; END IF;
 event_id:='organization-profile:'||encode(sha256(convert_to(jsonb_build_array(selected_org,actor,request_key)::text,'UTF8')),'hex');
 signature_value:=encode(sha256(convert_to(jsonb_build_array(btrim(profile_name),profile_description,profile_website,expected_revision,btrim(reason))::text,'UTF8')),'hex');
 SELECT details INTO prior FROM public.audit_events WHERE organization_id=selected_org AND audit_event_id=event_id;
 IF FOUND THEN
  IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN;
 END IF;
 IF current_profile.profile_revision<>expected_revision THEN RAISE EXCEPTION 'ORGANIZATION_PROFILE_CHANGED'; END IF;
 UPDATE public.organizations SET name=btrim(profile_name),description=profile_description,website=profile_website,profile_revision=profile_revision+1,updated_at=now() WHERE organization_id=selected_org;
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES(event_id,selected_org,actor,'ORGANIZATION_PROFILE_UPDATED','organization',selected_org,jsonb_build_object('signature',signature_value,'reason',btrim(reason),'previous',jsonb_build_object('name',current_profile.name,'description',current_profile.description,'website',current_profile.website),'next',jsonb_build_object('name',btrim(profile_name),'description',profile_description,'website',profile_website),'previousRevision',expected_revision,'correlationId',correlation),now());
END $$;
REVOKE ALL ON FUNCTION public.update_organization_profile(text,text,text,integer,text,text,text,text) FROM PUBLIC;
`;
const projection=`SELECT organization_id AS "organizationId",name,description,website,profile_revision AS revision FROM organizations WHERE organization_id=$1`;
export function createOrganizationProfileStore(pool:Pool){
 async function read(client:import('pg').PoolClient,tenant:TenantContext){
  const permitted=await client.query(`SELECT 1 FROM organization_memberships m JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN organizations o ON o.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.subject=$2 AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=$1)`,[tenant.organizationId,tenant.actorId]);
  if(!permitted.rowCount)throw Error('ORGANIZATION_PROFILE_ADMIN_REQUIRED');
  const result=await client.query(projection,[tenant.organizationId]);
  if(!result.rowCount)throw Error('ORGANIZATION_PROFILE_NOT_FOUND');
  return result.rows[0];
 }
 return {
  get:(tenant:TenantContext)=>withTenantTransaction(pool,tenant,client=>read(client,tenant)),
  async update(tenant:TenantContext,input:{name:string;description:string;website:string;revision:number;reason:string;idempotencyKey:string}){
   if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>160||typeof input.description!=='string'||input.description.length>2000||typeof input.website!=='string'||input.website.length>2048||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('ORGANIZATION_PROFILE_INVALID');
   const website=input.website.trim();
   if(website){try{const parsed=new URL(website);if(parsed.protocol!=='https:'||parsed.username||parsed.password||/\s/.test(website))throw Error();}catch{throw Error('ORGANIZATION_PROFILE_INVALID');}}
   return withTenantTransaction(pool,tenant,async client=>{
    await client.query('SELECT public.update_organization_profile($1,$2,$3,$4,$5,$6,$7,$8)',[input.name.trim(),input.description.trim(),website,input.revision,tenant.actorId,input.idempotencyKey,input.reason.trim(),tenant.correlationId]);
    return read(client,tenant);
   });
  }
 };
}
