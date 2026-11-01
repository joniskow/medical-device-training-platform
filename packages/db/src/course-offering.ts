import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';

export type CourseOfferingInput={mode:'PRIVATE'|'PUBLIC'|'UNLISTED';audience:string;productScope:string;prerequisites:string;issuerStatement:string;intendedUse:string;accessibilityPath:string;estimatedMinutes:number;revision:number;reason:string;idempotencyKey:string};
export const COURSE_OFFERING_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.course_offerings(
 organization_id text NOT NULL,release_id text PRIMARY KEY REFERENCES public.release_manifests(release_id),
 mode text NOT NULL CHECK(mode IN ('PRIVATE','PUBLIC','UNLISTED')),
 details jsonb NOT NULL,revision integer NOT NULL CHECK(revision>0),updated_at timestamptz NOT NULL
);
-- Private routing metadata only: runtime gets no direct table access.
CREATE TABLE IF NOT EXISTS public.course_catalog_routes(
 release_id text PRIMARY KEY REFERENCES public.release_manifests(release_id) ON DELETE CASCADE,
 organization_id text NOT NULL,public_id uuid NOT NULL UNIQUE,listed boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS course_catalog_listed_idx ON public.course_catalog_routes(public_id) WHERE listed;
ALTER TABLE public.course_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_offerings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_offerings_tenant ON public.course_offerings;
CREATE POLICY course_offerings_tenant ON public.course_offerings USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''));
CREATE OR REPLACE FUNCTION public.manage_course_offering(target_release text,actor text,next_mode text,disclosures jsonb,expected_revision integer,request_key text,reason text,correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; current_row public.course_offerings%ROWTYPE; release_row public.release_manifests%ROWTYPE; previous_revision integer; event_id text; signature_value text; prior jsonb; field text;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR target_release IS NULL OR target_release !~ '^[A-Za-z0-9._:-]{1,128}$' OR actor IS NULL THEN RAISE EXCEPTION 'COURSE_OFFERING_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
 IF NOT EXISTS(SELECT 1 FROM public.organizations o JOIN public.organization_memberships m ON m.organization_id=o.organization_id JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE o.organization_id=selected_org AND o.status='ACTIVE' AND m.subject=actor AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)) THEN RAISE EXCEPTION 'COURSE_OFFERING_ADMIN_REQUIRED'; END IF;
 SELECT * INTO release_row FROM public.release_manifests WHERE organization_id=selected_org AND release_id=target_release FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_OFFERING_NOT_FOUND'; END IF;
 SELECT * INTO current_row FROM public.course_offerings WHERE organization_id=selected_org AND release_id=target_release FOR UPDATE;
 previous_revision:=COALESCE(current_row.revision,0);
 IF next_mode IS NOT NULL THEN
  IF next_mode NOT IN ('PRIVATE','PUBLIC','UNLISTED') OR disclosures IS NULL OR jsonb_typeof(disclosures)<>'object' OR expected_revision IS NULL OR expected_revision<0 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'COURSE_OFFERING_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(disclosures) k WHERE k NOT IN ('audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath','estimatedMinutes','costDesignation','enrollmentRule')) OR disclosures->>'costDesignation' IS DISTINCT FROM 'free-in-MVP' OR disclosures->>'enrollmentRule' IS DISTINCT FROM 'SELF_ENROLLMENT' THEN RAISE EXCEPTION 'COURSE_OFFERING_INVALID'; END IF;
  FOREACH field IN ARRAY ARRAY['audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath'] LOOP
   IF jsonb_typeof(disclosures->field) IS DISTINCT FROM 'string' OR length(disclosures->>field)>2000 OR (next_mode<>'PRIVATE' AND length(btrim(disclosures->>field))=0) THEN RAISE EXCEPTION 'COURSE_OFFERING_INVALID'; END IF;
  END LOOP;
  IF jsonb_typeof(disclosures->'estimatedMinutes') IS DISTINCT FROM 'number' OR (disclosures->>'estimatedMinutes') !~ '^[0-9]{1,5}$' OR (disclosures->>'estimatedMinutes')::integer NOT BETWEEN 1 AND 10080 THEN RAISE EXCEPTION 'COURSE_OFFERING_INVALID'; END IF;
  event_id:='course-offering:'||encode(sha256(convert_to(jsonb_build_array(selected_org,actor,request_key)::text,'UTF8')),'hex');
  signature_value:=encode(sha256(convert_to(jsonb_build_array(target_release,next_mode,disclosures,expected_revision,btrim(reason))::text,'UTF8')),'hex');
  SELECT details INTO prior FROM public.audit_events WHERE organization_id=selected_org AND audit_event_id=event_id;
  IF FOUND THEN
   IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  ELSE
   IF previous_revision<>expected_revision THEN RAISE EXCEPTION 'COURSE_OFFERING_CHANGED'; END IF;
   IF next_mode<>'PRIVATE' AND release_row.status<>'PUBLISHED' THEN RAISE EXCEPTION 'COURSE_OFFERING_RELEASE_UNAVAILABLE'; END IF;
   INSERT INTO public.course_offerings(organization_id,release_id,mode,details,revision,updated_at) VALUES(selected_org,target_release,next_mode,disclosures,previous_revision+1,now())
   ON CONFLICT(release_id) DO UPDATE SET mode=EXCLUDED.mode,details=EXCLUDED.details,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at;
   INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
   VALUES(event_id,selected_org,actor,'COURSE_OFFERING_UPDATED','course_release',target_release,jsonb_build_object('signature',signature_value,'reason',btrim(reason),'previousMode',COALESCE(current_row.mode,'PRIVATE'),'nextMode',next_mode,'previousRevision',previous_revision,'disclosures',disclosures,'releaseHash',release_row.release_hash,'correlationId',correlation),now());
   SELECT * INTO current_row FROM public.course_offerings WHERE organization_id=selected_org AND release_id=target_release;
  END IF;
 END IF;
 RETURN jsonb_build_object('releaseId',target_release,'title',COALESCE(release_row.manifest->'content'->>'title',''),'releaseStatus',release_row.status,'mode',COALESCE(current_row.mode,'PRIVATE'),'revision',COALESCE(current_row.revision,0),'details',COALESCE(current_row.details,'{}'::jsonb),'publicId',CASE WHEN current_row.mode IN ('PUBLIC','UNLISTED') THEN (SELECT public_id FROM public.course_catalog_routes WHERE release_id=target_release) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.manage_course_offering(text,text,text,jsonb,integer,text,text,text) FROM PUBLIC;
`;
export function createCourseOfferingStore(pool:Pool){
 const call=(tenant:TenantContext,releaseId:string,input?:CourseOfferingInput)=>withTenantTransaction(pool,tenant,async client=>{
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(releaseId))throw Error('COURSE_OFFERING_INVALID');
  let details:Record<string,unknown>|null=null;
  if(input){
   if(!['PRIVATE','PUBLIC','UNLISTED'].includes(input.mode)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=2147483647||!Number.isSafeInteger(input.estimatedMinutes)||input.estimatedMinutes<1||input.estimatedMinutes>10080||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('COURSE_OFFERING_INVALID');
   details={costDesignation:'free-in-MVP',enrollmentRule:'SELF_ENROLLMENT',estimatedMinutes:input.estimatedMinutes};
   for(const field of ['audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath'] as const){const value=input[field];if(typeof value!=='string'||value.length>2000||(input.mode!=='PRIVATE'&&!value.trim()))throw Error('COURSE_OFFERING_INVALID');details[field]=value.trim();}
  }
  const result=await client.query('SELECT public.manage_course_offering($1,$2,$3,$4::jsonb,$5,$6,$7,$8) AS offering',[releaseId,tenant.actorId,input?.mode??null,details?JSON.stringify(details):null,input?.revision??null,input?.idempotencyKey??null,input?.reason.trim()??null,tenant.correlationId]);
  return result.rows[0].offering;
 });
 return {get:(tenant:TenantContext,releaseId:string)=>call(tenant,releaseId),update:(tenant:TenantContext,releaseId:string,input:CourseOfferingInput)=>call(tenant,releaseId,input)};
}
