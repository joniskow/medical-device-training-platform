import {COURSE_STORY_MIGRATION_SQL} from './course-story-store.js';
import {PERSONAL_WALLET_MIGRATION_SQL} from './personal-wallet.js';
import {CANDIDATE_ACCESS_MIGRATION_SQL} from './candidate-learning-access.js';
import {CANDIDATE_ENROLLMENT_MIGRATION_SQL} from './candidate-enrollment.js';
import {COURSE_CATALOG_MIGRATION_SQL} from './course-catalog.js';
import {COURSE_OFFERING_MIGRATION_SQL} from './course-offering.js';
import type { Pool } from "pg";

export const PROCESSING_JOB_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS organization_memberships (
  membership_id text PRIMARY KEY,
  subject text NOT NULL,
  organization_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (subject, organization_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_subject_idx
  ON organization_memberships (subject, status, organization_id);

CREATE TABLE IF NOT EXISTS processing_jobs (
  job_id text PRIMARY KEY,
  job_type text NOT NULL,
  organization_id text NOT NULL,
  tenant jsonb NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  correlation_id text NOT NULL,
  timeout_seconds integer CHECK (timeout_seconds IS NULL OR timeout_seconds > 0),
  deadline_at timestamptz,
  input_asset_version_id text,
  code_version text NOT NULL DEFAULT 'unknown',
  adapter_version text,
  error_class text,
  operator_metadata jsonb,
  last_failure jsonb,
  output_artifact_ids text[] NOT NULL DEFAULT '{}',
  outcome jsonb
);

CREATE INDEX IF NOT EXISTS processing_jobs_available_idx
  ON processing_jobs (state, available_at);

CREATE INDEX IF NOT EXISTS processing_jobs_lease_idx
  ON processing_jobs (state, lease_expires_at);

CREATE INDEX IF NOT EXISTS processing_jobs_organization_idx
  ON processing_jobs (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS processing_job_outbox (
  outbox_id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES processing_jobs(job_id),
  organization_id text NOT NULL,
  tenant jsonb NOT NULL,
  message jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'FAILED')),
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL,
  claimed_by text,
  lease_expires_at timestamptz,
  last_failure jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS processing_job_outbox_available_idx
  ON processing_job_outbox (state, available_at, created_at);

CREATE TABLE IF NOT EXISTS processing_job_audit (
  audit_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES processing_jobs(job_id),
  organization_id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('OPERATOR_RETRY')),
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS processing_job_audit_job_idx
  ON processing_job_audit (organization_id, job_id, created_at DESC);

ALTER TABLE processing_job_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_job_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processing_job_outbox_isolation ON processing_job_outbox;
CREATE POLICY processing_job_outbox_isolation ON processing_job_outbox
  USING (
    organization_id = current_setting('app.organization_id', true)
    OR current_user = 'medical_device_outbox_publisher'
  )
  WITH CHECK (
    organization_id = current_setting('app.organization_id', true)
    OR current_user = 'medical_device_outbox_publisher'
  );

ALTER TABLE processing_job_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_job_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processing_job_audit_isolation ON processing_job_audit;
CREATE POLICY processing_job_audit_isolation ON processing_job_audit
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));

ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS lease_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS timeout_seconds integer;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS input_asset_version_id text;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS code_version text NOT NULL DEFAULT 'unknown';
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS adapter_version text;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS error_class text;
ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS operator_metadata jsonb;
UPDATE processing_jobs SET correlation_id = COALESCE(correlation_id, tenant->>'correlationId') WHERE correlation_id IS NULL;
ALTER TABLE processing_jobs ALTER COLUMN correlation_id SET NOT NULL;
UPDATE processing_jobs SET input_asset_version_id = COALESCE(input_asset_version_id, payload->>'inputAssetVersionId') WHERE input_asset_version_id IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_jobs_lease_generation_check'
      AND conrelid = 'processing_jobs'::regclass
  ) THEN
    ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_lease_generation_check CHECK (lease_generation >= 0);
  END IF;
END
$$;

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS processing_jobs_tenant_isolation ON processing_jobs;
CREATE POLICY processing_jobs_tenant_isolation ON processing_jobs
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
`;

/**
 * Baseline domain tables. These are intentionally present before the feature
 * services land so tenant isolation is a database invariant, not something
 * added piecemeal by each repository.
 */
export const TENANT_DOMAIN_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  organization_id text PRIMARY KEY,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  status text NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')),
  created_by text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_invitations (
  invitation_id text PRIMARY KEY,
  organization_id text NOT NULL,
  intended_email text NOT NULL,
  role text NOT NULL CHECK(role IN ('learner','author','reviewer','publisher','organization_admin','employer')),
  inviter_id text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  token_key_id text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REVOKED')),
  expires_at timestamptz NOT NULL,
  accepted_by text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS organization_invitations_list_idx ON organization_invitations(organization_id,invitation_id);
CREATE TABLE IF NOT EXISTS role_assignments (
  role_assignment_id text PRIMARY KEY,
  organization_id text NOT NULL,
  subject text NOT NULL,
  role text NOT NULL,
  scope_type text NOT NULL DEFAULT 'organization',
  scope_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, subject, role, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS products (
  product_id text PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED', 'SUSPENDED')),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS product_versions (
  product_version_id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(product_id),
  organization_id text NOT NULL,
  version_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, product_id, version_label)
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id text PRIMARY KEY,
  organization_id text NOT NULL,
  product_id text,
  source_type text NOT NULL CHECK (source_type IN ('pdf', 'image', 'video', 'gltf', 'glb')),
  status text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS updated_by text;
UPDATE assets SET updated_by = COALESCE(updated_by, created_by) WHERE updated_by IS NULL;
ALTER TABLE assets ALTER COLUMN updated_by SET NOT NULL;

CREATE TABLE IF NOT EXISTS asset_versions (
  asset_version_id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets(asset_id),
  organization_id text NOT NULL,
  product_id text,
  source_type text NOT NULL CHECK (source_type IN ('pdf', 'image', 'video', 'gltf', 'glb')),
  blob_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('UPLOADING', 'READY_FOR_SCAN', 'QUARANTINED', 'SCAN_FAILED', 'READY_FOR_PROCESSING', 'PROCESSING', 'PROCESSING_FAILED', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED')),
  reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, blob_key)
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  upload_session_id text PRIMARY KEY,
  organization_id text NOT NULL,
  actor_id text NOT NULL,
  product_id text,
  source_type text NOT NULL CHECK (source_type IN ('pdf', 'image', 'video', 'gltf', 'glb')),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  blob_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  completed_asset_version_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, blob_key)
);

CREATE TABLE IF NOT EXISTS asset_rights_attestations (
  attestation_id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_version_id text NOT NULL REFERENCES asset_versions(asset_version_id),
  owner_name text NOT NULL,
  use_scope text NOT NULL,
  derivative_allowed boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS openmontage_scene_briefs (
  brief_id text PRIMARY KEY,
  organization_id text NOT NULL,
  scene_id text NOT NULL,
  scene_manifest jsonb NOT NULL,
  brief jsonb NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS openmontage_scene_briefs_scene_idx
  ON openmontage_scene_briefs (organization_id, scene_id, created_at DESC);

CREATE TABLE IF NOT EXISTS openmontage_render_artifacts (
  artifact_id text PRIMARY KEY,
  organization_id text NOT NULL,
  scene_id text NOT NULL,
  brief_id text NOT NULL REFERENCES openmontage_scene_briefs(brief_id),
  artifact jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('REVIEW_REQUIRED', 'APPROVED')),
  scene_manifest jsonb,
  reviewer_id text,
  review_ref text,
  request_hash text NOT NULL,
  idempotency_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS openmontage_render_artifacts_scene_idx
  ON openmontage_render_artifacts (organization_id, scene_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_version_id text NOT NULL REFERENCES asset_versions(asset_version_id),
  chunk_text text NOT NULL,
  citation jsonb NOT NULL,
  heading text,
  source_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS model_versions (
  model_version_id text PRIMARY KEY,
  organization_id text NOT NULL,
  asset_version_id text REFERENCES asset_versions(asset_version_id),
  blob_key text NOT NULL,
  manifest jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS manifest_blob_key text;

CREATE TABLE IF NOT EXISTS model_components (
  model_component_id text PRIMARY KEY,
  organization_id text NOT NULL,
  model_version_id text NOT NULL REFERENCES model_versions(model_version_id),
  component_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, model_version_id, component_key)
);

CREATE TABLE IF NOT EXISTS simulation_definitions (
  simulation_definition_id text PRIMARY KEY,
  organization_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_sessions (
  simulation_session_id text PRIMARY KEY,
  organization_id text NOT NULL,
  simulation_definition_id text NOT NULL REFERENCES simulation_definitions(simulation_definition_id),
  learner_id text NOT NULL,
  state jsonb NOT NULL,
  next_sequence integer NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS release_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS activity_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS enrollment_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS attempt_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS policy_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS policy_version integer;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS model_version_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS release_binding_id text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS start_request_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS simulation_sessions_start_key_idx
  ON simulation_sessions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS simulation_actions (
  simulation_action_id text PRIMARY KEY,
  organization_id text NOT NULL,
  simulation_session_id text NOT NULL REFERENCES simulation_sessions(simulation_session_id),
  sequence integer NOT NULL CHECK (sequence > 0),
  nonce text NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, simulation_session_id, sequence),
  UNIQUE (organization_id, simulation_session_id, nonce)
);

CREATE TABLE IF NOT EXISTS courses (
  course_id text PRIMARY KEY,
  organization_id text NOT NULL,
  product_id text,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS course_versions (
  course_version_id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses(course_id),
  organization_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  content jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, course_id, revision)
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS creation_key text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS creation_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS courses_creation_key_idx ON courses (organization_id, created_by, creation_key) WHERE creation_key IS NOT NULL;

ALTER TABLE course_versions ADD COLUMN IF NOT EXISTS release_manifest_id text;

CREATE TABLE IF NOT EXISTS course_review_decisions (
  decision_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  target_type text NOT NULL CHECK (target_type IN ('COURSE', 'AI_DRAFT', 'SOURCE', 'MODEL', 'SIMULATION', 'ASSESSMENT', 'POLICY', 'VIDEO_LESSON')),
  target_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'NEEDS_CHANGES')),
  rationale text NOT NULL,
  actor_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS course_review_decisions_version_idx
  ON course_review_decisions (organization_id, course_version_id, created_at DESC);

ALTER TABLE course_review_decisions DROP CONSTRAINT IF EXISTS course_review_decisions_target_type_check;
ALTER TABLE course_review_decisions ADD CONSTRAINT course_review_decisions_target_type_check
  CHECK (target_type IN ('COURSE', 'AI_DRAFT', 'SOURCE', 'MODEL', 'SIMULATION', 'ASSESSMENT', 'POLICY', 'VIDEO_LESSON'));

CREATE TABLE IF NOT EXISTS release_manifests (
  release_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  status text NOT NULL CHECK (status IN ('PUBLISHED', 'SUPERSEDED', 'RETIRED')),
  manifest jsonb NOT NULL,
  release_hash text NOT NULL CHECK (release_hash ~ '^[0-9a-f]{64}$'),
  published_by text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, course_version_id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, release_hash)
);

CREATE INDEX IF NOT EXISTS release_manifests_version_idx
  ON release_manifests (organization_id, course_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS release_model_bindings (
  release_model_binding_id text PRIMARY KEY,
  organization_id text NOT NULL,
  release_id text NOT NULL REFERENCES release_manifests(release_id),
  model_version_id text NOT NULL REFERENCES model_versions(model_version_id),
  release_binding_id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  model_blob_key text NOT NULL,
  manifest_blob_key text NOT NULL,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, release_id),
  UNIQUE (organization_id, release_binding_id)
);

CREATE INDEX IF NOT EXISTS release_model_bindings_model_idx
  ON release_model_bindings (organization_id, model_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS modules (
  module_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  position integer NOT NULL CHECK (position >= 0),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  activity_id text PRIMARY KEY,
  organization_id text NOT NULL,
  module_id text NOT NULL REFERENCES modules(module_id),
  activity_type text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS certification_policies (
  policy_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  version integer NOT NULL CHECK (version > 0),
  policy jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  enrollment_id text PRIMARY KEY,
  organization_id text NOT NULL,
  learner_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_attempts (
  simulation_attempt_id text PRIMARY KEY,
  organization_id text NOT NULL,
  enrollment_id text NOT NULL REFERENCES enrollments(enrollment_id),
  learner_id text NOT NULL,
  release_id text NOT NULL,
  activity_id text NOT NULL REFERENCES activities(activity_id),
  simulation_definition_id text NOT NULL REFERENCES simulation_definitions(simulation_definition_id),
  model_version_id text NOT NULL,
  policy_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'INVALIDATED', 'EXPIRED')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, enrollment_id, activity_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS simulation_attempts_learner_idx
  ON simulation_attempts (organization_id, learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS progress_events (
  progress_event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  enrollment_id text NOT NULL REFERENCES enrollments(enrollment_id),
  learner_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  attempt_id text PRIMARY KEY,
  organization_id text NOT NULL,
  assessment_id text NOT NULL REFERENCES assessments(assessment_id),
  learner_id text NOT NULL,
  answers jsonb NOT NULL,
  result jsonb NOT NULL,
  submitted_at timestamptz NOT NULL,
  UNIQUE (organization_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
  session_id text PRIMARY KEY,
  organization_id text NOT NULL,
  learner_id text NOT NULL,
  enrollment_id text NOT NULL REFERENCES enrollments(enrollment_id),
  release_id text NOT NULL REFERENCES release_manifests(release_id),
  release_hash text NOT NULL,
  activity_id text NOT NULL,
  assessment_id text NOT NULL,
  assessment_version integer NOT NULL CHECK (assessment_version > 0),
  policy_id text NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  definition jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  start_key text NOT NULL,
  start_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','PASSED','FAILED','EXPIRED','INVALIDATED')),
  answers jsonb,
  answer_hash text,
  result jsonb,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  UNIQUE (organization_id, learner_id, start_key),
  UNIQUE (organization_id, enrollment_id, release_id, activity_id, attempt_number),
  CHECK (expires_at > started_at),
  CHECK (status NOT IN ('PASSED','FAILED') OR (answers IS NOT NULL AND answer_hash IS NOT NULL AND result IS NOT NULL AND submitted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS credentials (
  credential_id text PRIMARY KEY,
  organization_id text NOT NULL,
  learner_id text NOT NULL,
  course_version_id text NOT NULL REFERENCES course_versions(course_version_id),
  public_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUPERSEDED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_events (
  credential_event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  credential_id text NOT NULL REFERENCES credentials(credential_id),
  event_type text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

ALTER TABLE credentials ADD COLUMN IF NOT EXISTS release_id text REFERENCES release_manifests(release_id);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS release_hash text;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS policy_id text;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS policy_version integer;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS qualification_id text;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS public_id_hash text;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS evidence jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS credentials_qualification_unique ON credentials(organization_id,learner_id,release_id,policy_version,qualification_id) WHERE release_id IS NOT NULL;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS superseded_by text REFERENCES credentials(credential_id);
ALTER TABLE credential_events ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE credential_events ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS credential_events_request_unique ON credential_events(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credentials_public_hash_unique ON credentials(public_id_hash);
CREATE TABLE IF NOT EXISTS credential_verifications (
  public_id_hash text PRIMARY KEY REFERENCES credentials(public_id_hash) ON DELETE CASCADE,
  public_fields jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','REVOKED','SUPERSEDED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz
);
CREATE TABLE IF NOT EXISTS public_verification_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests>0)
);
CREATE INDEX IF NOT EXISTS public_verification_limits_window ON public_verification_limits(window_start);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS sharing_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS sharing_revision integer NOT NULL DEFAULT 0;
ALTER TABLE credential_verifications ADD COLUMN IF NOT EXISTS sharing_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id text PRIMARY KEY,
  organization_id text NOT NULL,
  recipient_id text NOT NULL,
  notification_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  email_delivery_id text PRIMARY KEY,
  organization_id text NOT NULL,
  recipient_id text NOT NULL,
  template_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS provider_event_at timestamptz;
CREATE TABLE IF NOT EXISTS email_delivery_attempts (
 operation_id text PRIMARY KEY,
 organization_id text NOT NULL,
 outbox_event_id text NOT NULL,
 recipient_hash text NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS email_delivery_reports (
 report_id text NOT NULL,
 organization_id text NOT NULL,
 operation_id text NOT NULL,
 status text NOT NULL,
 occurred_at timestamptz NOT NULL,
 signature text NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,report_id)
);
CREATE TABLE IF NOT EXISTS email_recipient_suppressions (
 organization_id text NOT NULL,
 recipient_hash text NOT NULL,
 reason text NOT NULL,
 report_id text NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,recipient_hash)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_cursor_idx ON notifications(organization_id,recipient_id,notification_id);
ALTER TABLE email_recipient_suppressions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE email_recipient_suppressions ADD COLUMN IF NOT EXISTS released_at timestamptz;

CREATE TABLE IF NOT EXISTS usage_meter_events (
  usage_event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  meter_key text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  deduplication_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, deduplication_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  outbox_event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  event_type text NOT NULL,
  deduplication_key text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'FAILED')),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (organization_id, deduplication_key)
);

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS deduplication_key text;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code text;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS delivery_lease_token text;
CREATE INDEX IF NOT EXISTS invitation_delivery_due_idx ON outbox_events(available_at,outbox_event_id) WHERE event_type='organization.invitation.deliver' AND state IN ('PENDING','CLAIMED');
CREATE INDEX IF NOT EXISTS credential_expiration_dispatch_due_idx ON outbox_events(available_at,outbox_event_id) WHERE state='PENDING' AND event_type IN ('credential.expire','credential.expired');
CREATE INDEX IF NOT EXISTS credential_notice_dispatch_due_idx ON outbox_events(available_at,outbox_event_id) WHERE state='PENDING' AND event_type IN ('credential.issued','credential.revoked','credential.superseded');
CREATE INDEX IF NOT EXISTS qualification_dispatch_due_idx ON outbox_events(available_at,outbox_event_id) WHERE state='PENDING' AND event_type='credential.qualify';
CREATE INDEX IF NOT EXISTS course_change_dispatch_due_idx ON outbox_events(available_at,outbox_event_id) WHERE state='PENDING' AND event_type IN ('course.change.notify','course.change.assign');
INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
SELECT 'expiration:'||credential_id,organization_id,'credential.expire','expiration:'||credential_id,
  jsonb_build_object('credentialId',credential_id,'learnerId',learner_id),'PENDING',expires_at,now(),now()
FROM credentials WHERE expires_at IS NOT NULL AND status IN ('ACTIVE','EXPIRED')
ON CONFLICT DO NOTHING;
UPDATE outbox_events SET deduplication_key = outbox_event_id WHERE deduplication_key IS NULL;
ALTER TABLE outbox_events ALTER COLUMN deduplication_key SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outbox_events_organization_deduplication_key_key'
      AND conrelid = 'outbox_events'::regclass
  ) THEN
    ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_organization_deduplication_key_key UNIQUE (organization_id, deduplication_key);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id text PRIMARY KEY,
  organization_id text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  resource_type text,
  resource_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  ai_run_id text PRIMARY KEY,
  organization_id text NOT NULL,
  course_version_id text,
  operation text NOT NULL,
  source_artifact_ids text[] NOT NULL DEFAULT '{}',
  provider text NOT NULL,
  deployment text NOT NULL,
  model text NOT NULL,
  api_version text NOT NULL,
  prompt_version text NOT NULL,
  output_schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'REJECTED', 'FAILED')),
  output jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS course_version_id text;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS input_evidence jsonb;

CREATE INDEX IF NOT EXISTS tenant_domain_products_idx ON products (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_domain_assets_idx ON assets (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_domain_asset_versions_idx ON asset_versions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_domain_upload_sessions_idx ON upload_sessions (organization_id, status, expires_at);
CREATE INDEX IF NOT EXISTS tenant_domain_knowledge_idx ON knowledge_chunks (organization_id, asset_version_id, created_at);
CREATE INDEX IF NOT EXISTS tenant_domain_ai_runs_idx ON ai_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_domain_ai_runs_course_version_idx ON ai_runs (organization_id, course_version_id, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'role_assignments', 'products', 'product_versions', 'assets', 'asset_versions',
    'upload_sessions', 'asset_rights_attestations', 'openmontage_scene_briefs', 'openmontage_render_artifacts', 'knowledge_chunks', 'model_versions',
    'model_components', 'simulation_definitions', 'simulation_sessions', 'simulation_actions',
    'courses', 'course_versions', 'course_review_decisions', 'release_manifests', 'release_model_bindings', 'modules', 'activities', 'assessments',
    'certification_policies', 'enrollments', 'simulation_attempts', 'progress_events', 'assessment_attempts',
    'organizations', 'organization_invitations', 'assessment_sessions', 'credentials', 'credential_events', 'notifications', 'email_deliveries', 'email_delivery_attempts', 'email_delivery_reports', 'email_recipient_suppressions',
    'usage_meter_events', 'outbox_events', 'audit_events', 'ai_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(''app.organization_id'', true), '''')) WITH CHECK (organization_id = NULLIF(current_setting(''app.organization_id'', true), ''''))',
      table_name
    );
  END LOOP;
END
$$;

`;

// Membership discovery is a control-plane read. Runtime status writes use only this
// tenant-bound operation; runtime receives no UPDATE privilege on the control table.
export const MEMBERSHIP_STATUS_MIGRATION_SQL = `
CREATE OR REPLACE FUNCTION public.create_organization_invitation(invitation text,actor text,email text,assigned_role text,secret_hash text,key_id text,signature text,expiry_hours integer,correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; existing_signature text;
BEGIN
  selected_org:=NULLIF(current_setting('app.organization_id',true),'');
  IF selected_org IS NULL OR invitation IS NULL OR invitation !~ '^invitation:[a-f0-9]{64}$' OR email IS NULL OR length(email) NOT BETWEEN 3 AND 254
    OR assigned_role IS NULL OR assigned_role NOT IN ('learner','author','reviewer','publisher','organization_admin','employer')
    OR secret_hash IS NULL OR secret_hash !~ '^[a-f0-9]{64}$' OR signature IS NULL OR signature !~ '^[a-f0-9]{64}$'
    OR key_id IS NULL OR length(key_id) NOT BETWEEN 1 AND 128 OR expiry_hours IS NULL OR expiry_hours NOT BETWEEN 1 AND 168 THEN RAISE EXCEPTION 'INVITATION_REQUEST_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN public.organizations o ON o.organization_id=m.organization_id
    WHERE m.organization_id=selected_org AND m.subject=actor AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)) THEN RAISE EXCEPTION 'INVITATION_ADMIN_REQUIRED'; END IF;
  SELECT request_hash INTO existing_signature FROM public.organization_invitations WHERE organization_id=selected_org AND invitation_id=invitation;
  IF FOUND THEN
    IF existing_signature<>signature THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.organization_invitations(invitation_id,organization_id,intended_email,role,inviter_id,token_hash,token_key_id,request_hash,status,expires_at,created_at,updated_at)
    VALUES(invitation,selected_org,lower(btrim(email)),assigned_role,actor,secret_hash,key_id,signature,'PENDING',clock_timestamp()+(expiry_hours*interval '1 hour'),now(),now());
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
    VALUES('created:'||invitation,selected_org,actor,'ORGANIZATION_INVITATION_CREATED','invitation',invitation,jsonb_build_object('role',assigned_role,'correlationId',correlation),now());
  INSERT INTO public.outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
    VALUES('deliver:'||invitation,selected_org,'organization.invitation.deliver','deliver:'||invitation,jsonb_build_object('invitationId',invitation),'PENDING',now(),now(),now());
END $$;
REVOKE ALL ON FUNCTION public.create_organization_invitation(text,text,text,text,text,text,text,integer,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.revoke_organization_invitation(invitation text,actor text,reason text,correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; invitation_status text;
BEGIN
  selected_org:=NULLIF(current_setting('app.organization_id',true),'');
  IF selected_org IS NULL OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVITATION_REQUEST_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN public.organizations o ON o.organization_id=m.organization_id
    WHERE m.organization_id=selected_org AND m.subject=actor AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)) THEN RAISE EXCEPTION 'INVITATION_ADMIN_REQUIRED'; END IF;
  SELECT status INTO invitation_status FROM public.organization_invitations WHERE organization_id=selected_org AND invitation_id=invitation FOR UPDATE;
  IF NOT FOUND OR invitation_status='ACCEPTED' THEN RAISE EXCEPTION 'INVITATION_UNAVAILABLE'; END IF;
  IF invitation_status='REVOKED' THEN RETURN; END IF;
  UPDATE public.organization_invitations SET status='REVOKED',updated_at=clock_timestamp() WHERE organization_id=selected_org AND invitation_id=invitation;
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
    VALUES('revoked:'||invitation,selected_org,actor,'ORGANIZATION_INVITATION_REVOKED','invitation',invitation,jsonb_build_object('reason',btrim(reason),'correlationId',correlation),now());
END $$;
REVOKE ALL ON FUNCTION public.revoke_organization_invitation(text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.accept_organization_invitation(invitation text,provided_hash text,verified_email text,accepting_subject text,expected_role text,correlation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; invite public.organization_invitations%ROWTYPE; member_status text;
BEGIN
  selected_org:=NULLIF(current_setting('app.organization_id',true),'');
  IF selected_org IS NULL OR accepting_subject IS NULL OR length(accepting_subject) NOT BETWEEN 1 AND 256 OR verified_email IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
  SELECT * INTO invite FROM public.organization_invitations WHERE invitation_id=invitation AND organization_id=selected_org FOR UPDATE;
  IF NOT FOUND OR invite.status<>'PENDING' OR invite.expires_at<=clock_timestamp() OR invite.token_hash IS DISTINCT FROM provided_hash
    OR invite.intended_email IS DISTINCT FROM lower(btrim(verified_email)) OR invite.role IS DISTINCT FROM expected_role THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organization_id=selected_org AND status='ACTIVE') THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject
    WHERE m.organization_id=selected_org AND m.subject=invite.inviter_id AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)) THEN RETURN false; END IF;
  SELECT status INTO member_status FROM public.organization_memberships WHERE organization_id=selected_org AND subject=accepting_subject;
  IF member_status='SUSPENDED' THEN RETURN false; END IF;
  IF member_status='REMOVED' THEN DELETE FROM public.role_assignments WHERE organization_id=selected_org AND subject=accepting_subject; END IF;
  INSERT INTO public.organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at)
    VALUES('invited:'||invitation,accepting_subject,selected_org,'ACTIVE',now(),now())
    ON CONFLICT(subject,organization_id) DO UPDATE SET status='ACTIVE',updated_at=clock_timestamp();
  IF NOT EXISTS(SELECT 1 FROM public.role_assignments WHERE organization_id=selected_org AND subject=accepting_subject AND role=invite.role AND scope_type='organization' AND (scope_id IS NULL OR scope_id=selected_org)) THEN
    INSERT INTO public.role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at)
      VALUES('invited:'||invitation,selected_org,accepting_subject,invite.role,'organization',selected_org,now(),now());
  END IF;
  UPDATE public.organization_invitations SET status='ACCEPTED',accepted_by=accepting_subject,accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE invitation_id=invitation;
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
    VALUES('invitation-accepted:'||invitation,selected_org,accepting_subject,'ORGANIZATION_INVITATION_ACCEPTED','invitation',invitation,
      jsonb_build_object('inviterId',invite.inviter_id,'role',invite.role,'correlationId',correlation),now());
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.accept_organization_invitation(text,text,text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.create_training_organization(creator_subject text,organization_name text,request_key text,correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; content_hash text; existing public.organizations%ROWTYPE;
BEGIN
  IF creator_subject IS NULL OR length(btrim(creator_subject)) NOT BETWEEN 1 AND 256 OR organization_name IS NULL OR length(btrim(organization_name)) NOT BETWEEN 1 AND 160
    OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'ORGANIZATION_REQUEST_INVALID'; END IF;
  selected_org:='org:'||encode(sha256(convert_to(jsonb_build_array(creator_subject,request_key)::text,'UTF8')),'hex');
  content_hash:=encode(sha256(convert_to(btrim(organization_name),'UTF8')),'hex');
  PERFORM set_config('app.organization_id',selected_org,true);
  PERFORM pg_advisory_xact_lock(hashtextextended(selected_org,0));
  SELECT * INTO existing FROM public.organizations WHERE organization_id=selected_org;
  IF FOUND THEN
    IF existing.request_hash<>content_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    IF existing.status<>'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=selected_org AND subject=creator_subject AND status='ACTIVE') THEN RAISE EXCEPTION 'ORGANIZATION_CREATION_UNAVAILABLE'; END IF;
    RETURN jsonb_build_object('organizationId',selected_org,'name',existing.name);
  END IF;
  INSERT INTO public.organizations(organization_id,name,status,created_by,request_hash,created_at,updated_at) VALUES(selected_org,btrim(organization_name),'ACTIVE',creator_subject,content_hash,now(),now());
  INSERT INTO public.organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at)
    VALUES('founder:'||selected_org,creator_subject,selected_org,'ACTIVE',now(),now());
  INSERT INTO public.role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at)
    VALUES('founder:'||selected_org,selected_org,creator_subject,'organization_admin','organization',selected_org,now(),now());
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
    VALUES('created:'||selected_org,selected_org,creator_subject,'ORGANIZATION_CREATED','organization',selected_org,jsonb_build_object('name',btrim(organization_name),'initialRole','organization_admin','correlationId',correlation),now());
  RETURN jsonb_build_object('organizationId',selected_org,'name',btrim(organization_name));
END $$;
REVOKE ALL ON FUNCTION public.create_training_organization(text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.set_tenant_membership_status(target_subject text,next_status text,expected_status text,expected_updated_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; affected integer;
BEGIN
  selected_org:=NULLIF(current_setting('app.organization_id',true),'');
  IF selected_org IS NULL OR next_status NOT IN ('ACTIVE','SUSPENDED','REMOVED') THEN RAISE EXCEPTION 'MEMBER_REQUEST_INVALID'; END IF;
  IF expected_status=next_status OR (expected_status='REMOVED' AND next_status<>'ACTIVE') THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
  IF expected_status='ACTIVE' AND next_status<>'ACTIVE' AND EXISTS(
    SELECT 1 FROM public.role_assignments WHERE organization_id=selected_org AND subject=target_subject AND role='organization_admin' AND scope_type='organization' AND (scope_id IS NULL OR scope_id=selected_org)
  ) AND NOT EXISTS(
    SELECT 1 FROM public.organization_memberships m JOIN public.role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject
    WHERE m.organization_id=selected_org AND m.subject<>target_subject AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=selected_org)
  ) THEN RAISE EXCEPTION 'LAST_ORGANIZATION_ADMIN'; END IF;
  UPDATE public.organization_memberships SET status=next_status,updated_at=clock_timestamp()
    WHERE organization_id=selected_org AND subject=target_subject AND status=expected_status AND updated_at=expected_updated_at;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
END $$;
REVOKE ALL ON FUNCTION public.set_tenant_membership_status(text,text,text,timestamptz) FROM PUBLIC;
`;

export const EMAIL_RATE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS email_rate_buckets (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  reserved_count integer NOT NULL CHECK(reserved_count>=0)
);
CREATE OR REPLACE FUNCTION public.reserve_invitation_email_capacity(provider_scope text,global_limit integer,organization_limit integer)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; global_key text; org_key text; current_time_value timestamptz; retry_at timestamptz;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR provider_scope IS NULL OR length(provider_scope) NOT BETWEEN 1 AND 256 OR global_limit IS NULL OR global_limit NOT BETWEEN 1 AND 1000000 OR organization_limit IS NULL OR organization_limit NOT BETWEEN 1 AND global_limit THEN RAISE EXCEPTION 'EMAIL_RATE_CONFIGURATION_INVALID'; END IF;
 global_key:='global:'||encode(sha256(convert_to(provider_scope,'UTF8')),'hex');
 org_key:='organization:'||encode(sha256(convert_to(jsonb_build_array(provider_scope,selected_org)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('email-rate:'||global_key,0));
 current_time_value:=clock_timestamp();
 INSERT INTO public.email_rate_buckets(bucket_key,window_started_at,reserved_count) VALUES(global_key,current_time_value,0),(org_key,current_time_value,0) ON CONFLICT DO NOTHING;
 UPDATE public.email_rate_buckets SET window_started_at=current_time_value,reserved_count=0 WHERE bucket_key IN (global_key,org_key) AND window_started_at+interval '1 minute'<=current_time_value;
 SELECT max(window_started_at+interval '1 minute') INTO retry_at FROM public.email_rate_buckets WHERE (bucket_key=global_key AND reserved_count>=global_limit) OR (bucket_key=org_key AND reserved_count>=organization_limit);
 IF retry_at IS NOT NULL THEN RETURN retry_at; END IF;
 UPDATE public.email_rate_buckets SET reserved_count=reserved_count+1 WHERE bucket_key IN (global_key,org_key);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.reserve_invitation_email_capacity(text,integer,integer) FROM PUBLIC;
`;

export const EMAIL_DELIVERY_REPORT_MIGRATION_SQL = `
CREATE OR REPLACE FUNCTION public.record_invitation_email_attempt(event_id text,operation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; recipient_hash_value text;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 SELECT encode(sha256(convert_to(lower(btrim(i.intended_email)),'UTF8')),'hex') INTO recipient_hash_value
 FROM public.outbox_events e JOIN public.organization_invitations i ON i.organization_id=e.organization_id AND i.invitation_id=e.payload->>'invitationId'
 WHERE e.organization_id=selected_org AND e.outbox_event_id=event_id AND e.event_type='organization.invitation.deliver' AND e.state='CLAIMED' AND e.delivery_lease_token=operation AND e.available_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_ATTEMPT_INVALID'; END IF;
 INSERT INTO public.email_delivery_attempts(operation_id,organization_id,outbox_event_id,recipient_hash,created_at) VALUES(operation,selected_org,event_id,recipient_hash_value,now());
END $$;
REVOKE ALL ON FUNCTION public.record_invitation_email_attempt(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.apply_email_delivery_report(report text,operation text,recipient_digest text,report_status text,occurred timestamptz,actor text,correlation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; attempt public.email_delivery_attempts%ROWTYPE; signature_value text; prior_signature text; delivery_id text;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR report IS NULL OR report !~ '^[A-Za-z0-9._:-]{1,128}$' OR report_status IS NULL OR report_status NOT IN ('Delivered','Suppressed','Bounced','Quarantined','FilteredSpam','Expanded','Failed') OR occurred IS NULL OR NOT isfinite(occurred) OR occurred>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'EMAIL_REPORT_INVALID'; END IF;
 SELECT * INTO attempt FROM public.email_delivery_attempts WHERE organization_id=selected_org AND operation_id=operation FOR UPDATE;
 IF NOT FOUND OR attempt.recipient_hash IS DISTINCT FROM recipient_digest THEN RAISE EXCEPTION 'EMAIL_REPORT_UNMATCHED'; END IF;
 signature_value:=encode(sha256(convert_to(jsonb_build_array(operation,recipient_digest,report_status,extract(epoch FROM occurred))::text,'UTF8')),'hex');
 SELECT signature INTO prior_signature FROM public.email_delivery_reports WHERE organization_id=selected_org AND report_id=report;
 IF FOUND THEN
   IF prior_signature<>signature_value THEN RAISE EXCEPTION 'EMAIL_REPORT_CONFLICT'; END IF;
   RETURN true;
 END IF;
 SELECT email_delivery_id INTO delivery_id FROM public.email_deliveries WHERE organization_id=selected_org AND email_delivery_id='email:'||attempt.outbox_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_REPORT_UNMATCHED'; END IF;
 INSERT INTO public.email_delivery_reports(report_id,organization_id,operation_id,status,occurred_at,signature,created_at) VALUES(report,selected_org,operation,report_status,occurred,signature_value,now());
 UPDATE public.email_deliveries SET provider_status='PROVIDER_'||upper(report_status),provider_event_at=occurred,updated_at=now()
 WHERE organization_id=selected_org AND email_delivery_id=delivery_id AND (provider_event_at IS NULL OR provider_event_at<occurred OR (provider_event_at=occurred AND
 array_position(ARRAY['PROVIDER_EXPANDED','PROVIDER_DELIVERED','PROVIDER_FAILED','PROVIDER_FILTEREDSPAM','PROVIDER_QUARANTINED','PROVIDER_SUPPRESSED','PROVIDER_BOUNCED'],'PROVIDER_'||upper(report_status))>
 array_position(ARRAY['PROVIDER_EXPANDED','PROVIDER_DELIVERED','PROVIDER_FAILED','PROVIDER_FILTEREDSPAM','PROVIDER_QUARANTINED','PROVIDER_SUPPRESSED','PROVIDER_BOUNCED'],provider_status)));
 IF report_status IN ('Bounced','Suppressed') THEN
  INSERT INTO public.email_recipient_suppressions(organization_id,recipient_hash,reason,report_id,created_at) VALUES(selected_org,recipient_digest,report_status,report,now()) ON CONFLICT(organization_id,recipient_hash) DO UPDATE SET reason=EXCLUDED.reason,report_id=EXCLUDED.report_id,revision=public.email_recipient_suppressions.revision+1,released_at=NULL;
 END IF;
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
 VALUES('email-report:'||encode(sha256(convert_to(jsonb_build_array(selected_org,report)::text,'UTF8')),'hex'),selected_org,actor,'EMAIL_DELIVERY_REPORT_RECORDED','email_delivery',delivery_id,jsonb_build_object('reportId',report,'status',report_status,'occurredAt',occurred,'correlationId',correlation),now());
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.apply_email_delivery_report(text,text,text,text,timestamptz,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.release_email_suppression(recipient_digest text,expected_revision integer,request_id text,release_reason text,actor text,correlation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected_org text; audit_id text; signature_value text; prior jsonb; current_row public.email_recipient_suppressions%ROWTYPE;
BEGIN
 selected_org:=NULLIF(current_setting('app.organization_id',true),'');
 IF selected_org IS NULL OR recipient_digest IS NULL OR recipient_digest !~ '^[a-f0-9]{64}$' OR expected_revision IS NULL OR expected_revision<1 OR request_id IS NULL OR request_id !~ '^[A-Za-z0-9._:-]{1,128}$' OR release_reason IS NULL OR length(btrim(release_reason))<1 OR length(release_reason)>2000 THEN RAISE EXCEPTION 'EMAIL_SUPPRESSION_REQUEST_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_memberships m JOIN public.organizations o ON o.organization_id=m.organization_id WHERE m.organization_id=selected_org AND m.subject=actor AND m.status='ACTIVE' AND o.status='ACTIVE') THEN RAISE EXCEPTION 'EMAIL_SUPPRESSION_ACCESS_DENIED'; END IF;
 audit_id:='email-suppression-release:'||encode(sha256(convert_to(jsonb_build_array(selected_org,actor,request_id)::text,'UTF8')),'hex');
 signature_value:=encode(sha256(convert_to(jsonb_build_array(recipient_digest,expected_revision,btrim(release_reason))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(audit_id,0));
 SELECT details INTO prior FROM public.audit_events WHERE organization_id=selected_org AND audit_event_id=audit_id;
 IF FOUND THEN
  IF prior->>'signature' IS DISTINCT FROM signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
  RETURN true;
 END IF;
 SELECT * INTO current_row FROM public.email_recipient_suppressions WHERE organization_id=selected_org AND recipient_hash=recipient_digest FOR UPDATE;
 IF NOT FOUND OR current_row.revision<>expected_revision OR current_row.released_at IS NOT NULL THEN RAISE EXCEPTION 'EMAIL_SUPPRESSION_CHANGED'; END IF;
 UPDATE public.email_recipient_suppressions SET released_at=now(),revision=revision+1 WHERE organization_id=selected_org AND recipient_hash=recipient_digest;
 INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
 VALUES(audit_id,selected_org,actor,'EMAIL_SUPPRESSION_RELEASED','email_suppression',recipient_digest,jsonb_build_object('signature',signature_value,'requestId',request_id,'reason',btrim(release_reason),'previousRevision',expected_revision,'reportId',current_row.report_id,'correlationId',correlation),now());
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.release_email_suppression(text,integer,text,text,text,text) FROM PUBLIC;
`;

import {ORGANIZATION_PROFILE_MIGRATION_SQL} from './organization-profile.js';
import {ORGANIZATION_LIFECYCLE_MIGRATION_SQL} from './organization-lifecycle.js';
import {PERSONAL_ACCOUNT_MIGRATION_SQL} from './personal-account.js';
import {ACCOUNT_SECURITY_MIGRATION_SQL} from './account-security.js';
import {ACCOUNT_VERIFICATION_MIGRATION_SQL} from './account-verification.js';
import {EMAIL_CHALLENGE_MIGRATION_SQL} from './email-verification-challenge.js';
import {OPERATIONS_MIGRATION_SQL} from './operations-store.js';
import {LIFECYCLE_GOVERNANCE_MIGRATION_SQL} from './lifecycle-governance.js';
import {DISCOVERY_INQUIRIES_MIGRATION_SQL} from './discovery-inquiries.js';
import {CUSTOMER_WEBHOOK_MIGRATION_SQL} from './customer-webhooks.js';
import {PROTECTED_EXPORT_MIGRATION_SQL} from './protected-exports.js';
import {LIFECYCLE_NOTIFICATION_MIGRATION_SQL} from './lifecycle-notifications.js';
import {RETENTION_GOVERNANCE_MIGRATION_SQL} from './retention-governance.js';
import {EVIDENCE_INTEGRITY_MIGRATION_SQL} from './evidence-integrity.js';
import {KNOWLEDGE_EMBEDDINGS_MIGRATION_SQL} from './knowledge-embeddings.js';
import {RETENTION_RESOURCE_MIGRATION_SQL} from './retention-resources.js';
import {LEARNING_REPORT_MIGRATION_SQL} from './learning-reports.js';
import {MACHINE_INTEGRATION_MIGRATION_SQL} from './machine-integrations.js';
import {configureLifecycleMaintenanceRouting} from './maintenance-routing.js';
export async function applyProcessingJobMigration(pool: Pool): Promise<void> {
  await pool.query(PROCESSING_JOB_MIGRATION_SQL);
  await pool.query(TENANT_DOMAIN_MIGRATION_SQL);
  await pool.query(MEMBERSHIP_STATUS_MIGRATION_SQL);
  await pool.query(EMAIL_RATE_MIGRATION_SQL);
  await pool.query(EMAIL_DELIVERY_REPORT_MIGRATION_SQL);
  await pool.query(ORGANIZATION_PROFILE_MIGRATION_SQL);
  await pool.query(ORGANIZATION_LIFECYCLE_MIGRATION_SQL);
  await pool.query(PERSONAL_ACCOUNT_MIGRATION_SQL);
  await pool.query(ACCOUNT_SECURITY_MIGRATION_SQL);
  await pool.query(ACCOUNT_VERIFICATION_MIGRATION_SQL);
  await pool.query(EMAIL_CHALLENGE_MIGRATION_SQL);
  await pool.query(COURSE_OFFERING_MIGRATION_SQL);
  await pool.query(COURSE_CATALOG_MIGRATION_SQL);
  await pool.query(CANDIDATE_ENROLLMENT_MIGRATION_SQL);
  await pool.query(CANDIDATE_ACCESS_MIGRATION_SQL);
  await pool.query(PERSONAL_WALLET_MIGRATION_SQL);
  await pool.query(COURSE_STORY_MIGRATION_SQL);
  await pool.query(OPERATIONS_MIGRATION_SQL);
  await pool.query(LIFECYCLE_GOVERNANCE_MIGRATION_SQL);
  await pool.query(DISCOVERY_INQUIRIES_MIGRATION_SQL);
  await pool.query(CUSTOMER_WEBHOOK_MIGRATION_SQL);
  await pool.query(PROTECTED_EXPORT_MIGRATION_SQL);
  await pool.query(LIFECYCLE_NOTIFICATION_MIGRATION_SQL);
  await pool.query(RETENTION_GOVERNANCE_MIGRATION_SQL);
  await pool.query(EVIDENCE_INTEGRITY_MIGRATION_SQL);
  await pool.query(KNOWLEDGE_EMBEDDINGS_MIGRATION_SQL);
  await pool.query(RETENTION_RESOURCE_MIGRATION_SQL);
  await pool.query(LEARNING_REPORT_MIGRATION_SQL);
  await pool.query(MACHINE_INTEGRATION_MIGRATION_SQL);
  await configureLifecycleMaintenanceRouting(pool);
}
