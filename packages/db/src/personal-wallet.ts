import type {Pool} from 'pg';

export const PERSONAL_WALLET_MIGRATION_SQL=`
-- Routing only; no runtime table grants or cross-tenant credential SELECT policy.
CREATE TABLE IF NOT EXISTS public.personal_credential_routes(
 credential_id text PRIMARY KEY REFERENCES public.credentials(credential_id) ON DELETE CASCADE,
 user_id text NOT NULL,organization_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS personal_credential_owner_idx ON public.personal_credential_routes(user_id,credential_id);
CREATE OR REPLACE FUNCTION public.sync_personal_credential_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.personal_credential_routes(credential_id,user_id,organization_id) VALUES(NEW.credential_id,NEW.learner_id,NEW.organization_id)
 ON CONFLICT(credential_id) DO UPDATE SET user_id=EXCLUDED.user_id,organization_id=EXCLUDED.organization_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_personal_credential_route() FROM PUBLIC;
DROP TRIGGER IF EXISTS personal_credential_route ON public.credentials;
CREATE TRIGGER personal_credential_route AFTER INSERT OR UPDATE OF learner_id,organization_id ON public.credentials FOR EACH ROW EXECUTE FUNCTION public.sync_personal_credential_route();
INSERT INTO public.personal_credential_routes(credential_id,user_id,organization_id) SELECT credential_id,learner_id,organization_id FROM public.credentials
ON CONFLICT(credential_id) DO UPDATE SET user_id=EXCLUDED.user_id,organization_id=EXCLUDED.organization_id;
CREATE OR REPLACE FUNCTION public.read_personal_wallet(actor text,after_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_org text;previous_user text;route record;item jsonb;items jsonb:='[]'::jsonb;last_id text;scanned integer:=0;has_more boolean:=false;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR (after_id IS NOT NULL AND after_id !~ '^[A-Za-z0-9._:-]{1,128}$') THEN RAISE EXCEPTION 'PERSONAL_WALLET_INVALID';END IF;
 previous_org:=current_setting('app.organization_id',true);previous_user:=current_setting('app.user_id',true);PERFORM set_config('app.user_id',actor,true);
 IF EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=actor AND status='ACTIVE') THEN
  FOR route IN SELECT credential_id,organization_id FROM public.personal_credential_routes WHERE user_id=actor AND (after_id IS NULL OR credential_id>after_id) ORDER BY credential_id LIMIT 51 LOOP
   IF scanned=50 THEN has_more:=true;EXIT;END IF;
   scanned:=scanned+1;last_id:=route.credential_id;PERFORM set_config('app.organization_id',route.organization_id,true);
   SELECT jsonb_build_object('credentialId',c.credential_id,'issuerId',c.organization_id,'issuerName',COALESCE(c.evidence->'policy'->'publicVerification'->>'issuerName','Issuing organization'),
    'title',COALESCE(c.evidence->>'title','Training credential'),'releaseId',c.release_id,'courseVersionId',c.course_version_id,'policyVersion',c.policy_version,
    'status',CASE WHEN c.status='ACTIVE' AND c.expires_at<=now() THEN 'EXPIRED' ELSE c.status END,'supersededBy',c.superseded_by,
    'issuedAt',c.issued_at,'expiresAt',c.expires_at,'publicId',c.public_id,
    'verificationAllowed',COALESCE((c.evidence->'policy'->'publicVerification'->>'enabled')='true',false),
    'verificationEnabled',COALESCE((c.evidence->'policy'->'publicVerification'->>'enabled')='true',false) AND c.sharing_enabled,
    'sharingRevision',c.sharing_revision,
    'intendedUse','Organization-issued product-training credential. Not professional licensure, accreditation, or regulatory approval.') INTO item
   FROM public.credentials c WHERE c.credential_id=route.credential_id AND c.organization_id=route.organization_id AND c.learner_id=actor;
   IF item IS NOT NULL THEN items:=items||jsonb_build_array(item);END IF;
  END LOOP;
 END IF;
 PERFORM set_config('app.organization_id',COALESCE(previous_org,''),true);PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.read_personal_wallet(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.resolve_personal_credential(actor text,target_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_org text;previous_user text;issuer text;permitted boolean:=false;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR target_id IS NULL OR target_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'PERSONAL_WALLET_INVALID';END IF;
 previous_org:=current_setting('app.organization_id',true);previous_user:=current_setting('app.user_id',true);PERFORM set_config('app.user_id',actor,true);
 IF EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=actor AND status='ACTIVE') THEN
  SELECT organization_id INTO issuer FROM public.personal_credential_routes WHERE credential_id=target_id AND user_id=actor;
  IF issuer IS NOT NULL THEN
   PERFORM set_config('app.organization_id',issuer,true);
   SELECT EXISTS(SELECT 1 FROM public.credentials WHERE credential_id=target_id AND organization_id=issuer AND learner_id=actor) INTO permitted;
  END IF;
 END IF;
 PERFORM set_config('app.organization_id',COALESCE(previous_org,''),true);PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);
 RETURN CASE WHEN permitted THEN issuer ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION public.resolve_personal_credential(text,text) FROM PUBLIC;
`;

export function createPersonalWalletStore(pool:Pool){return {
 async resolveOwner(actor:string,credentialId:string):Promise<string|null>{return (await pool.query('SELECT public.resolve_personal_credential($1,$2) AS issuer',[actor,credentialId])).rows[0].issuer;},
 async list(actor:string,after?:string){
  if(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('PERSONAL_WALLET_INVALID');
  return (await pool.query('SELECT public.read_personal_wallet($1,$2) AS wallet',[actor,after??null])).rows[0].wallet;
 }
};}
