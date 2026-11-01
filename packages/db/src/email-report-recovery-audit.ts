import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createEmailReportRecoveryAudit(pool:Pool){return async(tenant:TenantContext,input:{requestId:string;snapshot:string;reason:string;stage:'STARTED'|'COMPLETED'})=>{
 if(!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)||!input.reason.trim()||input.reason.length>2000||!/^[a-f0-9]{64}$/.test(input.snapshot)||!['STARTED','COMPLETED'].includes(input.stage))throw Error('EMAIL_RECOVERY_REQUEST_INVALID');
 return withTenantTransaction(pool,tenant,async client=>{
  const base=digest([tenant.organizationId,tenant.actorId,input.requestId]),signature=digest([input.snapshot,input.reason.trim()]);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['email-recovery:'+base]);
  const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,'email-recovery:'+base+':STARTED'])).rows[0];
  if(prior?.details.signature!==undefined&&prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');
  if(input.stage==='COMPLETED'&&!prior)throw Error('EMAIL_RECOVERY_NOT_STARTED');
  await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,$4,'email_report_recovery',$5,$6::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`,['email-recovery:'+base+':'+input.stage,tenant.organizationId,tenant.actorId,'EMAIL_REPORT_RECOVERY_'+input.stage,input.requestId,JSON.stringify({signature,snapshot:input.snapshot,reason:input.reason.trim(),correlationId:tenant.correlationId})]);
 });
};}
