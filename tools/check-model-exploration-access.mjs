import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresCourseReviewStore} from '../packages/db/dist/index.js';
import {createPostgresEnrollmentService} from '../apps/api/dist/enrollment-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const admin=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='inspect:'+randomUUID(),tenant={organizationId:org,actorId:'learner',correlationId:org},releaseId=org+':release',enrollmentId=org+':enrollment',modelVersionId=org+':model';
const model=JSON.parse(await readFile('apps/web/src/model-manifest.json','utf8'));model.modelVersionId=modelVersionId;model.releaseBindingId=`releasebind:${releaseId}:${modelVersionId}`;
const exploration={overview:'Inspect the controller',hotspots:[{componentId:model.components[0].componentId,title:'Panel',text:'Review the indicators'}]};
const content={model:{modelVersionId,manifestHash:model.sourceHash,manifest:model},modules:[{moduleId:'inspect',activities:[{activityId:'inspect',type:'hotspot',exploration}]}]};
const service=createPostgresEnrollmentService(runtime);let locked=false,candidate=false,candidateAllowed=true,addedGrant=false,addedBindingGrant=false;
const server=createJobStatusHttpServer({enrollmentService:service,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization?{subject:req.headers.authorization,issuer:'fixture',identityTenant:'fixture',roles:['learner']}:null},personalAccountStore:{access:async()=>{if(locked)throw Error('ACCOUNT_LOCKED');},observeVerification:async()=>{}},organizationContextResolver:{resolveActiveOrganizations:async()=>candidate?[]:[org]},candidateLearningAccessStore:{canAccess:async()=>candidateAllowed}});
try{
 await applyProcessingJobMigration(admin);
 if(!(await admin.query("SELECT has_table_privilege('local_runtime','course_story_positions','SELECT') allowed")).rows[0].allowed){await admin.query('GRANT SELECT ON course_story_positions TO local_runtime');addedGrant=true;}
 if(!(await admin.query("SELECT has_table_privilege('local_runtime','release_model_bindings','SELECT') allowed")).rows[0].allowed){await admin.query('GRANT SELECT ON release_model_bindings TO local_runtime');addedBindingGrant=true;}
 const draft=await createPostgresCourseReviewStore(admin).createDraft({tenant,title:'Inspection fixture',idempotencyKey:'draft'});
 await admin.query(`INSERT INTO model_versions(model_version_id,organization_id,blob_key,manifest_blob_key,manifest,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'APPROVED','reviewer',now(),now())`,[modelVersionId,org,org+'/model.glb',org+'/model.json',model]);
 await admin.query(`INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED',$4,$5,'reviewer','fixture','fixture',now())`,[releaseId,org,draft.courseVersionId,{content},'b'.repeat(64)]);
 await admin.query(`INSERT INTO release_model_bindings(release_model_binding_id,organization_id,release_id,model_version_id,release_binding_id,manifest_hash,model_blob_key,manifest_blob_key,manifest,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,[org+':binding',org,releaseId,modelVersionId,model.releaseBindingId,model.sourceHash,org+'/model.glb',org+'/model.json',model]);
 await admin.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,'learner',$3,'ACTIVE',now(),now())`,[enrollmentId,org,draft.courseVersionId]);
 const projected=await service.inspect(tenant,enrollmentId,'inspect');assert.deepEqual(projected,{releaseId,modelVersionId,exploration});
 for(const actor of [{...tenant,actorId:'foreign'},{...tenant,organizationId:'foreign'}])await assert.rejects(service.inspect(actor,enrollmentId,'inspect'),/EXPLORATION_NOT_FOUND/);
 assert.equal((await admin.query('SELECT count(*)::int n FROM progress_events WHERE organization_id=$1',[org])).rows[0].n,0);
 const setContent=value=>admin.query('UPDATE release_manifests SET manifest=$2 WHERE release_id=$1',[releaseId,{content:value}]);
 const forged=structuredClone(content);forged.modules[0].activities[0].exploration.hotspots[0].componentId='forged';forged.model.manifest.components.push({...model.components[0],componentId:'forged'});
 await setContent(forged);await assert.rejects(service.inspect(tenant,enrollmentId,'inspect'),/EXPLORATION_NOT_FOUND/);await assert.rejects(service.acknowledge(tenant,enrollmentId,'inspect'),/EXPLORATION_NOT_FOUND/);await setContent(content);
 await admin.query("UPDATE release_model_bindings SET manifest_hash=$2 WHERE organization_id=$1",[org,'a'.repeat(64)]);await assert.rejects(service.inspect(tenant,enrollmentId,'inspect'),/EXPLORATION_NOT_FOUND/);await admin.query('UPDATE release_model_bindings SET manifest_hash=$2 WHERE organization_id=$1',[org,model.sourceHash]);
 await admin.query("UPDATE enrollments SET status='SUSPENDED' WHERE enrollment_id=$1",[enrollmentId]);await assert.rejects(service.inspect(tenant,enrollmentId,'inspect'),/EXPLORATION_NOT_FOUND/);await admin.query("UPDATE enrollments SET status='ACTIVE' WHERE enrollment_id=$1",[enrollmentId]);
 const story=structuredClone(content);story.story={schemaVersion:'course-story.v1',mission:'Inspect',startNodeId:'intro',nodes:[{nodeId:'intro',title:'Briefing',purpose:'Read',prerequisites:[],choices:[{choiceId:'begin',label:'Begin',consequence:'Inspect',nextNodeId:'inspect',conditions:[]}]},{nodeId:'inspect',title:'Inspect',purpose:'Read',activityId:'inspect',prerequisites:[],choices:[],outcome:{kind:'success',message:'Done'}}]};
 await setContent(story);await assert.rejects(service.inspect(tenant,enrollmentId,'inspect'),/STORY_ACTIVITY_UNAVAILABLE/);await assert.rejects(service.acknowledge(tenant,enrollmentId,'inspect'),/STORY_ACTIVITY_UNAVAILABLE/);await setContent(content);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${enrollmentId}/activities/inspect/inspection`,headers={authorization:'learner','x-organization-id':org};
 assert.equal((await fetch(url)).status,401);const result=await fetch(url,{headers});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual(await result.json(),projected);
 assert.equal((await fetch(url+'?modelVersionId=forged',{headers})).status,422);assert.equal((await fetch(url,{headers,method:'POST'})).status,405);assert.equal((await fetch(url,{headers:{...headers,authorization:'foreign'}})).status,404);
 locked=true;assert.equal((await fetch(url,{headers})).status,403);locked=false;candidate=true;assert.equal((await fetch(url,{headers})).status,200);candidateAllowed=false;assert.equal((await fetch(url,{headers})).status,403);candidateAllowed=true;
 const acknowledgements=await Promise.all([service.acknowledge(tenant,enrollmentId,'inspect'),service.acknowledge(tenant,enrollmentId,'inspect')]);assert.deepEqual(acknowledgements[0],acknowledgements[1]);
 assert.equal((await service.get(tenant,enrollmentId)).progress[0].status,'ACKNOWLEDGED');assert.equal((await admin.query('SELECT count(*)::int n FROM progress_events WHERE organization_id=$1',[org])).rows[0].n,1);
 for(const table of ['simulation_attempts','credentials'])assert.equal((await admin.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`,[org])).rows[0].n,0);
 console.log('Inspection access passed: restricted-role immutable model/component validation, story/ownership/lifecycle gates, safe HTTP projection, explicit single acknowledgement and no simulation attempt or credential.');
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
 for(const table of ['progress_events','enrollments','release_model_bindings','release_manifests','model_versions','course_versions','courses','audit_events'])await admin.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
 if(addedBindingGrant)await admin.query('REVOKE SELECT ON release_model_bindings FROM local_runtime');
 if(addedGrant)await admin.query('REVOKE SELECT ON course_story_positions FROM local_runtime');await runtime.end();await admin.end();
}
