import { Pool } from "pg";
import { applyProcessingJobMigration, seedActiveOrganizationMembership } from "@medical-device/db";

const runtimeRole = "medical_device_runtime";
const outboxPublisherRole = "medical_device_outbox_publisher";
const runtimeTables = [
  "processing_jobs", "processing_job_outbox", "processing_job_audit", "role_assignments",
  "products", "product_versions", "assets", "asset_versions", "upload_sessions",
  "asset_rights_attestations", "openmontage_scene_briefs", "openmontage_render_artifacts", "knowledge_chunks", "model_versions", "model_components",
  "simulation_definitions", "simulation_sessions", "simulation_actions", "courses",
  "course_versions", "course_review_decisions", "release_manifests", "release_model_bindings", "modules", "activities", "assessments", "certification_policies",
  "enrollments", "simulation_attempts", "progress_events", "assessment_attempts", "assessment_sessions", "credentials", "credential_events",
  "notifications", "email_deliveries", "usage_meter_events", "outbox_events", "audit_events", "ai_runs"
].join(", ");

export async function bootstrapPostgres(options: {
  adminDatabaseUrl: string;
  runtimeDatabaseUrl: string;
  runtimePassword: string;
  outboxPublisherPassword: string;
  pilotSubject?: string;
  pilotOrganizationId?: string;
  pilotRoles?: string[];
}): Promise<void> {
  const adminPool = new Pool({ connectionString: options.adminDatabaseUrl });
  try {
    await applyProcessingJobMigration(adminPool);
    const passwordLiteral = (await adminPool.query<{ value: string }>(
      "SELECT quote_literal($1) AS value",
      [options.runtimePassword]
    )).rows[0]?.value;
    if (!passwordLiteral) throw new Error("POSTGRES_RUNTIME_PASSWORD_QUOTE_FAILED");

    await adminPool.query(`
      DO $do$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
          CREATE ROLE ${runtimeRole} LOGIN PASSWORD ${passwordLiteral};
        ELSE
          ALTER ROLE ${runtimeRole} LOGIN PASSWORD ${passwordLiteral};
        END IF;
      END
      $do$;
    `);
    await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO medical_device_runtime");
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${runtimeTables} TO ${runtimeRole}`);
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

    await adminPool.query(`
      DO $do$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${outboxPublisherRole}') THEN
          CREATE ROLE ${outboxPublisherRole} LOGIN PASSWORD ${outboxPasswordLiteral};
        ELSE
          ALTER ROLE ${outboxPublisherRole} LOGIN PASSWORD ${outboxPasswordLiteral};
        END IF;
      END
      $do$;
    `);
    await adminPool.query("GRANT CONNECT ON DATABASE medical_device TO medical_device_outbox_publisher");
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO ${outboxPublisherRole}`);
    await adminPool.query(`GRANT SELECT(operation_id,organization_id) ON email_delivery_attempts TO ${outboxPublisherRole}`);
    await adminPool.query(`DROP POLICY IF EXISTS email_report_routing_read ON email_delivery_attempts`);
    await adminPool.query(`CREATE POLICY email_report_routing_read ON email_delivery_attempts FOR SELECT TO ${outboxPublisherRole} USING(true)`);
    await adminPool.query(`GRANT SELECT, UPDATE ON processing_job_outbox TO ${outboxPublisherRole}`);
    // Control-plane discovery exposes only pending notice routing metadata, not recipient payloads.
    await adminPool.query(`GRANT SELECT(outbox_event_id,organization_id,event_type,state,available_at) ON outbox_events TO ${outboxPublisherRole}`);
    await adminPool.query(`DROP POLICY IF EXISTS notice_dispatcher_read ON outbox_events`);
    await adminPool.query(`CREATE POLICY notice_dispatcher_read ON outbox_events FOR SELECT TO ${outboxPublisherRole} USING(event_type IN ('course.change.notify','course.change.assign','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired','organization.invitation.deliver'))`);
  } finally {
    await adminPool.end();
  }
}
