import {randomUUID} from 'node:crypto';
import type {PrivateObjectStoragePort,SourceUsageReceipt,SourceUsageOperation} from '@medical-device/contracts';

export type StorageUsageSink=(input:{organizationId:string;receipt:SourceUsageReceipt})=>Promise<unknown>;

/** Meter physical server operations. A SAS grant is a grant, never proof of bytes delivered.
 * Paths stay in this adapter; only their server-owned organization prefix is sent to the store. */
export function createSourceMeteredStorage<T extends PrivateObjectStoragePort>(raw:T,sink:StorageUsageSink):T {
  const run=async<R>(operation:SourceUsageOperation,blobKey:string,action:()=>Promise<R>,metrics:(result:R)=>SourceUsageReceipt['metrics'])=>{
    const organizationId=blobKey.split('/')[0];
    if(!organizationId||!/^[A-Za-z0-9._:-]{1,128}$/.test(organizationId)||!blobKey.includes('/'))throw Error('STORAGE_METER_TENANT_INVALID');
    const receiptId=randomUUID(),started=performance.now();
    const record=(phase:SourceUsageReceipt['phase'],measurements:SourceUsageReceipt['metrics'])=>sink({organizationId,receipt:{receiptId,operation,provider:'azure-blob',phase,metrics:measurements}});
    await record('STARTED',{calls:1});
    let result:R;
    try{result=await action();}
    catch(error){await record('FAILED',{duration_ms:Math.round(performance.now()-started)});throw error;}
    // A failed receipt commit leaves a durable STARTED event with unknown outcome;
    // do not fabricate a failed storage operation after it already succeeded.
    await record('SUCCEEDED',{calls:1,duration_ms:Math.round(performance.now()-started),...metrics(result)});
    return result;
  };
  const metered={...raw,
    createUploadUrl(input:Parameters<T['createUploadUrl']>[0]){return run('storage.upload_grant',input.blobKey,()=>raw.createUploadUrl(input),()=>({}));},
    createDownloadUrl(input:Parameters<T['createDownloadUrl']>[0]){return run('storage.download_grant',input.blobKey,()=>raw.createDownloadUrl(input),()=>({}));},
    readObject(input:Parameters<T['readObject']>[0]){return run('storage.read',input.blobKey,()=>raw.readObject(input),result=>({bytes:result.bytes.byteLength}));},
    getObjectProperties(input:Parameters<T['getObjectProperties']>[0]){return run('storage.properties',input.blobKey,()=>raw.getObjectProperties(input),()=>({}));},
    putObject(input:Parameters<T['putObject']>[0]){return run('storage.write',input.blobKey,()=>raw.putObject(input),()=>({bytes:input.bytes.byteLength}));},
    async verifyChecksum(input:Parameters<T['verifyChecksum']>[0]){return raw.verifyChecksum.call(metered,input);},
    async quarantine(input:Parameters<T['quarantine']>[0]){return run('storage.quarantine',input.blobKey,()=>raw.quarantine.call(metered,input),()=>({}));},
    ...(raw.deleteObject?{deleteObject:(input:{blobKey:string})=>run('storage.delete',input.blobKey,()=>raw.deleteObject!(input),()=>({}))}:{}),
    ...(raw.putObjectStream?{putObjectStream:(input:Parameters<NonNullable<T['putObjectStream']>>[0])=>{
      let bytes=0;
      const chunks=(async function*(){for await(const chunk of input.chunks){bytes+=chunk.byteLength;yield chunk;}})();
      return run('storage.write',input.blobKey,()=>raw.putObjectStream!({...input,chunks}),()=>({bytes}));
    }}:{})
  };
  return metered as T;
}
