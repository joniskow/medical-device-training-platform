/** Row locks still need UPDATE privileges. Triggers prohibit runtime mutation of evidence
 * while allowing explicit superuser fixture cleanup in disposable test databases. */
export const EVIDENCE_INTEGRITY_MIGRATION_SQL = `
CREATE OR REPLACE FUNCTION public.protect_immutable_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
  RAISE EXCEPTION 'IMMUTABLE_EVIDENCE';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE target text; BEGIN
 FOREACH target IN ARRAY ARRAY['audit_events','credential_events','progress_events','course_review_decisions','ai_runs','release_manifests','release_model_bindings','lifecycle_tombstones'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS immutable_evidence ON public.%I',target);
  EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_immutable_evidence()',target);
 END LOOP;
END $$;
`;
