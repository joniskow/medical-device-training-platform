import assert from "node:assert/strict";
import { createCourseChangeNotificationStore } from "../packages/db/dist/index.js";
import { createPostgresEnrollmentService } from "../apps/api/dist/enrollment-service.js";
import { createCourseChangeService } from "../apps/api/dist/course-change-service.js";
import { createNotificationService } from "../apps/api/dist/notification-service.js";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";
import { Pool } from "pg";
import {
  applyProcessingJobMigration,
  createPostgresCourseReviewStore
} from "../packages/db/dist/index.js";

const pool = new Pool({ connectionString: "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const id = `release_${Date.now()}`;
const tenant = { organizationId: `${id}_org`, actorId: `${id}_publisher`, correlationId: `${id}_corr` };
const authorId = `${id}_author`;
const reviewerId = `${id}_reviewer`;
const courseId = `${id}_course`;
const courseVersionId = `${id}_coursev`;
const aiRunId = `${id}_ai`;
const assetVersionId = `${id}_assetv`;
const modelVersionId = `${id}_model`;
const modelManifestHash = "c".repeat(64);
const simulationDefinitionId = `${id}_simulation`;
const policyId = `${id}_policy`;
const courseContent = {
  schemaVersion: "course-draft.v1",
  title: "Pilot course",
  citations: [{ assetVersionId, citation: { page: 1, anchor: "procedure" } }],
  model: {
    modelVersionId,
    manifestHash: modelManifestHash,
    manifest: {
      schemaVersion: "model-manifest.v1", format: "glb", sourceHash: modelManifestHash, modelVersionId, unitSystem: "meter", scaleMeters: 1, upAxis: "Y", handedness: "right", origin: "bounding-box-center", forwardAxis: "-Z", normalizationStatus: "CANONICAL",
      sceneNodeCount: 1, meshCount: 1, materialCount: 1, textureCount: 0, triangleCount: 1,
      materials: [{ materialId: "mat-control-panel", name: "Control panel" }],
      textures: [],
      variants: [{ variantId: "mobile", sourceHash: "d".repeat(64), modelBlobKey: `${tenant.organizationId}/model.mobile.glb`, manifestBlobKey: `${tenant.organizationId}/model.mobile.json`, targetProfiles: ["ios-webgl2", "android-webgl2"] }],
      components: [{ componentId: "AIC-C01", nodePath: "Controller/Panel", displayName: "Control panel", aliases: [], interactionCapabilities: ["select"] }]
    }
  },
  simulation: {
    simulationDefinitionId,
    definition: {
      schemaVersion: "simulation-definition.v1", simulationDefinitionId, version: 1,
      model: { modelVersionId, manifestHash: modelManifestHash, componentIds: ["AIC-C01"] },
      components: [{ componentId: "AIC-C01", initialState: "idle", allowedActions: ["select_component"] }],
      initialState: { currentStepId: "identify-panel", variables: {}, componentStates: { "AIC-C01": "idle" } },
      steps: [{ stepId: "identify-panel", title: "Identify the control panel", action: { type: "select_component", componentId: "AIC-C01" }, nextStepIds: [], points: 1 }],
      faults: [], scoring: { maxScore: 1, passScore: 0.8, stepPoints: { "identify-panel": 1 }, faultPoints: {}, penalties: {} },
      completion: { requiredStepIds: ["identify-panel"], requiredFaultIds: [], terminalStepIds: ["identify-panel"] },
      equivalentPath: { mode: "TEXT_KEYBOARD", instructions: [{ stepId: "identify-panel", text: "Select the control panel using the keyboard." }], faultInstructions: [] }
    }
  },
  policy: { policyId, version: 1, maxAttempts: 3, cooldownSeconds: 60, attemptTtlSeconds: 1800, requiredEvidence: ["simulation.completed", "simulation.equivalent-path"] },
  modules: [{ moduleId: "procedure", title: "Procedure", activities: [{ type: "simulation", simulationDefinitionId, citations: [{ assetVersionId }] }] }]
};

if(process.argv.includes('--update-modules')){
  courseContent.modules[0].activities[0].activityId='simulation';
  Object.assign(courseContent.policy,{schemaVersion:'certification-policy.v1',requiredActivityIds:['simulation'],requiredModuleIds:[],resultSelection:'latest',passScore:0.8,repeatedFailureReviewAfter:null,expirationDays:365});
}
try {
  await applyProcessingJobMigration(pool);
  await pool.query(`
    INSERT INTO courses (course_id, organization_id, name, status, created_by, created_at, updated_at)
    VALUES ($1, $2, 'Pilot course', 'DRAFT', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [courseId, tenant.organizationId, authorId]);
  await pool.query(`
    INSERT INTO course_versions (course_version_id, course_id, organization_id, revision, content, status, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, 1, $4::jsonb, 'DRAFT', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [courseVersionId, courseId, tenant.organizationId, JSON.stringify(courseContent), authorId]);
  await pool.query(`
    INSERT INTO assets (asset_id, organization_id, source_type, status, created_by, updated_by, created_at, updated_at)
    VALUES ($1, $2, 'pdf', 'APPROVED', $3, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [`${id}_asset`, tenant.organizationId, authorId]);
  await pool.query(`
    INSERT INTO asset_versions (asset_version_id, asset_id, organization_id, source_type, blob_key, file_name, content_type, size_bytes, sha256, state, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, 'pdf', $4, 'manual.pdf', 'application/pdf', 1, $5, 'APPROVED', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [assetVersionId, `${id}_asset`, tenant.organizationId, `${tenant.organizationId}/manual.pdf`, "a".repeat(64), authorId]);
  await pool.query(`
    INSERT INTO model_versions (model_version_id, organization_id, blob_key, manifest_blob_key, manifest, status, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, 'APPROVED', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [modelVersionId, tenant.organizationId, `${tenant.organizationId}/model.glb`, `${tenant.organizationId}/model.json`, JSON.stringify(courseContent.model.manifest), reviewerId]);
  await pool.query(`
    INSERT INTO ai_runs (ai_run_id, organization_id, course_version_id, operation, source_artifact_ids, provider, deployment, model, api_version, prompt_version, output_schema_version, status, output, citations, warnings, metrics, created_at, updated_at)
    VALUES ($1, $2, $3, 'generate_course_draft', $4, 'foundry', 'deterministic-local', 'deterministic', 'local', 'course-draft.v1', 'course-draft.v1', 'DRAFT', $5::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [aiRunId, tenant.organizationId, courseVersionId, [assetVersionId], JSON.stringify({ schemaVersion: "course-draft.v1", title: "Pilot course" })]);

  const releaseArtifacts = {
    releaseManifestBlobKey({ organizationId, releaseId }) {
      return `${organizationId}/releases/${releaseId}/release-manifest.json`;
    },
    async materializeModelArtifacts({ organizationId, releaseId, modelVersionId, manifest }) {
      const prefix = `${organizationId}/releases/${releaseId}/models/${modelVersionId}`;
      return {
        modelBlobKey: `${prefix}/full.glb`,
        manifestBlobKey: `${prefix}/full.json`,
        manifest: {
          ...manifest,
          variants: manifest.variants.map((variant) => ({ ...variant, modelBlobKey: `${prefix}/${variant.variantId}.glb`, manifestBlobKey: `${prefix}/${variant.variantId}.json` }))
        }
      };
    },
    async materializeReleaseManifest({ manifest, releaseHash }) {
      assert.equal(manifest.schemaVersion, "release-manifest.v1");
      assert.match(releaseHash, /^[0-9a-f]{64}$/);
    }
  };
  const store = createPostgresCourseReviewStore(pool, { releaseArtifacts });
  await store.recordDecision({ tenant: { ...tenant, actorId: reviewerId }, courseVersionId, targetType: "AI_DRAFT", targetId: aiRunId, decision: "APPROVE", rationale: "Reviewed against the pilot source.", revision: 1, idempotencyKey: `${id}:review:ai`, requestHash: "review-hash" });
  await store.recordDecision({ tenant: { ...tenant, actorId: reviewerId }, courseVersionId, targetType: "COURSE", targetId: courseVersionId, decision: "APPROVE", rationale: "Content is ready for publisher review.", revision: 1, idempotencyKey: `${id}:review:course`, requestHash: "review-course-hash" });
  await store.recordDecision({ tenant: { ...tenant, actorId: reviewerId }, courseVersionId, targetType: "MODEL", targetId: modelVersionId, decision: "APPROVE", rationale: "Model manifest reviewed against the reference GLB.", revision: 1, idempotencyKey: `${id}:review:model`, requestHash: "review-model-hash" });
  await store.recordDecision({ tenant: { ...tenant, actorId: reviewerId }, courseVersionId, targetType: "SIMULATION", targetId: simulationDefinitionId, decision: "APPROVE", rationale: "Simulation replay and equivalent path reviewed.", revision: 1, idempotencyKey: `${id}:review:simulation`, requestHash: "review-simulation-hash" });
  await store.recordDecision({ tenant: { ...tenant, actorId: reviewerId }, courseVersionId, targetType: "POLICY", targetId: policyId, decision: "APPROVE", rationale: "Certification evidence requirements reviewed.", revision: 1, idempotencyKey: `${id}:review:policy`, requestHash: "review-policy-hash" });

  const first = await store.publish({ tenant, courseVersionId, idempotencyKey: `${id}:publish`, requestHash: "publish-hash" });
  assert.ok(first?.releaseId);
  assert.match(first.releaseHash, /^[0-9a-f]{64}$/);
  assert.equal(first.manifest.courseVersionId, courseVersionId);

  const second = await store.publish({ tenant, courseVersionId, idempotencyKey: `${id}:publish`, requestHash: "publish-hash" });
  assert.deepEqual(second, first);
  await assert.rejects(
    createPostgresCourseReviewStore(pool).publish({ tenant, courseVersionId, idempotencyKey: `${id}:publish-without-artifacts`, requestHash: "publish-without-artifacts" }),
    /RELEASE_ARTIFACT_PUBLISHER_REQUIRED/
  );
  const rows = await pool.query("SELECT status, release_manifest_id FROM course_versions WHERE course_version_id = $1", [courseVersionId]);
  assert.deepEqual(rows.rows[0], { status: "PUBLISHED", release_manifest_id: first.releaseId });
  const binding = await pool.query("SELECT release_binding_id, model_version_id, manifest_hash, model_blob_key, manifest_blob_key, manifest FROM release_model_bindings WHERE organization_id = $1 AND release_id = $2", [tenant.organizationId, first.releaseId]);
  assert.equal(binding.rows[0].release_binding_id, `releasebind:${first.releaseId}:${modelVersionId}`);
  assert.equal(binding.rows[0].model_version_id, modelVersionId);
  assert.equal(binding.rows[0].manifest_hash, modelManifestHash);
  const releaseModelPrefix = `${tenant.organizationId}/releases/${first.releaseId}/models/${modelVersionId}`;
  assert.equal(binding.rows[0].model_blob_key, `${releaseModelPrefix}/full.glb`);
  assert.equal(binding.rows[0].manifest_blob_key, `${releaseModelPrefix}/full.json`);
  assert.equal(binding.rows[0].manifest.variants[0].variantId, "mobile");
  assert.equal(binding.rows[0].manifest.variants[0].releaseBindingId, `releasebind:${first.releaseId}:${modelVersionId}`);
  assert.equal(binding.rows[0].manifest.variants[0].modelBlobKey, `${releaseModelPrefix}/mobile.glb`);
  assert.equal(binding.rows[0].manifest.variants[0].manifestBlobKey, `${releaseModelPrefix}/mobile.json`);
  assert.equal(first.manifest.releaseArtifact.manifestBlobKey, `${tenant.organizationId}/releases/${first.releaseId}/release-manifest.json`);
  const outbox = await pool.query("SELECT COUNT(*)::int AS count FROM outbox_events WHERE organization_id = $1 AND event_type = 'course.release.published'", [tenant.organizationId]);
  assert.equal(outbox.rows[0].count, 1);
  const author={...tenant,actorId:authorId};
  const revisions=createPostgresCourseReviewStore(runtime);
  const revisionRequest={tenant:author,courseVersionId,reason:'Update procedure training',idempotencyKey:'create-revision'};
  const [fork,retryFork]=await Promise.all([revisions.createRevision(revisionRequest),revisions.createRevision(revisionRequest)]);assert.deepEqual(fork,retryFork);assert.equal(fork.courseId,courseId);
  await assert.rejects(store.createRevision({...revisionRequest,reason:'Different reason'}),/IDEMPOTENCY_KEY_REUSED/);
  await assert.rejects(store.createRevision({...revisionRequest,idempotencyKey:'another-draft'}),/COURSE_REVISION_ALREADY_OPEN/);
  await assert.rejects(revisions.createRevision({...revisionRequest,tenant:{...author,organizationId:'foreign'}}),/COURSE_VERSION_NOT_FOUND/);
  const draft=await store.get(author,fork.courseVersionId);assert.equal(draft.courseVersion.status,'DRAFT');assert.equal(draft.decisions.length,0);assert.equal(draft.courseVersion.content.policy.version,2);assert.equal(draft.courseVersion.content.simulation.definition.version,2);
  assert.equal(draft.courseVersion.content._lineage.sourceReleaseId,first.releaseId);assert.equal(draft.courseVersion.content._source.aiRunId,aiRunId);
  await assert.rejects(store.publish({tenant,courseVersionId:fork.courseVersionId,idempotencyKey:'unreviewed-revision',requestHash:'unreviewed'}),/COURSE_NOT_PUBLISHABLE/);
  let saved=await store.saveDraft({tenant:author,courseVersionId:fork.courseVersionId,revision:draft.courseVersion.revision,content:{...draft.courseVersion.content,title:'Updated pilot course',_lineage:{sourceReleaseId:'forged'},_source:{aiRunId:'forged'}}});
  const edited=await store.get(author,fork.courseVersionId);assert.equal(edited.courseVersion.content._lineage.sourceReleaseId,first.releaseId);assert.equal(edited.courseVersion.content._source.aiRunId,aiRunId);
  for(const [targetType,targetId] of [['AI_DRAFT',aiRunId],['COURSE',fork.courseVersionId],['MODEL',modelVersionId],['SIMULATION',simulationDefinitionId],['POLICY',policyId]])await store.recordDecision({tenant:{...tenant,actorId:reviewerId},courseVersionId:fork.courseVersionId,targetType,targetId,decision:'APPROVE',rationale:'Reviewed updated content and inherited source evidence',revision:saved.revision,idempotencyKey:'revision:'+targetType,requestHash:'revision:'+targetType});
  await assert.rejects(store.publish({tenant,courseVersionId:fork.courseVersionId,idempotencyKey:'missing-impact',requestHash:'missing-impact'}),error=>error.findings?.some(f=>f.code==='RELEASE_CHANGE_REQUIRED'));
  const releaseChange={schemaVersion:'release-change.v1',classes:['simulation','instructional'],releaseNotes:'Updated procedure sequence',effectiveAt:new Date(Date.now()-60000).toISOString(),decision:'full_retake',rationale:'Procedure changes affect demonstrated competency',learnerMessage:'Complete the updated course before using the revised procedure.',updateModuleIds:[]};
  if(process.argv.includes('--update-modules')){releaseChange.decision='update_modules';releaseChange.updateModuleIds=['procedure'];}
  saved=await store.saveDraft({tenant:author,courseVersionId:fork.courseVersionId,revision:saved.revision,content:{...edited.courseVersion.content,releaseChange}});
  await assert.rejects(store.publish({tenant,courseVersionId:fork.courseVersionId,idempotencyKey:'stale-impact-approval',requestHash:'stale-impact-approval'}),/COURSE_NOT_PUBLISHABLE/);
  for(const [targetType,targetId] of [['AI_DRAFT',aiRunId],['COURSE',fork.courseVersionId],['MODEL',modelVersionId],['SIMULATION',simulationDefinitionId],['POLICY',policyId]])await store.recordDecision({tenant:{...tenant,actorId:reviewerId},courseVersionId:fork.courseVersionId,targetType,targetId,decision:'APPROVE',rationale:'Reviewed issuer impact decision and learner communication',revision:saved.revision,idempotencyKey:'impact:'+targetType,requestHash:'impact:'+targetType});
  await pool.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) SELECT $1||n,$2,'learner:'||lpad(n::text,3,'0'),$3,'ACTIVE',now(),now() FROM generate_series(1,51)n`,[id+':enrollment:',tenant.organizationId,courseVersionId]);
  const updated=await store.publish({tenant,courseVersionId:fork.courseVersionId,idempotencyKey:'publish-revision',requestHash:'publish-revision'});
  assert.notEqual(updated.releaseId,first.releaseId);assert.equal(updated.manifest.aiRun.aiRunId,aiRunId);assert.equal(updated.manifest.content.title,'Updated pilot course');
  assert.deepEqual(updated.manifest.content.releaseChange,releaseChange);
  const changeEvent=(await pool.query(`SELECT payload FROM outbox_events WHERE organization_id=$1 AND payload->>'releaseId'=$2`,[tenant.organizationId,updated.releaseId])).rows[0];assert.equal(changeEvent.payload.changeApplicationRequested,true);assert.deepEqual(changeEvent.payload.releaseChange,releaseChange);
  const noticeStore=createCourseChangeNotificationStore(runtime),inbox=createNotificationService(runtime);
  const job=(await pool.query(`SELECT outbox_event_id FROM outbox_events WHERE organization_id=$1 AND event_type='course.change.notify'`,[tenant.organizationId])).rows[0].outbox_event_id;
  const dispatchRole=id+'_dispatch',dispatchPolicy=id+'_dispatch_read';
  assert.match(dispatchRole,/^[a-z0-9_]+$/);
  const control=await pool.connect();
  try{
    await control.query(`CREATE ROLE ${dispatchRole} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await control.query(`GRANT USAGE ON SCHEMA public TO ${dispatchRole}`);
    await control.query(`GRANT SELECT(outbox_event_id,organization_id,event_type,state,available_at) ON outbox_events TO ${dispatchRole}`);
    await control.query(`CREATE POLICY ${dispatchPolicy} ON outbox_events FOR SELECT TO ${dispatchRole} USING(event_type IN ('course.change.notify','course.change.assign'))`);
    await control.query(`SET ROLE ${dispatchRole}`);
    const routed=await control.query(`SELECT outbox_event_id,organization_id FROM outbox_events WHERE event_type='course.change.notify' AND state='PENDING' AND available_at<=now() AND organization_id=$1 ORDER BY available_at,outbox_event_id LIMIT 5`,[tenant.organizationId]);assert.equal(routed.rows.length,1);
    assert.equal((await control.query(`SELECT outbox_event_id FROM outbox_events WHERE event_type='course.release.published' AND organization_id=$1`,[tenant.organizationId])).rows.length,0);
    await assert.rejects(control.query('SELECT payload FROM outbox_events'),/permission denied/);
  }finally{await control.query('RESET ROLE');await control.query(`DROP POLICY IF EXISTS ${dispatchPolicy} ON outbox_events`);await control.query(`DROP OWNED BY ${dispatchRole}`);await control.query(`DROP ROLE ${dispatchRole}`);control.release();}
  await pool.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,'late-learner',$3,'ACTIVE',now()+interval '1 second',now())`,[id+':late',tenant.organizationId,courseVersionId]);
  assert.equal((await noticeStore.process({...tenant,organizationId:'foreign'},job)).state,'SKIPPED');
  let inserts=0;
  const brokenPool={async connect(){const c=await runtime.connect();return {query(sql,args){if(String(sql).includes('INSERT INTO notifications')&&++inserts===2)throw Error('Injected notice write failure');return c.query(sql,args);},release(){c.release();}};}};
  const failedNotice=await createCourseChangeNotificationStore(brokenPool).process(tenant,job);assert.equal(failedNotice.errorCode,'NOTIFICATION_DELIVERY_FAILED');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM notifications WHERE organization_id=$1`,[tenant.organizationId])).rows[0].n,0,'Partial batch must roll back');
  assert.equal((await noticeStore.process(tenant,job)).state,'SKIPPED','Retry delay must be enforced');
  await pool.query(`UPDATE outbox_events SET available_at=now() WHERE outbox_event_id=$1`,[job]);
  await noticeStore.process(tenant,job);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM notifications WHERE organization_id=$1`,[tenant.organizationId])).rows[0].n,50);
  const failingRemainder={async connect(){const c=await runtime.connect();return {query(sql,args){if(String(sql).includes('INSERT INTO notifications'))throw Error('Remainder unavailable');return c.query(sql,args);},release(){c.release();}};}};
  for(let attempt=0;attempt<5;attempt++){await pool.query(`UPDATE outbox_events SET available_at=now() WHERE outbox_event_id=$1`,[job]);await createCourseChangeNotificationStore(failingRemainder).process(tenant,job);}
  const recovery=createCourseChangeService(runtime),failed=(await recovery.failedJobs(tenant)).items.find(item=>item.jobId===job);assert(failed);assert.equal(failed.processed,50);
  await recovery.retry(tenant,job,{reason:'Delivery restored',retryToken:failed.retryToken,idempotencyKey:'recover-remainder'});
  await Promise.all([noticeStore.process(tenant,job),noticeStore.process(tenant,job)]);
  await noticeStore.process(tenant,job);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM notifications WHERE organization_id=$1`,[tenant.organizationId])).rows[0].n,51);
  assert.equal((await pool.query(`SELECT state FROM outbox_events WHERE outbox_event_id=$1`,[job])).rows[0].state,'PUBLISHED');
  assert.equal((await noticeStore.process(tenant,job)).state,'SKIPPED');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_CHANGE_NOTICES_DELIVERED'`,[tenant.organizationId])).rows[0].n,1);
  const learner={...tenant,actorId:'learner:001'},messages=await inbox.list(learner);assert.equal(messages.items.length,1);assert.equal(messages.items[0].message,releaseChange.learnerMessage);assert.equal(messages.items[0].read,false);
  assert.equal((await inbox.list({...learner,actorId:'late-learner'})).items.length,0);assert.equal((await inbox.list({...learner,organizationId:'foreign'})).items.length,0);
  assert.ok(!JSON.stringify(messages).includes('sourceReleaseHash'));assert.ok(!JSON.stringify(messages).includes(aiRunId));
  const noticeId=messages.items[0].notificationId;
  await assert.rejects(inbox.markRead({...learner,actorId:'other'},noticeId),/NOTIFICATION_NOT_FOUND/);
  await Promise.all([inbox.markRead(learner,noticeId),inbox.markRead(learner,noticeId)]);assert.equal((await inbox.list(learner)).items[0].read,true);
  const http=createJobStatusHttpServer({courseChangeService:createCourseChangeService(runtime),notificationService:inbox,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization==='Bearer admin'?{subject:'admin',roles:['organization_admin']}:req.headers.authorization?{subject:'learner:001',roles:['learner']}:null},organizationContextResolver:{resolveActiveOrganizations:async()=>[tenant.organizationId]}});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  try{const previewUrl=`http://127.0.0.1:${http.address().port}/api/v1/course-changes/${updated.releaseId}`;assert.equal((await fetch(previewUrl,{headers:{authorization:'Bearer learner'}})).status,403);const previewResponse=await fetch(previewUrl,{headers:{authorization:'Bearer admin'}});assert.equal(previewResponse.status,200);assert.equal((await previewResponse.json()).totalAffected,51);const base=`http://127.0.0.1:${http.address().port}/api/v1/notifications`;assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{headers:{authorization:'Bearer learner'}})).status,200);assert.equal((await fetch(base+'/'+noticeId+'/read',{method:'POST',headers:{authorization:'Bearer learner','content-type':'application/json'},body:'{"recipientId":"other"}'})).status,422);}finally{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
  await pool.query(`INSERT INTO organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at) SELECT $1||n,'learner:'||lpad(n::text,3,'0'),$2,CASE WHEN n=50 THEN 'SUSPENDED' ELSE 'ACTIVE' END,now(),now() FROM generate_series(1,50)n`,[id+':member:',tenant.organizationId]);
  await pool.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,'learner:049',$3,'SUSPENDED',now(),now())`,[id+':suspended-target',tenant.organizationId,fork.courseVersionId]);
  const impactService=createCourseChangeService(runtime),impact=await impactService.preview(tenant,updated.releaseId);assert.equal(impact.totalAffected,51);assert.equal(impact.items.length,50);assert.ok(impact.nextCursor);
  assert.equal((await impactService.preview(tenant,updated.releaseId,impact.nextCursor)).items.length,1);
  await assert.rejects(impactService.preview({...tenant,organizationId:'foreign'},updated.releaseId),/COURSE_CHANGE_NOT_FOUND/);
  const assignmentJob=(await pool.query(`SELECT outbox_event_id,available_at FROM outbox_events WHERE organization_id=$1 AND event_type='course.change.assign'`,[tenant.organizationId])).rows[0];assert.equal(new Date(assignmentJob.available_at).toISOString(),releaseChange.effectiveAt);
  await pool.query(`UPDATE outbox_events SET available_at=now()+interval '1 day' WHERE outbox_event_id=$1`,[assignmentJob.outbox_event_id]);
  assert.equal((await noticeStore.process(tenant,assignmentJob.outbox_event_id)).state,'SKIPPED');
  await pool.query(`UPDATE outbox_events SET available_at=now() WHERE outbox_event_id=$1`,[assignmentJob.outbox_event_id]);
  inserts=0;const failedAssignment=await createCourseChangeNotificationStore(brokenPool).process(tenant,assignmentJob.outbox_event_id);assert.equal(failedAssignment.errorCode,'NOTIFICATION_DELIVERY_FAILED');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM enrollments WHERE organization_id=$1 AND course_version_id=$2 AND status='ACTIVE'`,[tenant.organizationId,fork.courseVersionId])).rows[0].n,0,'Failed batch must not leave assignments');
  await pool.query(`UPDATE outbox_events SET available_at=now() WHERE outbox_event_id=$1`,[assignmentJob.outbox_event_id]);
  const manual=createPostgresEnrollmentService(runtime);
  await Promise.all([manual.assign(tenant,'learner:001',updated.releaseId),noticeStore.process(tenant,assignmentJob.outbox_event_id),noticeStore.process(tenant,assignmentJob.outbox_event_id)]);
  await noticeStore.process(tenant,assignmentJob.outbox_event_id);
  const applied=(await impactService.preview(tenant,updated.releaseId)).jobs.find(job=>job.kind==='assignments');assert.equal(applied.state,'PUBLISHED');assert.equal(applied.processed,48);assert.equal(applied.skipped,3);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM enrollments WHERE organization_id=$1 AND course_version_id=$2 AND status='ACTIVE'`,[tenant.organizationId,fork.courseVersionId])).rows[0].n,48);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM enrollments WHERE organization_id=$1 AND course_version_id=$2`,[tenant.organizationId,courseVersionId])).rows[0].n,52,'Original enrollments must remain intact');
  const updatedNotice=(await inbox.list(learner)).items.find(item=>item.enrollmentId);assert.ok(updatedNotice);
  assert.equal((await manual.get(learner,updatedNotice.enrollmentId)).releaseId,updated.releaseId);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_REQUALIFICATION_SKIPPED'`,[tenant.organizationId])).rows[0].n,3);
  assert.equal((await noticeStore.process(tenant,assignmentJob.outbox_event_id)).state,'SKIPPED');
  const badJob=id+':bad-notice';await pool.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'course.change.notify',$1,'{}','PENDING',now(),now(),now())`,[badJob,tenant.organizationId]);
  for(let n=0;n<5;n++){await pool.query(`UPDATE outbox_events SET available_at=now() WHERE outbox_event_id=$1`,[badJob]);await noticeStore.process(tenant,badJob);}
  const terminal=(await pool.query(`SELECT state,attempt_count FROM outbox_events WHERE outbox_event_id=$1`,[badJob])).rows[0];assert.deepEqual(terminal,{state:'FAILED',attempt_count:5});
  assert.deepEqual((await store.get(tenant,courseVersionId)).release,first,'Original published release must remain unchanged');
  await assert.rejects(store.createRevision({...revisionRequest,idempotencyKey:'old-source'}),/COURSE_REVISION_SOURCE_STALE/);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_REVISION_CREATED'`,[tenant.organizationId])).rows[0].n,1);
  console.log("Course review/release passed: reviewer approval, immutable hash manifest, idempotent publish, and one outbox event.");
} finally {
  for (const table of ['notifications','enrollments','organization_memberships']) await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[tenant.organizationId]);
  for (const table of ['activities','modules','certification_policies','simulation_definitions']) await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[tenant.organizationId]);
  await pool.query("DELETE FROM outbox_events WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM release_model_bindings WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM release_manifests WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM course_review_decisions WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM ai_runs WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM course_versions WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM asset_versions WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM assets WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM model_versions WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.query("DELETE FROM courses WHERE organization_id = $1", [tenant.organizationId]).catch(() => {});
  await pool.end();
  await runtime.end();
}
