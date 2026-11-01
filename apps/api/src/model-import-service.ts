import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {PrivateObjectStoragePort,TenantContext} from '@medical-device/contracts';
import {createModelImportStore} from '@medical-device/db';
export function createModelImportService(pool:Pool,storage:PrivateObjectStoragePort){
 const store=createModelImportStore(pool,{writeManifest:async(key,manifest)=>{await storage.putObject({blobKey:key,bytes:Buffer.from(JSON.stringify(manifest)),contentType:'application/json'});}});
 return {list:store.list,review:store.review,configure:store.configure,
  async get(tenant:TenantContext,id:string){const row=await store.get(tenant,id);if(!row)return null;return {modelVersionId:row.modelVersionId,fileName:row.fileName,status:row.status,manifest:row.manifest,contentUrl:`/api/v1/model-imports/${encodeURIComponent(id)}/content`};},
  async content(tenant:TenantContext,id:string){
   const row=await store.get(tenant,id);if(!row||!row.blobKey.startsWith(tenant.organizationId+'/'))return null;
   const object=await storage.readObject({blobKey:row.blobKey,maxBytes:64*1024*1024});
   if(createHash('sha256').update(object.bytes).digest('hex')!==row.sha256||row.manifest.sourceHash!==row.sha256)throw Error('MODEL_CONTENT_MISMATCH');
   return object.bytes;
  }
 };
}
