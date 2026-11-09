import assert from 'node:assert/strict';
import {processAssetJob} from '../apps/worker/dist/job-runner.js';
import {toJobStatus} from '../apps/api/dist/job-status-service.js';
import {createInMemoryJobStore} from '../tests/doubles/deterministic-adapters.mjs';

const tenant={organizationId:'org_failure_privacy',actorId:'actor_failure_privacy',correlationId:'corr_failure_privacy'};
const marker='PRIVATE_TEST_SIGNATURE_NOT_A_REAL_SECRET';
const store=createInMemoryJobStore();
await store.enqueue({jobId:'job_failure_privacy',jobType:'asset.process',attempt:1,maxAttempts:3,idempotency:{key:'failure_privacy',requestHash:'test'},tenant,payload:{inputAssetVersionId:'asset_failure_privacy',sourceType:'pdf',blobKey:tenant.organizationId+'/source.pdf',sha256:'test'}});
const result=await processAssetJob({jobStore:store,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>{throw Error('GET https://private.invalid/blob?sig='+marker);}},tenant,jobId:'job_failure_privacy',workerId:'worker'});
assert.equal(result.lastFailure.code,'WORKER_PROCESSING_EXCEPTION');
assert.doesNotMatch(JSON.stringify(result.lastFailure),/PRIVATE_TEST_SIGNATURE|private\.invalid/,'raw provider exception must not be persisted');

// Older records must also be safe to return, without needing to rewrite history.
const failure={class:'RETRYABLE',code:'WORKER_PROCESSING_EXCEPTION',message:marker,retryAfterSeconds:30};
const historic={...result,lastFailure:failure,outcome:{adapter:'test',adapterVersion:'1',status:'FAILED',outputArtifactIds:[],warnings:[],metrics:{},failure}};
const projected=toJobStatus(historic);
assert.doesNotMatch(JSON.stringify(projected),new RegExp(marker),'both failure projections must redact historic exception text');
assert.equal(projected.lastFailure.code,'WORKER_PROCESSING_EXCEPTION');
assert.equal(projected.lastFailure.retryAfterSeconds,30);
assert.equal(historic.lastFailure.message,marker,'projection must not mutate stored evidence');
console.log('Job failure privacy passed: safe persisted exception, historic lastFailure/outcome projections, stable code/retry metadata and no record mutation.');
