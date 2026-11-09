import type { Pool } from 'pg';

/** Shared deployment/test grant matrix; forced tenant RLS is never bypassed. */
export const runtimeDomainTables = Object.freeze([
  'processing_jobs', 'processing_job_outbox', 'processing_job_audit', 'role_assignments',
  'products', 'product_versions', 'assets', 'asset_versions', 'upload_sessions',
  'asset_rights_attestations', 'openmontage_scene_briefs', 'openmontage_render_artifacts', 'knowledge_chunks', 'model_versions', 'model_components',
  'simulation_definitions', 'simulation_sessions', 'simulation_actions', 'courses',
  'course_versions', 'course_review_decisions', 'release_manifests', 'release_model_bindings', 'modules', 'activities', 'assessments', 'certification_policies',
  'enrollments', 'simulation_attempts', 'progress_events', 'assessment_attempts', 'assessment_sessions', 'credentials', 'credential_events',
  'notifications', 'email_deliveries', 'usage_meter_events', 'outbox_events', 'audit_events', 'ai_runs'
]);

export async function grantRuntimeDomainTables(pool: Pool, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('RUNTIME_ROLE_INVALID');
  const identity = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1', [role]);
  if (!identity.rows[0] || identity.rows[0].rolsuper || identity.rows[0].rolbypassrls) throw new Error('RUNTIME_ROLE_UNSAFE');
  // Table names are fixed; role is validated and quoted. Account/control tables are intentionally excluded.
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${runtimeDomainTables.map(table => `public.${table}`).join(', ')} TO "${role}"`);
  if((await pool.query("SELECT to_regclass('public.knowledge_embeddings') IS NOT NULL AS present")).rows[0]?.present)await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.knowledge_embeddings TO "${role}"`);
  for(const [table,privileges]of [
    ['credential_verifications','SELECT,INSERT,UPDATE,DELETE'],['public_verification_limits','SELECT,INSERT,UPDATE,DELETE'],
    ['course_story_positions','SELECT,INSERT,UPDATE'],['course_story_choices','SELECT,INSERT'],
    ['lifecycle_tombstones','SELECT,INSERT'],['lifecycle_holds','SELECT,INSERT,UPDATE'],
    ['customer_webhook_subscriptions','SELECT,INSERT,UPDATE,DELETE'],['customer_webhook_deliveries','SELECT,INSERT,UPDATE,DELETE'],
    ['protected_exports','SELECT,INSERT,UPDATE'],['retention_schedules','SELECT,INSERT,UPDATE'],
    ['retention_blob_resources','SELECT,INSERT,UPDATE'],['retention_blob_write_receipts','SELECT,INSERT,UPDATE'],
    ['retention_resource_policies','SELECT,INSERT'],['machine_integrations','SELECT,INSERT,UPDATE'],['machine_integration_references','SELECT,INSERT,UPDATE']
  ] as const){
    if((await pool.query('SELECT to_regclass($1) IS NOT NULL AS present',['public.'+table])).rows[0]?.present)await pool.query(`GRANT ${privileges} ON public.${table} TO "${role}"`);
  }
  // Old local default privileges may have granted new control tables to the runtime.
  // Reconcile that drift using a fixed denylist; these tables are function-only.
  const privateTables = ['personal_accounts','personal_account_events','external_identities',
    'email_verification_challenges','email_verification_assurances','email_verification_delivery_limits',
    'operational_rate_buckets','operational_reservations','operational_control',
    'discovery_profiles','discovery_inquiries','discovery_limits','lifecycle_notification_preferences'];
  for (const table of privateTables) {
    const exists = await pool.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
    if (exists.rows[0].present) await pool.query(`REVOKE ALL ON TABLE public.${table} FROM "${role}"`);
  }
  // Organization mutations are authorized by the reviewed SECURITY DEFINER functions.
  // Revoke grants left by old default privileges without removing required reads.
  await pool.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.organizations, public.organization_memberships, public.organization_invitations FROM "${role}"`);
  await pool.query(`GRANT SELECT ON public.organizations, public.organization_memberships, public.organization_invitations TO "${role}"`);
}

/** Atomically restore the publisher's routing-only table privileges after grant drift. */
export async function reconcileOutboxTablePermissions(pool: Pool, role: string): Promise<void> {
  if (role !== 'medical_device_outbox_publisher') throw Error('OUTBOX_ROLE_INVALID');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const identity = await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1', [role]);
    if (!identity.rows[0] || identity.rows[0].rolsuper || identity.rows[0].rolbypassrls) throw Error('OUTBOX_ROLE_UNSAFE');
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}"`);
    await client.query(`GRANT SELECT,UPDATE ON public.processing_job_outbox TO "${role}"`);
    await client.query(`GRANT SELECT(operation_id,organization_id) ON public.email_delivery_attempts TO "${role}"`);
    await client.query(`GRANT SELECT(outbox_event_id,organization_id,event_type,state,available_at) ON public.outbox_events TO "${role}"`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
