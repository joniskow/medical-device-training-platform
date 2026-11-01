import type {Pool} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
/** authorize must verify a current authenticated platform operator and active organization membership. */
export function createEmailSuppressionReview(pool:Pool,authorize:(tenant:TenantContext)=>Promise<void>){return {
 async list(tenant:TenantContext,after?:string){
  await authorize(tenant);
  if(after!==undefined&&!/^[a-f0-9]{64}$/.test(after))throw Error('EMAIL_SUPPRESSION_REQUEST_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   const result=await client.query(`SELECT recipient_hash AS "recipientHash",reason,report_id AS "reportId",revision,created_at AS "createdAt",released_at AS "releasedAt" FROM email_recipient_suppressions WHERE organization_id=$1 AND ($2::text IS NULL OR recipient_hash>$2) ORDER BY recipient_hash LIMIT 51`,[tenant.organizationId,after??null]);
   return {items:result.rows.slice(0,50),nextCursor:result.rows.length>50?result.rows[49].recipientHash:null};
  });
 },
 async release(tenant:TenantContext,input:{recipientHash:string;revision:number;requestId:string;reason:string;confirmed:boolean}){
  await authorize(tenant);
  if(input.confirmed!==true||!/^[a-f0-9]{64}$/.test(input.recipientHash)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('EMAIL_SUPPRESSION_REQUEST_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   const result=await client.query(`SELECT public.release_email_suppression($1,$2,$3,$4,$5,$6) AS replayed`,[input.recipientHash,input.revision,input.requestId,input.reason.trim(),tenant.actorId,tenant.correlationId]);
   return {replayed:result.rows[0].replayed};
  });
 }
};}
