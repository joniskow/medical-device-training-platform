import type {Pool} from 'pg';
export const COURSE_CATALOG_MIGRATION_SQL=`
-- Pure allowlist projection shared by public detail and immutable enrollment consent.
CREATE OR REPLACE FUNCTION public.catalog_certification_summary(content jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE policy jsonb:=content->'policy'; summary jsonb; module_row record; activity jsonb; kind text; threshold jsonb; required jsonb:='[]'::jsonb; field text;
BEGIN
 IF policy->>'schemaVersion' IS DISTINCT FROM 'certification-policy.v1' OR jsonb_typeof(content->'modules') IS DISTINCT FROM 'array' OR jsonb_typeof(policy->'requiredActivityIds') IS DISTINCT FROM 'array' OR jsonb_typeof(policy->'requiredModuleIds') IS DISTINCT FROM 'array' THEN RETURN NULL;END IF;
 summary:='{}'::jsonb;
 FOREACH field IN ARRAY ARRAY['version','passScore','maxAttempts','cooldownSeconds','attemptTtlSeconds','repeatedFailureReviewAfter','expirationDays'] LOOP
  IF jsonb_typeof(policy->field) NOT IN ('number','null') OR NOT policy ? field THEN RETURN NULL;END IF;
  IF field NOT IN ('repeatedFailureReviewAfter','expirationDays') AND jsonb_typeof(policy->field)<>'number' THEN RETURN NULL;END IF;
  summary:=summary||jsonb_build_object(field,policy->field);
 END LOOP;
 IF policy->>'resultSelection' NOT IN ('best','latest') OR policy->>'resultSelection' IS NULL THEN RETURN NULL;END IF;
 FOR module_row IN SELECT value,ordinality FROM jsonb_array_elements(content->'modules') WITH ORDINALITY LOOP
  IF jsonb_typeof(module_row.value->'activities') IS DISTINCT FROM 'array' THEN RETURN NULL;END IF;
  FOR activity IN SELECT value FROM jsonb_array_elements(module_row.value->'activities') LOOP
   IF NOT COALESCE(((policy->'requiredActivityIds') ? (activity->>'activityId') OR (policy->'requiredModuleIds') ? COALESCE(module_row.value->>'moduleId','module:'||(module_row.ordinality-1)::text)),false) THEN CONTINUE;END IF;
   kind:=CASE WHEN activity->>'type' IN ('multiple_choice','multi_select','ordered_step') THEN 'assessment' WHEN activity->>'type' IN ('simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly') THEN 'simulation' ELSE 'content' END;
   threshold:=CASE WHEN kind='assessment' THEN activity->'assessment'->'passScore' WHEN kind='simulation' THEN content->'simulation'->'definition'->'scoring'->'passScore' ELSE 'null'::jsonb END;
   IF kind<>'content' AND jsonb_typeof(threshold) IS DISTINCT FROM 'number' THEN RETURN NULL;END IF;
   required:=required||jsonb_build_array(jsonb_build_object('title',CASE WHEN jsonb_typeof(activity->'title')='string' THEN activity->>'title' ELSE 'Required activity' END,'kind',kind,'passScore',threshold));
  END LOOP;
 END LOOP;
 IF jsonb_array_length(required)=0 THEN RETURN NULL;END IF;
 RETURN summary||jsonb_build_object('resultSelection',policy->>'resultSelection','requiredActivities',required)||CASE WHEN policy->>'credentialIssuance'='DISABLED' THEN '{"credentialIssuance":"DISABLED"}'::jsonb ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public.catalog_certification_summary(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_course_catalog_route() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.course_catalog_routes(release_id,organization_id,public_id,listed)
 VALUES(NEW.release_id,NEW.organization_id,gen_random_uuid(),NEW.mode='PUBLIC')
 ON CONFLICT(release_id) DO UPDATE SET listed=EXCLUDED.listed,
 public_id=CASE WHEN TG_OP='UPDATE' AND NEW.mode<>OLD.mode AND NEW.mode<>'PRIVATE' THEN EXCLUDED.public_id ELSE public.course_catalog_routes.public_id END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_course_catalog_route() FROM PUBLIC;
DROP TRIGGER IF EXISTS course_catalog_route_sync ON public.course_offerings;
CREATE TRIGGER course_catalog_route_sync AFTER INSERT OR UPDATE ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION public.sync_course_catalog_route();
INSERT INTO public.course_catalog_routes(release_id,organization_id,public_id,listed) SELECT release_id,organization_id,gen_random_uuid(),mode='PUBLIC' FROM public.course_offerings ON CONFLICT(release_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.read_course_catalog(target_id uuid,after_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE route record; projected jsonb; items jsonb:='[]'::jsonb; previous_context text; last_id uuid; scanned integer:=0; has_more boolean:=false;
BEGIN
 previous_context:=current_setting('app.organization_id',true);
 FOR route IN SELECT c.* FROM public.course_catalog_routes c WHERE (target_id IS NOT NULL AND c.public_id=target_id) OR (target_id IS NULL AND c.listed AND (after_id IS NULL OR c.public_id>after_id)) ORDER BY c.public_id LIMIT 51 LOOP
  IF scanned=50 THEN has_more:=true;EXIT;END IF;
  scanned:=scanned+1;last_id:=route.public_id;
  PERFORM set_config('app.organization_id',route.organization_id,true);
  SELECT jsonb_build_object('publicId',route.public_id,'title',COALESCE(r.manifest->'content'->>'title',''),'issuerName',o.name,'revision',f.revision,
   'audience',f.details->>'audience','productScope',f.details->>'productScope','prerequisites',f.details->>'prerequisites',
   'issuerStatement',f.details->>'issuerStatement','intendedUse',f.details->>'intendedUse','accessibilityPath',f.details->>'accessibilityPath',
   'estimatedMinutes',f.details->'estimatedMinutes','costDesignation','free-in-MVP') || CASE WHEN target_id IS NOT NULL THEN jsonb_build_object('publishedRevision',CASE WHEN jsonb_typeof(r.manifest->'revision')='number' THEN r.manifest->'revision' ELSE NULL END,'certification',public.catalog_certification_summary(r.manifest->'content')) ELSE '{}'::jsonb END INTO projected
  FROM public.course_offerings f JOIN public.release_manifests r ON r.release_id=f.release_id AND r.organization_id=f.organization_id JOIN public.organizations o ON o.organization_id=f.organization_id
  WHERE f.release_id=route.release_id AND f.organization_id=route.organization_id AND o.status='ACTIVE' AND r.status='PUBLISHED' AND public.lifecycle_release_available(r.release_id)
   AND ((target_id IS NULL AND f.mode='PUBLIC') OR (target_id IS NOT NULL AND f.mode IN ('PUBLIC','UNLISTED')));
  IF projected IS NOT NULL THEN items:=items||jsonb_build_array(projected);END IF;
 END LOOP;
 PERFORM set_config('app.organization_id',COALESCE(previous_context,''),true);
 IF target_id IS NOT NULL THEN RETURN items->0;END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.read_course_catalog(uuid,uuid) FROM PUBLIC;
`;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCourseCatalogStore(pool:Pool){
 return {
  async list(after?:string){if(after!==undefined&&!uuid.test(after))throw Error('CATALOG_CURSOR_INVALID');return (await pool.query('SELECT public.read_course_catalog(NULL,$1::uuid) AS catalog',[after??null])).rows[0].catalog;},
  async get(publicId:string){if(!uuid.test(publicId))return null;return (await pool.query('SELECT public.read_course_catalog($1::uuid,NULL) AS catalog',[publicId])).rows[0].catalog;}
 };
}
