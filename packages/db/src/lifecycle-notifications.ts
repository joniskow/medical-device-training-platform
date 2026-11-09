import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';

export const LIFECYCLE_NOTIFICATION_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.lifecycle_notification_preferences(
 user_id text PRIMARY KEY,email text NOT NULL,email_verified_until timestamptz NOT NULL,enabled boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.set_lifecycle_notification_preference(actor text,verified_email text,verified_until timestamptz,opt_in boolean,expected_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.lifecycle_notification_preferences%ROWTYPE;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR opt_in IS NULL OR expected_revision IS NULL OR expected_revision<0 THEN RAISE EXCEPTION 'NOTIFICATION_PREFERENCE_INVALID';END IF;
 PERFORM set_config('app.user_id',actor,true);IF NOT EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'NOTIFICATION_ACCOUNT_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('notification-preference:'||actor,0));SELECT * INTO p FROM public.lifecycle_notification_preferences WHERE user_id=actor FOR UPDATE;
 IF (FOUND AND p.revision<>expected_revision) OR (NOT FOUND AND expected_revision<>0) THEN RAISE EXCEPTION 'NOTIFICATION_REVISION_CONFLICT';END IF;
 IF opt_in AND (verified_email IS NULL OR length(verified_email)>254 OR verified_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR verified_until IS NULL OR NOT isfinite(verified_until) OR verified_until<=now()) THEN RAISE EXCEPTION 'NOTIFICATION_VERIFIED_EMAIL_REQUIRED';END IF;
 INSERT INTO public.lifecycle_notification_preferences(user_id,email,email_verified_until,enabled) VALUES(actor,COALESCE(verified_email,''),COALESCE(verified_until,now()),opt_in)
 ON CONFLICT(user_id) DO UPDATE SET email=CASE WHEN opt_in THEN EXCLUDED.email ELSE '' END,email_verified_until=EXCLUDED.email_verified_until,enabled=EXCLUDED.enabled,revision=public.lifecycle_notification_preferences.revision+1,updated_at=now();
 INSERT INTO public.personal_account_events(event_id,user_id,event_type,details,created_at) VALUES('notice-preference:'||gen_random_uuid()::text,actor,'NOTIFICATION_CHANNEL_CONSENT_CHANGED',jsonb_build_object('enabled',opt_in,'revision',expected_revision+1),now());
 RETURN jsonb_build_object('enabled',opt_in,'revision',expected_revision+1,'channel','email','inAppEnabled',true);
END $$;
REVOKE ALL ON FUNCTION public.set_lifecycle_notification_preference(text,text,timestamptz,boolean,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.queue_lifecycle_notification_email() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE event_id text;
BEGIN
 IF NEW.notification_type NOT IN ('CREDENTIAL_LIFECYCLE','COURSE_CHANGE','COURSE_RETRAINING_ASSIGNMENT','INQUIRY_LIFECYCLE','PROCESSING_LIFECYCLE') THEN RETURN NEW;END IF;
 event_id:='notice-mail:'||encode(sha256(convert_to(NEW.organization_id||':'||NEW.notification_id,'UTF8')),'hex');
 INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES(event_id,NEW.organization_id,'lifecycle.notification.deliver',event_id,jsonb_build_object('notificationId',NEW.notification_id),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lifecycle_notification_email ON public.notifications;
CREATE TRIGGER lifecycle_notification_email AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.queue_lifecycle_notification_email();
CREATE OR REPLACE FUNCTION public.notify_processing_terminal_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE notice text;recipient text;
BEGIN
 IF NEW.state IS NOT DISTINCT FROM OLD.state OR NEW.state NOT IN ('SUCCEEDED','FAILED','DEAD_LETTERED') THEN RETURN NEW;END IF;
 recipient:=NEW.tenant->>'actorId';IF recipient IS NULL OR recipient='' THEN RETURN NEW;END IF;
 notice:='processing-notice:'||encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,NEW.job_id,NEW.attempt,NEW.state)::text,'UTF8')),'hex');
 INSERT INTO public.notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at)
 VALUES(notice,NEW.organization_id,recipient,'PROCESSING_LIFECYCLE',jsonb_build_object('jobId',NEW.job_id,'state',NEW.state,'title','Processing update','message','A processing job changed status. Open your jobs to review its current state.'),notice,now()) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS processing_terminal_notification ON public.processing_jobs;
CREATE TRIGGER processing_terminal_notification AFTER UPDATE OF state ON public.processing_jobs FOR EACH ROW EXECUTE FUNCTION public.notify_processing_terminal_state();
ALTER TABLE public.discovery_inquiries ADD COLUMN IF NOT EXISTS last_eligibility_check timestamptz NOT NULL DEFAULT 'epoch';
CREATE OR REPLACE FUNCTION public.advance_inquiry_lifecycle() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i record;next_state text;n integer:=0;notice text;previous_org text;previous_user text;
BEGIN
 previous_org:=current_setting('app.organization_id',true);previous_user:=current_setting('app.user_id',true);
 FOR i IN SELECT q.*,p.user_id,p.organization_id AS issuer_org FROM public.discovery_inquiries q JOIN public.discovery_profiles p ON p.profile_id=q.profile_id WHERE q.status IN ('PENDING','ACCEPTED') ORDER BY q.last_eligibility_check,q.inquiry_id LIMIT 100 FOR UPDATE OF q SKIP LOCKED LOOP
  next_state:=CASE WHEN i.expires_at<=now() THEN 'EXPIRED' WHEN NOT public.discovery_profile_eligible(i.profile_id,false) THEN 'WITHDRAWN' ELSE NULL END;
  UPDATE public.discovery_inquiries SET last_eligibility_check=now() WHERE inquiry_id=i.inquiry_id;
  IF next_state IS NULL THEN CONTINUE;END IF;
  UPDATE public.discovery_inquiries SET status=next_state,consent_contact=NULL,updated_at=now() WHERE inquiry_id=i.inquiry_id;
  PERFORM set_config('app.organization_id',i.issuer_org,true);
  notice:='inquiry-closed:'||i.inquiry_id;
  INSERT INTO public.notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at) VALUES(notice,i.issuer_org,i.user_id,'INQUIRY_LIFECYCLE',jsonb_build_object('inquiryId',i.inquiry_id,'title','Inquiry closed','message','A training inquiry is no longer available.'),notice,now()) ON CONFLICT DO NOTHING;
  PERFORM set_config('app.organization_id',i.organization_id,true);
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES('inquiry-close:'||i.inquiry_id,i.organization_id,'notification-worker','INQUIRY_CLOSED','inquiry',i.inquiry_id,jsonb_build_object('status',next_state),now()) ON CONFLICT DO NOTHING;
  n:=n+1;
 END LOOP;PERFORM set_config('app.organization_id',COALESCE(previous_org,''),true);PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.advance_inquiry_lifecycle() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.claim_lifecycle_notification_email(event_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;n public.notifications%ROWTYPE;e public.outbox_events%ROWTYPE;p public.lifecycle_notification_preferences%ROWTYPE;token text;digest text;delivery_state text;
BEGIN
 org:=NULLIF(current_setting('app.organization_id',true),'');IF org IS NULL THEN RAISE EXCEPTION 'NOTIFICATION_TENANT_REQUIRED';END IF;
 SELECT * INTO e FROM public.outbox_events WHERE organization_id=org AND outbox_event_id=event_id AND event_type='lifecycle.notification.deliver' AND state IN ('PENDING','CLAIMED') AND available_at<=now() FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO n FROM public.notifications WHERE organization_id=org AND notification_id=e.payload->>'notificationId';
 SELECT * INTO p FROM public.lifecycle_notification_preferences WHERE user_id=n.recipient_id;
 PERFORM set_config('app.user_id',n.recipient_id,true);
 delivery_state:=CASE WHEN e.attempt_count>=5 THEN 'FAILED' WHEN n.notification_id IS NULL OR p.user_id IS NULL OR NOT p.enabled OR p.email_verified_until<=now() OR NOT EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=n.recipient_id AND status='ACTIVE') THEN 'SKIPPED' ELSE 'SENDING' END;
 digest:=encode(sha256(convert_to(lower(btrim(p.email)),'UTF8')),'hex');
 IF EXISTS(SELECT 1 FROM public.email_recipient_suppressions WHERE organization_id=org AND recipient_hash=digest AND released_at IS NULL) THEN delivery_state:='SUPPRESSED';END IF;
 INSERT INTO public.email_deliveries(email_delivery_id,organization_id,recipient_id,template_key,payload,status,created_at,updated_at) VALUES('email:'||event_id,org,COALESCE(n.recipient_id,'unavailable'),'lifecycle-notice.v1',jsonb_build_object('eventId',event_id),delivery_state,now(),now()) ON CONFLICT(email_delivery_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now();
 IF delivery_state<>'SENDING' THEN
  UPDATE public.outbox_events SET state=CASE WHEN delivery_state='FAILED' THEN 'FAILED' ELSE 'PUBLISHED' END,delivery_lease_token=NULL,updated_at=now() WHERE organization_id=org AND outbox_event_id=event_id;
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES('notice-skip:'||gen_random_uuid()::text,org,'notification-worker','NOTIFICATION_EMAIL_SUPPRESSED','notification',n.notification_id,jsonb_build_object('state',delivery_state),now());RETURN NULL;
 END IF;
 token:=gen_random_uuid()::text;
 UPDATE public.outbox_events SET state='CLAIMED',attempt_count=attempt_count+1,delivery_lease_token=token,available_at=now()+interval '60 seconds',updated_at=now() WHERE organization_id=org AND outbox_event_id=event_id;
 INSERT INTO public.email_delivery_attempts(operation_id,organization_id,outbox_event_id,recipient_hash,created_at) VALUES(token,org,event_id,digest,now());
 RETURN jsonb_build_object('eventId',event_id,'operationId',token,'recipient',p.email,'notificationId',n.notification_id);
END $$;
REVOKE ALL ON FUNCTION public.claim_lifecycle_notification_email(text) FROM PUBLIC;
`;
export function createLifecycleNotificationStore(pool:Pool){return {
 /** Email and expiry must come from authenticated signed verification, never request JSON. */
 async preference(actor:string,input:{enabled:boolean;revision:number},assurance?:{email:string;expiresAt:string}){
  if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>2147483647)throw Error('NOTIFICATION_PREFERENCE_INVALID');
  return (await pool.query('SELECT public.set_lifecycle_notification_preference($1,$2,$3,$4,$5) AS result',[actor,assurance?.email??null,assurance?.expiresAt??null,input.enabled,input.revision])).rows[0].result;
 },
 async claim(tenant:TenantContext,eventId:string){return withTenantTransaction(pool,tenant,async client=>(await client.query('SELECT public.claim_lifecycle_notification_email($1) AS result',[eventId])).rows[0].result);},
 async finish(tenant:TenantContext,eventId:string,token:string,accepted:boolean){return withTenantTransaction(pool,tenant,async client=>{
  const row=(await client.query(`UPDATE outbox_events SET state=CASE WHEN $4 THEN 'PUBLISHED' WHEN attempt_count>=5 THEN 'FAILED' ELSE 'PENDING' END,delivery_lease_token=NULL,last_error_code=CASE WHEN $4 THEN NULL ELSE 'NOTIFICATION_SEND_FAILED' END,available_at=now()+interval '1 minute',updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2 AND state='CLAIMED' AND delivery_lease_token=$3 RETURNING state`,[tenant.organizationId,eventId,token,accepted])).rows[0];
  if(!row)return {state:'STALE'};
  await client.query("UPDATE email_deliveries SET status=$3,updated_at=now() WHERE organization_id=$1 AND email_delivery_id=$2",[tenant.organizationId,'email:'+eventId,accepted?'ACCEPTED':row.state==='FAILED'?'FAILED':'RETRY_PENDING']);
  await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_id,details,created_at) VALUES($1,$2,$3,$4,$5,$6,now())",['notice-send:'+token,tenant.organizationId,tenant.actorId,accepted?'NOTIFICATION_EMAIL_ACCEPTED':'NOTIFICATION_EMAIL_FAILED',eventId,JSON.stringify({state:row.state})]);return {state:row.state};
 });}
};}
