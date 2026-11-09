import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyProcessingJobMigration,LIFECYCLE_ROUTING_OWNER } from "../packages/db/dist/index.js";

const adminPool = new Pool({ connectionString: "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const runtimePool = new Pool({ connectionString: "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device" });
const tenantTables = [
  "role_assignments", "products", "product_versions", "assets", "asset_versions", "upload_sessions",
  "asset_rights_attestations", "openmontage_scene_briefs", "openmontage_render_artifacts", "knowledge_chunks", "model_versions", "model_components",
  "simulation_definitions", "simulation_sessions", "simulation_actions", "courses", "course_versions",
  "course_review_decisions", "release_manifests", "release_model_bindings", "modules", "activities", "assessments", "certification_policies", "enrollments", "simulation_attempts", "progress_events",
  "assessment_attempts", "credentials", "credential_events", "notifications", "email_deliveries",
  "usage_meter_events", "outbox_events", "audit_events", "ai_runs", "customer_webhook_deliveries", "protected_exports", "retention_schedules", "retention_blob_resources", "retention_blob_write_receipts", "retention_resource_policies"
];
const id = `rls_${randomUUID()}`;
const orgA = `${id}_a`;
const orgB = `${id}_b`;

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE products TO local_runtime");
  const policies = await adminPool.query(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY($1::text[])`, [tenantTables]);
  const definitions=(await adminPool.query(`SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])`,[tenantTables])).rows;
  const tenantExpression="(organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))";
  const dispatcherEvents=['course.change.notify','course.change.assign','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired','organization.invitation.deliver','lifecycle.notification.deliver'];
  const dispatcherExpression="(event_type = ANY (ARRAY["+dispatcherEvents.map(event=>`'${event}'::text`).join(', ')+"]))";
  assert.equal(policies.rows.length, tenantTables.length);
  for (const row of policies.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} RLS disabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS disabled`);
    const tablePolicies=definitions.filter(policy=>policy.tablename===row.relname);
    const isolation=tablePolicies.find(policy=>policy.policyname==='tenant_isolation');
    assert.ok(isolation,`${row.relname} named tenant policy missing`);
    assert.equal(isolation.permissive,'PERMISSIVE');assert.equal(isolation.cmd,'ALL');assert.deepEqual(isolation.roles,['public']);
    assert.equal(isolation.qual,tenantExpression,`${row.relname} tenant read boundary changed`);
    assert.equal(isolation.with_check,tenantExpression,`${row.relname} tenant write boundary changed`);
    for(const extra of tablePolicies.filter(policy=>policy!==isolation)){
      assert.equal(extra.permissive,'PERMISSIVE');
      if(extra.policyname==='lifecycle_router_metadata_read'){
        assert.ok(['outbox_events','customer_webhook_deliveries','protected_exports','retention_schedules','retention_blob_resources','retention_blob_write_receipts'].includes(row.relname),'Unexpected routing table');assert.equal(extra.cmd,'SELECT');assert.deepEqual(extra.roles,[LIFECYCLE_ROUTING_OWNER]);assert.equal(extra.qual,'true');assert.equal(extra.with_check,null);
      }else if(extra.policyname==='lifecycle_router_check_update'){
        assert.equal(row.relname,'retention_blob_resources');assert.equal(extra.cmd,'UPDATE');assert.deepEqual(extra.roles,[LIFECYCLE_ROUTING_OWNER]);assert.equal(extra.qual,'true');assert.equal(extra.with_check,'true');
      }else{
        assert.equal(row.relname,'outbox_events','Unexpected additional policy');assert.equal(extra.policyname,'notice_dispatcher_read');assert.equal(extra.cmd,'SELECT');assert.deepEqual(extra.roles,['medical_device_outbox_publisher']);assert.equal(extra.with_check,null);assert.equal(extra.qual,dispatcherExpression,'Dispatcher event allowlist changed');
      }
    }
  }
  const routingOwner=(await adminPool.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname=$1',[LIFECYCLE_ROUTING_OWNER])).rows[0];assert.ok(routingOwner);assert.ok(Object.values(routingOwner).every(value=>value===false),'Maintenance owner must be a non-login, non-superuser role without bypass/admin capabilities');
  for(const name of ['local_runtime','medical_device_runtime','medical_device_outbox_publisher'])if((await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount)assert.equal((await adminPool.query("SELECT pg_has_role($1,$2,'MEMBER') AS member",[name,LIFECYCLE_ROUTING_OWNER])).rows[0].member,false,`${name} inherits maintenance access`);
  const routerPolicies=(await adminPool.query("SELECT tablename,policyname,roles::text[] AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'lifecycle_router_%' ORDER BY tablename,policyname")).rows;
  const routerReadTables=['customer_webhook_deliveries','protected_exports','outbox_events','retention_schedules','retention_blob_resources','retention_blob_write_receipts','organization_memberships'].sort();assert.deepEqual(routerPolicies.filter(p=>p.policyname==='lifecycle_router_metadata_read').map(p=>p.tablename).sort(),routerReadTables);assert.equal(routerPolicies.length,8);
  for(const policy of routerPolicies){assert.deepEqual(policy.roles,[LIFECYCLE_ROUTING_OWNER]);assert.equal(policy.qual,'true');assert.equal(policy.cmd,policy.policyname==='lifecycle_router_check_update'?'UPDATE':'SELECT');assert.equal(policy.with_check,policy.cmd==='UPDATE'?'true':null);}
  assert.equal((await adminPool.query("SELECT has_table_privilege($1,'public.retention_blob_resources','UPDATE') AS allowed",[LIFECYCLE_ROUTING_OWNER])).rows[0].allowed,false,'Maintenance owner has broad update ACL');
  const updateColumns=(await adminPool.query("SELECT a.attname FROM pg_attribute a WHERE a.attrelid='public.retention_blob_resources'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege($1,a.attrelid,a.attnum,'UPDATE') ORDER BY a.attname",[LIFECYCLE_ROUTING_OWNER])).rows.map(r=>r.attname);assert.deepEqual(updateColumns,['last_retention_check']);
  for(const table of routerReadTables)assert.equal((await adminPool.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[LIFECYCLE_ROUTING_OWNER,'public.'+table])).rows[0].allowed,true);
  const role=(await adminPool.query("SELECT rolsuper,rolbypassrls,pg_has_role(rolname,'medical_device_outbox_publisher','MEMBER') AS dispatcher FROM pg_roles WHERE rolname='local_runtime'")).rows[0];
  assert.ok(role);assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.dispatcher,false,'Runtime inherited dispatcher access');
  // A dispatcher-visible event in a foreign tenant must remain hidden from runtime.
  await adminPool.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'credential.issued',$1,'{}','PENDING',now(),now(),now())`,[id+'_outbox',orgA]);
  const runtimeScope=await runtimePool.connect();
  try{
    await runtimeScope.query('BEGIN');
    assert.equal((await runtimeScope.query('SELECT outbox_event_id FROM outbox_events WHERE outbox_event_id=$1',[id+'_outbox'])).rows.length,0,'Missing context exposed dispatcher event');
    await runtimeScope.query("SELECT set_config('app.organization_id',$1,true)",[orgB]);
    assert.equal((await runtimeScope.query('SELECT outbox_event_id FROM outbox_events WHERE outbox_event_id=$1',[id+'_outbox'])).rows.length,0,'Foreign tenant exposed dispatcher event');
    await runtimeScope.query("SELECT set_config('app.organization_id',$1,true)",[orgA]);
    assert.equal((await runtimeScope.query('SELECT outbox_event_id FROM outbox_events WHERE outbox_event_id=$1',[id+'_outbox'])).rows.length,1,'Own tenant event missing');
    await runtimeScope.query('ROLLBACK');
  }finally{runtimeScope.release();}

  const a = await runtimePool.connect();
  try {
    await a.query("BEGIN");
    await a.query("SELECT set_config('app.organization_id', $1, true)", [orgA]);
    await a.query(
      `INSERT INTO products (product_id, organization_id, name, status, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, 'A', 'ACTIVE', 'tester', 'tester', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [`${id}_product_a`, orgA]
    );
    await a.query("COMMIT");
  } catch (error) {
    await a.query("ROLLBACK");
    throw error;
  } finally {
    a.release();
  }
  const hidden = await runtimePool.query("SELECT product_id FROM products");
  assert.equal(hidden.rows.length, 0, "missing tenant context exposed rows");
  const scoped = await runtimePool.connect();
  try {
    await scoped.query("BEGIN");
    await scoped.query("SELECT set_config('app.organization_id', $1, true)", [orgB]);
    const rows = await scoped.query("SELECT product_id FROM products");
    assert.equal(rows.rows.length, 0, "cross-tenant product was visible");
    await assert.rejects(
      scoped.query(
        `INSERT INTO products (product_id, organization_id, name, status, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, 'B', 'ACTIVE', 'tester', 'tester', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [`${id}_product_b`, orgA]
      ),
      /row-level security policy/
    );
    await scoped.query("ROLLBACK");
  } finally {
    scoped.release();
  }
  await adminPool.query("DELETE FROM products WHERE product_id LIKE $1", [`${id}%`]);
  console.log(`Tenant domain RLS passed: ${tenantTables.length} tenant tables have forced RLS and cross-tenant reads/writes are denied.`);
} finally {
  await adminPool.query('DELETE FROM outbox_events WHERE outbox_event_id=$1',[id+'_outbox']);
  await runtimePool.end();
  await adminPool.end();
}
