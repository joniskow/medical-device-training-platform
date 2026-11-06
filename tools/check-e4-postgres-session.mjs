import {createServer as reservePort} from 'node:net';
import {createMediaAssetService} from '../apps/api/dist/media-asset-service.js';
import {buildNxstageFamiliarization} from './nxstage-familiarization.mjs';
import {createPostgresCredentialService} from '../packages/db/dist/credential-service.js';
import {createCourseStoryStore} from '../packages/db/dist/index.js';
import {enrollmentStoryFacts} from '../packages/db/dist/certification-eligibility.js';
import {withTenantTransaction} from '../packages/db/dist/index.js';
import {createPostgresModelAssetService} from '../apps/api/dist/postgres-model-asset-service.js';
import {createCandidateLearningAccessStore,createPersonalAccountStore} from '../packages/db/dist/index.js';
import {verifiedAccountFixture} from './verified-account-fixture.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createLearnerSimulationService } from "../apps/api/dist/learner-simulation-service.js";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";
import { createPostgresEnrollmentService } from "../apps/api/dist/enrollment-service.js";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyProcessingJobMigration, createPostgresCourseReviewStore } from "../packages/db/dist/index.js";
import { createPostgresModelSessionService } from "../apps/api/dist/postgres-model-session-service.js";
import { createAttemptInvalidationService } from '../apps/api/dist/attempt-invalidation.js';
import { createAttemptReviewService } from '../apps/api/dist/attempt-review.js';
import { applyPermittedTransform } from '../packages/model-runtime/dist/browser.js';

const root = new URL("../", import.meta.url);
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const runtimePool=process.argv.includes('--runtime-role')?new Pool({connectionString:process.env.RUNTIME_DATABASE_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'}):pool;
const id = `e4_session_${Date.now()}`;
const organizationId = `${id}_org`;
const tenant = { organizationId, actorId: `${id}_learner`, correlationId: `${id}_corr` };
const authorId = `${id}_author`;
const reviewerId = `${id}_reviewer`;
const courseId = `${id}_course`;
const courseVersionId = `${id}_coursev`;
const assetId = `${id}_asset`;
const assetVersionId = `${id}_assetv`;
const aiRunId = `${id}_ai`;
const modelVersionId = `${id}_model`;
let simulationDefinitionId = `${id}_simulation`;
let policyId = `${id}_policy`;
const enrollmentId = `${id}_enrollment`;
let attemptId = `${id}_attempt`;
const moduleId = `${id}_module`;
let activityId = `${id}_activity`;

const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, root), "utf8"));
const fineMotionMode=process.argv.includes('--nxstage-fine-motion');
const developerBrowser=process.argv.includes('--developer-browser');
const familiarizationMode=process.argv.includes('--nxstage-familiarization')||developerBrowser;
const canonical = await readJson(familiarizationMode ? 'fixtures/nxstage-system-one-rear-outlet-depth-review/model-manifest.json' : fineMotionMode ? "fixtures/nxstage-system-one-fine-motion-v2-review/model-manifest.json" : "apps/web/src/model-manifest.json");
const mobile = await readJson("apps/web/src/model/model-manifest.mobile.json");
const reduced = await readJson("apps/web/src/model/model-manifest.reduced.json");
const modelManifest = {
  ...canonical,
  modelVersionId,
  releaseBindingId: `releasebind:pending:${modelVersionId}`,
  variants: (fineMotionMode || familiarizationMode ? [] : [mobile, reduced]).map((variant) => ({
    variantId: variant.variant.variantId,
    sourceHash: variant.sourceHash,
    modelBlobKey: `${organizationId}/model.${variant.variant.variantId}.glb`,
    manifestBlobKey: `${organizationId}/model.${variant.variant.variantId}.json`,
    targetProfiles: variant.variant.targetProfiles
  }))
};
if(process.argv.includes('--removed-replacement'))modelManifest.components.push({...structuredClone(modelManifest.components[0]),componentId:'assembly-root',nodePath:'Aurora Infusion Controller',displayName:'Controller assembly'});
const componentIds = modelManifest.components.map((component) => component.componentId);
const simulationDefinition = {
  schemaVersion: "simulation-definition.v1",
  simulationDefinitionId,
  version: 1,
  model: { modelVersionId, manifestHash: canonical.sourceHash, componentIds },
  components: componentIds.map((componentId) => ({ componentId, initialState: "idle", allowedActions: ["select_component"] })),
  initialState: { currentStepId: "select-panel", variables: {}, componentStates: Object.fromEntries(componentIds.map((componentId) => [componentId, "idle"])) },
  steps: [
    { stepId: "select-panel", title: "Select the control panel", action: { type: "select_component", componentId: "AIC-C01" }, nextStepIds: ["open-cover"], points: 1 },
    { stepId: "open-cover", title: "Open the safety cover", action: { type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } }, nextStepIds: ["position-sensor"], points: 1 },
    { stepId: "position-sensor", title: "Position the line sensor", action: { type: "transform_component", componentId: "AIC-C03", transform: { translationX: 0.2 } }, nextStepIds: [], points: 1 }
  ],
  faults: [],
  scoring: { maxScore: 3, passScore: 1, stepPoints: { "select-panel": 1, "open-cover": 1, "position-sensor": 1 }, faultPoints: {}, penalties: {} },
  completion: { requiredStepIds: ["select-panel", "open-cover", "position-sensor"], requiredFaultIds: [], terminalStepIds: ["position-sensor"] },
  equivalentPath: { mode: "TEXT_KEYBOARD", instructions: [{ stepId: "select-panel", text: "Select the control panel." }, { stepId: "open-cover", text: "Open the safety cover." }, { stepId: "position-sensor", text: "Position the line sensor." }], faultInstructions: [] }
};
if(fineMotionMode){
 const cabinet=canonical.components.find(c=>c.componentId==='nxstage-cabinet-door'),tub=canonical.components.find(c=>c.componentId==='pureflow-tub');
 const zero={rotationY:0,translationX:0};
 const partial=applyPermittedTransform(cabinet,zero,{rotationY:-89*Math.PI/180}).rotationY;
 const tubPartial=applyPermittedTransform(tub,zero,{translationX:tub.permittedTransforms.translationX.snap*3}).translationX;
 const actions=[
  {type:'select_component',componentId:'nxstage-control-panel'},
  {type:'transform_component',componentId:'nxstage-cabinet-door',transform:{rotationY:partial}},
  {type:'transform_component',componentId:'nxstage-cabinet-door',transform:{rotationY:-Math.PI/2}},
  {type:'transform_component',componentId:'pureflow-tub',transform:{translationX:tubPartial}},
  {type:'transform_component',componentId:'pureflow-tub',transform:{translationX:0}},
  {type:'transform_component',componentId:'nxstage-cabinet-door',transform:{rotationY:0}},
 ];
 simulationDefinition.steps=actions.map((action,i)=>({stepId:i===0?'select-panel':`fine-${i}`,title:`Fine motion ${i}`,action,nextStepIds:i<actions.length-1?[`fine-${i+1}`]:[],points:1}));
 simulationDefinition.scoring={maxScore:actions.length,passScore:1,stepPoints:{},faultPoints:{},penalties:{}};
 simulationDefinition.completion={requiredStepIds:simulationDefinition.steps.map(s=>s.stepId),requiredFaultIds:[],terminalStepIds:[`fine-${actions.length-1}`]};
 simulationDefinition.equivalentPath={mode:'TEXT_KEYBOARD',instructions:simulationDefinition.steps.map(s=>({stepId:s.stepId,text:`Perform ${s.title}`})),faultInstructions:[]};
}
const faultStory=process.argv.includes('--fault-story');
const semanticMode=faultStory||process.argv.includes('--semantic-actions');
if(semanticMode){
 const types=['open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault','request_hint','select_component','transform_component'];
 simulationDefinition.steps=[simulationDefinition.steps[0],...types.map((type,i)=>({stepId:'semantic-'+i,title:type,action:{type,value:'checked-'+i,stepId:'semantic-'+i,...(['select_component','transform_component'].includes(type)?{componentId:'AIC-C02'}:{}),...(type==='transform_component'?{transform:{rotationY:Math.PI/2}}:{})},nextStepIds:i<types.length-1?['semantic-'+(i+1)]:[],points:1}))];
 simulationDefinition.steps[0].nextStepIds=['semantic-0'];simulationDefinition.steps[0].triggerFaultId='semantic-fault';simulationDefinition.faults=[{faultId:'semantic-fault',title:'Semantic fault',triggerStepId:'select-panel',diagnosis:{type:'diagnose_fault',value:'diagnosed'},resolution:{type:'resolve_fault',value:'resolved'},points:0,failureRule:'REJECT_AND_REMAIN'}];
 simulationDefinition.scoring={maxScore:10,passScore:1,stepPoints:{},faultPoints:{},penalties:{}};simulationDefinition.completion={requiredStepIds:simulationDefinition.steps.map(s=>s.stepId),requiredFaultIds:['semantic-fault'],terminalStepIds:['semantic-8']};simulationDefinition.equivalentPath={mode:'TEXT_KEYBOARD',instructions:simulationDefinition.steps.map(s=>({stepId:s.stepId,text:'Perform '+s.title})),faultInstructions:[{faultId:'semantic-fault',text:'Diagnose, then resolve'}]};
}
const branchMode=process.argv.includes('--branches');
if(branchMode){
 simulationDefinition.initialState.variables.route=true;simulationDefinition.steps[0].setVariables={route:false};simulationDefinition.steps[0].nextStepIds=['open-cover','alternate-cover'];simulationDefinition.steps[1].preconditions=[{variable:'route',equals:true}];
 simulationDefinition.steps.push({...structuredClone(simulationDefinition.steps[1]),stepId:'alternate-cover',preconditions:[{variable:'route',equals:false}]});
 simulationDefinition.completion.requiredStepIds=['select-panel','position-sensor'];simulationDefinition.equivalentPath.instructions.push({stepId:'alternate-cover',text:'Open the alternate cover route.'});
}
const faultMode=process.argv.includes('--fault-invalidation');
if(faultMode){simulationDefinition.steps[1].triggerFaultId='fault:terminal';simulationDefinition.faults=[{faultId:'fault:terminal',title:'Terminal fault',triggerStepId:'open-cover',diagnosis:{type:'select_component',componentId:'AIC-C02'},resolution:{type:'transform_component',componentId:'AIC-C02',transform:{rotationY:Math.PI/2}},points:0,failureRule:'INVALIDATE_SESSION'}];simulationDefinition.scoring.faultPoints={'fault:terminal':0};simulationDefinition.completion.requiredFaultIds=['fault:terminal'];simulationDefinition.equivalentPath.faultInstructions=[{faultId:'fault:terminal',text:'Select the cover, then open it.'}];}
const courseContent = {
  schemaVersion: "course-draft.v1",
  title: "AIC-001 E4 PostgreSQL rehearsal",
  citations: [{ assetVersionId, citation: { page: 1, anchor: "procedure" } }],
  model: { modelVersionId, manifestHash: canonical.sourceHash, manifest: modelManifest },
  simulation: { simulationDefinitionId, definition: simulationDefinition },
  policy: { schemaVersion:'certification-policy.v1',policyId, version: 1, requiredActivityIds:[activityId],requiredModuleIds:[],resultSelection:'latest',passScore:1,repeatedFailureReviewAfter:null,expirationDays:365,maxAttempts: 2, cooldownSeconds: 60, attemptTtlSeconds: 1800, requiredEvidence: ["simulation.completed", "simulation.equivalent-path"] },
  modules: [{ moduleId,title: "Procedure", activities: [{ activityId,type: "simulation", simulationDefinitionId, citations: [{ assetVersionId }] }] }]
};
const familiarization=familiarizationMode?buildNxstageFamiliarization(modelManifest,{simulationDefinitionId,policyId,activityId}):undefined;
if(familiarization){
  Object.assign(simulationDefinition,familiarization.definition);courseContent.title=familiarization.title;courseContent.policy=familiarization.policy;
  Object.assign(courseContent.modules[0].activities[0],{type:'guided_procedure',title:familiarization.title,instructions:familiarization.briefing});
}
const activityKind=process.argv.find(arg=>arg.startsWith('--activity-type='))?.split('=')[1];
if(activityKind){assert(['guided_procedure','manipulation','assembly'].includes(activityKind));courseContent.modules[0].activities[0].type=activityKind;}

const publishedStory=faultStory||process.argv.includes('--published-story');
const publishedMedia=process.argv.includes('--published-media');
const standaloneInspection=process.argv.includes('--standalone-inspection');
const publishedExploration=standaloneInspection||process.argv.includes('--published-exploration')||process.argv.includes('--model-replacement')||process.argv.includes('--mapped-replacement')||process.argv.includes('--expanded-replacement')||process.argv.includes('--removed-replacement');
const inspectionActivities=['3d_viewer','hotspot'].map(type=>({activityId:`${id}_${type}`,type,title:type,exploration:{overview:'Inspect the controller',hotspots:type==='hotspot'?[{componentId:'AIC-C02',title:'Cover',text:'Review the cover before opening it.'}]:[]}}));
let materializations=0;
const mediaActivities=['image','video'].map(type=>({activityId:`${id}_${type}`,type,title:type,media:{assetVersionId:`${id}_${type}_version`,...(type==='image'?{altText:'Controller diagram'}:{transcript:'Identify the controller before opening the cover.'})}}));
const authoredStory={schemaVersion:'course-story.v1',mission:'Inspect the controller',startNodeId:'intro',nodes:[
 {nodeId:'intro',title:'Briefing',purpose:'Read the mission',prerequisites:[],choices:[{choiceId:'begin',label:'Begin',consequence:'Inspect the controller',nextNodeId:'activity',conditions:[]}]},
 {nodeId:'activity',title:'Procedure',purpose:'Complete the procedure',activityId,prerequisites:[],choices:[{choiceId:'finish',label:'Finish',consequence:'Review outcome',nextNodeId:'success',conditions:[{activityId,fact:'passed',equals:true}]}]},
 {nodeId:'success',title:'Complete',purpose:'Review your result',prerequisites:[],choices:[],outcome:{kind:'success',message:'Procedure complete'}}]};
if(faultStory)authoredStory.nodes[1].choices[0].conditions.push({activityId,fact:'diagnosed',faultId:'semantic-fault',equals:true},{activityId,fact:'resolved',faultId:'semantic-fault',equals:true});
const stories=createCourseStoryStore(pool);
const verified=verifiedAccountFixture(pool,organizationId);
fixture: try {
  await applyProcessingJobMigration(pool);
 await verified.prepare();
  await verified.seed(tenant.actorId);
  await pool.query("INSERT INTO organizations(organization_id,name,status,created_by,request_hash,created_at,updated_at) VALUES($1,'Simulation issuer','ACTIVE',$2,'fixture',now(),now())",[organizationId,authorId]);
  await pool.query(`INSERT INTO courses (course_id, organization_id, name, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, 'DRAFT', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [courseId, organizationId, courseContent.title, authorId]);
  await pool.query(`INSERT INTO course_versions (course_version_id, course_id, organization_id, revision, content, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, 1, $4::jsonb, 'DRAFT', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [courseVersionId, courseId, organizationId, JSON.stringify(courseContent), authorId]);
  await pool.query(`INSERT INTO assets (asset_id, organization_id, source_type, status, created_by, updated_by, created_at, updated_at) VALUES ($1, $2, 'pdf', 'APPROVED', $3, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [assetId, organizationId, authorId]);
  await pool.query(`INSERT INTO asset_versions (asset_version_id, asset_id, organization_id, source_type, blob_key, file_name, content_type, size_bytes, sha256, state, created_by, created_at, updated_at) VALUES ($1, $2, $3, 'pdf', $4, 'manual.pdf', 'application/pdf', 1, $5, 'APPROVED', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [assetVersionId, assetId, organizationId, `${organizationId}/manual.pdf`, "a".repeat(64), authorId]);
  await pool.query(`INSERT INTO model_versions (model_version_id, organization_id, blob_key, manifest_blob_key, manifest, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, 'APPROVED', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [modelVersionId, organizationId, `${organizationId}/model.glb`, `${organizationId}/model.json`, JSON.stringify(modelManifest), reviewerId]);
  await pool.query(`INSERT INTO ai_runs (ai_run_id, organization_id, course_version_id, operation, source_artifact_ids, provider, deployment, model, api_version, prompt_version, output_schema_version, status, output, citations, warnings, metrics, created_at, updated_at) VALUES ($1, $2, $3, 'generate_course_draft', $4, 'foundry', 'deterministic-local', 'deterministic', 'local', 'course-draft.v1', 'course-draft.v1', 'DRAFT', $5::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [aiRunId, organizationId, courseVersionId, [assetVersionId], JSON.stringify({ schemaVersion: "course-draft.v1", title: courseContent.title })]);

  if(publishedMedia){
    for(const media of mediaActivities){
      await pool.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,'APPROVED',$4,$4,now(),now())`,[media.activityId,organizationId,media.type,authorId]);
      await pool.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,'APPROVED',$9,now(),now())`,[media.media.assetVersionId,media.activityId,organizationId,media.type,`${organizationId}/uploads/${media.type}`,media.type,media.type==='image'?'image/png':'video/mp4','c'.repeat(64),authorId]);
    }
  }
  const releaseArtifacts = {
    releaseManifestBlobKey({ organizationId, releaseId }) {
      return `${organizationId}/releases/${releaseId}/release-manifest.json`;
    },
    async materializeModelArtifacts({ organizationId, releaseId, modelVersionId, manifest }) {
      materializations++;
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
    async materializeReleaseManifest() {}
  };
  const review = createPostgresCourseReviewStore(pool, { releaseArtifacts });
  if(publishedStory){
    await review.saveDraft({tenant:{...tenant,actorId:authorId},courseVersionId,revision:1,content:{...courseContent,story:authoredStory}});
    assert.deepEqual((await review.get({...tenant,actorId:authorId},courseVersionId)).courseVersion.content.story,authoredStory);
  }
  if(publishedMedia){
    const edited=structuredClone(courseContent);edited.modules.push({moduleId:id+'_media',title:'Media',activities:mediaActivities});edited.policy.requiredActivityIds.push(...mediaActivities.map(a=>a.activityId));
    await review.saveDraft({tenant:{...tenant,actorId:authorId},courseVersionId,revision:1,content:edited});
    assert.deepEqual((await review.get({...tenant,actorId:authorId},courseVersionId)).courseVersion.content.modules[1].activities,mediaActivities);
  }
  if(publishedExploration){
    const edited=structuredClone(courseContent);edited.modules.push({moduleId:id+'_inspection',title:'Inspection',activities:inspectionActivities});edited.policy.requiredActivityIds.push(...inspectionActivities.map(a=>a.activityId));
    if(standaloneInspection){edited.modules=edited.modules.slice(1);delete edited.simulation;delete edited.policy;}
    await review.saveDraft({tenant:{...tenant,actorId:authorId},courseVersionId,revision:1,content:edited});
    assert.deepEqual((await review.get({...tenant,actorId:authorId},courseVersionId)).courseVersion.content.modules[standaloneInspection?0:1].activities,inspectionActivities);
  }
  const reviewTenant = { organizationId, actorId: reviewerId, correlationId: `${id}_review` };
  for (const [targetType, targetId] of [["AI_DRAFT", aiRunId], ["COURSE", courseVersionId], ["MODEL", modelVersionId], ["SIMULATION", simulationDefinitionId], ["POLICY", policyId]]) {
    if(standaloneInspection&&['SIMULATION','POLICY'].includes(targetType))continue;
    await review.recordDecision({ tenant: reviewTenant, courseVersionId, targetType, targetId, decision: "APPROVE", rationale: "E4 PostgreSQL release/session rehearsal approval.", revision: (publishedStory||publishedMedia||publishedExploration)?2:1, idempotencyKey: `${id}:review:${targetType}`, requestHash: `${id}:${targetType}` });
  }
  if(process.argv.includes('--identity-validation')){
    const duplicate=structuredClone(courseContent);
    duplicate.simulation.definition.steps.push({...duplicate.simulation.definition.steps[0],title:'Ambiguous duplicate',nextStepIds:[]});
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(duplicate)]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:`${id}:blocked-identity`,requestHash:'blocked-identity'}),error=>error.code==='COURSE_PUBLICATION_BLOCKED'&&error.findings.some(f=>f.code==='STEP_DUPLICATE'));
    for(const table of ['release_manifests','simulation_definitions'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE organization_id=$1 AND event_type='course.release.published'",[organizationId])).rows[0].n,0);
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(courseContent)]);
    console.log('Duplicate simulation identity blocked publication without release/runtime/event writes.');
  }
  if(process.argv.includes('--model-validation')){
    const restricted=structuredClone(modelManifest);restricted.components.find(c=>c.componentId==='AIC-C02').permittedTransforms.rotationY.max=0;
    await pool.query('UPDATE model_versions SET manifest=$2::jsonb WHERE model_version_id=$1',[modelVersionId,JSON.stringify(restricted)]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:`${id}:blocked-model`,requestHash:'blocked-model'}),error=>error.code==='COURSE_PUBLICATION_BLOCKED'&&error.findings.some(f=>f.code==='MODEL_ACTION_TRANSFORM_NOT_PERMITTED'));
    assert.equal((await pool.query('SELECT count(*)::int n FROM release_manifests WHERE organization_id=$1',[organizationId])).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int n FROM simulation_definitions WHERE organization_id=$1',[organizationId])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE organization_id=$1 AND event_type='course.release.published'",[organizationId])).rows[0].n,0);
    await pool.query('UPDATE model_versions SET manifest=$2::jsonb WHERE model_version_id=$1',[modelVersionId,JSON.stringify(modelManifest)]);
  }
  if(publishedStory){
    const saved=(await review.get({...tenant,actorId:authorId},courseVersionId)).courseVersion.content;
    const bypass=structuredClone(saved);bypass.story.nodes[0].choices.push({choiceId:'skip',label:'Skip',consequence:'Skip training',nextNodeId:'success',conditions:[]});
    const legacy=structuredClone(saved);delete legacy.policy.schemaVersion;
    const badFault=structuredClone(saved);badFault.story.nodes[1].choices[0].conditions.push({activityId,fact:'resolved',faultId:'unknown-fault',equals:true});
    for(const [invalid,code] of [[bypass,'STORY_REQUIRED_ACTIVITY_BYPASS'],[legacy,'STORY_POLICY_REQUIRED'],[badFault,'STORY_CONDITION_INVALID']]){
      await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(invalid)]);
      await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:`${id}:invalid:${code}`,requestHash:code}),error=>error.code==='COURSE_PUBLICATION_BLOCKED'&&error.findings.some(f=>f.code===code));
      for(const table of ['release_manifests','simulation_definitions'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
      assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE organization_id=$1 AND event_type='course.release.published'",[organizationId])).rows[0].n,0);
    }
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(saved)]);
  }
  if(process.argv.includes('--media-validation')){
    const invalid=structuredClone(courseContent);
    invalid.modules[0].activities.push({activityId:'media:fixture',type:'image',media:{assetVersionId:'foreign:missing',altText:'Cover diagram'}});
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(invalid)]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:'media-missing',requestHash:'media-missing'}),/SOURCE_ARTIFACT_NOT_APPROVED/);
    invalid.modules[0].activities.at(-1).media.assetVersionId=assetVersionId;
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(invalid)]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:'media-type',requestHash:'media-type'}),error=>error.code==='COURSE_PUBLICATION_BLOCKED'&&error.findings.some(f=>f.code==='MEDIA_ASSET_TYPE_INVALID'));
    for(const table of ['release_manifests','simulation_definitions'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE organization_id=$1 AND event_type='course.release.published'",[organizationId])).rows[0].n,0);
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(courseContent)]);
    console.log('Media publication rejected unavailable asset and mismatched approved PDF without release/runtime/event writes.');
  }
  if(publishedMedia){
    await pool.query("UPDATE asset_versions SET state='REJECTED' WHERE asset_version_id=$1",[mediaActivities[0].media.assetVersionId]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:'media-approval-lost',requestHash:'media-approval-lost'}),/SOURCE_ARTIFACT_NOT_APPROVED/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM release_manifests WHERE organization_id=$1',[organizationId])).rows[0].n,0);
    await pool.query("UPDATE asset_versions SET state='APPROVED' WHERE asset_version_id=$1",[mediaActivities[0].media.assetVersionId]);
  }
  if(publishedExploration){
    const saved=(await review.get({...tenant,actorId:authorId},courseVersionId)).courseVersion.content;
    const forged=structuredClone(saved);forged.model.manifest.components.push({...forged.model.manifest.components[0],componentId:'forged'});forged.modules[standaloneInspection?0:1].activities[1].exploration.hotspots[0].componentId='forged';
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(forged)]);
    await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId,idempotencyKey:'forged-inspection',requestHash:'forged-inspection'}),error=>error.code==='COURSE_PUBLICATION_BLOCKED'&&error.findings.some(f=>f.code==='EXPLORATION_COMPONENT_INVALID'));
    assert.equal(materializations,0,'Invalid inspection materialized model artifacts');
    for(const table of ['release_manifests','simulation_definitions'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE organization_id=$1 AND event_type='course.release.published'",[organizationId])).rows[0].n,0);
    await pool.query('UPDATE course_versions SET content=$2::jsonb WHERE course_version_id=$1',[courseVersionId,JSON.stringify(saved)]);
  }
  const release = await review.publish({ tenant: { organizationId, actorId: `${id}_publisher`, correlationId: `${id}_publish` }, courseVersionId, idempotencyKey: `${id}:publish`, requestHash: `${id}:publish` });
  assert.ok(release?.releaseId);
  if(activityKind){const summary=(await pool.query('SELECT public.catalog_certification_summary($1::jsonb) value',[release.manifest.content])).rows[0].value;assert.equal(summary.requiredActivities[0].kind,'simulation');assert.equal(summary.requiredActivities[0].passScore,1);}
  if(publishedStory)assert.deepEqual(release.manifest.content.story,authoredStory,'Publication changed stable story activity references');
  const releaseBindingId = `releasebind:${release.releaseId}:${modelVersionId}`;

  if(standaloneInspection){
    assert.equal(release.manifest.content.simulation,undefined);assert.equal(release.manifest.content.policy,undefined);assert.equal(release.manifest.content.runtimeBindings,undefined);
    await pool.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now())`,[enrollmentId,organizationId,tenant.actorId,courseVersionId]);
    const enrollments=createPostgresEnrollmentService(pool),privateModel=createPostgresModelAssetService({pool,storage:{createDownloadUrl:async()=> 'https://private.test/inspection'}});
    for(const activity of inspectionActivities){
      assert.deepEqual((await enrollments.inspect(tenant,enrollmentId,activity.activityId)).exploration,activity.exploration);
      const assets=await privateModel.getLearnerModel(tenant,{releaseId:release.releaseId,modelVersionId});assert.equal(assets.modelVersionId,modelVersionId);
      await enrollments.acknowledge(tenant,enrollmentId,activity.activityId);
    }
    const progress=await enrollments.get(tenant,enrollmentId);assert.equal(progress.progress.length,2);assert(progress.progress.every(p=>p.status==='ACKNOWLEDGED'));assert.equal(progress.eligibility.eligible,false);
    for(const table of ['simulation_definitions','simulation_attempts','credentials'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
    console.log('Standalone inspection passed: no simulation or certification policy, reviewed model release, private geometry access and passive acknowledgement without scored runtime records or credentials.');
  }else{
  const runtime = release.manifest.content.runtimeBindings;
  simulationDefinitionId = runtime.simulationDefinitionId;
  policyId = runtime.policyId;
  activityId = runtime.activities[0].runtimeActivityId;
  assert.equal(release.manifest.content.modules[0].activities[0].activityId, runtime.activities[0].activityId);
  const replayedRelease = await review.publish({ tenant: reviewTenant, courseVersionId, idempotencyKey: `${id}:publish`, requestHash: `${id}:publish` });
  assert.equal(replayedRelease.releaseId, release.releaseId);
  const publishedRows = await pool.query('SELECT count(*)::int AS count FROM activities WHERE organization_id=$1', [organizationId]);
  assert.equal(publishedRows.rows[0].count, (publishedMedia||publishedExploration)?3:1);
  await pool.query(`INSERT INTO enrollments (enrollment_id, organization_id, learner_id, course_version_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [enrollmentId, organizationId, tenant.actorId, courseVersionId]);
  // Synthetic acceptance fixture; the candidate-enrollment suite separately tests creation.
  await pool.query(`INSERT INTO candidate_enrollment_consents(user_id,request_key,organization_id,enrollment_id,release_id,request_signature,offering_revision,release_hash,disclosures,notice_version,accepted_at) VALUES($1,'fixture',$2,$3,$4,'fixture',1,$5,'{}','candidate-notice.v1',now())`,[tenant.actorId,organizationId,enrollmentId,release.releaseId,release.releaseHash]);
  if(publishedMedia){
    const signed=[];const mediaService=createMediaAssetService(pool,{createDownloadUrl:async input=>{signed.push(input);return 'https://private.test/media';}});
    const enrollmentService=createPostgresEnrollmentService(pool);
    for(const media of mediaActivities){
      assert(release.manifest.sourceArtifacts.some(s=>s.assetVersionId===media.media.assetVersionId&&s.sha256==='c'.repeat(64)),'Published source hash missing');
      const delivered=await mediaService.get(tenant,enrollmentId,media.activityId);assert.equal(delivered.contentType,media.type==='image'?'image/png':'video/mp4');assert.equal(delivered[media.type==='image'?'altText':'transcript'],media.media[media.type==='image'?'altText':'transcript']);
      const before=await enrollmentService.get(tenant,enrollmentId);assert.equal(before.eligibility.eligible,false);
      assert(!before.progress.some(p=>p.activityId===media.activityId),'Loading media marked completion');
      await enrollmentService.acknowledge(tenant,enrollmentId,media.activityId);await enrollmentService.acknowledge(tenant,enrollmentId,media.activityId);
    }
    assert.equal(signed.length,2);assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[organizationId])).rows[0].n,0,'Media-only completion issued credential');
    assert.equal((await enrollmentService.get(tenant,enrollmentId)).eligibility.eligible,false,'Scored evidence bypassed');
  }
  if(publishedExploration){
    const enrollments=createPostgresEnrollmentService(pool);
    for(const activity of inspectionActivities){
      assert.deepEqual((await enrollments.inspect(tenant,enrollmentId,activity.activityId)).exploration,activity.exploration);
      assert(!(await enrollments.get(tenant,enrollmentId)).progress.some(p=>p.activityId===activity.activityId));
      await Promise.all([enrollments.acknowledge(tenant,enrollmentId,activity.activityId),enrollments.acknowledge(tenant,enrollmentId,activity.activityId)]);
    }
    for(const table of ['simulation_attempts','credentials'])assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[organizationId])).rows[0].n,0);
    assert.equal((await enrollments.get(tenant,enrollmentId)).eligibility.eligible,false);
  }
  const sessions = createPostgresModelSessionService({ pool:runtimePool });
  const launcher = createLearnerSimulationService(pool,sessions);
  const publicActivityId = runtime.activities[0].activityId;
  if(publishedStory){
    await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/STORY_ACTIVITY_UNAVAILABLE/);
    assert.equal((await stories.get(tenant,enrollmentId)).node.nodeId,'intro');
    await stories.choose(tenant,enrollmentId,{revision:1,choiceId:'begin',requestId:'story-begin'});
    assert.equal((await stories.get(tenant,enrollmentId)).node.choices[0].enabled,false);
    await assert.rejects(stories.choose(tenant,enrollmentId,{revision:2,choiceId:'finish',requestId:'premature'}),/STORY_CHOICE_NOT_AVAILABLE/);
  }
  const [started, concurrent] = await Promise.all([launcher.launch(tenant,enrollmentId,publicActivityId),launcher.launch(tenant,enrollmentId,publicActivityId)]);
  assert.equal(started.sessionId,concurrent.sessionId);
  attemptId = started.attemptId;
  const launchKey = `launch:${createHash('sha256').update(attemptId).digest('hex')}`;
  const startRequest = { releaseId: release.releaseId, activityId, simulationDefinitionId, modelVersionId, enrollmentId, attemptId, policyId, expiresInSeconds:courseContent.policy.attemptTtlSeconds };
  await assert.rejects(sessions.start(tenant,{...startRequest,simulationDefinitionId:'foreign-definition'},`${id}:wrong-definition`),/ACTIVITY_NOT_IN_RELEASE/);
  await assert.rejects(launcher.launch({...tenant,actorId:'foreign'},enrollmentId,publicActivityId),/SIMULATION_NOT_FOUND/);
  await assert.rejects(launcher.launch(tenant,enrollmentId,'unknown'),publishedStory?/STORY_ACTIVITY_UNAVAILABLE/:/SIMULATION_NOT_FOUND/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM simulation_attempts WHERE organization_id=$1',[organizationId])).rows[0].count,1);
  const signedUrls=[];
  const modelDeliveryStorage={createDownloadUrl:async({blobKey})=>{signedUrls.push(blobKey);return 'https://private.test/'+blobKey;},readObject:async({blobKey})=>{
    if(blobKey.endsWith('/full.glb'))return {bytes:new Uint8Array(await readFile(new URL(familiarizationMode?'fixtures/nxstage-system-one-rear-outlet-depth-review/nxstage-system-one.glb':fineMotionMode?'fixtures/nxstage-system-one-fine-motion-v2-review/nxstage-system-one.glb':'fixtures/reference/model/aurora-infusion-controller.glb',root)))};
    const row=(await pool.query('SELECT manifest FROM release_model_bindings WHERE organization_id=$1 AND release_id=$2 AND model_version_id=$3',[organizationId,release.releaseId,modelVersionId])).rows[0];
    return {bytes:Buffer.from(JSON.stringify(row.manifest))};
  }};
  const assets=createPostgresModelAssetService({pool,storage:modelDeliveryStorage});
  const privateAssets=createPostgresModelAssetService({pool,storage:modelDeliveryStorage,privateDelivery:true});
  const privateDescriptor=await privateAssets.getLearnerModel(tenant,{releaseId:release.releaseId,modelVersionId});
  assert.ok(privateDescriptor.modelUrl.startsWith('/api/v1/'));assert.ok(privateDescriptor.manifestUrl.endsWith('content=manifest'));
  assert.equal(await privateAssets.getLearnerContent({...tenant,actorId:'unassigned'},{releaseId:release.releaseId,modelVersionId,content:'model'}),null);
  assert.equal(await privateAssets.getLearnerContent({...tenant,organizationId:'foreign'},{releaseId:release.releaseId,modelVersionId,content:'model'}),null);

  const candidatePrincipal={subject:tenant.actorId,issuer:'https://fixture.example.test/'+encodeURIComponent(organizationId),identityTenant:organizationId,verifiedEmail:'synthetic@example.test',verificationExpiresAt:new Date(Date.now()+3600000).toISOString(),roles:['operator']};
  let browserPort=0;
  if(developerBrowser){const reservation=reservePort();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));browserPort=reservation.address().port;await new Promise(done=>reservation.close(done));}
  const server=createJobStatusHttpServer({staticRoot:'apps/web/dist',allowedOrigins:developerBrowser?[`http://127.0.0.1:${browserPort}`]:[],enrollmentService:createPostgresEnrollmentService(pool),courseStoryStore:stories,candidateLearningAccessStore:createCandidateLearningAccessStore(pool),personalAccountStore:createPersonalAccountStore(pool),modelAssetService:developerBrowser?privateAssets:assets,modelSessionService:sessions,learnerSimulationService:launcher,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization==='Bearer learner'?candidatePrincipal:null},organizationContextResolver:{resolveActiveOrganizations:async()=>developerBrowser?[organizationId]:[],selectOrganization:async()=>{}}});
  await new Promise(resolve=>server.listen(browserPort,'127.0.0.1',resolve));
  try {
    if(developerBrowser){
      const {checkDeveloperBrowser}=await import('./check-developer-browser.mjs');
      await checkDeveloperBrowser({upstream:`http://127.0.0.1:${server.address().port}`,organizationId,sessionId:started.sessionId,
        expire:()=>pool.query("UPDATE simulation_sessions SET expires_at=now()-interval '1 second' WHERE simulation_session_id=$1",[started.sessionId])});
      const debrief=await sessions.debrief(tenant,started.sessionId);assert.equal(debrief.completed,true);assert.equal(debrief.hintsUsed,2);assert.equal(debrief.rejectedAttempts,2);assert.equal(debrief.events.length,11);
      break fixture;
    }
    const url=`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${enrollmentId}/activities/${publicActivityId}/start`;
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
    const headers={authorization:'Bearer learner','content-type':'application/json','x-organization-id':organizationId};
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({policyId:'forged'})})).status,422);
    const response=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).sessionId,started.sessionId);
    const modelUrl=`http://127.0.0.1:${server.address().port}/api/v1/releases/${release.releaseId}/model-assets/${modelVersionId}`;
    const modelResponse=await fetch(modelUrl,{headers});assert.equal(modelResponse.status,200);assert.equal((await modelResponse.json()).releaseManifestUrl,undefined);assert.equal(signedUrls.length,2);assert.ok(!signedUrls.some(key=>key.endsWith('/release-manifest.json')));
    const privateBytes=await fetch(modelUrl+'?content=model',{headers});assert.equal(privateBytes.status,200);assert.equal(privateBytes.headers.get('cache-control'),'no-store');assert.equal(createHash('sha256').update(Buffer.from(await privateBytes.arrayBuffer())).digest('hex'),canonical.sourceHash);
    const privateManifest=await fetch(modelUrl+'?content=manifest',{headers});assert.equal(privateManifest.status,200);assert.equal((await privateManifest.json()).releaseBindingId,releaseBindingId);
    assert.equal((await fetch(modelUrl+'?content=model')).status,401);
    assert.equal((await fetch(modelUrl+'?content=other',{headers})).status,422);

    assert.equal(await assets.getLearnerModel({...tenant,actorId:'foreign'},{releaseId:release.releaseId,modelVersionId}),null);assert.equal(signedUrls.length,2,'Denied learner received signed URLs');
    await pool.query("UPDATE enrollments SET status='SUSPENDED' WHERE enrollment_id=$1",[enrollmentId]);assert.equal((await fetch(modelUrl,{headers})).status,403);assert.equal(await assets.getLearnerModel(tenant,{releaseId:release.releaseId,modelVersionId}),null);await pool.query("UPDATE enrollments SET status='ACTIVE' WHERE enrollment_id=$1",[enrollmentId]);
    if(publishedStory){const projected=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${enrollmentId}/story`,{headers});assert.equal(projected.status,200);assert.equal((await projected.json()).node.nodeId,'activity');}
    if(publishedExploration)for(const activity of inspectionActivities){const inspection=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${enrollmentId}/activities/${activity.activityId}/inspection`,{headers});assert.equal(inspection.status,200);assert.deepEqual((await inspection.json()).exploration,activity.exploration);}
    const action={clientActionId:`${id}:select`,releaseBindingId,modelVersionId,expectedSequence:1,type:'select_component',componentId:simulationDefinition.steps[0].action.componentId,source:'KEYBOARD'};
    const acted=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/model-sessions/${started.sessionId}/actions`,{method:'POST',headers:{...headers,'idempotency-key':`${id}:select`},body:JSON.stringify(action)});assert.equal(acted.status,200);assert.equal((await acted.json()).status,'accepted');
    const debriefUrl=`http://127.0.0.1:${server.address().port}/api/v1/model-sessions/${started.sessionId}/debrief`;
    const debriefResponse=await fetch(debriefUrl,{headers});assert.equal(debriefResponse.status,200);assert.equal((await debriefResponse.json()).events.length,1);
    assert.equal((await fetch(debriefUrl)).status,401);
    assert.equal((await fetch(debriefUrl+'?learnerId=other',{headers})).status,422);

  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(started.releaseBindingId, releaseBindingId);
  assert.equal(started.state.activeStepId, simulationDefinition.initialState.currentStepId);
  assert.deepEqual(started.state.allowedActions, ["select_component"]);
  const startedAgain = await sessions.start(tenant, startRequest, launchKey);
  assert.equal(startedAgain.sessionId, started.sessionId, "reusing a session-start idempotency key must return the original session");
  const selected = await sessions.submit(tenant, started.sessionId, { clientActionId: `${id}:select`, releaseBindingId, modelVersionId, expectedSequence: 1, type: "select_component", componentId: simulationDefinition.steps[0].action.componentId, source: "KEYBOARD" }, `${id}:select`);
  assert.equal(selected.status, "accepted");
  assert.equal(selected.nextSequence, 2);
  if(branchMode){assert.equal(selected.state.activeStepId,'alternate-cover');assert.equal((await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state.simulationState.variables.route,false);}
  if(familiarizationMode){
    let sequence=2;
    const send=async(name,action)=>{const request={...action,clientActionId:`${id}:${name}`,releaseBindingId,modelVersionId,expectedSequence:sequence,source:'KEYBOARD'};const result=await sessions.submit(tenant,started.sessionId,request,request.clientActionId);if(result.status==='accepted')sequence=result.nextSequence;return result;};
    const firstHint=await send('hint-one',{type:'request_hint'}),secondHint=await send('hint-two',{type:'request_hint'});assert.notEqual(firstHint.feedback,secondHint.feedback);
    const premature=await send('premature-door',simulationDefinition.steps.find(step=>step.stepId==='open-door').action);assert.equal(premature.status,'invalid_precondition');assert.match(premature.feedback,/Lift the cycler door handle/i);
    let last;
    for(const step of simulationDefinition.steps.slice(1)){
      last=await send(step.stepId,step.action);assert.equal(last.status,'accepted',JSON.stringify(last));
      if(step.stepId==='open-door'){const prematureLower=await send('premature-lower',simulationDefinition.steps.at(-1).action);assert.equal(prematureLower.status,'invalid_precondition');assert.match(prematureLower.feedback,/Close the cycler door/i);}
    }
    assert.equal(last.state.completed,true);assert.equal(last.state.activeStepId,undefined);assert.equal(last.state.activeStepInstructions,undefined);
    assert.deepEqual(last.state.transforms['nxstage-cycler-door'],{rotationY:0,translationX:0});assert.deepEqual(last.state.transforms['nxstage-cycler-handle'],{rotationY:0,translationX:0});
    const debrief=await sessions.debrief(tenant,started.sessionId);assert.equal(debrief.steps.length,7);assert(debrief.steps.every(step=>step.completed));assert.equal(debrief.hintsUsed,2);assert.equal(debrief.rejectedAttempts,2);
    assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[organizationId])).rows[0].n,0);
    await assert.rejects(createPostgresCredentialService(pool).issue(tenant,enrollmentId),/CREDENTIAL_ISSUANCE_DISABLED/);
    const enrollment=await createPostgresEnrollmentService(pool).get(tenant,enrollmentId);assert.equal(enrollment.progress[0].status,'PASSED');assert.equal(enrollment.eligibility.eligible,false);assert(enrollment.eligibility.missing.includes('CREDENTIAL_ISSUANCE_DISABLED'));
    console.log('NxStage familiarization passed: published synthetic fixture, private real model, seven-step sequence, mechanical mistakes/recovery, progressive hints, durable debrief and no automatic/manual credential issuance.');
  }else if(process.argv.includes('--debrief')){
    assert.ok(Array.isArray(started.state.interactionOptions));
    const action=(name,type,extra={},sequence=2)=>({clientActionId:`${id}:${name}`,releaseBindingId,modelVersionId,expectedSequence:sequence,type,...extra});
    const send=request=>sessions.submit(tenant,started.sessionId,request,request.clientActionId);
    const hint=action('hint','request_hint');assert.equal((await send(hint)).status,'accepted');
    const wrong=action('wrong-order','transform_component',{componentId:'AIC-C03',transform:{translationX:.2}},3);
    const failing=createPostgresModelSessionService({pool:{async connect(){const client=await pool.connect();return {query(sql,args){if(sql.includes("'SIMULATION_ACTION_REJECTED'"))throw Error('Injected rejected-action audit failure');return client.query(sql,args);},release(){client.release();}};}}});
    await assert.rejects(failing.submit(tenant,started.sessionId,wrong,wrong.clientActionId),/Injected rejected-action audit failure/);
    assert.equal((await sessions.debrief(tenant,started.sessionId)).rejectedAttempts,0);
    const failures=await Promise.all([send(wrong),send(wrong)]);assert.deepEqual(failures[0],failures[1]);assert.equal(failures[0].status,'invalid_precondition');assert.equal(failures[0].nextSequence,3);
    assert.equal((await send({...wrong,componentId:'AIC-C02',transform:{rotationY:Math.PI/2}})).status,'invalid_precondition','A rejected action key cannot be reused with corrected intent');
    assert.equal((await send({...wrong,clientActionId:`id:stale`,expectedSequence:1})).status,'stale_sequence');
    assert.equal(await sessions.debrief({...tenant,actorId:'other-learner'},started.sessionId),null);
    assert.equal(await sessions.debrief({...tenant,organizationId:'other-org'},started.sessionId),null);
    const open=action('open','transform_component',{componentId:'AIC-C02',transform:{rotationY:Math.PI/2}},3);assert.equal((await send(open)).status,'accepted');
    const finish=action('finish','transform_component',{componentId:'AIC-C03',transform:{translationX:.2}},4);assert.equal((await send(finish)).state.completed,true);
    const debrief=await sessions.debrief(tenant,started.sessionId);
    assert.equal(debrief.status,'COMPLETED');assert.equal(debrief.hintsUsed,1);assert.equal(debrief.rejectedAttempts,1);assert.equal(debrief.events.length,5);assert(debrief.steps.every(step=>step.completed));assert.equal(debrief.eventsTruncated,false);
    await send(hint);await send(wrong);await send(finish);assert.deepEqual(await sessions.debrief(tenant,started.sessionId),debrief);
    await pool.query("UPDATE simulation_sessions SET expires_at=now()-interval '1 second' WHERE simulation_session_id=$1",[started.sessionId]);
    assert.equal((await sessions.debrief(tenant,started.sessionId)).status,'COMPLETED','Expiry must not hide the completed debrief');
    for(const [table,column,key,status] of [['enrollments','enrollment_id',enrollmentId,'SUSPENDED'],['release_manifests','release_id',release.releaseId,'RETIRED']]){
      const original=(await pool.query(`SELECT status FROM ${table} WHERE ${column}=$1`,[key])).rows[0].status;
      await pool.query(`UPDATE ${table} SET status=$2 WHERE ${column}=$1`,[key,status]);
      assert.equal(await sessions.debrief(tenant,started.sessionId),null);
      await pool.query(`UPDATE ${table} SET status=$2 WHERE ${column}=$1`,[key,original]);
    }
    console.log('Model debrief passed: real database/HTTP, owner isolation, atomic rejected receipts, concurrent retries, unchanged sequences, hints, completion and expiry.');
  }else if(fineMotionMode){
    let sequence=2;
    for(const step of simulationDefinition.steps.slice(1)){
      const request={...step.action,releaseBindingId,modelVersionId,clientActionId:`${id}:fine:${sequence}`,expectedSequence:sequence,source:'KEYBOARD'};
      const acted=await sessions.submit(tenant,started.sessionId,request,request.clientActionId);
      assert.equal(acted.status,'accepted',`${step.stepId}: ${acted.feedback}`);
      assert.deepEqual(await sessions.submit(tenant,started.sessionId,request,request.clientActionId),acted,`${step.stepId} replay must not move twice`);
      sequence++;
      const restarted=createPostgresModelSessionService({pool});
      const resumed=await restarted.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:sequence});
      assert.equal(resumed.status,'accepted');
      assert.deepEqual(resumed.state.transforms,acted.state.transforms,`${step.stepId} must survive resume`);
      const stored=(await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state;
      assert.deepEqual((stored.modelState??stored).transforms,acted.state.transforms,`${step.stepId} must be persisted`);
      if(step.stepId==='fine-1'){
        const blocked={clientActionId:`${id}:blocked-tub`,releaseBindingId,modelVersionId,expectedSequence:sequence,type:'transform_component',componentId:'pureflow-tub',transform:{translationX:simulationDefinition.steps[3].action.transform.translationX},source:'KEYBOARD'};
        const denied=await sessions.submit(tenant,started.sessionId,blocked,blocked.clientActionId);
        assert.equal(denied.status,'invalid_precondition');assert.equal(denied.nextSequence,sequence);assert.match(denied.feedback,/open the cabinet door fully/i);
      }
      if(step.stepId==='fine-3'){
        const blocked={clientActionId:`${id}:blocked-door`,releaseBindingId,modelVersionId,expectedSequence:sequence,type:'transform_component',componentId:'nxstage-cabinet-door',transform:{rotationY:0},source:'KEYBOARD'};
        const denied=await sessions.submit(tenant,started.sessionId,blocked,blocked.clientActionId);
        assert.equal(denied.status,'invalid_precondition');assert.equal(denied.nextSequence,sequence);assert.match(denied.feedback,/push the tub in/i);
      }
    }
    console.log('NxStage fine-motion PostgreSQL rehearsal passed: partial positions persist and resume; cabinet/tub interlocks reject invalid actions.');
  }else if(semanticMode){
    let sequence=2,last;
    const requirements=[simulationDefinition.faults[0].diagnosis,simulationDefinition.faults[0].resolution,...simulationDefinition.steps.slice(1).map(s=>s.action)];
    for(const requirement of requirements){
      const request={...requirement,releaseBindingId,modelVersionId,clientActionId:`${id}:semantic:${sequence}`,expectedSequence:sequence,source:'KEYBOARD'};
      const wrong=await sessions.submit(tenant,started.sessionId,{...request,clientActionId:request.clientActionId+':wrong',value:'wrong'},request.clientActionId+':wrong');assert.equal(wrong.status,'invalid_precondition');assert.equal(wrong.nextSequence,sequence);
      last=await sessions.submit(tenant,started.sessionId,request,request.clientActionId);assert.equal(last.status,'accepted');assert.equal(last.nextSequence,++sequence);
      assert.deepEqual(await sessions.submit(tenant,started.sessionId,request,request.clientActionId),last);
      assert.equal((await sessions.submit(tenant,started.sessionId,{...request,stepId:'changed'},request.clientActionId)).status,'invalid_precondition');
    }
    const history=(await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state.simulationState;assert.deepEqual(history.diagnosedFaultIds,['semantic-fault']);assert.deepEqual(history.resolvedFaultIds,['semantic-fault']);
    const completion=(await pool.query("SELECT payload FROM progress_events WHERE organization_id=$1 AND progress_event_id=$2",[organizationId,'progress:'+attemptId])).rows[0].payload;assert.deepEqual(completion.diagnosedFaultIds,['semantic-fault']);assert.deepEqual(completion.resolvedFaultIds,['semantic-fault']);
    const faultFacts=await withTenantTransaction(pool,tenant,client=>enrollmentStoryFacts(client,tenant,enrollmentId));assert.deepEqual(faultFacts.find(f=>f.activityId===publicActivityId).faults,[{faultId:'semantic-fault',diagnosed:true,resolved:true}]);
    await pool.query("UPDATE progress_events SET payload=payload-'diagnosedFaultIds' WHERE organization_id=$1 AND progress_event_id=$2",[organizationId,'progress:'+attemptId]);
    assert.equal((await withTenantTransaction(pool,tenant,client=>enrollmentStoryFacts(client,tenant,enrollmentId))).find(f=>f.activityId===publicActivityId).faults,undefined);
    if(faultStory){assert.equal((await stories.get(tenant,enrollmentId)).node.choices[0].enabled,false);await assert.rejects(stories.choose(tenant,enrollmentId,{revision:2,choiceId:'finish',requestId:'missing-fault-history'}),/STORY_CHOICE_NOT_AVAILABLE/);}
    await pool.query("UPDATE progress_events SET payload=$3 WHERE organization_id=$1 AND progress_event_id=$2",[organizationId,'progress:'+attemptId,completion]);
    assert.equal(last.state.completed,true);assert.equal(last.state.scorePoints,10);assert.equal(last.state.transforms['AIC-C02'].rotationY,Math.PI/2);
    assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[organizationId])).rows[0].n,1);
    assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:sequence})).state.completed,true);
    if(faultStory){assert.equal((await stories.get(tenant,enrollmentId)).node.choices[0].enabled,true);await stories.choose(tenant,enrollmentId,{revision:2,choiceId:'finish',requestId:'fault-story-finish'});assert.equal((await stories.get(tenant,enrollmentId)).node.outcome.kind,'success');console.log('Fault story passed: reviewed publication, unknown-fault rejection, authoritative diagnosis/resolution gating, missing-history denial and terminal outcome.');}
    console.log('Semantic actions PostgreSQL passed: every editor action, fault diagnosis/resolution, optional component, required values/step references, rejection, replay identity, transforms, completion and credential.');
  }else if(faultMode){
    const faultOpened=await sessions.submit(tenant,started.sessionId,{clientActionId:`${id}:fault-open`,releaseBindingId,modelVersionId,expectedSequence:2,type:'transform_component',componentId:'AIC-C02',transform:{rotationY:Math.PI/2}},`${id}:fault-open`);assert.equal(faultOpened.state.activeFaultId,'fault:terminal');
    const diagnosed=await sessions.submit(tenant,started.sessionId,{clientActionId:`${id}:fault-diagnose`,releaseBindingId,modelVersionId,expectedSequence:3,type:'select_component',componentId:'AIC-C02'},`${id}:fault-diagnose`);assert.equal(diagnosed.status,'accepted');assert.equal((await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state.simulationState.faultStage,'RESOLUTION');assert.deepEqual((await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state.simulationState.diagnosedFaultIds,['fault:terminal']);
    const wrong={clientActionId:`${id}:wrong-fault`,releaseBindingId,modelVersionId,expectedSequence:4,type:'transform_component',componentId:'AIC-C03',transform:{translationX:.2}};
    const stale={...wrong,clientActionId:`${id}:stale-fault`,expectedSequence:1};assert.equal((await sessions.submit(tenant,started.sessionId,stale,stale.clientActionId)).status,'stale_sequence');
    const failing=createPostgresModelSessionService({pool:{async connect(){const c=await pool.connect();return {query(sql,args){if(sql.includes('SIMULATION_FAULT_INVALIDATED'))throw Error('Injected invalidation audit failure');return c.query(sql,args);},release(){c.release();}};}}});
    await assert.rejects(failing.submit(tenant,started.sessionId,wrong,wrong.clientActionId),/Injected invalidation audit failure/);
    assert.equal((await pool.query('SELECT status,next_sequence FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].status,'ACTIVE');assert.equal((await pool.query('SELECT status FROM simulation_attempts WHERE simulation_attempt_id=$1',[attemptId])).rows[0].status,'ACTIVE');
    const failed=await Promise.all([sessions.submit(tenant,started.sessionId,wrong,wrong.clientActionId),sessions.submit(tenant,started.sessionId,wrong,wrong.clientActionId)]);assert.deepEqual(failed[0],failed[1]);assert.equal(failed[0].status,'expired_session');assert.equal(failed[0].nextSequence,5);assert.equal(failed[0].state,undefined);
    assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='SIMULATION_FAULT_INVALIDATED'",[organizationId])).rows[0].n,1);
    const ended=(await pool.query('SELECT status,state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0];assert.equal(ended.status,'INVALIDATED');assert.equal(ended.state.simulationState.invalidated,true);assert.equal(ended.state.scorePoints,2);
    assert.deepEqual(ended.state.transforms,diagnosed.state.transforms,'The rejected fault transform must not change model geometry');
    assert.deepEqual(ended.state.allowedActions,[]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM simulation_actions WHERE simulation_session_id=$1 AND nonce=$2',[started.sessionId,wrong.clientActionId])).rows[0].n,1);
    const altered=await sessions.submit(tenant,started.sessionId,{...wrong,transform:{translationX:.1}},wrong.clientActionId);
    assert.equal(altered.status,'expired_session');assert.notDeepEqual(altered,failed[0],'Changed payload must not receive the cached terminal response');assert.equal(altered.state,undefined);
    const foreign=await sessions.submit({...tenant,actorId:`${id}:other-learner`},started.sessionId,wrong,wrong.clientActionId);
    assert.equal(foreign.status,'expired_session');assert.notDeepEqual(foreign,failed[0]);assert.equal(foreign.state,undefined);
    assert.equal((await pool.query('SELECT status FROM simulation_attempts WHERE simulation_attempt_id=$1',[attemptId])).rows[0].status,'INVALIDATED');const failedHistory=(await pool.query('SELECT state FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].state.simulationState;assert.deepEqual(failedHistory.diagnosedFaultIds,['fault:terminal']);assert.deepEqual(failedHistory.resolvedFaultIds,[]);assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[organizationId])).rows[0].n,0);assert.equal((await pool.query("SELECT count(*)::int n FROM progress_events WHERE organization_id=$1 AND event_type='simulation.completed'",[organizationId])).rows[0].n,0);
    assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:5})).status,'expired_session');await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/SIMULATION_COOLDOWN/);
    console.log('Fault invalidation PostgreSQL passed: published rule, protocol rejection, atomic audit rollback, concurrent idempotence, terminal session/attempt, retained score and no credential/completion.');
  }else{
  const opened = await sessions.submit(tenant, started.sessionId, { clientActionId: `${id}:open`, releaseBindingId, modelVersionId, expectedSequence: 2, type: "transform_component", componentId: "AIC-C02", transform: { rotationY: Math.PI / 2 } }, `${id}:open`);
  assert.equal(opened.status, "accepted");
  const finalAction={ clientActionId: `${id}:position`, releaseBindingId, modelVersionId, expectedSequence: 3, type: "transform_component", componentId: "AIC-C03", transform: { translationX: 0.2 } };
  // Force progress insertion to fail and prove the action/state/attempt transaction rolls back.
  await pool.query(`INSERT INTO progress_events(progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at) VALUES($1,$2,$3,$4,'test-conflict','{}',now())`,[`progress:${attemptId}`,organizationId,enrollmentId,tenant.actorId]);
  await assert.rejects(sessions.submit(tenant,started.sessionId,finalAction,`${id}:position`),/duplicate key/);
  assert.equal((await pool.query('SELECT next_sequence FROM simulation_sessions WHERE simulation_session_id=$1',[started.sessionId])).rows[0].next_sequence,3);
  assert.equal((await pool.query('SELECT status FROM simulation_attempts WHERE simulation_attempt_id=$1',[attemptId])).rows[0].status,'ACTIVE');
  await pool.query('DELETE FROM progress_events WHERE organization_id=$1 AND progress_event_id=$2',[organizationId,`progress:${attemptId}`]);
  const [positioned,concurrentCompletion]=await Promise.all([sessions.submit(tenant,started.sessionId,finalAction,`${id}:position`),sessions.submit(tenant,started.sessionId,finalAction,`${id}:position`)]);
  assert.deepEqual(positioned,concurrentCompletion);
  assert.equal(positioned.status, "accepted");
  assert.equal(positioned.state?.completed, true);
  assert.equal(positioned.state?.scorePoints, 3);
  assert.deepEqual(positioned.state?.allowedActions, []);
  const replay = await sessions.submit(tenant, started.sessionId, { clientActionId: `${id}:position`, releaseBindingId, modelVersionId, expectedSequence: 3, type: "transform_component", componentId: "AIC-C03", transform: { translationX: 0.2 } }, `${id}:position`);
  assert.deepEqual(replay, positioned);
  const resumed = await sessions.resume(tenant, started.sessionId, { releaseBindingId, modelVersionId, nextSequence: 4 });
  assert.equal(resumed?.status, "accepted");
  assert.equal(resumed?.state?.completed, true);
  assert.equal(resumed?.state?.scorePoints, 3);
  const events=await pool.query(`SELECT payload FROM progress_events WHERE organization_id=$1 AND event_type='simulation.completed'`,[organizationId]);
  assert.equal(events.rows.length,1);assert.equal(events.rows[0].payload.passed,true);assert.equal(events.rows[0].payload.score,3);
  assert.equal(events.rows[0].payload.releaseHash,release.releaseHash);assert.equal(events.rows[0].payload.policyVersion,1);
  const afterCompletion=await sessions.submit(tenant,started.sessionId,{...finalAction,clientActionId:`${id}:after-completion`,expectedSequence:4},`${id}:after-completion`);
  assert.equal(afterCompletion.status,'invalid_precondition');
  assert.equal((await pool.query(`SELECT status FROM simulation_attempts WHERE simulation_attempt_id=$1`,[attemptId])).rows[0].status,'COMPLETED');
  const progress=await createPostgresEnrollmentService(pool).get(tenant,enrollmentId);
  assert.equal(progress.eligibility.eligible,true);if(publishedMedia||publishedExploration){assert.equal(progress.eligibility.evidenceIds.length,3);assert(progress.eligibility.evidenceIds.includes(attemptId));}else assert.deepEqual(progress.eligibility.evidenceIds,[attemptId]);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM credentials WHERE organization_id=$1`,[organizationId])).rows[0].n,1);
  assert.deepEqual(progress.progress.filter(p=>p.activityId===publicActivityId),[{activityId:publicActivityId,status:'PASSED',score:3,maxScore:3}]);
  if(publishedStory){
    assert.equal((await stories.get(tenant,enrollmentId)).node.choices[0].enabled,true);
    const storyServer=createJobStatusHttpServer({courseStoryStore:stories,candidateLearningAccessStore:createCandidateLearningAccessStore(pool),personalAccountStore:createPersonalAccountStore(pool),statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization==='Bearer learner'?candidatePrincipal:null},organizationContextResolver:{resolveActiveOrganizations:async()=>[]}});
    await new Promise(resolve=>storyServer.listen(0,'127.0.0.1',resolve));
    let finished;
    try{
      const endpoint=`http://127.0.0.1:${storyServer.address().port}/api/v1/enrollments/${enrollmentId}/story/choices`;
      const request={method:'POST',headers:{authorization:'Bearer learner','content-type':'application/json','x-organization-id':organizationId,'idempotency-key':'story-finish'},body:JSON.stringify({revision:2,choiceId:'finish'})};
      const response=await fetch(endpoint,request);assert.equal(response.status,200);finished=await response.json();
      const replay=await fetch(endpoint,request);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),finished);
    }finally{storyServer.closeAllConnections();await new Promise(resolve=>storyServer.close(resolve));}
    assert.equal(finished.revision,3);assert.equal((await stories.get(tenant,enrollmentId)).node.outcome.kind,'success');
    assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:4})).status,'expired_session');
    const retained=await createPostgresEnrollmentService(pool).get(tenant,enrollmentId);assert.equal(retained.eligibility.eligible,true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[organizationId])).rows[0].n,1);
    const immutable=(await pool.query('SELECT release_hash,manifest FROM release_manifests WHERE release_id=$1',[release.releaseId])).rows[0];
    assert.equal(immutable.release_hash,release.releaseHash);assert.deepEqual(immutable.manifest,release.manifest);
    console.log('Published story passed: saved draft, revision-bound reviews, immutable release, launch gate, authenticated HTTP projection, real simulation facts, terminal navigation and retained credential.');
  }else if(publishedMedia||publishedExploration){
    assert.equal(progress.progress.filter(p=>p.status==='ACKNOWLEDGED').length,2);
    const snapshot=(await pool.query('SELECT release_hash,manifest FROM release_manifests WHERE release_id=$1',[release.releaseId])).rows[0];assert.equal(snapshot.release_hash,release.releaseHash);assert.deepEqual(snapshot.manifest,release.manifest);
    if(process.argv.includes('--model-replacement')||process.argv.includes('--mapped-replacement')||process.argv.includes('--expanded-replacement')||process.argv.includes('--removed-replacement')){const {checkModelReplacementPublication}=await import('./check-model-replacement-publication.mjs');await checkModelReplacementPublication({pool,review,tenant,authorId,reviewTenant,release,aiRunId,inspectionActivities,remap:process.argv.includes('--mapped-replacement')||process.argv.includes('--expanded-replacement')||process.argv.includes('--removed-replacement'),expanded:process.argv.includes('--expanded-replacement'),removed:process.argv.includes('--removed-replacement')});}
    if(publishedExploration)console.log('Published inspection passed: saved draft, actual-approved-model rejection, immutable release, authenticated inspection/private model access, single acknowledgements, scored requirement and credential.');
    else console.log('Published media passed: saved author bindings, approval-loss rejection, reviewed release hashes, private delivery, idempotent acknowledgements, scored requirement and one credential without release mutation.');
  }else{
  if(process.argv.includes('--story-access')){
    // Synthetic story fixture: publication remains gated until the player is integrated.
    const story={schemaVersion:'course-story.v1',mission:'Inspect the controller',startNodeId:'intro',nodes:[
      {nodeId:'intro',title:'Briefing',purpose:'Read the mission',prerequisites:[],choices:[{choiceId:'begin',label:'Begin',consequence:'Inspect the controller',nextNodeId:'activity',conditions:[]}]},
      {nodeId:'activity',title:'Procedure',purpose:'Complete the procedure',activityId:publicActivityId,prerequisites:[],choices:[],outcome:{kind:'success',message:'Procedure complete'}}]};
    const patched=structuredClone(release.manifest);patched.content.story=story;
    await pool.query('UPDATE release_manifests SET manifest=$2 WHERE release_id=$1',[release.releaseId,patched]);
    await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/STORY_ACTIVITY_UNAVAILABLE/);
    await assert.rejects(sessions.start(tenant,startRequest,launchKey),/STORY_ACTIVITY_UNAVAILABLE/);
    assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:4})).status,'expired_session');
    assert.equal((await sessions.submit(tenant,started.sessionId,finalAction,`${id}:position`)).status,'expired_session');
    const {createCourseStoryStore}=await import('../packages/db/dist/index.js');
    await createCourseStoryStore(pool).choose(tenant,enrollmentId,{revision:1,choiceId:'begin',requestId:'begin'});
    assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:4})).status,'accepted');
    // Restore the immutable-release fixture before the remaining lifecycle checks.
    await pool.query('UPDATE release_manifests SET manifest=$2 WHERE release_id=$1',[release.releaseId,release.manifest]);
    console.log('Story model access passed: launch/direct start/resume/action replay denied outside current node; current activity resumes.');
  }
  const factsFor=actor=>withTenantTransaction(pool,actor,client=>enrollmentStoryFacts(client,actor,enrollmentId));
  assert.deepEqual(await factsFor(tenant),[{activityId:publicActivityId,completed:true,passed:true,score:1,attempts:1}]);
  await assert.rejects(factsFor({...tenant,actorId:'foreign-learner'}),/ENROLLMENT_NOT_FOUND/);
  await assert.rejects(factsFor({...tenant,organizationId:'foreign-org'}),/ENROLLMENT_NOT_FOUND/);

  for (const [table,column,status] of [['enrollments','enrollment_id','SUSPENDED'],['simulation_attempts','simulation_attempt_id','INVALIDATED']]) {
    const target=table==='enrollments'?enrollmentId:attemptId;
    await pool.query(`UPDATE ${table} SET status=$2 WHERE ${column}=$1`,[target,status]);
    if(table==='enrollments')await assert.rejects(factsFor(tenant),/ENROLLMENT_NOT_FOUND/);
    else {const invalidatedFacts=await factsFor(tenant);assert.equal(invalidatedFacts[0].completed,false);assert.equal(invalidatedFacts[0].score,null);}

    await assert.rejects(sessions.start(tenant,startRequest,launchKey),/ENROLLMENT_NOT_ACTIVE_FOR_RELEASE/);
    await assert.rejects(sessions.start(tenant,startRequest,`${id}:new-start`),/ENROLLMENT_NOT_ACTIVE_FOR_RELEASE|SIMULATION_ATTEMPT_NOT_ACTIVE_OR_BOUND/);
    const denied=await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:4});
    assert.equal(denied?.status,'expired_session');assert.equal(denied?.state,undefined);
    const replayDenied=await sessions.submit(tenant,started.sessionId,{clientActionId:`${id}:position`,releaseBindingId,modelVersionId,expectedSequence:3,type:'transform_component',componentId:'AIC-C03',transform:{translationX:0.2}},`${id}:position`);
    assert.equal(replayDenied.status,'expired_session');assert.equal(replayDenied.state,undefined);
    if(table==='simulation_attempts') {
      const revoked=await createPostgresEnrollmentService(pool).get(tenant,enrollmentId);
      assert.equal(revoked.progress[0].status,'INVALIDATED');assert.equal(revoked.progress[0].score,undefined);
      assert.equal(revoked.eligibility.eligible,false);
    }
    await pool.query(`UPDATE ${table} SET status=$2 WHERE ${column}=$1`,[target,table==='simulation_attempts'?'COMPLETED':'ACTIVE']);
  }
  await pool.query(`UPDATE simulation_attempts SET started_at=now()-interval '1801 seconds' WHERE simulation_attempt_id=$1`,[attemptId]);
  assert.equal((await sessions.resume(tenant,started.sessionId,{releaseBindingId,modelVersionId,nextSequence:4})).status,'expired_session');
  await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/SIMULATION_COOLDOWN/);
  await pool.query(`UPDATE simulation_attempts SET started_at=now()-interval '1900 seconds',completed_at=now()-interval '1900 seconds' WHERE simulation_attempt_id=$1`,[attemptId]);
  const retry=await launcher.launch(tenant,enrollmentId,publicActivityId);
  assert.notEqual(retry.attemptId,attemptId);
  await pool.query(`UPDATE simulation_attempts SET started_at=now()-interval '1900 seconds' WHERE simulation_attempt_id=$1`,[retry.attemptId]);
  await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/SIMULATION_ATTEMPT_LIMIT/);
  const invalidation=createAttemptInvalidationService(pool),admin={...tenant,actorId:reviewerId};
  const preview=(await invalidation.list(admin,tenant.actorId)).items.find(item=>item.attemptId===attemptId);
  assert.equal(preview.affectedCredentials.length,1);
  const invalidated=await invalidation.invalidate(admin,'simulation',attemptId,{reason:'Simulation evidence was technically corrupted',previewToken:preview.previewToken,idempotencyKey:'invalidate-simulation'});
  assert.equal(invalidated.revokedCredentialIds.length,1);
  assert.equal((await pool.query(`SELECT status FROM credentials WHERE organization_id=$1`,[organizationId])).rows[0].status,'REVOKED');
  assert.equal((await pool.query(`SELECT payload FROM progress_events WHERE organization_id=$1 AND event_type='simulation.completed'`,[organizationId])).rows[0].payload.passed,true,'Historical progress evidence must remain intact');
  await pool.query(`UPDATE simulation_attempts SET started_at=now() WHERE simulation_attempt_id=$1`,[retry.attemptId]);
  assert.equal((await sessions.resume(tenant,retry.sessionId,{releaseBindingId,modelVersionId,nextSequence:1})).status,'accepted');
  const activePreview=(await invalidation.list(admin,tenant.actorId)).items.find(item=>item.attemptId===retry.attemptId);assert.equal(activePreview.affectedCredentials.length,0);
  await invalidation.invalidate(admin,'simulation',retry.attemptId,{reason:'Interrupted training session invalidated',previewToken:activePreview.previewToken,idempotencyKey:'invalidate-active'});
  assert.equal((await sessions.resume(tenant,retry.sessionId,{releaseBindingId,modelVersionId,nextSequence:1})).status,'expired_session');
  const resets=createAttemptReviewService(pool);
  const resetOption=(await resets.list(admin,tenant.actorId,undefined,'reset')).items.find(item=>item.activityId===publicActivityId);assert.equal(resetOption.throughAttempt,2);
  await resets.resolve(admin,enrollmentId,publicActivityId,{reason:'Reviewed technical interruption; repeat training',throughAttempt:2,idempotencyKey:'simulation-reset',action:'reset'});
  await assert.rejects(launcher.launch(tenant,enrollmentId,publicActivityId),/SIMULATION_COOLDOWN/);
  await pool.query(`UPDATE simulation_attempts SET started_at=now()-interval '1900 seconds' WHERE simulation_attempt_id=$1`,[retry.attemptId]);
  const resetLaunch=await launcher.launch(tenant,enrollmentId,publicActivityId);
  assert.equal((await pool.query(`SELECT attempt_number FROM simulation_attempts WHERE simulation_attempt_id=$1`,[resetLaunch.attemptId])).rows[0].attempt_number,3);
  assert.equal((await pool.query(`SELECT status FROM credentials WHERE organization_id=$1`,[organizationId])).rows[0].status,'REVOKED','Reset cannot resurrect an issued credential');
  console.log("E4 PostgreSQL passed: publication creates runtime records, learner launch/concurrent replay, HTTP forged-binding denial, completion/resume, suspension/invalidation, expiry/cooldown and attempt limit.");
  }
  }
  }
} finally {
  for (const sql of [
    "DELETE FROM course_story_choices WHERE organization_id = $1",
    "DELETE FROM course_story_positions WHERE organization_id = $1",
    "DELETE FROM credential_events WHERE organization_id = $1",
    "DELETE FROM credentials WHERE organization_id = $1",
    "DELETE FROM progress_events WHERE organization_id = $1",
    "DELETE FROM simulation_actions WHERE organization_id = $1",
    "DELETE FROM simulation_sessions WHERE organization_id = $1",
    "DELETE FROM simulation_attempts WHERE organization_id = $1",
    "DELETE FROM candidate_enrollment_consents WHERE organization_id = $1",
    "DELETE FROM enrollments WHERE organization_id = $1",
    "DELETE FROM certification_policies WHERE organization_id = $1",
    "DELETE FROM activities WHERE organization_id = $1",
    "DELETE FROM modules WHERE organization_id = $1",
    "DELETE FROM simulation_definitions WHERE organization_id = $1",
    "DELETE FROM outbox_events WHERE organization_id = $1",
    "DELETE FROM release_model_bindings WHERE organization_id = $1",
    "DELETE FROM release_manifests WHERE organization_id = $1",
    "DELETE FROM course_review_decisions WHERE organization_id = $1",
    "DELETE FROM ai_runs WHERE organization_id = $1",
    "DELETE FROM course_versions WHERE organization_id = $1",
    "DELETE FROM asset_versions WHERE organization_id = $1",
    "DELETE FROM assets WHERE organization_id = $1",
    "DELETE FROM model_versions WHERE organization_id = $1",
    "DELETE FROM courses WHERE organization_id = $1",
    "DELETE FROM organizations WHERE organization_id = $1"
  ]) await pool.query(sql, [organizationId]).catch(() => {});
  await verified.cleanup();if(runtimePool!==pool)await runtimePool.end();await pool.end();
}
