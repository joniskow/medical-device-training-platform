import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';

/** Suppression is separate from immutable releases and credential/attempt evidence. */
export const LIFECYCLE_GOVERNANCE_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.lifecycle_tombstones(
 organization_id text NOT NULL,asset_version_id text NOT NULL REFERENCES public.asset_versions(asset_version_id),
 reason text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,asset_version_id));
CREATE TABLE IF NOT EXISTS public.lifecycle_holds(
 organization_id text NOT NULL,asset_version_id text NOT NULL REFERENCES public.asset_versions(asset_version_id),
 reason text NOT NULL,actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz,
 PRIMARY KEY(organization_id,asset_version_id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['lifecycle_tombstones','lifecycle_holds'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_isolation') THEN
 EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (organization_id=NULLIF(current_setting(''app.organization_id'',true),'''')) WITH CHECK (organization_id=NULLIF(current_setting(''app.organization_id'',true),''''))',t); END IF;
 END LOOP; END $$;
CREATE OR REPLACE FUNCTION public.lifecycle_json_has_id(value jsonb,id text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_path_query(value,'lax $.**') v WHERE v=to_jsonb(id))
$$;
CREATE OR REPLACE FUNCTION public.lifecycle_asset_edges() RETURNS TABLE(parent_id text,child_id text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT a.asset_version_id,m.asset_version_id FROM public.model_versions m JOIN public.asset_versions a ON a.organization_id=m.organization_id AND public.lifecycle_json_has_id(m.manifest,a.asset_version_id)
   WHERE m.organization_id=NULLIF(current_setting('app.organization_id',true),'') AND m.asset_version_id IS NOT NULL
  UNION
  SELECT source->>'assetVersionId',j.outcome->'details'->>'assetVersionId' FROM public.processing_jobs j CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.payload->'assets')='array' THEN j.payload->'assets' ELSE '[]'::jsonb END) source
   WHERE j.organization_id=NULLIF(current_setting('app.organization_id',true),'') AND j.job_type='lesson.render' AND j.state='SUCCEEDED' AND j.outcome->'details'->>'assetVersionId' IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.lifecycle_asset_suppressed(id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 WITH RECURSIVE edges(parent_id,child_id) AS (SELECT * FROM public.lifecycle_asset_edges()),blocked(id) AS (
  SELECT a.asset_version_id FROM public.asset_versions a WHERE a.organization_id=NULLIF(current_setting('app.organization_id',true),'')
   AND (a.state IN ('QUARANTINED','RETIRED','REJECTED') OR EXISTS(SELECT 1 FROM public.lifecycle_tombstones t WHERE t.organization_id=a.organization_id AND t.asset_version_id=a.asset_version_id)
    OR EXISTS(SELECT 1 FROM public.asset_rights_attestations r WHERE r.organization_id=a.organization_id AND r.asset_version_id=a.asset_version_id AND r.status<>'ACTIVE'))
  UNION
  SELECT edges.child_id FROM edges JOIN blocked b ON edges.parent_id=b.id
 ) SELECT EXISTS(SELECT 1 FROM blocked WHERE blocked.id=$1)
$$;
CREATE OR REPLACE FUNCTION public.lifecycle_release_available(id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.release_manifests r WHERE r.release_id=$1 AND r.organization_id=NULLIF(current_setting('app.organization_id',true),'')
  AND NOT EXISTS(SELECT 1 FROM public.asset_versions a WHERE a.organization_id=r.organization_id AND public.lifecycle_asset_suppressed(a.asset_version_id)
   AND (public.lifecycle_json_has_id(r.manifest,a.asset_version_id) OR EXISTS(SELECT 1 FROM public.release_model_bindings b JOIN public.model_versions m ON m.organization_id=b.organization_id AND m.model_version_id=b.model_version_id
    WHERE b.organization_id=r.organization_id AND b.release_id=r.release_id AND (m.asset_version_id=a.asset_version_id OR public.lifecycle_json_has_id(m.manifest,a.asset_version_id))))))
$$;
CREATE OR REPLACE FUNCTION public.lifecycle_publication_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- Publication and withdrawal take the same organization lock, including transactions that bypass the HTTP layer.
 PERFORM pg_advisory_xact_lock(hashtextextended('lifecycle:'||NEW.organization_id,0));
 IF EXISTS(SELECT 1 FROM public.asset_versions a WHERE a.organization_id=NEW.organization_id AND public.lifecycle_asset_suppressed(a.asset_version_id) AND public.lifecycle_json_has_id(NEW.manifest,a.asset_version_id))
 OR EXISTS(SELECT 1 FROM public.model_versions m JOIN public.asset_versions a ON a.organization_id=m.organization_id WHERE m.organization_id=NEW.organization_id AND public.lifecycle_json_has_id(NEW.manifest,m.model_version_id)
 AND public.lifecycle_asset_suppressed(a.asset_version_id) AND (m.asset_version_id=a.asset_version_id OR public.lifecycle_json_has_id(m.manifest,a.asset_version_id)))
 THEN RAISE EXCEPTION 'RELEASE_DEPENDENCY_SUPPRESSED'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lifecycle_publication_guard ON public.release_manifests;
CREATE TRIGGER lifecycle_publication_guard BEFORE INSERT ON public.release_manifests FOR EACH ROW EXECUTE FUNCTION public.lifecycle_publication_guard();
`;

export async function requireLifecycleAdmin(client:PoolClient,tenant:TenantContext){
 const permitted=await client.query(`SELECT 1 FROM organization_memberships m JOIN organizations o ON o.organization_id=m.organization_id JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject
 WHERE m.organization_id=$1 AND m.subject=$2 AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=$1)`,[tenant.organizationId,tenant.actorId]);
 if(!permitted.rowCount)throw Error('LIFECYCLE_ADMIN_REQUIRED');
}
export function createLifecycleGovernanceStore(pool:Pool){
 const valid=(value:string)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
 async function impact(client:PoolClient,tenant:TenantContext,id:string){
  return (await client.query(`SELECT r.release_id AS "releaseId",r.course_version_id AS "courseVersionId",(SELECT count(*)::int FROM credentials c WHERE c.organization_id=r.organization_id AND c.release_id=r.release_id) AS "credentialCount"
   FROM release_manifests r WHERE r.organization_id=$1 AND (public.lifecycle_json_has_id(r.manifest,$2) OR EXISTS(SELECT 1 FROM release_model_bindings b JOIN model_versions m ON m.organization_id=b.organization_id AND m.model_version_id=b.model_version_id WHERE b.organization_id=r.organization_id AND b.release_id=r.release_id AND (m.asset_version_id=$2 OR public.lifecycle_json_has_id(m.manifest,$2)))) ORDER BY r.release_id LIMIT 501`,[tenant.organizationId,id])).rows;
 }
 return {
  async inspect(tenant:TenantContext,id:string){
   if(!valid(id))throw Error('LIFECYCLE_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);
    const asset=(await client.query('SELECT asset_version_id,state,public.lifecycle_asset_suppressed(asset_version_id) AS suppressed FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2',[tenant.organizationId,id])).rows[0];
    if(!asset)throw Error('LIFECYCLE_NOT_FOUND');return {asset,releases:await impact(client,tenant,id),credentialConsequence:'PRESERVE_HISTORICAL_STATUS_REQUIRES_INDEPENDENT_ISSUER_REVIEW',privateUrlExposure:'Previously issued private URLs remain valid until their configured expiry.'};});
  },
  async administer(tenant:TenantContext,id:string,input:{action:'WITHDRAW'|'HOLD'|'RELEASE_HOLD'|'TOMBSTONE';reason:string;idempotencyKey:string}){
   if(!valid(id)||!valid(input.idempotencyKey)||!['WITHDRAW','HOLD','RELEASE_HOLD','TOMBSTONE'].includes(input.action)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('LIFECYCLE_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    await requireLifecycleAdmin(client,tenant);await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[tenant.organizationId]);
    const asset=(await client.query('SELECT asset_version_id FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 FOR UPDATE',[tenant.organizationId,id])).rows[0];if(!asset)throw Error('LIFECYCLE_NOT_FOUND');
    const eventId='lifecycle:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,input.idempotencyKey])).digest('hex'),signature=createHash('sha256').update(JSON.stringify([id,input.action,input.reason.trim()])).digest('hex');
    const prior=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,eventId])).rows[0];
    if(prior){if(prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return prior.details.result;}
    if(input.action==='HOLD')await client.query(`INSERT INTO lifecycle_holds(organization_id,asset_version_id,reason,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,asset_version_id) DO UPDATE SET reason=EXCLUDED.reason,actor_id=EXCLUDED.actor_id,released_at=NULL`,[tenant.organizationId,id,input.reason.trim(),tenant.actorId]);
    if(input.action==='RELEASE_HOLD')await client.query('UPDATE lifecycle_holds SET released_at=now() WHERE organization_id=$1 AND asset_version_id=$2 AND released_at IS NULL',[tenant.organizationId,id]);
    if(input.action==='TOMBSTONE'){
     if((await client.query('SELECT 1 FROM lifecycle_holds WHERE organization_id=$1 AND asset_version_id=$2 AND released_at IS NULL',[tenant.organizationId,id])).rowCount)throw Error('LIFECYCLE_HELD');
     await client.query('INSERT INTO lifecycle_tombstones(organization_id,asset_version_id,reason,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenant.organizationId,id,input.reason.trim(),tenant.actorId]);
    }
    if(input.action==='WITHDRAW'||input.action==='TOMBSTONE'){
     await client.query(`UPDATE asset_rights_attestations SET status='WITHDRAWN',updated_at=now() WHERE organization_id=$1 AND asset_version_id=$2 AND status='ACTIVE'`,[tenant.organizationId,id]);
     await client.query(`UPDATE asset_versions SET state='RETIRED',reason=$3,updated_at=now() WHERE organization_id=$1 AND asset_version_id=$2`,[tenant.organizationId,id,input.reason.trim()]);
     // Approval records remain immutable evidence; suppress every affected unpublished draft by returning it for revision.
     await client.query(`UPDATE course_versions v SET status='DRAFT',revision=revision+1,updated_at=now() WHERE v.organization_id=$1 AND v.status='IN_REVIEW' AND EXISTS(SELECT 1 FROM asset_versions a WHERE a.organization_id=v.organization_id AND public.lifecycle_asset_suppressed(a.asset_version_id) AND (public.lifecycle_json_has_id(v.content,a.asset_version_id) OR EXISTS(SELECT 1 FROM model_versions m WHERE m.organization_id=v.organization_id AND public.lifecycle_json_has_id(v.content,m.model_version_id) AND (m.asset_version_id=a.asset_version_id OR public.lifecycle_json_has_id(m.manifest,a.asset_version_id)))))`,[tenant.organizationId]);
    }
    const result={assetVersionId:id,action:input.action,releases:await impact(client,tenant,id),historicalCredentialsPreserved:true};
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'ASSET_LIFECYCLE_ADMINISTERED','asset_version',$4,$5::jsonb,now())`,[eventId,tenant.organizationId,tenant.actorId,id,JSON.stringify({signature,result,reason:input.reason.trim(),correlationId:tenant.correlationId})]);
    if(input.action==='WITHDRAW'||input.action==='TOMBSTONE')await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'asset.delivery.suppressed',$1,$3::jsonb,'PENDING',now(),now(),now())`,[eventId,tenant.organizationId,JSON.stringify({schemaVersion:1,assetVersionId:id,eventId})]);
    return result;
   });
  }
 };
}
