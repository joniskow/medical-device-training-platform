import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {lifecycleRoutingPolicyStatements} from '../packages/db/dist/maintenance-routing.js';

// Isolated copies only: no ownership or policies on application tables/functions are altered.
// Production definitions execute as a non-superuser function owner, matching managed PostgreSQL.
const admin=new Pool({connectionString:process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const suffix=randomUUID().replaceAll('-',''),schema='maintenance_'+suffix,owner='maintenance_owner_'+suffix,caller='maintenance_caller_'+suffix;
const tables=['customer_webhook_deliveries','outbox_events','protected_exports','retention_schedules','lifecycle_holds'];
let connection;
try{
 await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE ${caller} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
 await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`);
 for(const table of tables){
  await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL); ALTER TABLE ${schema}.${table} OWNER TO ${owner}; ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${schema}.${table} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON ${schema}.${table} USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''))`);
 }
 // The selector's invoker helper sets a tenant context to read domain holds.
 // Clone its actual definition too; an isolated selector must not use live-schema helpers.
 const helper=(await admin.query('SELECT pg_get_functiondef($1::regprocedure) definition',['public.retention_source_held(text,text)'])).rows[0].definition.replaceAll('public.',schema+'.');
 await admin.query(helper);
 await admin.query(`ALTER FUNCTION ${schema}.retention_source_held(text,text) OWNER TO ${owner}; REVOKE ALL ON FUNCTION ${schema}.retention_source_held(text,text) FROM PUBLIC; GRANT SELECT ON ${schema}.lifecycle_holds TO ${owner}`);
 for(const signature of ['retention_source_held(text,text)','due_lifecycle_deliveries()','due_retention_organizations()']){
  const definition=(await admin.query('SELECT pg_get_functiondef($1::regprocedure) definition',['public.'+signature])).rows[0].definition.replaceAll('public.',schema+'.');
  await admin.query(definition);await admin.query(`ALTER FUNCTION ${schema}.${signature} OWNER TO ${owner}; REVOKE ALL ON FUNCTION ${schema}.${signature} FROM PUBLIC`);
  if(!signature.startsWith('retention_source_held'))await admin.query(`GRANT EXECUTE ON FUNCTION ${schema}.${signature} TO ${caller}`);
 }
 await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${caller}`);
 const org='isolated-maintenance',id='isolated-export';
 await admin.query(`INSERT INTO ${schema}.protected_exports(export_id,organization_id,requester_id,request_key,state,blob_key,expires_at) VALUES($1,$2,'admin',$1,'PENDING',$2||'/export',now()+interval '1 hour')`,[id,org]);
 await admin.query(`INSERT INTO ${schema}.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'protected.export.create',$1,'{}','PENDING',now(),now(),now())`,[id,org]);
 await admin.query(`INSERT INTO ${schema}.retention_schedules(organization_id,asset_version_id,purge_after,reason,actor_id) VALUES($1,'source',now()-interval '1 hour','fixture','admin')`,[org]);
 connection=await admin.connect();await connection.query(`SET ROLE ${caller}`);
 const identity=(await connection.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(identity.rolsuper,false);assert.equal(identity.rolbypassrls,false);
 await assert.rejects(connection.query(`SELECT * FROM ${schema}.protected_exports`),/permission denied/,'Caller must not receive cross-tenant table reads');
 assert.equal((await connection.query(`SELECT * FROM ${schema}.due_lifecycle_deliveries()`)).rowCount,0,'Fixture must reproduce FORCE RLS without owner-only routing policies');
 assert.equal((await connection.query(`SELECT * FROM ${schema}.due_retention_organizations()`)).rowCount,0);
 // Apply the exact production policy factory, limited to this isolated table subset.
 for(const statement of lifecycleRoutingPolicyStatements(schema,owner))if(tables.some(table=>statement.includes(`"${schema}"."${table}"`)))await admin.query(statement);
 const deliveries=(await connection.query(`SELECT * FROM ${schema}.due_lifecycle_deliveries()`)).rows;
 const retention=(await connection.query(`SELECT * FROM ${schema}.due_retention_organizations()`)).rows;
 assert.equal(deliveries.length,1,'Non-superuser function owner cannot discover due delivery rows behind FORCE RLS');
 assert.equal(retention.length,1,'Non-superuser function owner cannot discover due retention rows behind FORCE RLS');
 await admin.query(`INSERT INTO ${schema}.lifecycle_holds(organization_id,asset_version_id,reason,actor_id) VALUES($1,'source','Independent legal hold','admin')`,[org]);
 assert.equal((await connection.query(`SELECT * FROM ${schema}.due_retention_organizations()`)).rowCount,0,'A source legal hold must remain visible to the routing function owner');
 await assert.rejects(connection.query(`SELECT * FROM ${schema}.protected_exports`),/permission denied/,'Owner-only policy must not grant caller cross-tenant table reads');
 for(const targetOrg of [org,'chosen-foreign-organization'])await assert.rejects(connection.query(`SELECT ${schema}.retention_source_held($1,'source')`,[targetOrg]),/permission denied/,'Caller must not probe source holds through the internal helper');
 assert.equal((await admin.query('SELECT pg_has_role($1,$2,\'MEMBER\') member',[caller,owner])).rows[0].member,false);
 console.log('Independent non-superuser maintenance owner passed: isolated actual selector definitions see eligible work while restricted caller cannot read tenant tables.');
}finally{
 if(connection){await connection.query('RESET ROLE');connection.release();}
 await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.query(`DROP ROLE IF EXISTS ${caller}; DROP ROLE IF EXISTS ${owner}`);await admin.end();
}
