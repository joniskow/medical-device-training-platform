import {createPostgresAssessmentSessionService} from '../apps/api/dist/assessment-session-service.js';
import {createPostgresEnrollmentService} from '../apps/api/dist/enrollment-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresCourseReviewStore,createCourseStoryStore,withTenantTransaction} from '../packages/db/dist/index.js';
const admin=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='story:'+randomUUID(),tenant={organizationId:org,actorId:'learner',correlationId:org},enrollmentId=org+':enroll',releaseId=org+':release',store=createCourseStoryStore(runtime),grants=[];
let locked=false,candidate=false,candidateAllowed=true;
const server=createJobStatusHttpServer({courseStoryStore:store,statusService:{get:async()=>null,retry:async()=>null},
 authenticator:{authenticate:async req=>req.headers.authorization?{subject:req.headers.authorization,issuer:'fixture',identityTenant:'fixture',roles:['learner']}:null},
 personalAccountStore:{access:async()=>{if(locked)throw Error('ACCOUNT_LOCKED');},observeVerification:async()=>{}},
 organizationContextResolver:{resolveActiveOrganizations:async()=>candidate?[]:[org]},
 candidateLearningAccessStore:{canAccess:async()=>candidateAllowed}});
const choice=(choiceId,nextNodeId)=>({choiceId,label:choiceId,consequence:'Continue the mission.',nextNodeId,conditions:[]});
const node=(nodeId,choices,extra={})=>({nodeId,title:nodeId,purpose:'Test the mission.',prerequisites:[],choices,...extra});
const story={schemaVersion:'course-story.v1',mission:'Prepare the controller.',startNodeId:'start',nodes:[node('start',[choice('begin','read')]),node('read',[choice('continue','quiz')],{activityId:'read'}),node('quiz',[choice('finish','end'),choice('review','retry')],{activityId:'quiz'}),node('end',[],{outcome:{kind:'success',message:'Finished'}}),node('retry',[],{outcome:{kind:'retry',message:'Review and retry'}})]};
const content={story,policy:{schemaVersion:'certification-policy.v1',policyId:'policy',version:1,requiredActivityIds:['quiz'],requiredModuleIds:[],requiredEvidence:['assessment.passed'],resultSelection:'latest',passScore:1,maxAttempts:3,cooldownSeconds:0,attemptTtlSeconds:1800,repeatedFailureReviewAfter:null,expirationDays:null},modules:[{moduleId:'m',activities:[{activityId:'read',type:'text'},{activityId:'quiz',type:'multiple_choice',assessment:{assessmentId:'quiz',version:1,passScore:1}}]}]};
try{
 await applyProcessingJobMigration(admin);
 const permissions={course_story_positions:['SELECT','INSERT','UPDATE'],course_story_choices:['SELECT','INSERT'],enrollments:['SELECT','UPDATE'],release_manifests:['SELECT','UPDATE'],assessment_sessions:['SELECT'],simulation_attempts:['SELECT'],progress_events:['SELECT'],audit_events:['INSERT']};
 for(const [table,verbs] of Object.entries(permissions))for(const verb of verbs)if(!(await admin.query("SELECT has_table_privilege('local_runtime',$1,$2) allowed",[table,verb])).rows[0].allowed){await admin.query(`GRANT ${verb} ON ${table} TO local_runtime`);grants.push([table,verb]);}
 const draft=await createPostgresCourseReviewStore(admin).createDraft({tenant,title:'Story fixture',idempotencyKey:'draft'});
 await admin.query(`INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED',$4,$5,'reviewer','fixture','fixture',now())`,[releaseId,org,draft.courseVersionId,{content},'a'.repeat(64)]);
 await admin.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,'learner',$3,'ACTIVE',now(),now())`,[enrollmentId,org,draft.courseVersionId]);
 const assessments=createPostgresAssessmentSessionService(runtime),enrollments=createPostgresEnrollmentService(runtime);
 await assert.rejects(assessments.start(tenant,{enrollmentId,releaseId,activityId:'quiz',idempotencyKey:'skip'}),/STORY_ACTIVITY_UNAVAILABLE/);
 await assert.rejects(enrollments.acknowledge(tenant,enrollmentId,'read'),/STORY_ACTIVITY_UNAVAILABLE/);
 const initial=await store.get(tenant,enrollmentId);assert.equal(initial.node.nodeId,'start');assert.equal(initial.revision,1);
 assert.deepEqual(await store.get(tenant,enrollmentId),initial);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${encodeURIComponent(enrollmentId)}/story`;
 const headers={authorization:'learner','x-organization-id':org};
 assert.equal((await fetch(url)).status,401);
 const read=await fetch(url,{headers});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal((await read.json()).revision,1);
 assert.equal((await fetch(url+'?revision=1',{headers})).status,422);
 assert.equal((await fetch(url,{method:'POST',headers})).status,405);
 assert.equal((await fetch(url,{headers:{...headers,authorization:'other'}})).status,404);
 locked=true;assert.equal((await fetch(url,{headers})).status,403);locked=false;
 candidate=true;assert.equal((await fetch(url,{headers})).status,200);candidateAllowed=false;assert.equal((await fetch(url,{headers})).status,403);candidateAllowed=true;candidate=false;
 const post=(body,key='http')=>fetch(url+'/choices',{method:'POST',headers:{...headers,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(body)});
 assert.equal((await post({revision:1,choiceId:'begin'},null)).status,422);
 for(const extra of [{facts:[]},{learnerId:'other'},{nodeId:'end'},{releaseId:'forged'},{requestId:'body-key'}])assert.equal((await post({revision:1,choiceId:'begin',...extra})).status,422);
 assert.equal((await post({revision:1,choiceId:'end'})).status,409);
 assert.equal((await fetch(url+'/choices',{method:'POST',headers,body:'{}'})).status,415);
 const request={revision:1,choiceId:'begin',requestId:'first'};
 const results=await Promise.all([store.choose(tenant,enrollmentId,request),store.choose(tenant,enrollmentId,request)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].revision,2);
 const receipt=await post({revision:1,choiceId:'begin'},'first');assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),results[0]);
 assert.equal((await post({revision:1,choiceId:'continue'},'first')).status,409);
 assert.equal((await post({revision:1,choiceId:'begin'},'http-stale')).status,409);

 assert.equal((await store.get(tenant,enrollmentId)).node.choices[0].enabled,false);
 await assert.rejects(store.choose(tenant,enrollmentId,{...request,choiceId:'other'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(store.choose(tenant,enrollmentId,{...request,requestId:'stale'}),/STORY_REVISION_CONFLICT/);
 await assert.rejects(store.choose(tenant,enrollmentId,{revision:2,choiceId:'continue',requestId:'blocked'}),/STORY_CHOICE_NOT_AVAILABLE/);
 await assert.rejects(store.choose(tenant,enrollmentId,{revision:2,choiceId:'continue',requestId:'forged',facts:[]}),/STORY_REQUEST_INVALID/);
 await assert.rejects(store.get({...tenant,actorId:'other'},enrollmentId),/STORY_NOT_FOUND/);
 await assert.rejects(store.get({...tenant,organizationId:'other'},enrollmentId),/STORY_NOT_FOUND/);
 assert.equal((await runtime.query('SELECT count(*)::int n FROM course_story_positions')).rows[0].n,0,'Missing tenant context must expose no positions');
 assert.equal((await withTenantTransaction(runtime,{...tenant,organizationId:'other'},c=>c.query('SELECT count(*)::int n FROM course_story_choices'))).rows[0].n,0);
 await admin.query(`INSERT INTO progress_events(progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at) VALUES($1,$2,$3,'learner','content.acknowledged',$4,now())`,[org+':ack',org,enrollmentId,{activityId:'read',releaseId,releaseHash:'a'.repeat(64),policyId:'policy',policyVersion:1}]);
 assert.equal((await store.get(tenant,enrollmentId)).node.choices[0].enabled,true);
 const failingPool={connect:async()=>{const c=await runtime.connect();return {query:(sql,args)=>{if(/'STORY_(CHOICE_ACCEPTED|RESTARTED)'/.test(String(sql)))throw Error('Injected story audit failure');return c.query(sql,args);},release:()=>c.release()};}};
 const next={revision:2,choiceId:'continue',requestId:'second'};
 await assert.rejects(createCourseStoryStore(failingPool).choose(tenant,enrollmentId,next),/Injected story audit failure/);
 assert.equal((await store.get(tenant,enrollmentId)).revision,2);
 assert.equal((await admin.query('SELECT count(*)::int n FROM course_story_choices WHERE organization_id=$1',[org])).rows[0].n,1);
 const competitors=await Promise.allSettled([store.choose(tenant,enrollmentId,next),store.choose(tenant,enrollmentId,{...next,requestId:'competitor'})]);
 assert.equal(competitors.filter(r=>r.status==='fulfilled').length,1);assert.match(competitors.find(r=>r.status==='rejected').reason.message,/STORY_REVISION_CONFLICT/);
 assert.equal((await store.get(tenant,enrollmentId)).node.nodeId,'quiz');
 assert.deepEqual(await store.choose(tenant,enrollmentId,request),results[0],'Old retry returns original receipt');
 assert.equal((await store.get(tenant,enrollmentId)).revision,3,'Old retry must not rewind position');
 await admin.query(`INSERT INTO assessment_sessions(session_id,organization_id,learner_id,enrollment_id,release_id,release_hash,activity_id,assessment_id,assessment_version,policy_id,policy_version,definition,policy_snapshot,attempt_number,start_key,start_hash,status,answers,answer_hash,result,started_at,expires_at,submitted_at)
 VALUES($1,$2,'learner',$3,$4,$5,'quiz','quiz',1,'policy',1,'{}','{}',1,'fixture','fixture','PASSED','[]','fixture','{"score":1,"maxScore":1}',now()-interval '1 minute',now()+interval '10 minutes',now())`,[org+':quiz',org,enrollmentId,releaseId,'a'.repeat(64)]);
 await assert.rejects(enrollments.acknowledge(tenant,enrollmentId,'read'),/STORY_ACTIVITY_UNAVAILABLE/);
 await assert.rejects(store.restart(tenant,enrollmentId,{revision:3,requestId:'early-restart'}),/STORY_CHOICE_NOT_AVAILABLE/);
 await store.choose(tenant,enrollmentId,{revision:3,choiceId:'review',requestId:'review'});
 const preserved=JSON.stringify((await admin.query('SELECT * FROM assessment_sessions WHERE organization_id=$1',[org])).rows);
 const restartRequest={revision:4,requestId:'restart'};
 await assert.rejects(createCourseStoryStore(failingPool).restart(tenant,enrollmentId,restartRequest),/Injected story audit failure/);
 assert.equal((await store.get(tenant,enrollmentId)).revision,4);
 const restarted=await Promise.all([store.restart(tenant,enrollmentId,restartRequest),store.restart(tenant,enrollmentId,restartRequest)]);assert.deepEqual(restarted[0],restarted[1]);assert.equal(restarted[0].revision,5);
 assert.equal(JSON.stringify((await admin.query('SELECT * FROM assessment_sessions WHERE organization_id=$1',[org])).rows),preserved,'Restart rewrote assessment history');
 const restartPost=body=>fetch(url+'/restart',{method:'POST',headers:{...headers,'content-type':'application/json','idempotency-key':'restart'},body:JSON.stringify(body)});
 assert.equal((await restartPost({revision:4})).status,422);assert.equal((await restartPost({revision:4,confirmed:true,facts:[]})).status,422);
 const replayRestart=await restartPost({revision:4,confirmed:true});assert.equal(replayRestart.status,200);assert.deepEqual(await replayRestart.json(),restarted[0]);
 await assert.rejects(store.choose(tenant,enrollmentId,{revision:4,choiceId:'review',requestId:'restart'}),/IDEMPOTENCY_KEY_REUSED/);
 await store.choose(tenant,enrollmentId,{revision:5,choiceId:'begin',requestId:'again-begin'});
 await store.choose(tenant,enrollmentId,{revision:6,choiceId:'continue',requestId:'again-continue'});
 await store.choose(tenant,enrollmentId,{revision:7,choiceId:'finish',requestId:'terminal'});
 await assert.rejects(assessments.get(tenant,org+':quiz'),/STORY_ACTIVITY_UNAVAILABLE/);
 await assert.rejects(assessments.submit(tenant,org+':quiz',[]),/STORY_ACTIVITY_UNAVAILABLE/);
 const terminal=await store.get(tenant,enrollmentId);assert.equal(terminal.revision,8);assert.equal(terminal.node.outcome.kind,'success');
 assert.deepEqual(await store.restart(tenant,enrollmentId,restartRequest),restarted[0],'Old restart must return its original receipt');
 assert.equal((await store.get(tenant,enrollmentId)).revision,8,'Old restart must not rewind later progress');
 await assert.rejects(store.restart(tenant,enrollmentId,{revision:8,requestId:'success-restart'}),/STORY_CHOICE_NOT_AVAILABLE/);
 assert.equal((await admin.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='STORY_RESTARTED'",[org])).rows[0].n,1,'Concurrent/replayed restart must have one audit event');
 await assert.rejects(store.choose(tenant,enrollmentId,{revision:8,choiceId:'finish',requestId:'again'}),/STORY_CHOICE_NOT_AVAILABLE/);
 await assert.rejects(withTenantTransaction(runtime,tenant,c=>c.query("UPDATE course_story_choices SET response='{}' WHERE organization_id=$1",[org])),/permission denied/);
 await admin.query("UPDATE enrollments SET status='SUSPENDED' WHERE enrollment_id=$1",[enrollmentId]);await assert.rejects(store.choose(tenant,enrollmentId,request),/STORY_NOT_FOUND/);
 await admin.query("UPDATE enrollments SET status='ACTIVE' WHERE enrollment_id=$1",[enrollmentId]);
 await admin.query("UPDATE release_manifests SET status='RETIRED' WHERE release_id=$1",[releaseId]);await assert.rejects(store.get(tenant,enrollmentId),/STORY_NOT_FOUND/);
 await admin.query("UPDATE release_manifests SET status='PUBLISHED',release_hash=$2 WHERE release_id=$1",[releaseId,'b'.repeat(64)]);await assert.rejects(store.get(tenant,enrollmentId),/STORY_BINDING_CHANGED/);
 assert.equal((await admin.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='STORY_CHOICE_ACCEPTED'",[org])).rows[0].n,6);
 assert.equal((await admin.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[org])).rows[0].n,0);
 console.log('Story HTTP and store passed: authentication/account/candidate gates, strict fields, no-store, HTTP replay/conflicts;  restricted-runtime resume, concurrent replay/conflict, authoritative reading gate, audit rollback, old retry non-rewind, forged fields, tenant/owner denial, suspension/retirement/binding loss and no credential.');
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
 for(const table of ['course_story_choices','course_story_positions','assessment_sessions','progress_events','enrollments','release_manifests','course_versions','courses','audit_events'])await admin.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
 for(const [table,verb] of grants)await admin.query(`REVOKE ${verb} ON ${table} FROM local_runtime`);
 await runtime.end();await admin.end();
}
