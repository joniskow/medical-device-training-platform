import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {requireLifecycleAdmin} from './lifecycle-governance.js';

/** No automatic deletion policy is invented. An administrator schedules only already withdrawn source bytes. */
export const RETENTION_GOVERNANCE_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.retention_schedules(
 organization_id text NOT NULL,asset_version_id text NOT NULL REFERENCES public.asset_versions(asset_version_id),purge_after timestamptz NOT NULL,
 reason text NOT NULL,actor_id text NOT NULL,purged_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,asset_version_id));
ALTER TABLE public.retention_schedules ENABLE ROW LEVEL SECURITY;ALTER TABLE public.retention_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.retention_schedules;
CREATE POLICY tenant_isolation ON public.retention_schedules USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''));
ALTER TABLE public.protected_exports ADD COLUMN IF NOT EXISTS purged_at timestamptz;
CREATE OR REPLACE FUNCTION public.retention_source_held(target_org text,target_asset text) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous_context text;held boolean;
BEGIN
 previous_context:=current_setting('app.organization_id',true);
 PERFORM set_config('app.organization_id',target_org,true);
 SELECT EXISTS(SELECT 1 FROM public.lifecycle_holds h WHERE h.organization_id=target_org AND h.asset_version_id=target_asset AND h.released_at IS NULL) INTO held;
 PERFORM set_config('app.organization_id',COALESCE(previous_context,''),true);
 RETURN held;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('app.organization_id',COALESCE(previous_context,''),true);RAISE;
END $$;
REVOKE ALL ON FUNCTION public.retention_source_held(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.due_retention_organizations() RETURNS TABLE(organization_id text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.organization_id FROM public.retention_schedules s WHERE s.purge_after<=now() AND s.purged_at IS NULL AND NOT public.retention_source_held(s.organization_id,s.asset_version_id)
 UNION SELECT x.organization_id FROM public.protected_exports x WHERE x.expires_at<=now() AND x.purged_at IS NULL LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.due_retention_organizations() FROM PUBLIC;
`;
export interface RetentionObjectStorage{deleteObject(input:{blobKey:string}):Promise<void>}
export function createRetentionGovernanceStore(pool:Pool,storage?:RetentionObjectStorage){
 const manifestSql=`SELECT s.asset_version_id AS "assetVersionId",a.blob_key AS "blobKey",s.purge_after AS "purgeAfter",s.reason,
  EXISTS(SELECT 1 FROM lifecycle_holds h WHERE h.organization_id=s.organization_id AND h.asset_version_id=s.asset_version_id AND h.released_at IS NULL) AS held,
  s.purged_at AS "purgedAt" FROM retention_schedules s JOIN asset_versions a ON a.organization_id=s.organization_id AND a.asset_version_id=s.asset_version_id
  WHERE s.organization_id=$1 AND s.asset_version_id>$2 ORDER BY s.asset_version_id LIMIT 51`;
 return {
  async schedule(tenant:TenantContext,id:string,input:{purgeAfter:string;reason:string}){
   const when=Date.parse(input.purgeAfter);if(!/^[A-Za-z0-9._:-]{1,128}$/.test(id)||!Number.isFinite(when)||when<Date.now()||when>Date.now()+10*365*86400000||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('RETENTION_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[tenant.organizationId]);
    const row=(await client.query("SELECT 1 FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 AND state='RETIRED' FOR UPDATE",[tenant.organizationId,id])).rows[0];if(!row)throw Error('RETENTION_WITHDRAWAL_REQUIRED');
    const result=await client.query(`INSERT INTO retention_schedules(organization_id,asset_version_id,purge_after,reason,actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,asset_version_id) DO UPDATE SET purge_after=EXCLUDED.purge_after,reason=EXCLUDED.reason,actor_id=EXCLUDED.actor_id WHERE retention_schedules.purged_at IS NULL RETURNING asset_version_id`,[tenant.organizationId,id,new Date(when).toISOString(),input.reason.trim(),tenant.actorId]);if(!result.rowCount)throw Error('RETENTION_ALREADY_PURGED');
    await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'RETENTION_SCHEDULED','asset_version',$4,$5::jsonb,now())",[randomUUID(),tenant.organizationId,tenant.actorId,id,JSON.stringify({purgeAfter:input.purgeAfter,reason:input.reason.trim()})]);return {assetVersionId:id,purgeAfter:new Date(when).toISOString()};
   });
  },
  async manifest(tenant:TenantContext,after=''){
   if(after&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('RETENTION_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{await requireLifecycleAdmin(client,tenant);const rows=(await client.query(manifestSql,[tenant.organizationId,after])).rows;return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].assetVersionId:null,preservedIndefinitely:['immutable release manifests','assessment and simulation attempts','credentials and events','audit history'],scope:'Scheduled withdrawn source objects only. Derived/release blobs require their own approved retention schedules; this manifest does not claim to purge them.'};});
  },
  async purgeDue(tenant:TenantContext){
   if(!storage)throw Error('RETENTION_STORAGE_UNAVAILABLE');
   return withTenantTransaction(pool,tenant,async client=>{
    // Same lock as hold placement, rights withdrawal and publication. Hold cannot race physical deletion.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[tenant.organizationId]);
    const rows=(await client.query(`SELECT s.asset_version_id,a.blob_key,s.reason FROM retention_schedules s JOIN asset_versions a ON a.organization_id=s.organization_id AND a.asset_version_id=s.asset_version_id WHERE s.organization_id=$1 AND s.purge_after<=now() AND s.purged_at IS NULL AND a.state='RETIRED' AND NOT EXISTS(SELECT 1 FROM lifecycle_holds h WHERE h.organization_id=s.organization_id AND h.asset_version_id=s.asset_version_id AND h.released_at IS NULL) ORDER BY s.purge_after,s.asset_version_id LIMIT 10 FOR UPDATE OF s,a SKIP LOCKED`,[tenant.organizationId])).rows;
    for(const row of rows){
     if(!row.blob_key.startsWith(tenant.organizationId+'/'))throw Error('RETENTION_BLOB_SCOPE_INVALID');
     await client.query('INSERT INTO lifecycle_tombstones(organization_id,asset_version_id,reason,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tenant.organizationId,row.asset_version_id,row.reason,tenant.actorId]);
     await storage.deleteObject({blobKey:row.blob_key});
     await client.query('UPDATE retention_schedules SET purged_at=now() WHERE organization_id=$1 AND asset_version_id=$2',[tenant.organizationId,row.asset_version_id]);
     await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'RETAINED_SOURCE_PURGED','asset_version',$4,'{}',now())",[randomUUID(),tenant.organizationId,tenant.actorId,row.asset_version_id]);
    }
    const expired=(await client.query(`SELECT export_id,blob_key,artifact_keys FROM protected_exports WHERE organization_id=$1 AND expires_at<=now() AND purged_at IS NULL ORDER BY expires_at,export_id LIMIT 10 FOR UPDATE SKIP LOCKED`,[tenant.organizationId])).rows;
    for(const row of expired){for(const blobKey of new Set<string>([row.blob_key,...row.artifact_keys])){if(!blobKey.startsWith(tenant.organizationId+'/exports/'))throw Error('RETENTION_BLOB_SCOPE_INVALID');await storage.deleteObject({blobKey});}await client.query('UPDATE protected_exports SET purged_at=now(),updated_at=now() WHERE organization_id=$1 AND export_id=$2',[tenant.organizationId,row.export_id]);await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'EXPIRED_EXPORT_PURGED','export',$4,'{}',now())",[randomUUID(),tenant.organizationId,tenant.actorId,row.export_id]);}
    return {purged:rows.length,expiredExportsPurged:expired.length};
   });
  },
  async replayTombstones(tenant:TenantContext){return withTenantTransaction(pool,tenant,async client=>{
   await requireLifecycleAdmin(client,tenant);await client.query("SELECT pg_advisory_xact_lock(hashtextextended('lifecycle:'||$1,0))",[tenant.organizationId]);
   const changed=await client.query(`UPDATE asset_versions a SET state='RETIRED',reason='RESTORED_TOMBSTONE_REAPPLIED',updated_at=now() FROM lifecycle_tombstones t WHERE t.organization_id=$1 AND a.organization_id=t.organization_id AND a.asset_version_id=t.asset_version_id AND a.state<>'RETIRED'`,[tenant.organizationId]);
   await client.query("UPDATE asset_rights_attestations r SET status='WITHDRAWN',updated_at=now() FROM lifecycle_tombstones t WHERE t.organization_id=$1 AND r.organization_id=t.organization_id AND r.asset_version_id=t.asset_version_id AND r.status='ACTIVE'",[tenant.organizationId]);
   await client.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,details,created_at) VALUES($1,$2,$3,'RESTORED_TOMBSTONES_REAPPLIED',$4::jsonb,now())",[randomUUID(),tenant.organizationId,tenant.actorId,JSON.stringify({reapplied:changed.rowCount})]);return {reapplied:changed.rowCount};
  });}
 };
}
