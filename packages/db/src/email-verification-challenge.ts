import type {Pool} from 'pg';

export const EMAIL_CHALLENGE_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.email_verification_challenges (
 identity_key text PRIMARY KEY,
 challenge_id uuid NOT NULL UNIQUE,
 email text NOT NULL,
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(),
 sends integer NOT NULL DEFAULT 1,
 consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.email_verification_assurances (
 identity_key text PRIMARY KEY,
 email text NOT NULL,
 verified_until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.email_verification_delivery_limits (
 email_key text PRIMARY KEY,window_start timestamptz NOT NULL,sends integer NOT NULL
);
REVOKE ALL ON public.email_verification_delivery_limits FROM PUBLIC;
REVOKE ALL ON public.email_verification_challenges,public.email_verification_assurances FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.issue_email_verification(identity_value text,id_value uuid,email_value text,hash_value text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 IF identity_value IS NULL OR hash_value IS NULL OR email_value IS NULL OR id_value IS NULL OR identity_value !~ '^[a-f0-9]{64}$' OR hash_value !~ '^[a-f0-9]{64}$' OR email_value !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' OR length(email_value)>254 THEN RETURN false; END IF;
 -- Serialize identity and recipient counters across API replicas, including resend races.
 PERFORM pg_advisory_xact_lock(hashtextextended(identity_value,0));
 IF EXISTS(SELECT 1 FROM public.email_verification_challenges c WHERE c.identity_key=identity_value AND (c.issued_at>clock_timestamp()-interval '1 minute' OR (c.window_start>clock_timestamp()-interval '1 hour' AND c.sends>=5))) THEN RETURN false; END IF;
 INSERT INTO public.email_verification_delivery_limits(email_key,window_start,sends) VALUES(md5(email_value),clock_timestamp(),1)
 ON CONFLICT(email_key) DO UPDATE SET window_start=CASE WHEN email_verification_delivery_limits.window_start<=clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE email_verification_delivery_limits.window_start END,
 sends=CASE WHEN email_verification_delivery_limits.window_start<=clock_timestamp()-interval '1 hour' THEN 1 ELSE email_verification_delivery_limits.sends+1 END
 WHERE email_verification_delivery_limits.window_start<=clock_timestamp()-interval '1 hour' OR email_verification_delivery_limits.sends<5;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RETURN false; END IF;
 INSERT INTO public.email_verification_challenges(identity_key,challenge_id,email,code_hash,expires_at)
 VALUES(identity_value,id_value,email_value,hash_value,clock_timestamp()+interval '10 minutes')
 ON CONFLICT(identity_key) DO UPDATE SET challenge_id=id_value,email=email_value,code_hash=hash_value,expires_at=clock_timestamp()+interval '10 minutes',attempts=0,consumed_at=NULL,issued_at=clock_timestamp(),
 sends=CASE WHEN email_verification_challenges.window_start<=clock_timestamp()-interval '1 hour' THEN 1 ELSE email_verification_challenges.sends+1 END,
 window_start=CASE WHEN email_verification_challenges.window_start<=clock_timestamp()-interval '1 hour' THEN clock_timestamp() ELSE email_verification_challenges.window_start END
 WHERE email_verification_challenges.issued_at<=clock_timestamp()-interval '1 minute'
 AND (email_verification_challenges.window_start<=clock_timestamp()-interval '1 hour' OR email_verification_challenges.sends<5);
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
CREATE OR REPLACE FUNCTION public.consume_email_verification(identity_value text,id_value uuid,hash_value text)
RETURNS TABLE(email text,verified_until timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE challenge public.email_verification_challenges%ROWTYPE;
BEGIN
 IF identity_value IS NULL OR hash_value IS NULL OR identity_value !~ '^[a-f0-9]{64}$' OR hash_value !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
 SELECT * INTO challenge FROM public.email_verification_challenges WHERE identity_key=identity_value AND challenge_id=id_value FOR UPDATE;
 IF NOT FOUND OR challenge.consumed_at IS NOT NULL OR challenge.expires_at<=clock_timestamp() OR challenge.attempts>=5 THEN RETURN; END IF;
 UPDATE public.email_verification_challenges SET attempts=attempts+1 WHERE identity_key=identity_value;
 IF challenge.code_hash<>hash_value THEN RETURN; END IF;
 UPDATE public.email_verification_challenges SET consumed_at=clock_timestamp(),code_hash=repeat('0',64) WHERE identity_key=identity_value;
 INSERT INTO public.email_verification_assurances(identity_key,email,verified_until) VALUES(identity_value,challenge.email,clock_timestamp()+interval '24 hours')
 ON CONFLICT(identity_key) DO UPDATE SET email=EXCLUDED.email,verified_until=EXCLUDED.verified_until;
 RETURN QUERY SELECT a.email,a.verified_until FROM public.email_verification_assurances a WHERE a.identity_key=identity_value;
END $$;
CREATE OR REPLACE FUNCTION public.get_email_verification(identity_value text)
RETURNS TABLE(email text,verified_until timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.email,a.verified_until FROM public.email_verification_assurances a WHERE a.identity_key=identity_value AND a.verified_until>clock_timestamp();
$$;
CREATE OR REPLACE FUNCTION public.invalidate_email_verification(identity_value text,id_value uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 UPDATE public.email_verification_challenges SET consumed_at=clock_timestamp(),code_hash=repeat('0',64) WHERE identity_key=identity_value AND challenge_id=id_value;
$$;
CREATE OR REPLACE FUNCTION public.revoke_email_verification(identity_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(identity_value,0));
 UPDATE public.email_verification_challenges SET consumed_at=clock_timestamp(),code_hash=repeat('0',64) WHERE identity_key=identity_value;
 DELETE FROM public.email_verification_assurances WHERE identity_key=identity_value;
END $$;
REVOKE ALL ON FUNCTION public.issue_email_verification(text,uuid,text,text),public.consume_email_verification(text,uuid,text),public.get_email_verification(text),public.invalidate_email_verification(text,uuid),public.revoke_email_verification(text) FROM PUBLIC;
`;
export function createEmailVerificationStore(pool:Pool){
 return {
  async issue(identityKey:string,challengeId:string,email:string,hash:string):Promise<boolean>{const result=await pool.query('SELECT public.issue_email_verification($1,$2,$3,$4) AS accepted',[identityKey,challengeId,email,hash]);return result.rows[0]?.accepted===true;},
  async consume(identityKey:string,challengeId:string,hash:string){const result=await pool.query('SELECT * FROM public.consume_email_verification($1,$2,$3)',[identityKey,challengeId,hash]);const row=result.rows[0];return row?{verifiedEmail:String(row.email),verificationExpiresAt:new Date(row.verified_until).toISOString()}:null;},
  async get(identityKey:string){const result=await pool.query('SELECT * FROM public.get_email_verification($1)',[identityKey]);const row=result.rows[0];return row?{verifiedEmail:String(row.email),verificationExpiresAt:new Date(row.verified_until).toISOString()}:null;},
  async invalidate(identityKey:string,challengeId:string){await pool.query('SELECT public.invalidate_email_verification($1,$2)',[identityKey,challengeId]);}
  ,async revoke(identityKey:string){await pool.query('SELECT public.revoke_email_verification($1)',[identityKey]);}
 };
}
