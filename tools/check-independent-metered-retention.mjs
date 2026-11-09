import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createAzureBlobStorage} from '../packages/storage/dist/index.js';
import {withTenantTransaction,createRetentionTrackedStorage,createSourceUsageMeteringStore,createRetentionResourceStore} from '../packages/db/dist/index.js';

const owner=new Pool({connectionString:process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const runtimeUrl=process.env.DATABASE_RUNTIME_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device';
const domain=new Pool({connectionString:runtimeUrl,max:2,connectionTimeoutMillis:2000}),metering=new Pool({connectionString:runtimeUrl,max:2,connectionTimeoutMillis:2000});
const org='independent-meter:'+randomUUID(),tenant={organizationId:org,actorId:'independent',correlationId:'independent-meter'},keys=Array.from({length:10},(_,n)=>org+'/derived/media/fixture-'+n+'/private-source.bin'),bytes=Buffer.from('Private engineering source transport bytes');
const settings={connectionString:'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',containerName:'independent-metered-retention',allowHttp:true}; // gitleaks:allow -- public Azurite emulator account key only
const raw=createAzureBlobStorage(settings),usage=createSourceUsageMeteringStore(metering),storage=createRetentionTrackedStorage(domain,createAzureBlobStorage({...settings,onUsage:usage.storage}),{receiptPool:metering}),resources=createRetentionResourceStore(domain,storage);
try{
 await raw.ensureContainers();
 const writes=await Promise.allSettled(keys.slice(0,8).map(blobKey=>storage.putObject({blobKey,bytes,contentType:'application/octet-stream'})));
 assert(writes.every(result=>result.status==='fulfilled'),'Concurrent tracked/metered writes starved a bounded connection pool');
 assert.equal((await owner.query('SELECT count(*)::int n FROM retention_blob_resources WHERE organization_id=$1',[org])).rows[0].n,8);
 await assert.rejects(withTenantTransaction(domain,tenant,async()=>{await storage.putObject({blobKey:keys[8],bytes,contentType:'application/octet-stream'});throw Error('INDEPENDENT_DOMAIN_ROLLBACK');}),/INDEPENDENT_DOMAIN_ROLLBACK/);
 assert.equal((await owner.query('SELECT count(*)::int n FROM retention_blob_resources WHERE organization_id=$1',[org])).rows[0].n,8,'Domain registration did not roll back');
 assert.deepEqual(Buffer.from((await raw.readObject({blobKey:keys[8]})).bytes),bytes,'Physical I/O did not occur before domain rollback');
 const rows=(await owner.query('SELECT meter_key,quantity::text,metadata FROM usage_meter_events WHERE organization_id=$1',[org])).rows;
 const total=key=>rows.filter(row=>row.meter_key===key).reduce((sum,row)=>sum+Number(row.quantity),0);
 assert.equal(total('storage.write.receipts.started'),9,'Started receipts were lost');
 assert.equal(total('storage.write.receipts.succeeded'),9,'Physical I/O receipt rolled back with domain transaction');
 assert.equal(total('storage.write.succeeded.bytes'),bytes.length*9);
 assert(!JSON.stringify(rows).includes('private-source.bin'));assert(!JSON.stringify(rows).includes(bytes.toString()));
 assert.equal((await owner.query("SELECT count(*)::int n FROM retention_blob_write_receipts WHERE organization_id=$1 AND state='SUCCEEDED'",[org])).rows[0].n,9,'Physical object receipts were lost with domain rollback');
 assert.equal((await resources.reconcileDue(tenant)).reconciled,1);
 const recovered=(await owner.query('SELECT state,orphaned,policy_id,purge_after FROM retention_blob_resources WHERE organization_id=$1 AND blob_key=$2',[org,keys[8]])).rows[0];
 assert.equal(recovered.state,'ACTIVE');assert.equal(recovered.orphaned,true);assert.equal(recovered.policy_id,null);assert.equal(recovered.purge_after,null);
 assert.equal((await resources.purgeDue(tenant)).purged,0,'Recovery invented an automatic deletion policy');
 assert.equal((await owner.query('SELECT count(*)::int n FROM retention_blob_resources WHERE organization_id=$1',[org])).rows[0].n,9);
 assert.deepEqual(Buffer.from((await raw.readObject({blobKey:keys[8]})).bytes),bytes);
 // Production layering matters: the inner metering adapter may throw AFTER Blob
 // success when its own usage commit fails. The outer retention receipt is unknown.
 const failingMetering={async connect(){const client=await metering.connect();let success=false;return {async query(sql,args){if(typeof sql==='string'&&sql.startsWith('INSERT INTO usage_meter_events')&&args?.[2]==='storage.write.receipts.succeeded')success=true;if(sql==='COMMIT'&&success){await client.query('ROLLBACK');throw Error('INDEPENDENT_USAGE_COMMIT_FAILURE');}return client.query(sql,args);},release(){client.release();}};}};
 const failingUsage=createSourceUsageMeteringStore(failingMetering);
 const uncertain=createRetentionTrackedStorage(domain,createAzureBlobStorage({...settings,onUsage:failingUsage.storage}),{receiptPool:metering});
 await assert.rejects(uncertain.putObject({blobKey:keys[9],bytes,contentType:'application/octet-stream'}),/INDEPENDENT_USAGE_COMMIT_FAILURE/);
 assert.deepEqual(Buffer.from((await raw.readObject({blobKey:keys[9]})).bytes),bytes);
 assert.equal((await owner.query('SELECT state FROM retention_blob_write_receipts WHERE organization_id=$1 AND blob_key=$2',[org,keys[9]])).rows[0].state,'STARTED','Outer retention layer falsely classified successful Blob bytes as failed after inner metering commit failure');
 assert.equal((await resources.reconcileDue(tenant)).reconciled,1);
 assert.equal(domain.waitingCount,0);assert.equal(metering.waitingCount,0);
 console.log('Independent metered retention passed: 8 concurrent writes with domain/meter pools capped at2; physical bytes and both usage/retention receipts survive domain rollback; orphan reconciles without invented deletion policy; private usage metadata. Actual restricted PostgreSQL and private Azurite.');
}finally{
 for(const blobKey of keys)await raw.deleteObject({blobKey});
 for(const table of ['retention_blob_resources','retention_blob_write_receipts','usage_meter_events','audit_events'])await owner.query('DELETE FROM '+table+' WHERE organization_id=$1',[org]);await Promise.all([domain.end(),metering.end(),owner.end()]);
}
