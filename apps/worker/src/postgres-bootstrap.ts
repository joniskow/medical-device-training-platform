import { Pool } from "pg";
import { applyProcessingJobMigration, seedActiveOrganizationMembership, grantRuntimeDomainTables, reconcileOutboxTablePermissions } from "@medical-device/db";

const runtimeRole = "medical_device_runtime";
const outboxPublisherRole = "medical_device_outbox_publisher";

export async function bootstrapPostgres(options: {
  adminDatabaseUrl: string;
  runtimeDatabaseUrl: string;
  runtimePassword: string;
  outboxPublisherPassword: string;
  pilotSubject?: string;
  pilotOrganizationId?: string;
  pilotRoles?: string[];
}): Promise<void> {
  const adminPool = new Pool({ connectionString: options.adminDatabaseUrl, max:1, connectionTimeoutMillis:5000, statement_timeout:60000, query_timeout:90000 });
  try {
    // Session lock is held by this single-connection pool until end(). All migration jobs,
    // including retries, serialize before touching schema or runtime grants.
    await adminPool.query('SELECT pg_advisory_lock(72839504)');
    await applyProcessingJobMigration(adminPool);
    const passwordLiteral = (await adminPool.query<{ value: string }>(
      "SELECT quote_literal($1) AS value",
      [options.runtimePassword]
    )).rows[0]?.value;
    if (!passwordLiteral) throw new Error("POSTGRES_RUNTIME_PASSWORD_QUOTE_FAILED");

    const runtimeExists=(await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[runtimeRole])).rowCount;
    await adminPool.query(`${runtimeExists?'ALTER':'CREATE'} ROLE ${runtimeRole} LOGIN PASSWORD ${passwordLiteral}`);
    await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO medical_device_runtime");
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
    await grantRuntimeDomainTables(adminPool, runtimeRole);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE ON course_story_positions TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT ON course_story_choices TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT ON TABLE organization_memberships TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.default_credential_sharing(text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.read_candidate_learning_access(text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.read_personal_wallet(text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.resolve_personal_credential(text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.enroll_course_candidate(text,uuid,integer,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.read_course_catalog(uuid,uuid) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.manage_course_offering(text,text,text,jsonb,integer,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT ON organizations TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.access_personal_account(text,text,text,text,text,integer,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.observe_account_verification(text,text,text,timestamptz) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.has_verified_account(text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.issue_email_verification(text,uuid,text,text), public.consume_email_verification(text,uuid,text), public.get_email_verification(text), public.invalidate_email_verification(text,uuid) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.revoke_email_verification(text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.operational_rate_take(text,integer,integer), public.operational_reserve(text,uuid,integer,integer), public.operational_settle(text,uuid,integer), public.operational_renew(text,uuid,integer) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT ON public.lifecycle_tombstones TO ${runtimeRole}`);
    await adminPool.query(`REVOKE UPDATE, DELETE ON public.lifecycle_tombstones FROM ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE ON public.lifecycle_holds TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.manage_discovery_profile(text,text,text,text,text,boolean,integer), public.search_discovery(text,text,text,text), public.create_discovery_inquiry(text,text,text,text,text), public.respond_discovery_inquiry(text,text,text,text), public.list_discovery_inquiries(text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.search_discovery(text,text,text,text,jsonb) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_webhook_subscriptions, public.customer_webhook_deliveries TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE ON public.protected_exports TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.set_lifecycle_notification_preference(text,text,timestamptz,boolean,integer),public.claim_lifecycle_notification_email(text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE ON public.retention_schedules TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT,INSERT,UPDATE ON public.retention_blob_resources TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT,INSERT,UPDATE ON public.retention_blob_write_receipts TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT,INSERT ON public.retention_resource_policies TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT,INSERT,UPDATE ON public.machine_integrations,public.machine_integration_references TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.authorize_machine_integration(uuid,text,text,uuid,uuid,timestamptz,text,text[]) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.sync_machine_integration_actor(uuid,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.administer_personal_account(text,text,text,integer,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.set_organization_status(text,integer,text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.update_organization_profile(text,text,text,integer,text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT ON email_delivery_attempts, email_delivery_reports, email_recipient_suppressions TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.record_invitation_email_attempt(text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.apply_email_delivery_report(text,text,text,text,timestamptz,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.release_email_suppression(text,integer,text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.reserve_invitation_email_capacity(text,integer,integer) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT ON organization_invitations TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.create_organization_invitation(text,text,text,text,text,text,text,integer,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.revoke_organization_invitation(text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text,text,text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.create_training_organization(text,text,text,text) TO ${runtimeRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.set_tenant_membership_status(text,text,text,timestamptz) TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE credential_verifications, public_verification_limits TO ${runtimeRole}`);
    if (options.pilotSubject && options.pilotOrganizationId) {
      await seedActiveOrganizationMembership(adminPool, {
        subject: options.pilotSubject,
        organizationId: options.pilotOrganizationId,
        roles: options.pilotRoles
      });
    }

    const outboxPasswordLiteral = (await adminPool.query<{ value: string }>(
      "SELECT quote_literal($1) AS value",
      [options.outboxPublisherPassword]
    )).rows[0]?.value;
    if (!outboxPasswordLiteral) throw new Error("POSTGRES_OUTBOX_PASSWORD_QUOTE_FAILED");

    const outboxExists=(await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[outboxPublisherRole])).rowCount;
    await adminPool.query(`${outboxExists?'ALTER':'CREATE'} ROLE ${outboxPublisherRole} LOGIN PASSWORD ${outboxPasswordLiteral}`);
    await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO medical_device_outbox_publisher");
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${outboxPublisherRole}`);
    await reconcileOutboxTablePermissions(adminPool, outboxPublisherRole);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.due_lifecycle_deliveries() TO ${outboxPublisherRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.due_retention_organizations() TO ${outboxPublisherRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.due_retention_resource_organizations() TO ${outboxPublisherRole}`);
    await adminPool.query(`GRANT EXECUTE ON FUNCTION public.advance_inquiry_lifecycle() TO ${outboxPublisherRole}`);
    await adminPool.query(`GRANT SELECT(operation_id,organization_id) ON email_delivery_attempts TO ${outboxPublisherRole}`);
    await adminPool.query(`DROP POLICY IF EXISTS email_report_routing_read ON email_delivery_attempts`);
    await adminPool.query(`CREATE POLICY email_report_routing_read ON email_delivery_attempts FOR SELECT TO ${outboxPublisherRole} USING(true)`);
    await adminPool.query(`GRANT SELECT, UPDATE ON processing_job_outbox TO ${outboxPublisherRole}`);
    // Control-plane discovery exposes only pending notice routing metadata, not recipient payloads.
    await adminPool.query(`GRANT SELECT(outbox_event_id,organization_id,event_type,state,available_at) ON outbox_events TO ${outboxPublisherRole}`);
    await adminPool.query(`DROP POLICY IF EXISTS notice_dispatcher_read ON outbox_events`);
    await adminPool.query(`CREATE POLICY notice_dispatcher_read ON outbox_events FOR SELECT TO ${outboxPublisherRole} USING(event_type IN ('course.change.notify','course.change.assign','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired','organization.invitation.deliver','lifecycle.notification.deliver'))`);
  } finally {
    await adminPool.end();
  }
}
