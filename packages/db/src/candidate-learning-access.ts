import type {Pool} from 'pg';
export const CANDIDATE_ACCESS_MIGRATION_SQL=`
CREATE INDEX IF NOT EXISTS candidate_consent_learning_idx ON public.candidate_enrollment_consents(user_id,organization_id,enrollment_id);
CREATE OR REPLACE FUNCTION public.read_candidate_learning_access(actor text,target_org text,after_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_org text;previous_user text;route record;item jsonb;items jsonb:='[]'::jsonb;last_id text;scanned integer:=0;has_more boolean:=false;permitted boolean:=false;
BEGIN
 IF actor IS NULL OR length(actor) NOT BETWEEN 1 AND 256 OR (target_org IS NOT NULL AND length(target_org) NOT BETWEEN 1 AND 128) OR (after_id IS NOT NULL AND after_id !~ '^[A-Za-z0-9._:-]{1,128}$') THEN RAISE EXCEPTION 'CANDIDATE_ACCESS_INVALID';END IF;
 previous_org:=current_setting('app.organization_id',true);previous_user:=current_setting('app.user_id',true);PERFORM set_config('app.user_id',actor,true);
 IF EXISTS(SELECT 1 FROM public.personal_accounts WHERE user_id=actor AND status='ACTIVE') THEN
  IF target_org IS NOT NULL THEN
   PERFORM set_config('app.organization_id',target_org,true);
   SELECT EXISTS(SELECT 1 FROM public.candidate_enrollment_consents c JOIN public.enrollments e ON e.organization_id=c.organization_id AND e.enrollment_id=c.enrollment_id AND e.learner_id=c.user_id JOIN public.release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id AND r.release_id=c.release_id JOIN public.organizations o ON o.organization_id=e.organization_id
    WHERE c.user_id=actor AND c.organization_id=target_org AND e.status='ACTIVE' AND r.status='PUBLISHED' AND o.status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=target_org AND subject=actor AND status<>'ACTIVE')) INTO permitted;
  ELSE
   FOR route IN SELECT DISTINCT c.enrollment_id,c.organization_id,c.release_id FROM public.candidate_enrollment_consents c WHERE c.user_id=actor AND (after_id IS NULL OR c.enrollment_id>after_id) ORDER BY c.enrollment_id LIMIT 51 LOOP
    IF scanned=50 THEN has_more:=true;EXIT;END IF;
    scanned:=scanned+1;last_id:=route.enrollment_id;PERFORM set_config('app.organization_id',route.organization_id,true);
    SELECT jsonb_build_object('enrollmentId',e.enrollment_id,'organizationId',e.organization_id,'releaseId',r.release_id,'title',r.manifest->'content'->>'title','issuerName',o.name,'status',e.status) INTO item
    FROM public.enrollments e JOIN public.release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id AND r.release_id=route.release_id JOIN public.organizations o ON o.organization_id=e.organization_id
    WHERE e.enrollment_id=route.enrollment_id AND e.organization_id=route.organization_id AND e.learner_id=actor AND e.status='ACTIVE' AND r.status='PUBLISHED' AND o.status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=route.organization_id AND subject=actor AND status<>'ACTIVE');
    IF item IS NOT NULL THEN items:=items||jsonb_build_array(item);END IF;
   END LOOP;
  END IF;
 END IF;
 PERFORM set_config('app.organization_id',COALESCE(previous_org,''),true);PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);
 IF target_org IS NOT NULL THEN RETURN jsonb_build_object('allowed',permitted);END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.read_candidate_learning_access(text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.default_credential_sharing(actor text,target_enrollment text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous_user text;candidate boolean;
BEGIN
 previous_user:=current_setting('app.user_id',true);PERFORM set_config('app.user_id',actor,true);
 SELECT EXISTS(SELECT 1 FROM public.candidate_enrollment_consents WHERE user_id=actor AND enrollment_id=target_enrollment AND organization_id=NULLIF(current_setting('app.organization_id',true),'')) INTO candidate;
 PERFORM set_config('app.user_id',COALESCE(previous_user,''),true);RETURN NOT candidate;
END $$;
REVOKE ALL ON FUNCTION public.default_credential_sharing(text,text) FROM PUBLIC;
`;
export function createCandidateLearningAccessStore(pool:Pool){
 return {
  async canAccess(actor:string,organizationId:string):Promise<boolean>{if(!organizationId||organizationId.length>128)return false;return (await pool.query('SELECT public.read_candidate_learning_access($1,$2,NULL) AS access',[actor,organizationId])).rows[0].access.allowed===true;},
  async list(actor:string,after?:string){if(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('CANDIDATE_ACCESS_INVALID');return (await pool.query('SELECT public.read_candidate_learning_access($1,NULL,$2) AS access',[actor,after??null])).rows[0].access;}
 };
}
