import {createHash} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from '@medical-device/db';

export interface AssetRightsInput {sourceHash: string; ownerName: string; useScope: string; confirmed: true; targetKind: 'asset' | 'model'}
export function validateAssetRights(input: unknown): AssetRightsInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('ASSET_RIGHTS_INVALID');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['sourceHash','ownerName','useScope','confirmed','targetKind'].includes(key)) ||
    typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || value.confirmed !== true ||
    typeof value.ownerName !== 'string' || !value.ownerName.trim() || value.ownerName.length > 240 ||
    typeof value.useScope !== 'string' || !value.useScope.trim() || value.useScope.length > 1000 ||
    !['asset','model'].includes(String(value.targetKind))) throw Error('ASSET_RIGHTS_INVALID');
  return {...value,ownerName:value.ownerName.trim(),useScope:value.useScope.trim()} as unknown as AssetRightsInput;
}
export function createAssetRightsAttestor(pool: Pool) {
  return async (tenant: TenantContext, id: string, raw: unknown, key: string) => {
    const input = validateAssetRights(raw);
    if (!tenant.actorId || !id || id.length > 300 || !key || key.length > 200) throw Error('ASSET_RIGHTS_INVALID');
    const attestationId = 'rights:' + createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,key])).digest('hex');
    return withTenantTransaction(pool, tenant, async client => {
      const asset = (await client.query(`SELECT v.asset_version_id,v.sha256 FROM asset_versions v
        JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id
        WHERE v.organization_id=$1 AND v.asset_version_id=${input.targetKind === 'model' ? '(SELECT asset_version_id FROM model_versions WHERE organization_id=$1 AND model_version_id=$2)' : '$2'}
          AND v.source_type IN ('image','video','glb') AND v.state IN ('READY_FOR_REVIEW','APPROVED')
          AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
          AND NOT public.lifecycle_asset_suppressed(v.asset_version_id) FOR UPDATE OF v`, [tenant.organizationId,id])).rows[0];
      if (!asset || asset.sha256 !== input.sourceHash) throw Error('ASSET_RIGHTS_UNAVAILABLE');
      const inactive = await client.query("SELECT 1 FROM asset_rights_attestations WHERE organization_id=$1 AND asset_version_id=$2 AND status<>'ACTIVE' LIMIT 1", [tenant.organizationId,asset.asset_version_id]);
      if (inactive.rowCount) throw Error('ASSET_RIGHTS_UNAVAILABLE');
      const inserted = await client.query(`INSERT INTO asset_rights_attestations
        (attestation_id,organization_id,asset_version_id,owner_name,use_scope,derivative_allowed,status,created_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,true,'ACTIVE',$6,now(),now()) ON CONFLICT(attestation_id) DO NOTHING RETURNING attestation_id`,
        [attestationId,tenant.organizationId,asset.asset_version_id,input.ownerName,input.useScope,tenant.actorId]);
      const saved = (await client.query('SELECT * FROM asset_rights_attestations WHERE organization_id=$1 AND attestation_id=$2', [tenant.organizationId,attestationId])).rows[0];
      if (!saved || saved.asset_version_id !== asset.asset_version_id || saved.owner_name !== input.ownerName || saved.use_scope !== input.useScope || saved.created_by !== tenant.actorId || saved.status !== 'ACTIVE' || saved.derivative_allowed !== true) throw Error('ASSET_RIGHTS_CONFLICT');
      if (inserted.rowCount) await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
        VALUES($1,$2,$3,'ASSET_RIGHTS_ATTESTED','asset_version',$4,$5::jsonb,now())`,
        [attestationId,tenant.organizationId,tenant.actorId,asset.asset_version_id,JSON.stringify({attestationId,sourceHash:input.sourceHash,derivativeAllowed:true,ownerName:input.ownerName,useScope:input.useScope})]);
      return {attestationId,assetVersionId:asset.asset_version_id,status:'ACTIVE' as const};
    });
  };
}

// The existing media route supplies its already authenticated, company-scoped
// principal and tenant. This helper never accepts an actor/company from JSON.
export async function handleAdminRights(context: {
  request: IncomingMessage; response: ServerResponse; tenant: TenantContext; id?: string;
  service: {attestRights: ReturnType<typeof createAssetRightsAttestor>};
  readBody(): Promise<unknown>; key(): string | null | undefined;
}) {
  let status = 200, result: unknown;
  try {
    if (context.request.method !== 'POST') throw Error('ASSET_RIGHTS_METHOD');
    if (new URL(context.request.url ?? '/', 'http://localhost').search || !context.id || !context.key() ||
      context.request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase() !== 'application/json') throw Error('ASSET_RIGHTS_INVALID');
    result = await context.service.attestRights(context.tenant,context.id,await context.readBody(),context.key()!);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    status = code === 'ASSET_RIGHTS_METHOD' ? 405 : code === 'ASSET_RIGHTS_INVALID' || error instanceof SyntaxError ? 422 : code === 'ASSET_RIGHTS_UNAVAILABLE' ? 404 : code === 'ASSET_RIGHTS_CONFLICT' ? 409 : 500;
    result = {error:{code:status === 500 ? 'ASSET_RIGHTS_FAILED' : code,message:'Usage rights could not be recorded. Confirm permission, check company access and refresh the source before retrying.'}};
  }
  context.response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  context.response.end(JSON.stringify(result));
}
