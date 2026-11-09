import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresJobStore} from '../packages/db/dist/index.js';
import {createOperationalQueueSampler} from '../apps/worker/dist/operational-sampler.js';
const url=process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const target=new URL(url);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54329')throw Error('QUEUE_TELEMETRY_TEST_REQUIRES_DISPOSABLE_LOCAL_DATABASE');
const admin=new Pool({connectionString:url}),observer=new Pool({connectionString:url,max:1});
const jobs=[],store=createPostgresJobStore(admin),signals=[];
try{
  for(let i=0;i<2;i++){
    const suffix=randomUUID(),jobId=`telemetry-${suffix}`;
    await store.enqueue({jobId,jobType:'asset.process',attempt:1,maxAttempts:2,tenant:{organizationId:`telemetry-org-${suffix}`,correlationId:`private-correlation-${suffix}`},idempotency:{key:jobId,requestHash:jobId},payload:{}});jobs.push(jobId);
  }
  await observer.query('SET ROLE medical_device_outbox_publisher');
  const identity=(await observer.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(identity.rolsuper,false);assert.equal(identity.rolbypassrls,false);
  assert.equal((await observer.query('SELECT job_id FROM processing_job_outbox WHERE job_id=ANY($1::text[])',[jobs])).rowCount,2,'designated non-owner outbox routing role must see both organizations');
  await assert.rejects(()=>observer.query('SELECT * FROM credentials'),/permission denied/);
  await createOperationalQueueSampler({outboxPool:observer,applicationPool:observer,receiver:{async peekMessages(){return [];}},secret:'queue-telemetry-secret-at-least-32bytes',sink:line=>signals.push(JSON.parse(line))})();
  assert.ok(signals.find(event=>event.event==='queue_snapshot').outboxPendingSampled>=2);assert.ok(!JSON.stringify(signals).includes('telemetry-org'));
  console.log('Queue telemetry PostgreSQL passed: actual non-super/non-bypass outbox role observes cross-organization routing aggregates while credential reads remain denied.');
}finally{
  await admin.query('DELETE FROM processing_job_outbox WHERE job_id=ANY($1::text[])',[jobs]);await admin.query('DELETE FROM processing_jobs WHERE job_id=ANY($1::text[])',[jobs]);
  await Promise.all([observer.end(),admin.end()]);
}
