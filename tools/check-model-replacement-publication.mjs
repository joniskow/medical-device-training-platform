import assert from 'node:assert/strict';
import {createPostgresEnrollmentService} from '../apps/api/dist/enrollment-service.js';
import {createPostgresModelAssetService} from '../apps/api/dist/postgres-model-asset-service.js';
import {createPostgresModelSessionService} from '../apps/api/dist/postgres-model-session-service.js';
import {createLearnerSimulationService} from '../apps/api/dist/learner-simulation-service.js';

// Runs inside the publication fixture, which owns setup and tenant-scoped cleanup.
export async function checkModelReplacementPublication({pool,review,tenant,authorId,reviewTenant,release,aiRunId,inspectionActivities,remap=false,expanded=false,removed=false}) {
 const author={...tenant,actorId:authorId},org=tenant.organizationId;
 const oldModel=release.manifest.content.model;
 const oldCredentials=(await pool.query('SELECT * FROM credentials WHERE organization_id=$1 ORDER BY credential_id',[org])).rows;
 const oldBinding=(await pool.query('SELECT * FROM release_model_bindings WHERE organization_id=$1 AND release_id=$2',[org,release.releaseId])).rows;
 const next=await review.createRevision({tenant:author,courseVersionId:release.manifest.courseVersionId,reason:'Reviewed compatible model replacement',idempotencyKey:'replacement-revision'});
 const read=async()=>(await review.get(author,next.courseVersionId)).courseVersion;
 let draft=await read();
 const nextModelId=oldModel.modelVersionId+':replacement';
 const sourceModel=(await pool.query('SELECT manifest FROM model_versions WHERE organization_id=$1 AND model_version_id=$2',[org,oldModel.modelVersionId])).rows[0].manifest;
 const manifest={...sourceModel,modelVersionId:nextModelId};
 const mappedId=id=>remap?'mapped-'+id:id;
 const componentMapping=manifest.components.map(c=>({from:c.componentId,to:removed&&c.componentId==='assembly-root'?null:mappedId(c.componentId)}));
 manifest.components=manifest.components.filter(c=>!removed||c.componentId!=='assembly-root').map(c=>({...c,componentId:mappedId(c.componentId)}));
 if(expanded)manifest.components.push({...structuredClone(sourceModel.components[0]),componentId:'assembly-root',nodePath:'Aurora Infusion Controller',displayName:'Controller assembly'});
 await pool.query(`INSERT INTO model_versions(model_version_id,organization_id,blob_key,manifest_blob_key,manifest,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'APPROVED',$6,now(),now())`,[nextModelId,org,org+'/replacement.glb',org+'/replacement.json',manifest,reviewTenant.actorId]);
 const change={schemaVersion:'release-change.v1',classes:['simulation','product_revision'],releaseNotes:'Reviewed replacement model',effectiveAt:new Date().toISOString(),decision:'future_learners_only',rationale:'Fixture preserves stable components and authored procedure',learnerMessage:'New learners use the reviewed model',updateModuleIds:[]};
 await review.saveDraft({tenant:author,courseVersionId:next.courseVersionId,revision:draft.revision,content:{...draft.content,releaseChange:change}});
 draft=await read();
 const approve=async(version)=>{
  const content=version.content;
  for(const [targetType,targetId] of [['AI_DRAFT',aiRunId],['COURSE',next.courseVersionId],['MODEL',content.model.modelVersionId],['SIMULATION',content.simulation.simulationDefinitionId],['POLICY',content.policy.policyId]])await review.recordDecision({tenant:reviewTenant,courseVersionId:next.courseVersionId,targetType,targetId,decision:'APPROVE',rationale:'Review exact replacement revision',revision:version.revision,idempotencyKey:`replacement:${version.revision}:${targetType}`,requestHash:`replacement:${version.revision}:${targetType}`});
 };
 await approve(draft);
 await review.replaceModel({tenant:author,courseVersionId:next.courseVersionId,revision:draft.revision,modelVersionId:nextModelId,idempotencyKey:'replace-published-model',...(remap?{componentMapping}:{})});
 await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId:next.courseVersionId,idempotencyKey:'draft-replacement',requestHash:'draft-replacement'}),/COURSE_NOT_PUBLISHABLE/);
 draft=await read();
 await review.recordDecision({tenant:reviewTenant,courseVersionId:next.courseVersionId,targetType:'COURSE',targetId:next.courseVersionId,decision:'APPROVE',rationale:'Only the course review has been renewed',revision:draft.revision,idempotencyKey:'partial-replacement-review',requestHash:'partial-replacement-review'});
 await assert.rejects(review.publish({tenant:reviewTenant,courseVersionId:next.courseVersionId,idempotencyKey:'stale-replacement-reviews',requestHash:'stale-replacement-reviews'}),/COURSE_REVIEW_REQUIRED/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM release_manifests WHERE organization_id=$1',[org])).rows[0].n,1);
 draft=await read();await approve(draft);
 const replacement=await review.publish({tenant:reviewTenant,courseVersionId:next.courseVersionId,idempotencyKey:'replacement-publish',requestHash:'replacement-publish'});
 if(removed){const definition=replacement.manifest.content.simulation.definition;assert.equal(definition.components.length,release.manifest.content.simulation.definition.components.length-1);assert(!definition.model.componentIds.includes('assembly-root'));assert(!Object.hasOwn(definition.initialState.componentStates,'assembly-root'));assert.deepEqual(definition.scoring,release.manifest.content.simulation.definition.scoring);}
 if(expanded){assert.deepEqual(replacement.manifest.content.simulation.definition.components.at(-1),{componentId:'assembly-root',initialState:'initial',allowedActions:['select_component']});assert.equal(replacement.manifest.content.simulation.definition.initialState.componentStates['assembly-root'],'initial');assert.deepEqual(replacement.manifest.content.simulation.definition.scoring,release.manifest.content.simulation.definition.scoring);}
 assert.equal(replacement.manifest.content.model.modelVersionId,nextModelId);
 assert.equal(replacement.manifest.content.simulation.definition.model.modelVersionId,nextModelId);
 const expectedModules=structuredClone(release.manifest.content.modules);
 for(const module of expectedModules)for(const activity of module.activities)for(const hotspot of activity.exploration?.hotspots??[])hotspot.componentId=mappedId(hotspot.componentId);
 assert.deepEqual(replacement.manifest.content.modules,expectedModules);
 const enrollmentId=org+':replacement-enrollment';
 await pool.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now())`,[enrollmentId,org,tenant.actorId,next.courseVersionId]);
 const enrollments=createPostgresEnrollmentService(pool);
 for(const activity of inspectionActivities){
  const inspection=await enrollments.inspect(tenant,enrollmentId,activity.activityId);assert.equal(inspection.modelVersionId,nextModelId);assert.deepEqual(inspection.exploration,{...activity.exploration,hotspots:activity.exploration.hotspots.map(h=>({...h,componentId:mappedId(h.componentId)}))});
  await enrollments.acknowledge(tenant,enrollmentId,activity.activityId);
 }
 const assets=createPostgresModelAssetService({pool,storage:{createDownloadUrl:async()=> 'https://private.test/model'}});
 assert.equal((await assets.getLearnerModel(tenant,{releaseId:replacement.releaseId,modelVersionId:nextModelId})).modelVersionId,nextModelId);
 assert.equal(await assets.getLearnerModel(tenant,{releaseId:replacement.releaseId,modelVersionId:oldModel.modelVersionId}),null);
 assert.equal((await assets.getLearnerModel(tenant,{releaseId:release.releaseId,modelVersionId:oldModel.modelVersionId})).modelVersionId,oldModel.modelVersionId);
 assert.equal(await assets.getLearnerModel(tenant,{releaseId:release.releaseId,modelVersionId:nextModelId}),null);
 const sessions=createPostgresModelSessionService({pool}),launcher=createLearnerSimulationService(pool,sessions);
 const activityId=replacement.manifest.content.runtimeBindings.activities[0].activityId;
 const started=await launcher.launch(tenant,enrollmentId,activityId);
 const actions=[{type:'select_component',componentId:'AIC-C01'},{type:'transform_component',componentId:'AIC-C02',transform:{rotationY:Math.PI/2}},{type:'transform_component',componentId:'AIC-C03',transform:{translationX:.2}}];
 for(const [i,action] of actions.entries()){
  const key=`replacement-action:${i}`;
  const result=await sessions.submit(tenant,started.sessionId,{...action,componentId:mappedId(action.componentId),clientActionId:key,releaseBindingId:started.releaseBindingId,modelVersionId:nextModelId,expectedSequence:i+1},key);
  assert.equal(result.status,'accepted');if(i===2)assert.equal(result.state.completed,true);
 }
 assert.equal((await enrollments.get(tenant,enrollmentId)).eligibility.eligible,true);
 const retained=(await pool.query('SELECT release_hash,manifest FROM release_manifests WHERE release_id=$1',[release.releaseId])).rows[0];
 assert.equal(retained.release_hash,release.releaseHash);assert.deepEqual(retained.manifest,release.manifest);
 assert.deepEqual((await pool.query('SELECT * FROM release_model_bindings WHERE organization_id=$1 AND release_id=$2',[org,release.releaseId])).rows,oldBinding);
 for(const credential of oldCredentials)assert.deepEqual((await pool.query('SELECT * FROM credentials WHERE credential_id=$1',[credential.credential_id])).rows[0],credential);
 assert.equal((await pool.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[org])).rows[0].n,oldCredentials.length+1);
 console.log((removed?'Removed-component replacement':expanded?'Expanded replacement':remap?'Mapped replacement':'Replacement')+' publication passed: successor revision, stale-review rejection, new review/model binding, private inspection, scored completion and unchanged original release/binding/credential.');
}
