import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
const states=['Delivered','Suppressed','Bounced','Quarantined','FilteredSpam','Expanded','Failed'];
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface EmailDeliveryReport {id:string;operationId:string;recipient:string;status:string;occurredAt:string}
/** Only call after transport authentication and ACS resource/sender validation. */
export function createEmailDeliveryReportStore(pool:Pool){return {
 async apply(tenant:TenantContext,report:EmailDeliveryReport){
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(report.id)||!/^[a-f0-9-]{36}$/i.test(report.operationId)||!states.includes(report.status)||typeof report.recipient!=='string'||report.recipient.length>254||!Number.isFinite(Date.parse(report.occurredAt)))throw Error('EMAIL_REPORT_INVALID');
  const recipientHash=hash(report.recipient.trim().toLowerCase()),occurredAt=new Date(report.occurredAt).toISOString();
  return withTenantTransaction(pool,tenant,async client=>{
   const result=await client.query(`SELECT public.apply_email_delivery_report($1,$2,$3,$4,$5,$6,$7) AS replayed`,[report.id,report.operationId,recipientHash,report.status,occurredAt,tenant.actorId,tenant.correlationId]);
   return {replayed:result.rows[0].replayed};
  });
 }
};}
