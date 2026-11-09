import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {withTenantTransaction} from '../packages/db/dist/index.js';

const owner=new Pool({connectionString:process.env.DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const runtime=new Pool({connectionString:process.env.DATABASE_RUNTIME_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const id='independent:'+randomUUID(),tenant={organizationId:id,actorId:'independent',correlationId:'runtime-boundaries'};
const privateTables=['personal_accounts','personal_account_events','external_identities','email_verification_challenges','email_verification_assurances','email_verification_delivery_limits','operational_rate_buckets','operational_reservations','operational_control','discovery_profiles','discovery_inquiries','discovery_limits','lifecycle_notification_preferences'];
const immutableTables=['audit_events','credential_events','progress_events','course_review_decisions','ai_runs','release_manifests','release_model_bindings','lifecycle_tombstones'];
try{
 const role=(await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
 for(const table of privateTables){
  const present=(await owner.query('SELECT to_regclass($1) IS NOT NULL present',['public.'+table])).rows[0].present;assert(present,table+' missing');
  await assert.rejects(runtime.query('SELECT * FROM public.'+table+' LIMIT 1'),/permission denied/,table+' leaked to runtime');
 }
 for(const table of immutableTables){
  const triggers=(await owner.query("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND c.relname=$1 AND t.tgname='immutable_evidence' AND t.tgenabled='O' AND p.proname='protect_immutable_evidence'",[table])).rowCount;assert.equal(triggers,1,table+' immutable trigger missing');
 }
 await owner.query("INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,details,created_at) VALUES($1,$2,'independent','INDEPENDENT_BOUNDARY_TEST','{}',now())",[id,id]);
 assert.equal((await withTenantTransaction(runtime,tenant,client=>client.query('SELECT audit_event_id FROM audit_events WHERE audit_event_id=$1 FOR UPDATE',[id]))).rowCount,1,'Evidence row locking broke');
 for(const sql of ['UPDATE audit_events SET details=\'{"tampered":true}\' WHERE audit_event_id=$1','DELETE FROM audit_events WHERE audit_event_id=$1'])await assert.rejects(withTenantTransaction(runtime,tenant,client=>client.query(sql,[id])),/IMMUTABLE_EVIDENCE/);
 assert.equal((await withTenantTransaction(runtime,{...tenant,organizationId:id+':foreign'},client=>client.query('SELECT audit_event_id FROM audit_events WHERE audit_event_id=$1',[id]))).rowCount,0,'Forced RLS leaked immutable evidence');
 assert.deepEqual((await owner.query('SELECT details FROM audit_events WHERE audit_event_id=$1',[id])).rows[0].details,{});
 console.log(`Independent runtime boundaries passed: ${privateTables.length} private tables deny runtime SELECT, ${immutableTables.length} immutable triggers installed; actual audit row lock succeeds, UPDATE/DELETE denied, foreign tenant hidden.`);
}finally{
 await owner.query('DELETE FROM audit_events WHERE audit_event_id=$1',[id]);await runtime.end();await owner.end();
}
