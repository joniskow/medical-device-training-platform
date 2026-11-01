import type {Pool} from 'pg';
import type {AccountIdentity} from './personal-account.js';
export const ACCOUNT_VERIFICATION_MIGRATION_SQL=`
ALTER TABLE public.personal_accounts ADD COLUMN IF NOT EXISTS verified_until timestamptz;
CREATE OR REPLACE FUNCTION public.observe_account_verification(identity_issuer text,identity_tenant_value text,identity_subject text,expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id text;
BEGIN
 IF expires_at IS NOT NULL AND (NOT isfinite(expires_at) OR expires_at<=clock_timestamp()) THEN expires_at:=NULL; END IF;
 SELECT user_id INTO account_id FROM public.external_identities WHERE issuer=identity_issuer AND identity_tenant=identity_tenant_value AND provider_subject=identity_subject;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.user_id',account_id,true);
 UPDATE public.personal_accounts SET verified_until=expires_at WHERE user_id=account_id AND status='ACTIVE';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.observe_account_verification(text,text,text,timestamptz) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.has_verified_account(target_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM set_config('app.user_id',target_id,true);
 -- Hold the account row until the issuing transaction commits; locks/revocation serialize with issuance.
 PERFORM 1 FROM public.personal_accounts WHERE user_id=target_id AND status='ACTIVE' AND verified_until>clock_timestamp() FOR SHARE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.has_verified_account(text) FROM PUBLIC;
`;
/** Only pass an expiry from the validated access token, never a request body or profile field. */
export async function observeAccountVerification(pool:Pool,identity:AccountIdentity,expiresAt?:string){
 const expiry=identity.verifiedEmail&&expiresAt&&Number.isFinite(Date.parse(expiresAt))?expiresAt:null;
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query('SELECT public.observe_account_verification($1,$2,$3,$4)',[identity.issuer,identity.identityTenant,identity.subject,expiry]);await client.query('COMMIT');}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
