import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {withTenantTransaction,createPostgresKnowledgeStore} from '@medical-device/db';
import type {TenantContext,PrivateObjectStoragePort} from '@medical-device/contracts';

export function createMediaReviewService(pool:Pool,storage:PrivateObjectStoragePort){
 const reviews=createPostgresKnowledgeStore(pool);
 async function source(tenant:TenantContext,id:string){
  return withTenantTransaction(pool,tenant,async client=>(await client.query(`SELECT v.asset_version_id,v.file_name,v.source_type,v.content_type,v.sha256,v.blob_key,v.state FROM asset_versions v JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id WHERE v.organization_id=$1 AND v.asset_version_id=$2 AND v.source_type IN ('image','video') AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')`,[tenant.organizationId,id])).rows[0]??null);
 }
 async function get(tenant:TenantContext,id:string){
  const row=await source(tenant,id);if(!row)return null;
  const key=`${tenant.organizationId}/derived/media/${encodeURIComponent(id)}/${row.sha256}/inspection.json`;
  const object=await storage.readObject({blobKey:key,maxBytes:64*1024});
  const report=JSON.parse(Buffer.from(object.bytes).toString('utf8'));
  if(report.schemaVersion!=='media-inspection.v1'||report.assetVersionId!==id||report.sourceSha256!==row.sha256||report.contentType!==row.content_type||report.decodeVerified!==true)throw Error('MEDIA_REPORT_INVALID');
  if(!Number.isSafeInteger(report.width)||report.width<1||report.width>4096||!Number.isSafeInteger(report.height)||report.height<1||report.height>4096||!Number.isFinite(report.durationSeconds)||report.durationSeconds<0||report.durationSeconds>300||row.source_type==='video'&&report.durationSeconds===0||row.source_type==='image'&&report.durationSeconds!==0)throw Error('MEDIA_REPORT_INVALID');
  const prefix=`${tenant.organizationId}/derived/media/${encodeURIComponent(id)}/${row.sha256}`;
  if(report.frames!==undefined&&(!Array.isArray(report.frames)||row.source_type!=='video'||report.frames.length<1||report.frames.length>24))throw Error('MEDIA_REPORT_INVALID');
  const frames:Array<{index:number;timestampSeconds:number;sha256:string;byteLength:number;contentUrl:string}>=(report.frames??[]).map((frame:any,index:number)=>{
   if(!frame||frame.index!==index||!Number.isFinite(frame.timestampSeconds)||frame.timestampSeconds<0||frame.timestampSeconds>report.durationSeconds||index>0&&frame.timestampSeconds<=report.frames[index-1].timestampSeconds||frame.blobKey!==`${prefix}/frame-${index}.png`||typeof frame.sha256!=='string'||!/^[a-f0-9]{64}$/.test(frame.sha256)||!Number.isSafeInteger(frame.byteLength)||frame.byteLength<1||frame.byteLength>2*1024*1024)throw Error('MEDIA_REPORT_INVALID');
   return {index,timestampSeconds:frame.timestampSeconds,sha256:frame.sha256,byteLength:frame.byteLength,contentUrl:`/api/v1/media-review/${encodeURIComponent(id)}/frames?index=${index}`};
  });
  const uniqueFrameCount=new Set(frames.map(frame=>frame.sha256)).size;
  return {assetVersionId:id,fileName:row.file_name,sourceType:row.source_type,contentType:row.content_type,sourceHash:row.sha256,state:row.state,width:report.width,height:report.height,durationSeconds:report.durationSeconds,videoCodec:report.videoCodec,audioCodec:report.audioCodec,contentUrl:`/api/v1/media-review/${encodeURIComponent(id)}/content`,frames,uniqueFrameCount,duplicateFrameCount:frames.length-uniqueFrameCount};
 }
 return {
  async list(tenant:TenantContext,after=''){
   return withTenantTransaction(pool,tenant,async client=>{
    const rows=(await client.query(`SELECT v.asset_version_id AS "assetVersionId",v.file_name AS "fileName",v.state FROM asset_versions v JOIN assets a ON a.organization_id=v.organization_id AND a.asset_id=v.asset_id WHERE v.organization_id=$1 AND v.asset_version_id>$2 AND v.source_type IN ('image','video') AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED') ORDER BY v.asset_version_id LIMIT 21`,[tenant.organizationId,after])).rows;
    return {items:rows.slice(0,20),...(rows.length>20?{nextCursor:rows[19].assetVersionId}:{})};
   });
  },get,
  async frame(tenant:TenantContext,id:string,index:number){
   if(!Number.isSafeInteger(index)||index<0||index>23)throw Error('MEDIA_REVIEW_INVALID');
   const detail=await get(tenant,id),frame=detail?.frames[index];if(!detail||!frame)return null;
   const blobKey=`${tenant.organizationId}/derived/media/${encodeURIComponent(id)}/${detail.sourceHash}/frame-${index}.png`;
   const object=await storage.readObject({blobKey,maxBytes:2*1024*1024});
   if(object.bytes.length!==frame.byteLength||createHash('sha256').update(object.bytes).digest('hex')!==frame.sha256)throw Error('MEDIA_CONTENT_MISMATCH');
   return {bytes:object.bytes,contentType:'image/png'};
  },
  async content(tenant:TenantContext,id:string){
   const row=await source(tenant,id);if(!row||!row.blob_key.startsWith(tenant.organizationId+'/'))return null;
   if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(row.content_type))throw Error('MEDIA_REPORT_INVALID');
   const object=await storage.readObject({blobKey:row.blob_key,maxBytes:128*1024*1024});
   if(createHash('sha256').update(object.bytes).digest('hex')!==row.sha256)throw Error('MEDIA_CONTENT_MISMATCH');
   return {bytes:object.bytes,contentType:row.content_type};
  },
  async review(tenant:TenantContext,id:string,input:{sourceHash:string;decision:'APPROVE'|'REJECT';rationale:string;idempotencyKey:string}){
   if(input.decision==='APPROVE'){const model=await get(tenant,id);if(!model||model.sourceHash!==input.sourceHash)throw Error('SOURCE_REVIEW_CONFLICT');}
   else {const exists=await withTenantTransaction(pool,tenant,async client=>(await client.query("SELECT 1 FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 AND source_type IN ('image','video')",[tenant.organizationId,id])).rowCount);if(!exists)throw Error('SOURCE_UNAVAILABLE');}
   return reviews.reviewSource!(tenant,id,input);
  }
 };
}
