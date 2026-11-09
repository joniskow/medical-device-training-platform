import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createOperationsStore,OPERATIONS_MIGRATION_SQL} from '../packages/db/dist/operations-store.js';

const connectionString=process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const parsed=new URL(connectionString);
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.port!=='54329')throw Error('OPERATIONS_TEST_REQUIRES_DISPOSABLE_LOCAL_DATABASE');
const admin=new Pool({connectionString});
const run=`ops-test-${randomUUID()}`;
const store=createOperationsStore(admin);
try {
  await admin.query(OPERATIONS_MIGRATION_SQL);
  const rates=await Promise.all(Array.from({length:40},()=>store.takeRate(run,10)));
  assert.equal(rates.filter(Boolean).length,10);
  const concurrent=await Promise.all(Array.from({length:8},(_,i)=>store.reserve(`${run}-${i}`,1)));
  assert.equal(concurrent.filter(item=>item.status==='ACCEPTED').length,4);
  assert.equal(concurrent.filter(item=>item.status==='CAPACITY').length,4);
  for(let i=0;i<concurrent.length;i++)if(concurrent[i].status==='ACCEPTED'){
    assert.equal(await store.settle(`${run}-${i}`,randomUUID(),1),false,'stale owner must not settle');
    assert.equal(await store.renew(`${run}-${i}`,concurrent[i].token),true);
    assert.equal(await store.settle(`${run}-${i}`,concurrent[i].token,1),true);
    assert.equal((await store.reserve(`${run}-${i}`,1)).status,'COMPLETED','duplicate must not execute again');
  }
  const budget=await store.reserve(`${run}-budget`,40000);
  assert.equal(budget.status,'ACCEPTED_WARNING');
  assert.equal((await store.reserve(`${run}-over`,10000)).status,'BUDGET');
  await store.settle(`${run}-budget`,budget.token,40000);
  await admin.query('UPDATE operational_control SET paused=true WHERE singleton');
  assert.equal((await store.reserve(`${run}-paused`,1)).status,'PAUSED');
  await admin.query('UPDATE operational_control SET paused=false WHERE singleton');
  await admin.query('SET ROLE local_runtime');
  await assert.rejects(()=>admin.query('SELECT * FROM operational_reservations'),/permission denied/);
  await admin.query('RESET ROLE');
  console.log('Operations PostgreSQL passed: concurrent global admission, shared rate limits, cost ceilings, idempotency, fenced leases, pause and private ledger.');
}finally {
  await admin.query('RESET ROLE').catch(()=>{});
  await admin.query('UPDATE operational_control SET paused=false WHERE singleton');
  await admin.query('DELETE FROM operational_reservations WHERE reservation_key LIKE $1',[`${run}%`]);
  await admin.query('DELETE FROM operational_rate_buckets WHERE bucket_key=$1',[run]);
  await admin.end();
}
