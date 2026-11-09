import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createAzureBlobStorage} from '../packages/storage/dist/index.js';
import {createSourceUsageMeteringStore,readSourceUsageRates} from '../packages/db/dist/source-usage-metering.js';
import {reconcileProviderBilledUsage} from '../packages/db/dist/billed-usage-reconciliation.js';

const adminUrl=process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const runtimeUrl=process.env.DATABASE_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device';
for(const url of [adminUrl,runtimeUrl]){const target=new URL(url);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54329')throw Error('SOURCE_USAGE_TEST_REQUIRES_DISPOSABLE_LOCAL_DATABASE');}
const admin=new Pool({connectionString:adminUrl}),runtime=new Pool({connectionString:runtimeUrl});
const organizationId=`usage-${randomUUID()}`,tenant={organizationId,actorId:'usage-test',correlationId:'usage-test'};
const rates=readSourceUsageRates(JSON.stringify([{rateId:'synthetic-test-rate',operation:'storage.read',provider:'azure-blob',unit:'bytes',microUsdPerMillionUnits:1000000}]));
const usage=createSourceUsageMeteringStore(runtime,{rates});
const raw=createAzureBlobStorage({connectionString:'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',containerName:'source-usage-test',allowHttp:true,onUsage:usage.storage}); // gitleaks:allow -- public Azurite emulator account key only
const blobKey=`${organizationId}/private-manual-do-not-log.txt`,bytes=Buffer.from('private source must never enter usage metadata');
try{
  await raw.ensureContainers();
  await raw.putObject({blobKey,bytes,contentType:'text/plain'});
  assert.equal(Buffer.from((await raw.readObject({blobKey})).bytes).toString(),bytes.toString());
  await raw.createDownloadUrl({blobKey,expiresInSeconds:60});
  const rows=(await admin.query('SELECT usage_event_id,meter_key,quantity::text,metadata FROM usage_meter_events WHERE organization_id=$1',[organizationId])).rows;
  assert.equal(Number(rows.find(row=>row.meter_key==='storage.read.succeeded.bytes').quantity),bytes.length);
  assert.equal(Number(rows.find(row=>row.meter_key==='storage.write.succeeded.bytes').quantity),bytes.length);
  assert.ok(rows.some(row=>row.meter_key==='storage.download_grant.receipts.succeeded'));
  assert.ok(!JSON.stringify(rows).includes('private-manual'));assert.ok(!JSON.stringify(rows).includes('private source'));
  assert.ok(!JSON.stringify(rows).includes('sig='));
  const sourceUsageEventId=rows.find(row=>row.meter_key==='storage.read.receipts.succeeded').usage_event_id;
  const billed={organizationId,sourceUsageEventId,invoiceLineId:'opaque-provider-invoice-line-test',microUsd:2000};
  await reconcileProviderBilledUsage(admin,billed);
  await reconcileProviderBilledUsage(admin,billed);
  await assert.rejects(()=>reconcileProviderBilledUsage(admin,{...billed,microUsd:2001}),/IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(()=>reconcileProviderBilledUsage(runtime,billed),/OPERATOR_REQUIRED/);
  await assert.rejects(()=>reconcileProviderBilledUsage(admin,{...billed,organizationId:'another-tenant'}),/SOURCE_REQUIRED/);
  const money=(await admin.query(`SELECT meter_key,sum(quantity)::text AS total FROM usage_meter_events WHERE organization_id=$1 AND meter_key LIKE 'cost.%' GROUP BY meter_key`,[organizationId])).rows;
  assert.equal(Number(money.find(row=>row.meter_key==='cost.usd.estimated').total),bytes.length/1000000);
  assert.equal(Number(money.find(row=>row.meter_key==='cost.usd.billed').total),0.002,'billed replay must not double count');
  const receipt={receiptId:randomUUID(),operation:'provider.speech',provider:'azure-speech',phase:'SUCCEEDED',metrics:{calls:1,input_characters:4}};
  await usage.record(tenant,receipt);await usage.record(tenant,{...receipt,metrics:{input_characters:4,calls:1}});
  await assert.rejects(()=>usage.record(tenant,{...receipt,metrics:{calls:1,input_characters:5}}),/IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(()=>usage.record(tenant,{...receipt,metrics:{calls:0.5}}),/RECEIPT_INVALID/);
  console.log('Source usage PostgreSQL/Azurite passed: durable physical bytes/calls, separate signed grants, no content/SAS metadata, versioned estimates, operator-only billed receipts, replay/conflict and tenant isolation.');
}finally{
  await raw.deleteObject({blobKey}).catch(()=>{});
  await admin.query('DELETE FROM audit_events WHERE organization_id=$1',[organizationId]);
  await admin.query('DELETE FROM usage_meter_events WHERE organization_id=$1',[organizationId]);
  await Promise.all([admin.end(),runtime.end()]);
}
