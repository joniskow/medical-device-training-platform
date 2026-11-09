import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createAzureBlobStorage} from '../packages/storage/dist/index.js';
import {createLessonRenderStore,createPostgresJobStore} from '../packages/db/dist/index.js';
import {createLessonRenderService} from '../apps/api/dist/lesson-render-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {processHostedLessonRenderJob} from '../apps/worker/dist/hosted-lesson-render.js';
import {createAzureServiceBusDispatcher} from '../apps/worker/dist/messaging/azure-service-bus-dispatcher.js';
import {handleAzureServiceBusJobMessage} from '../apps/worker/dist/messaging/azure-service-bus-consumer.js';
import {lessonRenderRevision} from '../packages/contracts/dist/index.js';
import {lessonDirectionRevision} from '../packages/simulation-schema/dist/index.js';

// Independently assembled transport acceptance: real HTTP, runtime PostgreSQL and private
// Azurite bytes; controlled identity/queue transport/renderer are explicitly not cloud proof.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const owner=new Pool({connectionString:process.env.DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const runtime=new Pool({connectionString:process.env.DATABASE_RUNTIME_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='independent_'+randomUUID(),tenant={organizationId:org,actorId:'author',correlationId:'independent-pipeline'};
const version=org+'_version',image=org+'_image',manual=org+'_manual',objects=[];
const storage=createAzureBlobStorage({connectionString:'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',containerName:'independent-headless-check',allowHttp:true}); // gitleaks:allow -- public Azurite emulator account key only
const recordingStorage={...storage,async putObject(input){objects.push(input.blobKey);return storage.putObject(input);}};
const citation={assetVersionId:manual,page:1},narration='Press Start. Verify Ready.';
const lesson={schemaVersion:'video-lesson.v1',lessonId:'lesson:independent',title:'Start',durationSeconds:30,learningObjectives:['Verify Ready'],safetyBoundary:'Engineering transport fixture.',citations:[citation],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narration,onScreenText:['Start'],visual:{kind:'source_image',assetVersionId:image,label:'Start'},citations:[citation]}],direction:{schemaVersion:'lesson-direction.v1',openingProblem:'How do you start?',outcome:'Verify Ready.',beats:[{sceneId:'one',sourceEvidence:[{citation,quote:narration}],startingCondition:'Press Start.',subject:'Start',framing:'operator',attentionTarget:'Start',action:'Press Start.',result:'Verify Ready.',narration,callouts:[],observationHoldSeconds:3,prerequisites:[],warnings:[],exactLabels:['Start']}]}};
lesson.directionReview={revision:lessonDirectionRevision(lesson.direction)};
const jobs=createPostgresJobStore(runtime),store=createLessonRenderStore(runtime),service=createLessonRenderService({jobs,store,storage});
let renderCount=0;
const video=Buffer.from('Independent controlled renderer transport fixture; not a playable video.'),captions=Buffer.from('WEBVTT\n\n00:00.000 --> 00:03.000\n'+narration);
const render=async input=>{renderCount++;const outputPath=join(input.outputDirectory,'clip.mp4'),captionsPath=join(input.outputDirectory,'clip.vtt');await writeFile(outputPath,video);await writeFile(captionsPath,captions);return {schemaVersion:'lesson-render.v1',mode:input.mode,artifactId:'sha256:'+sha(video),sha256:sha(video),inputRevision:lessonRenderRevision(input.lesson),durationSeconds:30,placeholders:[],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narrationSeconds:3}],outputPath,captionsPath,captionsSha256:sha(captions)};};
const server=createJobStatusHttpServer({statusService:{async get(){return null;},async retry(){return null;}},lessonRenders:service,authenticator:{async authenticate(req){const role=req.headers.authorization?.slice(7);return ['author','learner','foreign'].includes(role)?{subject:role,roles:[role==='foreign'?'author':role]}:null;}},organizationContextResolver:{async resolveActiveOrganizations(subject){return [subject==='foreign'?org+'_foreign':org];},async resolveOrganizationRoles(subject){return [subject==='foreign'?'author':subject];}}});
const messages=[],signingSecret='independent-signed-transport-secret';
const dispatcher=createAzureServiceBusDispatcher({client:{createSender:()=>({async sendMessages(message){messages.push(message);},async close(){}})},queueName:'lesson',signingSecret});
let listening=false;
try{
 await storage.ensureContainers();
 await owner.query("INSERT INTO courses(course_id,organization_id,name,status,created_by,created_at,updated_at) VALUES($1,$2,'Independent','DRAFT','author',now(),now())",[org+'_course',org]);
 await owner.query("INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$2,$3,1,$4,'DRAFT','author',now(),now())",[version,org+'_course',org,JSON.stringify({schemaVersion:'course-draft.v1',title:'Independent',modules:[],citations:[citation],videoLessons:[lesson]})]);
 for(const [id,type,mime] of [[image,'image','image/png'],[manual,'pdf','application/pdf']]){
  const bytes=Buffer.from('Independent '+type+' source transport bytes'),blobKey=org+'/'+id;await recordingStorage.putObject({blobKey,bytes,contentType:mime});
  await owner.query("INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,'APPROVED','author','author',now(),now())",[id+'_asset',org,type]);
  await owner.query("INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'input',$6,$7,$8,'APPROVED','author',now(),now())",[id,id+'_asset',org,type,blobKey,mime,bytes.length,sha(bytes)]);
  await owner.query("INSERT INTO asset_rights_attestations(attestation_id,organization_id,asset_version_id,owner_name,use_scope,derivative_allowed,status,created_by,created_at,updated_at) VALUES($1,$2,$3,'Engineering author','training',true,'ACTIVE','author',now(),now())",[id+'_rights',org,id]);
 }
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));listening=true;
 const base=`http://127.0.0.1:${server.address().port}/api/v1/lesson-renders`;
 const call=(path='',method='GET',body,role='author')=>fetch(base+path,{method,headers:{authorization:'Bearer '+role,'content-type':'application/json','idempotency-key':'independent-request'},...(body?{body:JSON.stringify(body)}:{})});
 const request={courseVersionId:version,revision:1,lessonId:lesson.lessonId,mode:'rough-cut'};
 assert.equal((await call('','POST',request,'missing')).status,401);
 assert.equal((await call('','POST',request,'learner')).status,403);
 const admitted=await call('','POST',request);assert.equal(admitted.status,202);const {jobId}=await admitted.json();
 const stored=await jobs.get(tenant,jobId);assert.equal(stored.state,'QUEUED');
 assert.equal((await owner.query('SELECT count(*)::int n FROM processing_job_outbox WHERE organization_id=$1 AND job_id=$2',[org,jobId])).rows[0].n,1);
 assert.equal((await (await call('','POST',request)).json()).jobId,jobId);
 await dispatcher.enqueue(stored);
 const settled={complete:0,dead:0},queueInput={message:messages[0],signingSecret,jobStore:jobs,storage:recordingStorage,processor:{async inspect(){throw Error('WRONG_PROCESSOR');}},workerId:'independent-worker',settle:{async complete(){settled.complete++;},async abandon(){throw Error('UNEXPECTED_ABANDON');},async deadLetter(){settled.dead++;}},processLessonRender:input=>processHostedLessonRenderJob({jobStore:jobs,store,storage:recordingStorage,speech:{async synthesize(){throw Error('Controlled renderer does not use speech');}},tenant:input.tenant,jobId:input.jobId,workerId:'independent-worker',render})};
 assert.equal(await handleAzureServiceBusJobMessage(queueInput),'COMPLETED');assert.equal(renderCount,1);
 assert.equal(await handleAzureServiceBusJobMessage(queueInput),'COMPLETED');assert.equal(renderCount,1,'Queue replay rendered twice');
 const path='/'+encodeURIComponent(jobId),status=await call(path);assert.equal(status.status,200);const result=await status.json();assert.equal(result.state,'SUCCEEDED');
 assert.equal((await call(path,'GET',undefined,'foreign')).status,404);
 assert.equal((await call(path+'/content?kind=video','GET',undefined,'learner')).status,403);
 const response=await call(path+'/content?kind=video');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),video);
 assert.deepEqual(Buffer.from(await (await call(path+'/content?kind=captions')).arrayBuffer()),captions);
 const unsigned='http://127.0.0.1:10000/devstoreaccount1/independent-headless-check/'+result.manifest.outputPath.split('/').map(encodeURIComponent).join('/');
 assert.notEqual((await fetch(unsigned)).status,200,'Private Blob unexpectedly anonymous');
 await storage.putObject({blobKey:result.manifest.outputPath,bytes:Buffer.from('tampered'),contentType:'video/mp4'});
 assert.notEqual((await call(path+'/content?kind=video')).status,200,'Tampered media released');
 await storage.putObject({blobKey:result.manifest.outputPath,bytes:video,contentType:'video/mp4'});
 await owner.query("UPDATE asset_rights_attestations SET status='WITHDRAWN' WHERE organization_id=$1 AND asset_version_id=$2",[org,image]);
 assert.notEqual((await call(path+'/content?kind=video')).status,200,'Withdrawn source derivative released');
 assert.equal(settled.complete,2);assert.equal(settled.dead,0);
 console.log('Independent headless pipeline passed: HTTP -> runtime PostgreSQL/outbox -> signed queue -> worker -> private Azurite -> authorized bytes; role/tenant/replay/hash/withdrawal denial. Controlled identity, queue transport and renderer; no cloud or narration-quality acceptance.');
}finally{
 if(listening)await new Promise(resolve=>server.close(resolve));await dispatcher.close();
 for(const key of objects)await storage.deleteObject({blobKey:key});
 for(const table of ['notifications','outbox_events','audit_events','processing_job_outbox','processing_jobs','asset_rights_attestations','asset_versions','assets','course_versions','courses'])await owner.query('DELETE FROM '+table+' WHERE organization_id=$1',[org]);
 await runtime.end();await owner.end();
}
