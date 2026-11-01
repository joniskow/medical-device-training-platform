import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyProcessingJobMigration } from "../packages/db/dist/index.js";

const adminPool = new Pool({ connectionString: "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const runtimePool = new Pool({ connectionString: "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device" });
const tenantTables = [
  "role_assignments", "products", "product_versions", "assets", "asset_versions", "upload_sessions",
  "asset_rights_attestations", "knowledge_chunks", "model_versions", "model_components",
  "simulation_definitions", "simulation_sessions", "simulation_actions", "courses", "course_versions",
  "course_review_decisions", "release_manifests", "release_model_bindings", "modules", "activities", "assessments", "certification_policies", "enrollments", "simulation_attempts", "progress_events",
  "assessment_attempts", "credentials", "credential_events", "notifications", "email_deliveries",
  "usage_meter_events", "outbox_events", "audit_events", "ai_runs"
];
const id = `rls_${randomUUID()}`;
const orgA = `${id}_a`;
const orgB = `${id}_b`;

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE products TO local_runtime");
  const policies = await adminPool.query(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.polname)::int AS policy_count
    FROM pg_class c
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.relname = ANY($1::text[])
    GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`, [tenantTables]);
  assert.equal(policies.rows.length, tenantTables.length);
  for (const row of policies.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} RLS disabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS disabled`);
    assert.equal(row.policy_count, 1, `${row.relname} tenant policy missing`);
  }

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
  await runtimePool.end();
  await adminPool.end();
}
