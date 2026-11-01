import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {createCourseCatalogStore,CANDIDATE_NOTICE_TEXT,CANDIDATE_NOTICE_VERSION} from '@medical-device/db';
export function createPublicCourseCatalogService(pool:Pool,perMinute=60){
 if(!Number.isSafeInteger(perMinute)||perMinute<1||perMinute>1000)throw Error('CATALOG_LIMIT_INVALID');
 const store=createCourseCatalogStore(pool);
 return {async read(address:string,publicId?:string,after?:string){
  const key=createHash('sha256').update(`course-catalog:${address}`).digest('hex');
  const result=await pool.query(`INSERT INTO public_verification_limits(bucket_key,window_start,requests) VALUES($1,date_trunc('minute',now()),1)
   ON CONFLICT(bucket_key) DO UPDATE SET window_start=date_trunc('minute',now()),requests=CASE WHEN public_verification_limits.window_start<date_trunc('minute',now()) THEN 1 ELSE LEAST(public_verification_limits.requests+1,$2+1) END RETURNING requests`,[key,perMinute]);
  if(result.rows[0].requests>perMinute)throw Error('CATALOG_RATE_LIMITED');
  await pool.query(`DELETE FROM public_verification_limits WHERE bucket_key IN (SELECT bucket_key FROM public_verification_limits WHERE window_start<now()-interval '10 minutes' ORDER BY window_start LIMIT 100)`);
  if(publicId===undefined)return store.list(after);
  const course=await store.get(publicId);return course?{...course,enrollmentNotice:{version:CANDIDATE_NOTICE_VERSION,text:CANDIDATE_NOTICE_TEXT}}:null;
 }};
}
