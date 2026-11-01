import { createHash } from "node:crypto";
import type { Pool } from "pg";

export interface PublicVerificationService {verify(publicId:string,clientAddress:string):Promise<unknown|null>}
export function createPublicVerificationService(pool:Pool,limits={perAddress:60,perCredential:30}):PublicVerificationService {
  if(![limits.perAddress,limits.perCredential].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1000))throw Error('VERIFICATION_LIMIT_INVALID');
  const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
  async function consume(key:string,maximum:number){
    const result=await pool.query(`INSERT INTO public_verification_limits(bucket_key,window_start,requests) VALUES($1,date_trunc('minute',now()),1)
      ON CONFLICT(bucket_key) DO UPDATE SET window_start=date_trunc('minute',now()),requests=CASE WHEN public_verification_limits.window_start<date_trunc('minute',now()) THEN 1 ELSE LEAST(public_verification_limits.requests+1,$2+1) END
      RETURNING requests`,[digest(key),maximum]);
    return result.rows[0].requests<=maximum;
  }
  return {async verify(publicId,clientAddress){
    if(!await consume(`address:${clientAddress}`,limits.perAddress))throw Error('VERIFICATION_RATE_LIMITED');
    if(!await consume(`credential:${publicId}`,limits.perCredential))throw Error('VERIFICATION_RATE_LIMITED');
    // Clean a bounded batch of expired counters; addresses and tokens are never retained in plaintext.
    await pool.query(`DELETE FROM public_verification_limits WHERE bucket_key IN (SELECT bucket_key FROM public_verification_limits WHERE window_start<now()-interval '10 minutes' ORDER BY window_start LIMIT 100)`);
    const hash=digest(/^[A-Za-z0-9_-]{43}$/.test(publicId)?publicId:'invalid-public-id');
    const result=await pool.query(`SELECT public_fields,status,issued_at,expires_at,expires_at<=now() AS expired,now() AS verified_at FROM credential_verifications WHERE public_id_hash=$1 AND sharing_enabled=true`,[hash]);
    const row=result.rows[0];if(!row)return null;
    return {issuerName:row.public_fields.issuerName,courseTitle:row.public_fields.courseTitle,
      status:row.status==='ACTIVE'&&row.expired?'EXPIRED':row.status,issuedAt:new Date(row.issued_at).toISOString(),expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,
      verifiedAt:new Date(row.verified_at).toISOString(),intendedUse:'Organization-issued product-training credential. Not professional licensure, accreditation, or regulatory approval. This is an online record lookup, not portable proof of identity.'};
  }};
}
