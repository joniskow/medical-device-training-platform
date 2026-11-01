import assert from "node:assert/strict";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresOrganizationMembershipStore, seedActiveOrganizationMembership } from "../packages/db/dist/index.js";

const adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const subject = "membership-store-test-user";
const organizationA = "org_membership_a";
const organizationB = "org_membership_b";

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query("DELETE FROM organization_memberships WHERE subject = $1", [subject]);
  await adminPool.query(
    `INSERT INTO organization_memberships (membership_id, subject, organization_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', now(), now()), ($4, $2, $5, 'SUSPENDED', now(), now())`,
    ["membership:test:a", subject, organizationA, "membership:test:b", organizationB]
  );
  const store = createPostgresOrganizationMembershipStore(adminPool);
  assert.deepEqual(await store.resolveActiveOrganizations(subject), [organizationA]);
  assert.deepEqual(await store.resolveActiveOrganizations("unknown-user"), []);
  await seedActiveOrganizationMembership(adminPool, {
    subject,
    organizationId: organizationB,
    membershipId: "membership:test:b"
  });
  assert.deepEqual(await store.resolveActiveOrganizations(subject), [organizationA, organizationB]);
  await seedActiveOrganizationMembership(adminPool, {
    subject,
    organizationId: organizationB,
    membershipId: "membership:test:b"
  });
  const seededRows = await adminPool.query("SELECT count(*)::int AS count FROM organization_memberships WHERE subject = $1 AND organization_id = $2", [subject, organizationB]);
  assert.equal(seededRows.rows[0].count, 1);
  console.log("Organization membership store passed: active-membership resolution, suspended exclusion, and idempotent pilot seeding.");
} finally {
  await adminPool.query("DELETE FROM organization_memberships WHERE subject = $1", [subject]).catch(() => undefined);
  await adminPool.end();
}
