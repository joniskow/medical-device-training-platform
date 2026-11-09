import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';

/** Private routing tables intentionally have no runtime table grants. Only minimized definer projections cross tenants. */
export const DISCOVERY_INQUIRIES_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.discovery_profiles(
 profile_id text PRIMARY KEY,user_id text NOT NULL,organization_id text NOT NULL,credential_id text NOT NULL REFERENCES public.credentials(credential_id),
 alias text NOT NULL,coarse_area text NOT NULL,enabled boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,credential_id));
CREATE TABLE IF NOT EXISTS public.discovery_inquiries(
 inquiry_id text PRIMARY KEY,organization_id text NOT NULL,requester_id text NOT NULL,profile_id text NOT NULL REFERENCES public.discovery_profiles(profile_id),
 message text NOT NULL,request_key text NOT NULL,signature text NOT NULL,status text NOT NULL CHECK(status IN ('PENDING','ACCEPTED','DECLINED','BLOCKED','REPORTED','EXPIRED','WITHDRAWN')),
 consent_contact text,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,requester_id,request_key));
CREATE INDEX IF NOT EXISTS discovery_inquiry_recipient_idx ON public.discovery_inquiries(profile_id,inquiry_id);
CREATE TABLE IF NOT EXISTS public.discovery_limits(bucket text PRIMARY KEY,window_start timestamptz NOT NULL,quantity integer NOT NULL);
CREATE OR REPLACE FUNCTION public.discovery_require_employer(actor text,org text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM set_config('app.organization_id',org,true);
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN public.organizations o ON o.organization_id=m.organization_id WHERE m.organization_id=org AND m.subject=actor AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role IN ('employer','organization_admin') AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=org)) THEN RAISE EXCEPTION 'DISCOVERY_EMPLOYER_REQUIRED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.discovery_require_employer(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.discovery_take_limit(bucket_id text,maximum integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.discovery_limits(bucket,window_start,quantity) VALUES(bucket_id,date_trunc('hour',now()),1)
 ON CONFLICT(bucket) DO UPDATE SET window_start=date_trunc('hour',now()),quantity=CASE WHEN public.discovery_limits.window_start<date_trunc('hour',now()) THEN 1 ELSE public.discovery_limits.quantity+1 END RETURNING quantity INTO n;
 IF n>maximum THEN RAISE EXCEPTION 'DISCOVERY_RATE_LIMITED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.discovery_take_limit(text,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.discovery_profile_eligible(profile text,lock_evidence boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.discovery_profiles%ROWTYPE; c public.credentials%ROWTYPE; permitted boolean;
BEGIN
 SELECT * INTO p FROM public.discovery_profiles WHERE profile_id=profile;
 IF NOT FOUND OR NOT p.enabled THEN RETURN false; END IF;
 PERFORM set_config('app.organization_id',p.organization_id,true);PERFORM set_config('app.user_id',p.user_id,true);
 IF NOT EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=p.user_id AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE organization_id=p.organization_id AND status='ACTIVE') THEN RETURN false; END IF;
 IF lock_evidence THEN SELECT * INTO c FROM public.credentials WHERE organization_id=p.organization_id AND credential_id=p.credential_id FOR SHARE;
 ELSE SELECT * INTO c FROM public.credentials WHERE organization_id=p.organization_id AND credential_id=p.credential_id; END IF;
 RETURN FOUND AND c.learner_id=p.user_id AND c.status='ACTIVE' AND (c.expires_at IS NULL OR c.expires_at>now()) AND c.release_id IS NOT NULL AND public.lifecycle_release_available(c.release_id);
END $$;
REVOKE ALL ON FUNCTION public.discovery_profile_eligible(text,boolean) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.manage_discovery_profile(actor text,org text,credential text,display_alias text,area text,opt_in boolean,expected_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.discovery_profiles%ROWTYPE; profile_key text;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR org IS NULL OR credential IS NULL OR display_alias IS NULL OR length(display_alias) NOT BETWEEN 1 AND 80 OR area IS NULL OR length(area) NOT BETWEEN 1 AND 80 OR opt_in IS NULL OR expected_revision IS NULL OR expected_revision<0 THEN RAISE EXCEPTION 'DISCOVERY_INVALID'; END IF;
 PERFORM set_config('app.organization_id',org,true);PERFORM set_config('app.user_id',actor,true);
 IF NOT EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=actor AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.credentials WHERE organization_id=org AND credential_id=credential AND learner_id=actor) THEN RAISE EXCEPTION 'DISCOVERY_ACCESS_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('discovery:'||actor||':'||credential,0));
 SELECT * INTO p FROM public.discovery_profiles WHERE user_id=actor AND credential_id=credential FOR UPDATE;
 IF (FOUND AND p.revision<>expected_revision) OR (NOT FOUND AND expected_revision<>0) THEN RAISE EXCEPTION 'DISCOVERY_REVISION_CONFLICT'; END IF;
 profile_key:=COALESCE(p.profile_id,'profile:'||substr(encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),1,48));
 INSERT INTO public.discovery_profiles(profile_id,user_id,organization_id,credential_id,alias,coarse_area,enabled) VALUES(profile_key,actor,org,credential,display_alias,area,opt_in)
 ON CONFLICT(user_id,credential_id) DO UPDATE SET alias=EXCLUDED.alias,coarse_area=EXCLUDED.coarse_area,enabled=EXCLUDED.enabled,revision=public.discovery_profiles.revision+1,updated_at=now();
 IF opt_in AND NOT public.discovery_profile_eligible(profile_key,true) THEN RAISE EXCEPTION 'DISCOVERY_CREDENTIAL_UNAVAILABLE'; END IF;
 IF NOT opt_in THEN UPDATE public.discovery_inquiries SET status='WITHDRAWN',consent_contact=NULL,updated_at=now() WHERE profile_id=profile_key AND status IN ('PENDING','ACCEPTED'); END IF;
 INSERT INTO public.personal_account_events(event_id,user_id,event_type,details,created_at) VALUES('discovery:'||profile_key||':'||(expected_revision+1),actor,'DISCOVERY_CONSENT_CHANGED',jsonb_build_object('profileId',profile_key,'enabled',opt_in,'revision',expected_revision+1),now());
 RETURN jsonb_build_object('profileId',profile_key,'alias',display_alias,'coarseArea',area,'enabled',opt_in,'revision',expected_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.manage_discovery_profile(text,text,text,text,text,boolean,integer) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.search_discovery(actor text,org text,area text,after_id text,filters jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p record;items jsonb:='[]'::jsonb;scanned integer:=0;next_id text;last_scanned text;eligible_count integer:=0;seen_users text[]:='{}';
BEGIN
 IF actor IS NULL OR org IS NULL OR area IS NULL OR length(area) NOT BETWEEN 1 AND 80 OR (after_id IS NOT NULL AND after_id !~ '^profile:[a-f0-9]{48}$') THEN RAISE EXCEPTION 'DISCOVERY_INVALID'; END IF;
 IF filters IS NULL OR jsonb_typeof(filters)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(filters) kv WHERE kv.key NOT IN ('courseId','certificationPolicyId','productId','competencyId') OR jsonb_typeof(kv.value)<>'string' OR length(kv.value#>>'{}') NOT BETWEEN 1 AND 128) THEN RAISE EXCEPTION 'DISCOVERY_INVALID';END IF;
 PERFORM public.discovery_require_employer(actor,org);PERFORM public.discovery_take_limit('search:'||org||':'||actor,60);
 -- Exact coarse-area search, at most 100 eligibility checks per request; no contact fields, tenant IDs or raw credentials.
 FOR p IN SELECT profile_id,user_id,organization_id,credential_id,alias,coarse_area FROM public.discovery_profiles WHERE enabled AND coarse_area=area AND (after_id IS NULL OR profile_id>after_id) ORDER BY profile_id LIMIT 101 LOOP
  scanned:=scanned+1;IF scanned>100 THEN next_id:=last_scanned;EXIT;END IF;last_scanned:=p.profile_id;
  IF public.discovery_profile_eligible(p.profile_id,false) AND NOT EXISTS(SELECT 1 FROM public.discovery_inquiries i JOIN public.discovery_profiles blocked ON blocked.profile_id=i.profile_id WHERE blocked.user_id=p.user_id AND i.organization_id=org AND i.status IN ('BLOCKED','REPORTED')) THEN
   IF NOT EXISTS(SELECT 1 FROM public.credentials c JOIN public.course_versions v ON v.organization_id=c.organization_id AND v.course_version_id=c.course_version_id JOIN public.courses course ON course.organization_id=v.organization_id AND course.course_id=v.course_id
    WHERE c.organization_id=p.organization_id AND c.credential_id=p.credential_id AND (NOT filters ? 'courseId' OR v.course_id=filters->>'courseId') AND (NOT filters ? 'certificationPolicyId' OR c.policy_id=filters->>'certificationPolicyId') AND (NOT filters ? 'productId' OR course.product_id=filters->>'productId')
    AND (NOT filters ? 'competencyId' OR EXISTS(SELECT 1 FROM public.assessment_sessions s WHERE s.organization_id=c.organization_id AND s.learner_id=c.learner_id AND s.status='PASSED' AND c.evidence->'evaluation'->'evidenceIds' ? s.session_id AND s.result->'demonstratedCompetencyIds' ? (filters->>'competencyId')))) THEN CONTINUE;END IF;
   IF p.user_id=ANY(seen_users) THEN CONTINUE;END IF;seen_users:=array_append(seen_users,p.user_id);
   eligible_count:=eligible_count+1;IF eligible_count<=20 THEN items:=items||jsonb_build_array(jsonb_build_object('profileId',p.profile_id,'alias',p.alias,'coarseArea',p.coarse_area));next_id:=p.profile_id;END IF;
   IF eligible_count=21 THEN EXIT;END IF;
  END IF;
 END LOOP;
 -- Cohorts below three are suppressed to reduce identification through narrow filters.
 IF eligible_count<3 THEN RETURN jsonb_build_object('items','[]'::jsonb,'nextCursor',NULL,'suppressed',true); END IF;
 PERFORM set_config('app.organization_id',org,true);
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,details,created_at) VALUES('discovery-search:'||gen_random_uuid()::text,org,actor,'DISCOVERY_SEARCH',jsonb_build_object('resultCount',least(eligible_count,20)),now());
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN eligible_count>20 OR scanned>100 THEN next_id ELSE NULL END,'suppressed',false);
END $$;
REVOKE ALL ON FUNCTION public.search_discovery(text,text,text,text,jsonb) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.search_discovery(actor text,org text,area text,after_id text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.search_discovery(actor,org,area,after_id,'{}'::jsonb) $$;
REVOKE ALL ON FUNCTION public.search_discovery(text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.create_discovery_inquiry(actor text,org text,profile text,body text,request_key_value text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.discovery_profiles%ROWTYPE;i public.discovery_inquiries%ROWTYPE;sig text;new_id text;
BEGIN
 IF profile IS NULL OR profile !~ '^profile:[a-f0-9]{48}$' OR body IS NULL OR length(btrim(body)) NOT BETWEEN 1 AND 1000 OR request_key_value IS NULL OR request_key_value !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'INQUIRY_INVALID'; END IF;
 PERFORM public.discovery_require_employer(actor,org);
 PERFORM pg_advisory_xact_lock(hashtextextended('inquiry:'||org||':'||actor,0));
 sig:=encode(sha256(convert_to(jsonb_build_array(profile,btrim(body))::text,'UTF8')),'hex');
 SELECT * INTO i FROM public.discovery_inquiries WHERE organization_id=org AND requester_id=actor AND request_key=request_key_value;
 IF FOUND THEN IF i.signature<>sig THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;RETURN jsonb_build_object('inquiryId',i.inquiry_id,'status',i.status,'expiresAt',i.expires_at);END IF;
 SELECT * INTO p FROM public.discovery_profiles WHERE profile_id=profile FOR UPDATE;
 IF NOT FOUND OR p.user_id=actor OR NOT public.discovery_profile_eligible(profile,true) THEN RAISE EXCEPTION 'INQUIRY_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('inquiry-recipient:'||org||':'||p.user_id,0));
 IF EXISTS(SELECT 1 FROM public.discovery_inquiries q JOIN public.discovery_profiles target ON target.profile_id=q.profile_id WHERE target.user_id=p.user_id AND q.organization_id=org AND (q.status IN ('BLOCKED','REPORTED') OR q.created_at>now()-interval '7 days')) THEN RAISE EXCEPTION 'INQUIRY_UNAVAILABLE'; END IF;
 PERFORM public.discovery_take_limit('inquiry:'||org||':'||actor,10);PERFORM public.discovery_take_limit('recipient:'||p.user_id,20);
 new_id:='inquiry:'||gen_random_uuid()::text;
 INSERT INTO public.discovery_inquiries(inquiry_id,organization_id,requester_id,profile_id,message,request_key,signature,status,expires_at) VALUES(new_id,org,actor,profile,btrim(body),request_key_value,sig,'PENDING',now()+interval '14 days') RETURNING * INTO i;
 PERFORM set_config('app.organization_id',p.organization_id,true);
 INSERT INTO public.notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at) VALUES(new_id,p.organization_id,p.user_id,'INQUIRY_LIFECYCLE',jsonb_build_object('inquiryId',new_id,'title','New training inquiry','message','An organization has sent an inquiry. Review it before sharing any contact details.'),new_id,now());
 RETURN jsonb_build_object('inquiryId',i.inquiry_id,'status',i.status,'expiresAt',i.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.create_discovery_inquiry(text,text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.respond_discovery_inquiry(actor text,inquiry text,decision text,contact text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.discovery_inquiries%ROWTYPE;p public.discovery_profiles%ROWTYPE;
BEGIN
 IF decision IS NULL OR decision NOT IN ('ACCEPTED','DECLINED','BLOCKED','REPORTED') OR (decision='ACCEPTED' AND (contact IS NULL OR length(contact) NOT BETWEEN 3 AND 254 OR contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) THEN RAISE EXCEPTION 'INQUIRY_INVALID';END IF;
 SELECT d.* INTO p FROM public.discovery_profiles d JOIN public.discovery_inquiries q ON q.profile_id=d.profile_id WHERE q.inquiry_id=inquiry AND d.user_id=actor FOR UPDATE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'INQUIRY_UNAVAILABLE'; END IF;
 SELECT * INTO i FROM public.discovery_inquiries WHERE inquiry_id=inquiry FOR UPDATE;
 IF i.status=decision THEN RETURN jsonb_build_object('inquiryId',inquiry,'status',i.status);END IF;
 IF i.status<>'PENDING' AND decision NOT IN ('BLOCKED','REPORTED') THEN RAISE EXCEPTION 'INQUIRY_UNAVAILABLE';END IF;
 IF decision='ACCEPTED' THEN
  IF i.expires_at<=now() OR NOT public.discovery_profile_eligible(p.profile_id,true) THEN RAISE EXCEPTION 'INQUIRY_UNAVAILABLE';END IF;
  PERFORM public.discovery_require_employer(i.requester_id,i.organization_id);
 END IF;
 UPDATE public.discovery_inquiries SET status=decision,consent_contact=CASE WHEN decision='ACCEPTED' THEN contact ELSE NULL END,updated_at=now() WHERE inquiry_id=inquiry;
 IF decision IN ('BLOCKED','REPORTED') THEN UPDATE public.discovery_inquiries q SET status=decision,consent_contact=NULL,updated_at=now() WHERE q.profile_id IN (SELECT profile_id FROM public.discovery_profiles WHERE user_id=p.user_id) AND q.organization_id=i.organization_id AND q.status IN ('PENDING','ACCEPTED');END IF;
 PERFORM set_config('app.organization_id',i.organization_id,true);
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES('inquiry-response:'||gen_random_uuid()::text,i.organization_id,actor,'INQUIRY_CONSENT_CHANGED','inquiry',inquiry,jsonb_build_object('decision',decision),now());
 IF decision IN ('ACCEPTED','DECLINED') THEN
  INSERT INTO public.notifications(notification_id,organization_id,recipient_id,notification_type,payload,idempotency_key,created_at) VALUES('inquiry-response:'||inquiry,i.organization_id,i.requester_id,'INQUIRY_LIFECYCLE',jsonb_build_object('inquiryId',inquiry,'title','Inquiry response','message','A learner responded to your inquiry. Open your inquiries to review current consent.'),'inquiry-response:'||inquiry,now()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('inquiryId',inquiry,'status',decision);
END $$;
REVOKE ALL ON FUNCTION public.respond_discovery_inquiry(text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.list_discovery_inquiries(actor text,org text,after_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i record;items jsonb:='[]'::jsonb;exposed_contact text;n integer:=0;last_id text;current_status text;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR (after_id IS NOT NULL AND after_id !~ '^inquiry:[a-f0-9-]{36}$') THEN RAISE EXCEPTION 'INQUIRY_INVALID';END IF;
 IF org IS NOT NULL THEN PERFORM public.discovery_require_employer(actor,org);END IF;
 FOR i IN SELECT q.*,p.user_id,p.alias FROM public.discovery_inquiries q JOIN public.discovery_profiles p ON p.profile_id=q.profile_id WHERE ((org IS NULL AND p.user_id=actor) OR (q.organization_id=org AND q.requester_id=actor)) AND (after_id IS NULL OR q.inquiry_id>after_id) ORDER BY q.inquiry_id LIMIT 21 LOOP
  IF n=20 THEN EXIT;END IF;n:=n+1;last_id:=i.inquiry_id;exposed_contact:=NULL;current_status:=i.status;
  IF i.status IN ('PENDING','ACCEPTED') AND (i.expires_at<=now() OR NOT public.discovery_profile_eligible(i.profile_id,false)) THEN current_status:=CASE WHEN i.expires_at<=now() THEN 'EXPIRED' ELSE 'WITHDRAWN' END;
  ELSIF i.status='ACCEPTED' AND org IS NOT NULL THEN exposed_contact:=i.consent_contact;END IF;
  items:=items||jsonb_build_array(jsonb_build_object('inquiryId',i.inquiry_id,'profileId',i.profile_id,'alias',i.alias,'message',i.message,'status',current_status,'expiresAt',i.expires_at,'contact',exposed_contact));
 END LOOP;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN n=20 THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.list_discovery_inquiries(text,text,text) FROM PUBLIC;
`;

export function createDiscoveryInquiryStore(pool:Pool){
 async function call(fn:string,args:unknown[]){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5000ms'");const result=await client.query(`SELECT public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args);await client.query('COMMIT');return result.rows[0].result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 return {
  profile:(actor:string,input:{organizationId:string;credentialId:string;alias:string;coarseArea:string;enabled:boolean;revision:number})=>call('manage_discovery_profile',[actor,input.organizationId,input.credentialId,input.alias,input.coarseArea,input.enabled,input.revision]),
  search:(tenant:TenantContext,input:{coarseArea:string;after?:string;courseId?:string;certificationPolicyId?:string;productId?:string;competencyId?:string})=>call('search_discovery',[tenant.actorId,tenant.organizationId,input.coarseArea,input.after??null,JSON.stringify({...(input.courseId?{courseId:input.courseId}:{}),...(input.certificationPolicyId?{certificationPolicyId:input.certificationPolicyId}:{}),...(input.productId?{productId:input.productId}:{}),...(input.competencyId?{competencyId:input.competencyId}:{})})]),
  createInquiry:(tenant:TenantContext,input:{profileId:string;message:string;idempotencyKey:string})=>call('create_discovery_inquiry',[tenant.actorId,tenant.organizationId,input.profileId,input.message,input.idempotencyKey]),
  respond:(actor:string,id:string,input:{decision:'ACCEPTED'|'DECLINED'|'BLOCKED'|'REPORTED';contact?:string})=>call('respond_discovery_inquiry',[actor,id,input.decision,input.contact??null]),
  list:(actor:string,organizationId?:string,after?:string)=>call('list_discovery_inquiries',[actor,organizationId??null,after??null])
 };
}
