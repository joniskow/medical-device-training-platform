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

CREATE INDEX IF NOT EXISTS processing_jobs_available_idx ON processing_jobs (state, available_at);
CREATE INDEX IF NOT EXISTS processing_jobs_lease_idx ON processing_jobs (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS processing_jobs_organization_idx ON processing_jobs (organization_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS processing_job_outbox_available_idx ON processing_job_outbox (state, available_at, created_at);

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

CREATE INDEX IF NOT EXISTS processing_job_audit_job_idx ON processing_job_audit (organization_id, job_id, created_at DESC);

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
