import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
export const ORGANIZATION_LIFECYCLE_MIGRATION_SQL=`
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS lifecycle_revision integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.set_organization_status(next_status text,expected_revision integer,actor text,request_key text,reason text,correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; event_id text; signature_value text; prior jsonb; current_row public.organizations%ROWTYPE;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR next_status IS NULL OR next_status NOT IN ('ACTIVE','SUSPENDED') OR expected_revision IS NULL OR expected_revision<1 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ORGANIZATION_LIFECYCLE_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=selected_org AND subject=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'ORGANIZATION_LIFECYCLE_ACCESS_DENIED'; END IF;
 SELECT * INTO current_row FROM public.organizations WHERE organization_id=selected_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORGANIZATION_LIFECYCLE_NOT_FOUND'; END IF;
 event_id:='organization-status:'||encode(sha256(convert_to(jsonb_build_array(selected_org,actor,request_key)::text,'UTF8')),'hex');
 signature_value:=encode(sha256(convert_to(jsonb_build_array(next_status,expected_revision,btrim(reason))::text,'UTF8')),'hex');
 SELECT details INTO prior FROM public.audit_events WHERE organization_id=selected_org AND audit_event_id=event_id;
 IF FOUND THEN
  IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN;
 END IF;
 IF current_row.lifecycle_revision<>expected_revision OR current_row.status=next_status THEN RAISE EXCEPTION 'ORGANIZATION_LIFECYCLE_CHANGED'; END IF;
 UPDATE public.organizations SET status=next_status,lifecycle_revision=lifecycle_revision+1,updated_at=now() WHERE organization_id=selected_org;
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
 VALUES(event_id,selected_org,actor,'ORGANIZATION_STATUS_CHANGED','organization',selected_org,jsonb_build_object('signature',signature_value,'previousStatus',current_row.status,'status',next_status,'previousRevision',expected_revision,'reason',btrim(reason),'correlationId',correlation),now());
END $$;
REVOKE ALL ON FUNCTION public.set_organization_status(text,integer,text,text,text,text) FROM PUBLIC;
`;
/** The callback must validate current signed platform-operator authority. Membership is checked here and in SQL. */
export function createOrganizationLifecycleStore(pool:Pool,authorizeOperator:(tenant:TenantContext)=>Promise<void>){
 async function read(client:PoolClient,tenant:TenantContext){
  if(!(await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND subject=$2 AND status='ACTIVE'`,[tenant.organizationId,tenant.actorId])).rowCount)throw Error('ORGANIZATION_LIFECYCLE_ACCESS_DENIED');
  const result=await client.query(`SELECT organization_id AS "organizationId",name,status,lifecycle_revision AS revision FROM organizations WHERE organization_id=$1`,[tenant.organizationId]);
  if(!result.rowCount)throw Error('ORGANIZATION_LIFECYCLE_NOT_FOUND');
  return result.rows[0];
 }
 return {
  async get(tenant:TenantContext){await authorizeOperator(tenant);return withTenantTransaction(pool,tenant,client=>read(client,tenant));},
  async setStatus(tenant:TenantContext,input:{status:string;revision:number;reason:string;idempotencyKey:string;confirmed:boolean}){
   await authorizeOperator(tenant);
   if(input.confirmed!==true||!['ACTIVE','SUSPENDED'].includes(input.status)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('ORGANIZATION_LIFECYCLE_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    await client.query('SELECT public.set_organization_status($1,$2,$3,$4,$5,$6)',[input.status,input.revision,tenant.actorId,input.idempotencyKey,input.reason.trim(),tenant.correlationId]);
    return read(client,tenant);
   });
  }
 };
}
