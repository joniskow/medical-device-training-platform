import type {Pool} from 'pg';
export const ACCOUNT_SECURITY_MIGRATION_SQL=`
CREATE OR REPLACE FUNCTION public.administer_personal_account(operator_id text,target_id text,next_status text,expected_revision integer,request_key text,reason text,correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row public.personal_accounts%ROWTYPE; event_key text; signature_value text; prior jsonb;
BEGIN
 IF operator_id IS NULL OR target_id IS NULL OR length(target_id) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'ACCOUNT_SECURITY_INVALID'; END IF;
 IF next_status IS NOT NULL AND (next_status NOT IN ('ACTIVE','LOCKED') OR operator_id=target_id OR expected_revision IS NULL OR expected_revision<1 OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'ACCOUNT_SECURITY_INVALID'; END IF;
 -- Serialize status administration so two operators cannot mutually authorize after one is locked.
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account-administration',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('personal-account:'||target_id,0));
 PERFORM set_config('app.user_id',operator_id,true);
 PERFORM 1 FROM public.personal_accounts WHERE user_id=operator_id AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_SECURITY_OPERATOR_UNAVAILABLE'; END IF;
 PERFORM set_config('app.user_id',target_id,true);
 SELECT * INTO current_row FROM public.personal_accounts WHERE user_id=target_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_SECURITY_NOT_FOUND'; END IF;
 IF next_status IS NOT NULL THEN
  event_key:='account-security:'||encode(sha256(convert_to(jsonb_build_array(operator_id,target_id,request_key)::text,'UTF8')),'hex');
  signature_value:=encode(sha256(convert_to(jsonb_build_array(next_status,expected_revision,btrim(reason))::text,'UTF8')),'hex');
  SELECT details INTO prior FROM public.personal_account_events WHERE user_id=target_id AND event_id=event_key;
  IF FOUND THEN
   IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  ELSE
   IF current_row.revision<>expected_revision OR current_row.status=next_status THEN RAISE EXCEPTION 'ACCOUNT_SECURITY_CHANGED'; END IF;
   UPDATE public.personal_accounts SET status=next_status,revision=revision+1,updated_at=now() WHERE user_id=target_id;
   INSERT INTO public.personal_account_events(event_id,user_id,event_type,details,created_at) VALUES(event_key,target_id,'ACCOUNT_STATUS_CHANGED',jsonb_build_object('signature',signature_value,'actorId',operator_id,'previousStatus',current_row.status,'status',next_status,'previousRevision',expected_revision,'reason',btrim(reason),'correlationId',correlation),now());
  END IF;
 END IF;
 SELECT * INTO current_row FROM public.personal_accounts WHERE user_id=target_id;
 RETURN jsonb_build_object('userId',current_row.user_id,'status',current_row.status,'revision',current_row.revision);
END $$;
REVOKE ALL ON FUNCTION public.administer_personal_account(text,text,text,integer,text,text,text) FROM PUBLIC;
`;
/** The caller authenticates a current platform operator; SQL also rechecks the operator's active account. */
export function createAccountSecurityStore(pool:Pool,authorizeOperator:()=>Promise<string>){
 async function run(targetId:string,input?:{status:string;revision:number;idempotencyKey:string;reason:string;confirmed:boolean}){
  const operatorId=await authorizeOperator();
  if(!targetId||targetId.length>256||input&&(input.confirmed!==true||!['ACTIVE','LOCKED'].includes(input.status)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)))throw Error('ACCOUNT_SECURITY_INVALID');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query('SELECT public.administer_personal_account($1,$2,$3,$4,$5,$6,$7) AS account',[operatorId,targetId,input?.status??null,input?.revision??null,input?.idempotencyKey??null,input?.reason.trim()??null,input?.idempotencyKey??'account-inspection']);
   await client.query('COMMIT');return result.rows[0].account;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 return {inspect:(targetId:string)=>run(targetId),setStatus:(targetId:string,input:NonNullable<Parameters<typeof run>[1]>)=>run(targetId,input)};
}
