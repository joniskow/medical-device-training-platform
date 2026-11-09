import {createHash,createHmac,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';

export const WEBHOOK_EVENT_TYPES=['credential.issued','credential.revoked','credential.superseded','credential.expired','asset.delivery.suppressed','processing.completed','processing.failed','course.published','enrollment.completed','enrollment.created','membership.created','membership.removed','learner.created','learner.updated','assessment.attempt.completed'] as const;
export function deriveCustomerWebhookSecret(master:Buffer,organizationId:string,subscriptionId:string){
 if(master.length<32)throw Error('WEBHOOK_KEY_INVALID');
 return createHmac('sha256',master).update(JSON.stringify(['customer-webhook.v1',organizationId,subscriptionId])).digest('hex');
}
export const CUSTOMER_WEBHOOK_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.customer_webhook_subscriptions(
 subscription_id text PRIMARY KEY,organization_id text NOT NULL,endpoint text NOT NULL,key_id text NOT NULL,previous_key_id text,previous_key_expires_at timestamptz,
 event_types text[] NOT NULL,enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.customer_webhook_deliveries(
 delivery_id text PRIMARY KEY,organization_id text NOT NULL,subscription_id text NOT NULL REFERENCES public.customer_webhook_subscriptions(subscription_id),event_id text NOT NULL,
 event_type text NOT NULL,payload jsonb NOT NULL,state text NOT NULL CHECK(state IN ('PENDING','CLAIMED','SUCCEEDED','FAILED','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_token text,lease_expires_at timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(subscription_id,event_id));
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['customer_webhook_subscriptions','customer_webhook_deliveries'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_isolation') THEN EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (organization_id=NULLIF(current_setting(''app.organization_id'',true),'''')) WITH CHECK(organization_id=NULLIF(current_setting(''app.organization_id'',true),''''))',t);END IF;
 END LOOP;END $$;
CREATE OR REPLACE FUNCTION public.fanout_customer_webhooks() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE subscription record;delivery text;safe_payload jsonb;event_kind text;
BEGIN
 event_kind:=CASE WHEN NEW.event_type='course.release.published' THEN 'course.published' ELSE NEW.event_type END;
 IF event_kind NOT IN ('credential.issued','credential.revoked','credential.superseded','credential.expired','asset.delivery.suppressed','processing.completed','processing.failed','course.published','enrollment.completed','enrollment.created','membership.created','membership.removed','learner.created','learner.updated','assessment.attempt.completed') THEN RETURN NEW;END IF;
 -- Deliberate field allowlist. Never send learner IDs, answers, evidence, arbitrary metadata or contact details.
 safe_payload:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','customer-event.v1','eventId',NEW.outbox_event_id,'eventType',event_kind,'occurredAt',NEW.created_at,'credentialId',NEW.payload->>'credentialId','assetVersionId',NEW.payload->>'assetVersionId','status',NEW.payload->>'status','jobId',NEW.payload->>'jobId','releaseId',NEW.payload->>'releaseId','courseVersionId',NEW.payload->>'courseVersionId','enrollmentId',NEW.payload->>'enrollmentId','membershipRef',NEW.payload->>'membershipRef','learnerRef',NEW.payload->>'learnerRef','attemptId',NEW.payload->>'attemptId','activityId',NEW.payload->>'activityId'));
 FOR subscription IN SELECT subscription_id FROM public.customer_webhook_subscriptions WHERE organization_id=NEW.organization_id AND enabled AND event_kind=ANY(event_types) LOOP
  delivery:='webhook:'||encode(sha256(convert_to(subscription.subscription_id||':'||NEW.outbox_event_id,'UTF8')),'hex');
  INSERT INTO public.customer_webhook_deliveries(delivery_id,organization_id,subscription_id,event_id,event_type,payload,state) VALUES(delivery,NEW.organization_id,subscription.subscription_id,NEW.outbox_event_id,event_kind,safe_payload,'PENDING') ON CONFLICT DO NOTHING;
  INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES(delivery,NEW.organization_id,'customer.webhook.deliver',delivery,jsonb_build_object('deliveryId',delivery),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 END LOOP;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS customer_webhook_fanout ON public.outbox_events;
CREATE TRIGGER customer_webhook_fanout AFTER INSERT ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION public.fanout_customer_webhooks();
CREATE OR REPLACE FUNCTION public.emit_processing_webhook() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE event_id text;kind text;
BEGIN
 IF NEW.state IS NOT DISTINCT FROM OLD.state OR NEW.state NOT IN ('SUCCEEDED','FAILED','DEAD_LETTERED') THEN RETURN NEW;END IF;
 kind:=CASE WHEN NEW.state='SUCCEEDED' THEN 'processing.completed' ELSE 'processing.failed' END;
 event_id:='processing-event:'||encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,NEW.job_id,NEW.attempt,NEW.state)::text,'UTF8')),'hex');
 INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
 VALUES(event_id,NEW.organization_id,kind,event_id,jsonb_build_object('jobId',NEW.job_id,'status',NEW.state),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS processing_customer_event ON public.processing_jobs;
CREATE TRIGGER processing_customer_event AFTER UPDATE OF state ON public.processing_jobs FOR EACH ROW EXECUTE FUNCTION public.emit_processing_webhook();
CREATE OR REPLACE FUNCTION public.emit_enrollment_webhook() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE event_id text;
BEGIN
 IF NEW.status<>'COMPLETED' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND OLD.status='COMPLETED' THEN RETURN NEW;END IF;
 event_id:='enrollment-completed:'||encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,NEW.enrollment_id)::text,'UTF8')),'hex');
 INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
 VALUES(event_id,NEW.organization_id,'enrollment.completed',event_id,jsonb_build_object('enrollmentId',NEW.enrollment_id,'courseVersionId',NEW.course_version_id,'status',NEW.status),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enrollment_customer_event ON public.enrollments;
CREATE TRIGGER enrollment_customer_event AFTER INSERT OR UPDATE OF status ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.emit_enrollment_webhook();
CREATE OR REPLACE FUNCTION public.emit_learning_entity_webhook() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE event_id text;kind text;body jsonb;subject_id text;
BEGIN
 IF TG_TABLE_NAME='enrollments' THEN
  kind:='enrollment.created';subject_id:=NEW.enrollment_id;body:=jsonb_build_object('enrollmentId',subject_id,'courseVersionId',NEW.course_version_id);
 ELSIF TG_TABLE_NAME='assessment_sessions' THEN
  IF NEW.status NOT IN ('PASSED','FAILED') THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('PASSED','FAILED') THEN RETURN NEW;END IF;
  kind:='assessment.attempt.completed';subject_id:=NEW.session_id;body:=jsonb_build_object('attemptId',subject_id,'enrollmentId',NEW.enrollment_id,'activityId',NEW.activity_id,'releaseId',NEW.release_id,'status',NEW.status);
 ELSE
  IF TG_OP='INSERT' THEN kind:='membership.created';
  ELSIF NEW.status='REMOVED' AND OLD.status<>'REMOVED' THEN kind:='membership.removed';
  ELSE RETURN NEW;END IF;
  subject_id:=NEW.membership_id;body:=jsonb_build_object('membershipRef',encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,subject_id)::text,'UTF8')),'hex'),'status',NEW.status,'learnerRef',encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,NEW.subject)::text,'UTF8')),'hex'));
 END IF;
 event_id:='entity-event:'||encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,kind,subject_id)::text,'UTF8')),'hex');
 INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES(event_id,NEW.organization_id,kind,event_id,body,'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 IF kind='membership.created' THEN
  event_id:='learner-created:'||encode(sha256(convert_to(jsonb_build_array(NEW.organization_id,NEW.subject)::text,'UTF8')),'hex');
  INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES(event_id,NEW.organization_id,'learner.created',event_id,jsonb_build_object('learnerRef',body->>'learnerRef'),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enrollment_created_customer_event ON public.enrollments;
CREATE TRIGGER enrollment_created_customer_event AFTER INSERT ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.emit_learning_entity_webhook();
DROP TRIGGER IF EXISTS assessment_customer_event ON public.assessment_sessions;
CREATE TRIGGER assessment_customer_event AFTER INSERT OR UPDATE OF status ON public.assessment_sessions FOR EACH ROW EXECUTE FUNCTION public.emit_learning_entity_webhook();
DROP TRIGGER IF EXISTS membership_customer_event ON public.organization_memberships;
CREATE TRIGGER membership_customer_event AFTER INSERT OR UPDATE OF status ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.emit_learning_entity_webhook();
CREATE OR REPLACE FUNCTION public.emit_learner_profile_webhook() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE membership record;event_id text;previous_context text;
BEGIN
 IF NEW.event_type<>'ACCOUNT_PROFILE_UPDATED' THEN RETURN NEW;END IF;
 previous_context:=current_setting('app.organization_id',true);
 FOR membership IN SELECT m.organization_id FROM public.organization_memberships m WHERE m.subject=NEW.user_id AND m.status='ACTIVE' LOOP
  PERFORM set_config('app.organization_id',membership.organization_id,true);
  event_id:='learner-updated:'||encode(sha256(convert_to(jsonb_build_array(membership.organization_id,NEW.event_id)::text,'UTF8')),'hex');
  INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
  VALUES(event_id,membership.organization_id,'learner.updated',event_id,jsonb_build_object('learnerRef',encode(sha256(convert_to(jsonb_build_array(membership.organization_id,NEW.user_id)::text,'UTF8')),'hex')),'PENDING',now(),now(),now()) ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('app.organization_id',COALESCE(previous_context,''),true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.emit_learner_profile_webhook() FROM PUBLIC;
DROP TRIGGER IF EXISTS learner_profile_customer_event ON public.personal_account_events;
CREATE TRIGGER learner_profile_customer_event AFTER INSERT ON public.personal_account_events FOR EACH ROW EXECUTE FUNCTION public.emit_learner_profile_webhook();



`;
export function validateWebhookEndpoint(value:string){
 let url:URL;try{url=new URL(value);}catch{throw Error('WEBHOOK_ENDPOINT_INVALID');}
 if(value.length>2048||url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||isIP(url.hostname.replace(/^\[|\]$/g,''))||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')||!url.hostname.includes('.'))throw Error('WEBHOOK_ENDPOINT_INVALID');
 return url.href;
}
export function createCustomerWebhookStore(pool:Pool){return {
 async save(tenant:TenantContext,input:{subscriptionId?:string;endpoint:string;keyId:string;eventTypes:string[];enabled:boolean;revision:number;idempotencyKey?:string;integrationId?:string}){
  const endpoint=validateWebhookEndpoint(input.endpoint);
  if(!/^[A-Za-z0-9._:-]{1,64}$/.test(input.keyId)||!Array.isArray(input.eventTypes)||!input.eventTypes.length||input.eventTypes.some(type=>!WEBHOOK_EVENT_TYPES.includes(type as typeof WEBHOOK_EVENT_TYPES[number]))||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0||input.subscriptionId&&!/^subscription:[a-f0-9-]{36}$/.test(input.subscriptionId)||input.idempotencyKey!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('WEBHOOK_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   await requireLifecycleAdmin(client,tenant);await client.query("SELECT pg_advisory_xact_lock(hashtextextended('webhook-admin:'||$1,0))",[tenant.organizationId]);
   if(input.integrationId){
    if(!/^[a-f0-9-]{36}$/i.test(input.integrationId)||(await client.query("SELECT 1 FROM machine_integrations WHERE organization_id=$1 AND integration_id=$2 AND actor_id=$3 AND status='ACTIVE' AND 'webhooks:write'=ANY(scopes) FOR SHARE",[tenant.organizationId,input.integrationId,tenant.actorId])).rowCount!==1)throw Error('WEBHOOK_INVALID');
    if(input.subscriptionId&&(await client.query("SELECT 1 FROM machine_integration_references WHERE organization_id=$1 AND integration_id=$2 AND kind='subscriptionId' AND internal_id=$3",[tenant.organizationId,input.integrationId,input.subscriptionId])).rowCount!==1)throw Error('WEBHOOK_INVALID');
   }
   const auditId=input.idempotencyKey?'webhook-admin:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,input.idempotencyKey])).digest('hex'):randomUUID(),signature=createHash('sha256').update(JSON.stringify([input.subscriptionId??null,endpoint,input.keyId,[...new Set(input.eventTypes)].sort(),input.enabled,input.revision])).digest('hex');
   const previous=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,auditId])).rows[0];
   if(previous){if(previous.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return previous.details.result as {subscriptionId:string;keyId:string;revision:number;enabled:boolean;signingSecretRequired:boolean};}
   const id=input.subscriptionId??'subscription:'+randomUUID();let signingSecretRequired=!input.subscriptionId;
   if(input.subscriptionId){const row=(await client.query('SELECT * FROM customer_webhook_subscriptions WHERE organization_id=$1 AND subscription_id=$2 FOR UPDATE',[tenant.organizationId,id])).rows[0];if(!row)throw Error('WEBHOOK_NOT_FOUND');if(row.revision!==input.revision)throw Error('WEBHOOK_REVISION_CONFLICT');signingSecretRequired=row.key_id!==input.keyId;
    if(signingSecretRequired&&row.previous_key_id&&new Date(row.previous_key_expires_at)>new Date())throw Error('WEBHOOK_ROTATION_IN_PROGRESS');
    await client.query(`UPDATE customer_webhook_subscriptions SET endpoint=$3,key_id=$4,previous_key_id=CASE WHEN key_id<>$4 THEN key_id ELSE previous_key_id END,previous_key_expires_at=CASE WHEN key_id<>$4 THEN now()+interval '24 hours' ELSE previous_key_expires_at END,event_types=$5,enabled=$6,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND subscription_id=$2`,[tenant.organizationId,id,endpoint,input.keyId,[...new Set(input.eventTypes)],input.enabled]);
   }else{
    if(input.revision!==0)throw Error('WEBHOOK_REVISION_CONFLICT');
    if((await client.query('SELECT count(*)::int n FROM customer_webhook_subscriptions WHERE organization_id=$1',[tenant.organizationId])).rows[0].n>=10)throw Error('WEBHOOK_LIMIT');
    await client.query('INSERT INTO customer_webhook_subscriptions(subscription_id,organization_id,endpoint,key_id,event_types,enabled) VALUES($1,$2,$3,$4,$5,$6)',[id,tenant.organizationId,endpoint,input.keyId,[...new Set(input.eventTypes)],input.enabled]);
   }
   if(!input.enabled){await client.query("UPDATE customer_webhook_deliveries SET state='CANCELLED',lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND subscription_id=$2 AND state IN ('PENDING','CLAIMED')",[tenant.organizationId,id]);await client.query("UPDATE outbox_events e SET state='PUBLISHED',updated_at=now() WHERE e.organization_id=$1 AND e.event_type='customer.webhook.deliver' AND EXISTS(SELECT 1 FROM customer_webhook_deliveries d WHERE d.organization_id=e.organization_id AND d.delivery_id=e.outbox_event_id AND d.subscription_id=$2 AND d.state='CANCELLED')",[tenant.organizationId,id]);}
   if(input.integrationId)await client.query("INSERT INTO machine_integration_references(reference_id,organization_id,integration_id,kind,internal_id) VALUES($1,$2,$3,'subscriptionId',$4) ON CONFLICT(integration_id,kind,internal_id) DO NOTHING",[randomUUID(),tenant.organizationId,input.integrationId,id]);
   const result={subscriptionId:id,keyId:input.keyId,revision:input.revision+1,enabled:input.enabled,signingSecretRequired};
   await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'WEBHOOK_SUBSCRIPTION_CHANGED','webhook_subscription',$4,$5::jsonb,now())`,[auditId,tenant.organizationId,tenant.actorId,id,JSON.stringify({enabled:input.enabled,keyId:input.keyId,revision:input.revision+1,signature,result})]);
   return result;
  });
 },
 async list(tenant:TenantContext){return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);return {items:(await client.query('SELECT subscription_id AS "subscriptionId",endpoint,key_id AS "keyId",event_types AS "eventTypes",enabled,revision FROM customer_webhook_subscriptions WHERE organization_id=$1 ORDER BY subscription_id LIMIT 10',[tenant.organizationId])).rows};});},
 async claim(tenant:TenantContext,id:string){return withTenantTransaction(pool,tenant,async client=>{
  const row=(await client.query(`SELECT d.*,s.endpoint,s.key_id,s.previous_key_id,s.previous_key_expires_at,s.enabled FROM customer_webhook_deliveries d JOIN customer_webhook_subscriptions s ON s.organization_id=d.organization_id AND s.subscription_id=d.subscription_id WHERE d.organization_id=$1 AND d.delivery_id=$2 FOR UPDATE OF d,s`,[tenant.organizationId,id])).rows[0];
  if(!row||!['PENDING','CLAIMED'].includes(row.state)||row.available_at>new Date()||row.state==='CLAIMED'&&row.lease_expires_at>new Date())return null;
  if(!row.enabled){await client.query("UPDATE customer_webhook_deliveries SET state='CANCELLED',updated_at=now() WHERE organization_id=$1 AND delivery_id=$2",[tenant.organizationId,id]);return null;}
  if(row.attempts>=8){await client.query("UPDATE customer_webhook_deliveries SET state='FAILED',updated_at=now() WHERE organization_id=$1 AND delivery_id=$2",[tenant.organizationId,id]);return null;}
  const token=randomUUID();await client.query("UPDATE customer_webhook_deliveries SET state='CLAIMED',attempts=attempts+1,lease_token=$3,lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE organization_id=$1 AND delivery_id=$2",[tenant.organizationId,id,token]);return {...row,leaseToken:token};
 });},
 async finish(tenant:TenantContext,id:string,lease:string,success:boolean){return withTenantTransaction(pool,tenant,async client=>{
  const result=await client.query(`UPDATE customer_webhook_deliveries SET state=CASE WHEN $4 THEN 'SUCCEEDED' WHEN attempts>=8 THEN 'FAILED' ELSE 'PENDING' END,available_at=now()+least(3600,power(2,attempts)::int*15)*interval '1 second',lease_token=NULL,lease_expires_at=NULL,last_error=CASE WHEN $4 THEN NULL ELSE 'WEBHOOK_DELIVERY_FAILED' END,updated_at=now() WHERE organization_id=$1 AND delivery_id=$2 AND state='CLAIMED' AND lease_token=$3 RETURNING state,available_at`,[tenant.organizationId,id,lease,success]);
  if(!result.rowCount)return {state:'STALE'};
  const row=result.rows[0];await client.query(`UPDATE outbox_events SET state=CASE WHEN $3='PENDING' THEN 'PENDING' WHEN $3='FAILED' THEN 'FAILED' ELSE 'PUBLISHED' END,available_at=$4,updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2`,[tenant.organizationId,id,row.state,row.available_at]);return {state:row.state};
 });},
 async retry(tenant:TenantContext,id:string){return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);const result=await client.query(`UPDATE customer_webhook_deliveries d SET state='PENDING',attempts=0,available_at=now(),last_error=NULL,updated_at=now() WHERE organization_id=$1 AND delivery_id=$2 AND state='FAILED' AND EXISTS(SELECT 1 FROM customer_webhook_subscriptions s WHERE s.organization_id=d.organization_id AND s.subscription_id=d.subscription_id AND s.enabled) RETURNING event_id`,[tenant.organizationId,id]);if(!result.rowCount)throw Error('WEBHOOK_NOT_RETRYABLE');await client.query("UPDATE outbox_events SET state='PENDING',available_at=now(),updated_at=now() WHERE organization_id=$1 AND outbox_event_id=$2",[tenant.organizationId,id]);await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_id,details,created_at) VALUES($1,$2,$3,'WEBHOOK_DELIVERY_RETRIED',$4,'{}',now())",[randomUUID(),tenant.organizationId,tenant.actorId,id]);return {deliveryId:id,state:'PENDING'};});}
};}

export const customerWebhookFingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');
