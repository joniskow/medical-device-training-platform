import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrateDatabase} from './migrate-database.mjs';

const adminUrl=process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const target=new URL(adminUrl);
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='54329'||target.pathname!=='/medical_device')throw Error('MIGRATION_TEST_REQUIRES_DISPOSABLE_LOCAL_DATABASE');
const admin=new Pool({connectionString:adminUrl,max:1});
const names=['medical_device_runtime','medical_device_outbox_publisher'];
const passwords=await admin.query('SELECT rolname,rolpassword FROM pg_authid WHERE rolname=ANY($1::text[])',[names]);
const snapshot=async()=>{
  const rows={};
  for(const table of ['credentials','release_manifests']){
    const exists=await admin.query('SELECT to_regclass($1) IS NOT NULL AS present',[`public.${table}`]);
    if(exists.rows[0].present)rows[table]=(await admin.query(`SELECT count(*)::integer AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS fingerprint FROM public.${table} t`)).rows[0];
  }
  return rows;
};
const before=await snapshot();
const password=`migration-test-$do$-${randomUUID()}`;
const runtime=new URL(adminUrl);runtime.username='medical_device_runtime';runtime.password=password;
const env={ADMIN_DATABASE_URL:adminUrl,DATABASE_URL:runtime.href,POSTGRES_RUNTIME_PASSWORD:password,POSTGRES_OUTBOX_PASSWORD:password,MIGRATION_CONFIRM_DATABASE:'medical_device'};
try {
  await admin.query('SELECT pg_advisory_lock(72839504)');
  let completed=false;
  const migration=migrateDatabase(env).then(()=>{completed=true;});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(completed,false,'migration must wait for the advisory serialization lock');
  await admin.query('SELECT pg_advisory_unlock(72839504)');
  await migration;
  await migrateDatabase(env);
  const after=await snapshot();
  for(const [table,evidence] of Object.entries(before))assert.deepEqual(after[table],evidence,'migration must preserve immutable evidence');
  const runtimePool=new Pool({connectionString:runtime.href});
  try{
    const result=await runtimePool.query(`SELECT has_function_privilege(current_user,'public.search_discovery(text,text,text,text,jsonb)','EXECUTE') AS allowed`);
    assert.equal(result.rows[0].allowed,true);
    await assert.rejects(()=>runtimePool.query('SELECT * FROM operational_reservations'),/permission denied/);
  }finally{await runtimePool.end();}
  console.log('Migration PostgreSQL passed: serialized actual bootstrap, repeatable migration/grants, dollar-quote password safety, restricted runtime and unchanged credential/release evidence.');
}finally{
  await admin.query('SELECT pg_advisory_unlock_all()').catch(()=>{});
  // Restore pre-existing role hashes in memory only; never print credential material.
  for(const row of passwords.rows){
    const quoted=(await admin.query('SELECT quote_literal($1) AS value',[row.rolpassword])).rows[0].value;
    await admin.query(`ALTER ROLE ${row.rolname} PASSWORD ${quoted??'NULL'}`);
  }
  await admin.end();
}
