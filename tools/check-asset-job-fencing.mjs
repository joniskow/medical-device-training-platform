import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresJobStore,createPostgresAssetLifecycleStore} from '../packages/db/dist/index.js';
import {processAssetJob} from '../apps/worker/dist/job-runner.js';

const adminUrl=process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const runtimeUrl=process.env.DATABASE_RUNTIME_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device';
for(const value of [adminUrl,runtimeUrl]){const url=new URL(value);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='54329'||url.pathname!=='/medical_device')throw Error('ASSET_FENCING_TEST_REQUIRES_DISPOSABLE_LOCAL_DATABASE');}
const admin=new Pool({connectionString:adminUrl}),runtime=new Pool({connectionString:runtimeUrl,max:3});
const prefix='asset-fence:'+randomUUID(),tenant={organizationId:prefix,actorId:'fixture',correlationId:prefix},jobs=createPostgresJobStore(runtime),lifecycle=createPostgresAssetLifecycleStore(runtime),failures=[];
const outcome=(status='REVIEW_REQUIRED')=>({adapter:'fencing-fixture',adapterVersion:'1',outputArtifactIds:[],status,warnings:[],metrics:{},...(status==='FAILED'?{failure:{class:'VALIDATION',code:'CONTROLLED_INVALID_SOURCE',message:'Controlled invalid source'}}:{})});
async function seed(label){
 const assetId=prefix+':'+label,version=assetId+':v',jobId=assetId+':job';
 await admin.query("INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'pdf','ACTIVE','fixture','fixture',now(),now())",[assetId,prefix]);
 await admin.query("INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'pdf',$4,'fixture.pdf','application/pdf',10,repeat('a',64),'READY_FOR_SCAN','fixture',now(),now())",[version,assetId,prefix,prefix+'/'+label+'.pdf']);
 const payload={inputAssetVersionId:version,sourceType:'pdf',blobKey:prefix+'/'+label+'.pdf',sha256:'a'.repeat(64),sizeBytes:10};
 await jobs.enqueue({jobId,jobType:'asset.process',attempt:1,maxAttempts:4,idempotency:{key:jobId,requestHash:payload.sha256},tenant,payload});
 return {version,jobId,payload,now:Date.now()+1000};
}
async function assetState(version){return (await admin.query('SELECT state FROM asset_versions WHERE asset_version_id=$1',[version])).rows[0].state;}
async function check(label,action){try{await action();console.log('PASS asset fencing: '+label);}catch(error){failures.push({label,error});console.error('FAIL asset fencing: '+label+': '+error.message);}}
async function stale(label,stage){
 const fixture=await seed(label);let release,entered,timer;
 const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>entered=resolve);
 const pause=async()=>{entered();await gate;};let quarantineCalls=0;
 const storage={verifyChecksum:async()=>true,quarantine:async()=>{quarantineCalls++;}};
 const processor={inspect:async()=>({supported:true,reasons:[]}),process:async()=>{if(stage==='success'||stage==='failure'){await pause();return outcome(stage==='failure'?'FAILED':'REVIEW_REQUIRED');}return outcome();}};
 let scanner;
 if(stage==='quarantine')scanner={scan:async()=>{await pause();return {status:'QUARANTINE',reasons:['CONTROLLED_SCAN_REJECTION']};}};
 if(stage==='unsupported')processor.inspect=async()=>{await pause();return {supported:false,reasons:['CONTROLLED_UNSUPPORTED']};};
 const old=processAssetJob({tenant,jobId:fixture.jobId,workerId:'old-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage,processor,scanner});
 try{
  await Promise.race([begun,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('OLD_PROCESSOR_DID_NOT_REACH_BARRIER')),3000);})]);clearTimeout(timer);
  const recovered=await jobs.claim(tenant,fixture.jobId,'current-worker',new Date(fixture.now+301000).toISOString(),300);assert.ok(recovered,'Expired lease must be reclaimed for the repro');
  const before=await assetState(fixture.version);assert.equal(before,'PROCESSING');
  release();const oldResult=await old;
  assert.equal(oldResult,null,'Superseded worker cannot finalize the job');
  assert.equal(await assetState(fixture.version),before,'Superseded worker cannot change current asset lifecycle');
  assert.equal(quarantineCalls,0,'Superseded worker cannot quarantine the current source');
  const current=await jobs.get(tenant,fixture.jobId);assert.equal(current.state,'RUNNING');assert.equal(current.leaseGeneration,recovered.leaseGeneration);assert.equal(current.leaseOwner,'current-worker');
  // The surviving generation can still fail without a stale review state blocking it.
  await lifecycle.transition({tenant,assetVersionId:fixture.version,state:'PROCESSING_FAILED'});
  await jobs.fail(tenant,fixture.jobId,'current-worker',recovered.leaseGeneration,{class:'VALIDATION',code:'CURRENT_SOURCE_INVALID',message:'Controlled current failure'},new Date(fixture.now+302000).toISOString());
  assert.equal(await assetState(fixture.version),'PROCESSING_FAILED');assert.equal((await jobs.get(tenant,fixture.jobId)).state,'FAILED');
 }finally{clearTimeout(timer);release();await old.catch(()=>{});}
}
const ddlSuffix=randomUUID().replaceAll('-',''),trigger='asset_fence_fixture_'+ddlSuffix;let triggerCreated=false,jobTriggerCreated=false;
try{
 const identity=(await runtime.query('SELECT r.rolsuper,r.rolbypassrls,c.relowner=current_user::regrole AS owns FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid=\'public.asset_versions\'::regclass')).rows[0];
 assert.deepEqual(identity,{rolsuper:false,rolbypassrls:false,owns:false},'Regression must run through restricted non-owner runtime credentials');
 assert.equal((await runtime.query('SELECT * FROM asset_versions WHERE organization_id=$1',[prefix])).rowCount,0);
 for(const expected of ['SUCCEEDED','FAILED','QUARANTINED'])await check('current-owner-'+expected.toLowerCase(),async()=>{
  const fixture=await seed('current-'+expected.toLowerCase());let quarantined=0;
  const result=await processAssetJob({tenant,jobId:fixture.jobId,workerId:'current-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true,quarantine:async()=>{quarantined++;}},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome(expected==='FAILED'?'FAILED':'REVIEW_REQUIRED')},...(expected==='QUARANTINED'?{scanner:{scan:async()=>({status:'QUARANTINE',reasons:['CONTROLLED_SCAN_REJECTION']})}}:{})});
  assert.equal(result.state,expected==='SUCCEEDED'?'SUCCEEDED':'FAILED');
  assert.equal(await assetState(fixture.version),expected==='SUCCEEDED'?'READY_FOR_REVIEW':expected==='FAILED'?'PROCESSING_FAILED':'QUARANTINED');
  assert.equal(quarantined,expected==='QUARANTINED'?1:0);
 });
 for(const [label,stage] of [['stale-success','success'],['stale-failure','failure'],['stale-quarantine','quarantine'],['stale-unsupported','unsupported']])await check(label,()=>stale(label,stage));
 await check('scanner-outage-then-successful-retry',async()=>{
  const fixture=await seed('scanner-retry');let scans=0;
  const common={tenant,jobId:fixture.jobId,jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}};
  const failed=await processAssetJob({...common,workerId:'scan-failed-worker',now:new Date(fixture.now).toISOString(),scanner:{scan:async()=>{scans++;throw Error('CONTROLLED_SCANNER_OUTAGE');}}});
  assert.equal(failed.state,'RETRY_SCHEDULED');assert.equal(failed.lastFailure.code,'ASSET_SCAN_FAILED');assert.equal(await assetState(fixture.version),'SCAN_FAILED');
  const retried=await processAssetJob({...common,workerId:'scan-retry-worker',now:new Date(fixture.now+31000).toISOString(),scanner:{scan:async()=>{scans++;return {status:'CLEAN',reasons:[]};}}});
  assert.equal(scans,2);assert.equal(retried?.state,'SUCCEEDED');assert.equal(await assetState(fixture.version),'READY_FOR_REVIEW');
 });
 await check('quarantine-provider-failure-is-retryable',async()=>{
  const fixture=await seed('quarantine-fails');let calls=0;
  const result=await processAssetJob({tenant,jobId:fixture.jobId,workerId:'quarantine-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>false,quarantine:async()=>{calls++;throw Error('CONTROLLED_QUARANTINE_UNAVAILABLE');}},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}});
  assert.equal(calls,1);assert.equal(result.state,'RETRY_SCHEDULED');assert.equal(result.lastFailure.code,'QUARANTINE_FAILED');
  assert.equal(await assetState(fixture.version),'PROCESSING','Rejected quarantine must roll back QUARANTINED state');
  const retry=await processAssetJob({tenant,jobId:fixture.jobId,workerId:'retry-worker',now:new Date(fixture.now+31000).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}});
  assert.equal(retry.state,'SUCCEEDED');assert.equal(await assetState(fixture.version),'READY_FOR_REVIEW');
 });
 await check('stale-before-start-transition',async()=>{
  const fixture=await seed('stale-start');let release,entered,timer,storageReads=0;
  const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>entered=resolve);
  const delayedLifecycle={async transition(input){entered();await gate;return lifecycle.transition(input);}};
  const old=processAssetJob({tenant,jobId:fixture.jobId,workerId:'old-start-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:delayedLifecycle,storage:{verifyChecksum:async()=>{storageReads++;return true;}},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}});
  try{
   await Promise.race([begun,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('START_DID_NOT_REACH_BARRIER')),3000);})]);clearTimeout(timer);
   const recovered=await jobs.claim(tenant,fixture.jobId,'new-start-worker',new Date(fixture.now+301000).toISOString(),300);assert.ok(recovered);
   release();assert.equal(await old,null);assert.equal(storageReads,0);assert.equal(await assetState(fixture.version),'READY_FOR_SCAN');
   assert.equal((await jobs.get(tenant,fixture.jobId)).leaseGeneration,recovered.leaseGeneration);
  }finally{clearTimeout(timer);release();await old.catch(()=>{});}
 });
 await check('asset-job-binding-mismatch-rolls-back',async()=>{
  const fixture=await seed('binding-job'),other=await seed('binding-other');
  const claimed=await jobs.claim(tenant,fixture.jobId,'binding-worker',new Date(fixture.now).toISOString(),300);assert.ok(claimed);
  await assert.rejects(()=>jobs.succeed(tenant,fixture.jobId,'binding-worker',claimed.leaseGeneration,outcome(),new Date(fixture.now).toISOString(),{assetTransition:{assetVersionId:other.version,state:'READY_FOR_REVIEW'}}),/ASSET_JOB_BINDING_INVALID/);
  assert.equal((await jobs.get(tenant,fixture.jobId)).state,'RUNNING');assert.equal(await assetState(fixture.version),'READY_FOR_SCAN');assert.equal(await assetState(other.version),'READY_FOR_SCAN');
 });
 await check('retired-source-cannot-finalize-success',async()=>{
  const fixture=await seed('source-retired');let release,entered,timer;
  const gate=new Promise(resolve=>release=resolve),begun=new Promise(resolve=>entered=resolve);
  const running=processAssetJob({tenant,jobId:fixture.jobId,workerId:'retired-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>{entered();await gate;return outcome();}}});
  try{
   await Promise.race([begun,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PROCESSOR_DID_NOT_REACH_BARRIER')),3000);})]);clearTimeout(timer);
   await admin.query("UPDATE asset_versions SET state='RETIRED' WHERE asset_version_id=$1",[fixture.version]);release();await running.catch(()=>{});
   assert.notEqual((await jobs.get(tenant,fixture.jobId)).state,'SUCCEEDED');assert.equal(await assetState(fixture.version),'RETIRED');
  }finally{clearTimeout(timer);release();await running.catch(()=>{});}
 });
 await check('atomic-finalization-rollback',async()=>{
  const fixture=await seed('atomic');
  // Real DB fault, scoped to this fixture. Never mock the persistence boundary.
  await admin.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${prefix}' AND NEW.state='READY_FOR_REVIEW' THEN RAISE EXCEPTION 'CONTROLLED_ASSET_FINALIZATION_REJECTED'; END IF;RETURN NEW;END $$`);
  await admin.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON asset_versions FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`);triggerCreated=true;
  try{await processAssetJob({tenant,jobId:fixture.jobId,workerId:'atomic-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}});}catch{/* A rejected finalization may propagate or become a durable retry. */}
  assert.notEqual((await jobs.get(tenant,fixture.jobId)).state,'SUCCEEDED','Failed asset write must roll back job success');
  assert.notEqual(await assetState(fixture.version),'READY_FOR_REVIEW','Failed atomic finalization cannot leave review state');
 });
 await check('atomic-job-persistence-rollback',async()=>{
  await admin.query(`DROP TRIGGER ${trigger} ON asset_versions`);triggerCreated=false;
  const fixture=await seed('atomic-job');
  await admin.query(`CREATE OR REPLACE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${prefix}' AND NEW.state='SUCCEEDED' THEN RAISE EXCEPTION 'CONTROLLED_JOB_FINALIZATION_REJECTED'; END IF;RETURN NEW;END $$`);
  await admin.query(`CREATE TRIGGER ${trigger}_job BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`);jobTriggerCreated=true;
  try{await processAssetJob({tenant,jobId:fixture.jobId,workerId:'atomic-job-worker',now:new Date(fixture.now).toISOString(),jobStore:jobs,lifecycleStore:lifecycle,storage:{verifyChecksum:async()=>true},processor:{inspect:async()=>({supported:true,reasons:[]}),process:async()=>outcome()}});}catch{/* Persistence rejection may propagate or become a durable retry. */}
  assert.notEqual((await jobs.get(tenant,fixture.jobId)).state,'SUCCEEDED');
  assert.notEqual(await assetState(fixture.version),'READY_FOR_REVIEW','Rejected job write must not leave its asset in review');
 });
 if(failures.length)throw new AggregateError(failures.map(({error})=>error),`${failures.length} asset fencing regressions failed: ${failures.map(({label})=>label).join(', ')}`);
 console.log('Asset job fencing passed: restricted PostgreSQL runtime, superseded success/failure/scan/inspection, quarantine side effects and atomic finalization rollback.');
}finally{
 if(triggerCreated)await admin.query(`DROP TRIGGER IF EXISTS ${trigger} ON asset_versions`);
 if(jobTriggerCreated)await admin.query(`DROP TRIGGER IF EXISTS ${trigger}_job ON processing_jobs`);
 await admin.query(`DROP FUNCTION IF EXISTS public.${trigger}()`);
 for(const table of ['audit_events','processing_job_outbox','processing_jobs','asset_versions','assets'])await admin.query('DELETE FROM '+table+' WHERE organization_id=$1',[prefix]);
 await Promise.all([runtime.end(),admin.end()]);
}
