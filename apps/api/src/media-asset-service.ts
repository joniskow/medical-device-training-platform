import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {PrivateObjectStoragePort,TenantContext} from '@medical-device/contracts';
import {withTenantTransaction,assertStoryActivityAccess} from '@medical-device/db';
import {validateMediaActivity} from '@medical-device/simulation-schema';

export interface MediaAssetService {
 listApproved(tenant:TenantContext,after?:string):Promise<{items:Array<{assetVersionId:string;fileName:string;type:'image'|'video';contentType:string}>;nextCursor?:string}>;
 get(tenant:TenantContext,enrollmentId:string,activityId:string,content?:boolean):Promise<{bytes?:Uint8Array;url:string;contentType:string;expiresInSeconds:number;altText?:string;transcript?:string}>;
}
const id=(value:string)=>/^[A-Za-z0-9._:-]{1,128}$/.test(value);
export async function resolvePublishedMediaAsset(client:PoolClient,tenant:TenantContext,manifest:any,activity:any){
   const assetVersionId=activity.media?.assetVersionId;
   if(typeof assetVersionId!=='string'||!id(assetVersionId))throw Error('MEDIA_NOT_FOUND');
   const snapshots=(Array.isArray(manifest.sourceArtifacts)?manifest.sourceArtifacts:[]).filter((a:any)=>a?.assetVersionId===assetVersionId);
   if(snapshots.length!==1||!/^([a-f0-9]{64})$/.test(snapshots[0].sha256))throw Error('MEDIA_NOT_FOUND');
   const result=await client.query(`SELECT asset_version_id,source_type,content_type,blob_key,sha256 FROM asset_versions
    WHERE organization_id=$1 AND asset_version_id=$2 AND state='APPROVED' AND NOT public.lifecycle_asset_suppressed(asset_version_id) FOR SHARE`,[tenant.organizationId,assetVersionId]);
   const asset=result.rows[0];
   if(!asset||asset.sha256!==snapshots[0].sha256||typeof asset.blob_key!=='string'||!asset.blob_key.startsWith(tenant.organizationId+'/')||asset.blob_key.length>1024||/[\u0000-\u001f]/.test(asset.blob_key))throw Error('MEDIA_NOT_FOUND');
   if(!validateMediaActivity(activity,[{assetVersionId,sourceType:asset.source_type,contentType:asset.content_type}]).valid)throw Error('MEDIA_NOT_FOUND');
   return asset;
}
/** Resolve only the asset version and hash frozen in the learner's published release. */
export function createMediaAssetService(pool:Pool,storage:Pick<PrivateObjectStoragePort,'createDownloadUrl'|'readObject'>,privateDelivery=false):MediaAssetService{
 return {
 async listApproved(tenant,after){
  if(!tenant.actorId||(after!==undefined&&!id(after)))throw Error('MEDIA_REQUEST_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   const rows=(await client.query(`SELECT asset_version_id,file_name,source_type,content_type FROM asset_versions
    WHERE organization_id=$1 AND state='APPROVED' AND NOT public.lifecycle_asset_suppressed(asset_version_id) AND ($2::text IS NULL OR asset_version_id>$2)
    AND ((source_type='image' AND content_type IN ('image/png','image/jpeg','image/webp')) OR (source_type='video' AND content_type IN ('video/mp4','video/webm')))
    ORDER BY asset_version_id LIMIT 51`,[tenant.organizationId,after??null])).rows;
   const items=rows.slice(0,50).map(r=>({assetVersionId:r.asset_version_id,fileName:r.file_name,type:r.source_type as 'image'|'video',contentType:r.content_type}));
   return {items,...(rows.length>50?{nextCursor:items[49].assetVersionId}:{})};
  });
 },
 async get(tenant,enrollmentId,activityId,contentRequest=false){
  if(!tenant.actorId||!id(enrollmentId)||!id(activityId))throw Error('MEDIA_NOT_FOUND');
  return withTenantTransaction(pool,tenant,async client=>{
   const rows=await client.query(`SELECT r.release_id,r.manifest FROM enrollments e
    JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
    WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status IN ('ACTIVE','COMPLETED') AND r.status='PUBLISHED' AND public.lifecycle_release_available(r.release_id)
    FOR SHARE OF e,r`,[tenant.organizationId,enrollmentId,tenant.actorId]);
   if(rows.rows.length!==1)throw Error('MEDIA_NOT_FOUND');
   const release=rows.rows[0],content=release.manifest?.content;
   const activities=(Array.isArray(content?.modules)?content.modules:[]).flatMap((m:any)=>Array.isArray(m?.activities)?m.activities:[]).filter((a:any)=>a?.activityId===activityId);
   if(activities.length!==1||!['image','video'].includes(activities[0].type))throw Error('MEDIA_NOT_FOUND');
   const activity=activities[0],asset=await resolvePublishedMediaAsset(client,tenant,release.manifest,activity);
   await assertStoryActivityAccess(client,tenant,enrollmentId,release.release_id,activityId);
   const expiresInSeconds=300;
   const url=privateDelivery||contentRequest?`/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/activities/${encodeURIComponent(activityId)}/media?content=1`:await storage.createDownloadUrl({blobKey:asset.blob_key,expiresInSeconds});
   let bytes:Uint8Array|undefined;
   if(contentRequest){const object=await storage.readObject({blobKey:asset.blob_key,maxBytes:128*1024*1024});if(createHash('sha256').update(object.bytes).digest('hex')!==asset.sha256)throw Error('MEDIA_CONTENT_MISMATCH');bytes=object.bytes;}
   return {...(bytes?{bytes}:{}),url,contentType:asset.content_type,expiresInSeconds,...(activity.type==='image'?{altText:activity.media.altText}:{transcript:activity.media.transcript})};
  });
 }};
}
