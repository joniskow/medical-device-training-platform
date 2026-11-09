import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {withTenantTransaction} from './tenant-transaction.js';
import {recordTechnicalCost} from './technical-metering.js';

/** Protected operator connection only. This is deliberately not exposed by a customer API.
 * A reviewed provider invoice line must reference a durable measured source receipt. */
export async function reconcileProviderBilledUsage(pool:Pool,input:{organizationId:string;sourceUsageEventId:string;invoiceLineId:string;microUsd:number}){
  const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
  if(!opaque(input.organizationId)||!/^source:[a-f0-9]{64}$/.test(input.sourceUsageEventId)||!opaque(input.invoiceLineId)||!Number.isSafeInteger(input.microUsd)||input.microUsd<0||input.microUsd>1e12)throw Error('BILLED_RECONCILIATION_INVALID');
  const identity=(await pool.query('SELECT current_user AS name,rolsuper OR rolcreaterole AS administrative FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!identity?.administrative)throw Error('BILLED_RECONCILIATION_OPERATOR_REQUIRED');
  const tenant={organizationId:input.organizationId,actorId:identity.name,correlationId:'billing-reconciliation'};
  const committed=await withTenantTransaction(pool,tenant,async client=>{
    const source=(await client.query('SELECT metadata FROM usage_meter_events WHERE organization_id=$1 AND usage_event_id=$2',[tenant.organizationId,input.sourceUsageEventId])).rows[0];
    if(!source||source.metadata.provenance!=='SOURCE_METER')throw Error('BILLED_RECONCILIATION_SOURCE_REQUIRED');
    const invoiceHash=createHash('sha256').update(input.invoiceLineId).digest('hex');
    const eventId='billed:'+createHash('sha256').update(JSON.stringify([source.metadata.provider,input.invoiceLineId])).digest('hex');
    const auditId='reconcile:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,eventId])).digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[auditId]);
    const prior=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,auditId])).rows[0];
    if(prior&&(prior.details.sourceUsageEventId!==input.sourceUsageEventId||prior.details.microUsd!==input.microUsd))throw Error('IDEMPOTENCY_KEY_REUSED');
    const result=await recordTechnicalCost(client,tenant,{eventId,microUsd:input.microUsd,provenance:'PROVIDER_BILLED',provider:source.metadata.provider,operation:source.metadata.operation});
    if(!prior)await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'PROVIDER_BILLED_USAGE_RECONCILED','usage_receipt',$4,$5::jsonb,now())`,[auditId,tenant.organizationId,identity.name,input.sourceUsageEventId,JSON.stringify({sourceUsageEventId:input.sourceUsageEventId,invoiceHash,microUsd:input.microUsd,usageEventId:result.usageEventId,provenance:'PROVIDER_BILLED'})]);
    return {...result,replayed:Boolean(prior)};
  });
  if(!committed.replayed)try{console.log(JSON.stringify({event:'cost_recorded',service:'metering',provenance:'PROVIDER_BILLED',microUsd:input.microUsd}));}catch{/* The audit and billed ledger already committed. */}
  return {usageEventId:committed.usageEventId};
}
