import type {Pool} from 'pg';
export const CANDIDATE_ENROLLMENT_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS public.candidate_enrollment_consents(
 user_id text NOT NULL,request_key text NOT NULL,organization_id text NOT NULL,
 enrollment_id text NOT NULL REFERENCES public.enrollments(enrollment_id),release_id text NOT NULL REFERENCES public.release_manifests(release_id),
 request_signature text NOT NULL,offering_revision integer NOT NULL,release_hash text NOT NULL,
 disclosures jsonb NOT NULL,notice_version text NOT NULL,accepted_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,request_key)
);
ALTER TABLE public.candidate_enrollment_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_enrollment_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_consent_owner ON public.candidate_enrollment_consents;
CREATE POLICY candidate_consent_owner ON public.candidate_enrollment_consents USING(user_id=NULLIF(current_setting('app.user_id',true),'')) WITH CHECK(user_id=NULLIF(current_setting('app.user_id',true),''));
CREATE OR REPLACE FUNCTION public.enroll_course_candidate(actor text,course_public_id uuid,expected_revision integer,notice_version_value text,request_key_value text,correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE route public.course_catalog_routes%ROWTYPE; offering public.course_offerings%ROWTYPE; released public.release_manifests%ROWTYPE; consent public.candidate_enrollment_consents%ROWTYPE; enrollment public.enrollments%ROWTYPE; signature_value text; selected_org text; previous_org text; previous_user text;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR course_public_id IS NULL OR expected_revision IS NULL OR expected_revision<1 OR (notice_version_value IS NULL OR notice_version_value NOT IN ('candidate-notice.v1','candidate-notice.v2')) OR request_key_value IS NULL OR request_key_value !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'CANDIDATE_ENROLLMENT_INVALID';END IF;
 previous_org:=current_setting('app.organization_id',true);previous_user:=current_setting('app.user_id',true);
 PERFORM set_config('app.user_id',actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('candidate-request:'||jsonb_build_array(actor,request_key_value)::text,0));
 signature_value:=encode(sha256(convert_to(jsonb_build_array(course_public_id,expected_revision,notice_version_value)::text,'UTF8')),'hex');
 SELECT * INTO consent FROM public.candidate_enrollment_consents WHERE user_id=actor AND request_key=request_key_value;
 IF FOUND THEN
  IF consent.request_signature<>signature_value THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';END IF;
  selected_org:=consent.organization_id;
 ELSE
  IF notice_version_value<>'candidate-notice.v2' THEN RAISE EXCEPTION 'CANDIDATE_DISCLOSURES_CHANGED';END IF;
  SELECT * INTO route FROM public.course_catalog_routes WHERE public_id=course_public_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANDIDATE_COURSE_UNAVAILABLE';END IF;
  selected_org:=route.organization_id;
 END IF;
 PERFORM set_config('app.organization_id',selected_org,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('member-admin:'||selected_org,0));
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE organization_id=selected_org AND status='ACTIVE') OR EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=selected_org AND subject=actor AND status<>'ACTIVE') THEN RAISE EXCEPTION 'CANDIDATE_COURSE_UNAVAILABLE';END IF;
 IF NOT public.has_verified_account(actor) THEN RAISE EXCEPTION 'CANDIDATE_VERIFIED_ACCOUNT_REQUIRED';END IF;
 SELECT * INTO released FROM public.release_manifests WHERE organization_id=selected_org AND release_id=COALESCE(consent.release_id,route.release_id) AND status='PUBLISHED' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CANDIDATE_COURSE_UNAVAILABLE';END IF;
 IF consent.enrollment_id IS NOT NULL THEN
  SELECT * INTO enrollment FROM public.enrollments WHERE organization_id=selected_org AND enrollment_id=consent.enrollment_id AND learner_id=actor AND status='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANDIDATE_ENROLLMENT_INACTIVE';END IF;
 ELSE
  SELECT * INTO offering FROM public.course_offerings WHERE organization_id=selected_org AND release_id=route.release_id AND mode IN ('PUBLIC','UNLISTED') FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.course_catalog_routes WHERE public_id=course_public_id AND release_id=route.release_id) THEN RAISE EXCEPTION 'CANDIDATE_COURSE_UNAVAILABLE';END IF;
  IF offering.revision<>expected_revision THEN RAISE EXCEPTION 'CANDIDATE_DISCLOSURES_CHANGED';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(selected_org,actor,released.course_version_id)::text,0));
  SELECT * INTO enrollment FROM public.enrollments WHERE organization_id=selected_org AND learner_id=actor AND course_version_id=released.course_version_id ORDER BY (status='ACTIVE') DESC,created_at,enrollment_id LIMIT 1 FOR UPDATE;
  IF FOUND AND enrollment.status<>'ACTIVE' THEN RAISE EXCEPTION 'CANDIDATE_ENROLLMENT_INACTIVE';END IF;
  IF enrollment.enrollment_id IS NULL THEN
   INSERT INTO public.enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES('enrollment:'||gen_random_uuid()::text,selected_org,actor,released.course_version_id,'ACTIVE',now(),now()) RETURNING * INTO enrollment;
  END IF;
  INSERT INTO public.candidate_enrollment_consents(user_id,request_key,organization_id,enrollment_id,release_id,request_signature,offering_revision,release_hash,disclosures,notice_version,accepted_at)
  VALUES(actor,request_key_value,selected_org,enrollment.enrollment_id,released.release_id,signature_value,expected_revision,released.release_hash,offering.details||jsonb_build_object('title',released.manifest->'content'->>'title','issuerName',(SELECT name FROM public.organizations WHERE organization_id=selected_org),'publicId',course_public_id,'mode',offering.mode,'publishedRevision',CASE WHEN jsonb_typeof(released.manifest->'revision')='number' THEN released.manifest->'revision' ELSE NULL END,'certification',public.catalog_certification_summary(released.manifest->'content')),notice_version_value,now());
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
  VALUES('candidate:'||gen_random_uuid()::text,selected_org,actor,'CANDIDATE_ENROLLED','enrollment',enrollment.enrollment_id,jsonb_build_object('releaseId',released.release_id,'releaseHash',released.release_hash,'offeringRevision',expected_revision,'noticeVersion',notice_version_value,'correlationId',correlation),now());
 END IF;
 PERFORM set_config('app.organization_id',COALESCE(previous_org,''),true);PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);
 RETURN jsonb_build_object('enrollmentId',enrollment.enrollment_id,'releaseId',released.release_id,'organizationId',selected_org,'status',enrollment.status);
END $$;
REVOKE ALL ON FUNCTION public.enroll_course_candidate(text,uuid,integer,text,text,text) FROM PUBLIC;
`;
export const CANDIDATE_NOTICE_VERSION='candidate-notice.v2';
export const CANDIDATE_NOTICE_TEXT='I have reviewed the published course revision, certification requirements, issuer, product scope, prerequisites, intended use, accessibility path and estimated effort. This is free organization-issued product training, not professional licensure or regulatory approval. Credential sharing and discoverability are separate choices.';
export function createCandidateEnrollmentStore(pool:Pool){
 return {async enroll(actor:string,input:{publicId:string;revision:number;noticeVersion:string;idempotencyKey:string},correlationId:string){
  if(typeof actor!=='string'||!actor||actor.length>256||typeof input.publicId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.publicId)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>2147483647||!['candidate-notice.v1',CANDIDATE_NOTICE_VERSION].includes(input.noticeVersion)||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey))throw Error('CANDIDATE_ENROLLMENT_INVALID');
  return (await pool.query('SELECT public.enroll_course_candidate($1,$2::uuid,$3,$4,$5,$6) AS enrollment',[actor,input.publicId,input.revision,input.noticeVersion,input.idempotencyKey,correlationId])).rows[0].enrollment;
 }};
}
