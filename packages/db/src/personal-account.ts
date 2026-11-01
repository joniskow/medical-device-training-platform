import type {Pool} from 'pg';
import {observeAccountVerification} from './account-verification.js';
export interface AccountIdentity {subject:string;issuer:string;identityTenant:string;verifiedEmail?:string}
export const PERSONAL_ACCOUNT_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.personal_accounts (
 user_id text PRIMARY KEY,display_name text NOT NULL,locale text NOT NULL DEFAULT 'en',
 status text NOT NULL CHECK(status IN ('ACTIVE','LOCKED')),revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.external_identities (
 issuer text NOT NULL,identity_tenant text NOT NULL,provider_subject text NOT NULL,
 user_id text NOT NULL REFERENCES public.personal_accounts(user_id),created_at timestamptz NOT NULL,
 PRIMARY KEY(issuer,identity_tenant,provider_subject)
);
CREATE TABLE IF NOT EXISTS public.personal_account_events (
 event_id text PRIMARY KEY,user_id text NOT NULL REFERENCES public.personal_accounts(user_id),event_type text NOT NULL,
 details jsonb NOT NULL,created_at timestamptz NOT NULL
);
ALTER TABLE public.personal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.personal_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_account_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_account_scope ON public.personal_accounts;
CREATE POLICY personal_account_scope ON public.personal_accounts USING(user_id=NULLIF(current_setting('app.user_id',true),'')) WITH CHECK(user_id=NULLIF(current_setting('app.user_id',true),''));
DROP POLICY IF EXISTS personal_account_event_scope ON public.personal_account_events;
CREATE POLICY personal_account_event_scope ON public.personal_account_events USING(user_id=NULLIF(current_setting('app.user_id',true),'')) WITH CHECK(user_id=NULLIF(current_setting('app.user_id',true),''));
CREATE OR REPLACE FUNCTION public.access_personal_account(identity_issuer text,identity_tenant_value text,identity_subject text,operation text,profile_name text,expected_revision integer,request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id text; current_row public.personal_accounts%ROWTYPE; event_key text; signature_value text; prior jsonb;
BEGIN
 IF identity_issuer IS NULL OR length(identity_issuer) NOT BETWEEN 1 AND 2048 OR identity_tenant_value IS NULL OR length(identity_tenant_value) NOT BETWEEN 1 AND 256 OR identity_subject IS NULL OR length(identity_subject) NOT BETWEEN 1 AND 256 OR operation IS NULL OR operation NOT IN ('GET','CREATE','UPDATE') THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_INVALID'; END IF;
 IF operation<>'GET' AND (profile_name IS NULL OR length(btrim(profile_name)) NOT BETWEEN 1 AND 160 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$') THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_INVALID'; END IF;
 IF operation='UPDATE' AND (expected_revision IS NULL OR expected_revision<1) THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account:'||identity_subject,0));
 SELECT user_id INTO account_id FROM public.external_identities WHERE issuer=identity_issuer AND identity_tenant=identity_tenant_value AND provider_subject=identity_subject;
 IF NOT FOUND THEN
  -- Preserve existing domain ownership IDs; another issuer may never claim the same legacy identifier.
  account_id:=identity_subject;
  PERFORM set_config('app.user_id',account_id,true);
  IF EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=account_id) THEN RAISE EXCEPTION 'ACCOUNT_IDENTITY_CONFLICT'; END IF;
  IF operation<>'CREATE' THEN RETURN NULL; END IF;
  INSERT INTO public.personal_accounts(user_id,display_name,status,created_at,updated_at) VALUES(account_id,btrim(profile_name),'ACTIVE',now(),now());
  INSERT INTO public.external_identities(issuer,identity_tenant,provider_subject,user_id,created_at) VALUES(identity_issuer,identity_tenant_value,identity_subject,account_id,now());
 ELSE
  PERFORM set_config('app.user_id',account_id,true);
 END IF;
 SELECT * INTO current_row FROM public.personal_accounts WHERE user_id=account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE'; END IF;
 IF current_row.status<>'ACTIVE' THEN RAISE EXCEPTION 'ACCOUNT_LOCKED'; END IF;
 IF operation<>'GET' THEN
  event_key:='account:'||encode(sha256(convert_to(jsonb_build_array(identity_issuer,identity_tenant_value,identity_subject,request_key)::text,'UTF8')),'hex');
  signature_value:=encode(sha256(convert_to(jsonb_build_array(operation,btrim(profile_name),expected_revision)::text,'UTF8')),'hex');
  SELECT details INTO prior FROM public.personal_account_events WHERE event_id=event_key AND user_id=account_id;
  IF FOUND THEN
   IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  ELSE
   IF operation='CREATE' AND EXISTS(SELECT 1 FROM public.personal_account_events WHERE user_id=account_id AND event_type='ACCOUNT_CREATED') THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_EXISTS'; END IF;
   IF operation='UPDATE' THEN
    IF current_row.revision<>expected_revision THEN RAISE EXCEPTION 'ACCOUNT_CHANGED'; END IF;
    UPDATE public.personal_accounts SET display_name=btrim(profile_name),revision=revision+1,updated_at=now() WHERE user_id=account_id;
   END IF;
   INSERT INTO public.personal_account_events(event_id,user_id,event_type,details,created_at) VALUES(event_key,account_id,CASE WHEN operation='CREATE' THEN 'ACCOUNT_CREATED' ELSE 'ACCOUNT_PROFILE_UPDATED' END,jsonb_build_object('signature',signature_value,'previousRevision',current_row.revision),now());
  END IF;
 END IF;
 SELECT * INTO current_row FROM public.personal_accounts WHERE user_id=account_id;
 RETURN jsonb_build_object('userId',current_row.user_id,'displayName',current_row.display_name,'locale',current_row.locale,'status',current_row.status,'revision',current_row.revision);
END $$;
REVOKE ALL ON FUNCTION public.access_personal_account(text,text,text,text,text,integer,text) FROM PUBLIC;
`;
/** Identity values must come from the signed authenticator, never a request body. */
export function createPersonalAccountStore(pool:Pool){return {
 observeVerification:(identity:AccountIdentity,expiresAt?:string)=>observeAccountVerification(pool,identity,expiresAt),
 async access(identity:AccountIdentity,operation:'GET'|'CREATE'|'UPDATE',input?:{displayName:string;revision?:number;idempotencyKey:string}){
  if(!identity.issuer||!identity.identityTenant||!identity.subject)throw Error('ACCOUNT_IDENTITY_REQUIRED');
  if(operation!=='GET'&&(!input||typeof input.displayName!=='string'||!input.displayName.trim()||input.displayName.trim().length>160||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)))throw Error('ACCOUNT_REQUEST_INVALID');
  if(operation==='UPDATE'&&(!Number.isSafeInteger(input?.revision)||input!.revision!<1||input!.revision!>2147483647))throw Error('ACCOUNT_REQUEST_INVALID');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query('SELECT public.access_personal_account($1,$2,$3,$4,$5,$6,$7) AS account',[identity.issuer,identity.identityTenant,identity.subject,operation,input?.displayName.trim()??null,input?.revision??null,input?.idempotencyKey??null]);
   await client.query('COMMIT');
   const account=result.rows[0].account;
   return account?{...account,emailVerified:!!identity.verifiedEmail}:null;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
};}
