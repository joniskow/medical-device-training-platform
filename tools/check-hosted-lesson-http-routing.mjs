import assert from 'node:assert/strict';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {createAzureServiceBusDispatcher} from '../apps/worker/dist/messaging/azure-service-bus-dispatcher.js';
import {handleAzureServiceBusJobMessage} from '../apps/worker/dist/messaging/azure-service-bus-consumer.js';
import {createInMemoryJobStore} from '../tests/doubles/deterministic-adapters.mjs';
const tenant={organizationId:'lesson_http_org',actorId:'author',correlationId:'lesson-http'},calls=[];
const lessonRenders={
 async promoteCorrectedTake(t,request){if(request.assetVersionId==='clip:withdrawn')throw Error('LESSON_TAKE_ASSET_NOT_APPROVED');calls.push({method:'promote',tenant:t,request});return {revision:request.revision+1,assetVersionId:request.assetVersionId};},
 async create(t,request){calls.push({method:'create',tenant:t,request});return {jobId:'render:1',state:'QUEUED'};},
 async get(t,id){return id==='render:1'?{jobId:id,state:'SUCCEEDED'}:null;},
 async content(t,id,kind){return id==='render:1'?{bytes:Buffer.from(kind),contentType:kind==='video'?'video/mp4':'text/vtt'}:null;},
 async cancel(t,id,reason){calls.push({method:'cancel',tenant:t,id,reason});return id==='render:1';},
 async retry(t,id,reason){calls.push({method:'retry',tenant:t,id,reason});return id==='render:1'?{jobId:id,state:'QUEUED'}:null;}
};
const server=createJobStatusHttpServer({statusService:{async get(){return null;},async retry(){return null;}},lessonRenders,
 authenticator:{async authenticate(req){const role=req.headers.authorization?.slice(7);return ['author','learner'].includes(role)?{subject:role,roles:[role]}:null;}},
 organizationContextResolver:{async resolveActiveOrganizations(){return [tenant.organizationId];},async resolveOrganizationRoles(subject){return [subject];}}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/api/v1/lesson-renders`;
const call=(path='',method='GET',body,role='author',headers={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+role,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
try{
 assert.equal((await call('','POST',{},'missing')).status,401);
 assert.equal((await call('','POST',{},'learner')).status,403);
 const request={courseVersionId:'course:1',revision:1,lessonId:'lesson:1',mode:'rough-cut'};
 assert.equal((await call('','POST',request)).status,422);
 assert.equal((await call('','POST',{...request,assets:{}},'author',{'idempotency-key':'render:1'})).status,422);
 const response=await call('','POST',request,'author',{'idempotency-key':'render:1'});assert.equal(response.status,202);assert.equal((await response.json()).jobId,'render:1');
 assert.equal(calls[0].request.idempotencyKey,'render:1');assert.equal(calls[0].tenant.organizationId,tenant.organizationId);
 assert.equal((await call('/render%3A1')).status,200);assert.equal((await call('/missing')).status,404);
 const video=await call('/render%3A1/content?kind=video');assert.equal(video.status,200);assert.match(video.headers.get('content-type'),/video\/mp4/);assert.equal(await video.text(),'video');
 assert.equal((await call('/render%3A1/content?kind=video&kind=captions')).status,422);
 assert.equal((await call('/render%3A1/content?kind=invalid')).status,422);
 assert.equal((await call('/render%3A1/cancel','POST',{reason:'Author requested cancellation'})).status,200);
 assert.equal((await call('/render%3A1/retry','POST',{reason:'Provider restored'})).status,200);
 assert.equal(calls.find(c=>c.method==='retry').reason,'Provider restored');
 assert.equal((await call('/render%3A1/cancel','POST',{})).status,422);
 const take={courseVersionId:'course:1',revision:1,lessonId:'lesson:1',sceneId:'scene:1',assetVersionId:'clip:1',sourceHash:'a'.repeat(64),reason:'Use the independently reviewed correction'};
 const corrected=(body=take,role='author',key='take:1',method='POST')=>fetch(base.replace('/lesson-renders','/lesson-corrected-takes'),{method,headers:{authorization:'Bearer '+role,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 assert.equal((await corrected(take,'learner')).status,403);assert.equal((await corrected(take,'author','')).status,422);
 assert.equal((await corrected({...take,path:'C:/private.mp4'})).status,422);assert.equal((await corrected(take,'author','take:1','GET')).status,405);
 const promoted=await corrected();assert.equal(promoted.status,200);assert.deepEqual(await promoted.json(),{revision:2,assetVersionId:'clip:1'});
 assert.equal(calls.find(c=>c.method==='promote').request.idempotencyKey,'take:1');assert.equal(calls.find(c=>c.method==='promote').tenant.organizationId,tenant.organizationId);
 assert.equal((await corrected({...take,assetVersionId:'clip:withdrawn'})).status,409);
}finally{await new Promise(r=>server.close(r));}
const messages=[],store=createInMemoryJobStore(),signingSecret='lesson-render-routing-signature-secret';
const job={jobId:'render:routing',jobType:'lesson.render',tenant,payload:{},attempt:1,maxAttempts:3,idempotency:{key:'routing:1',requestHash:'1'}};
await store.enqueue(job);
const dispatcher=createAzureServiceBusDispatcher({client:{createSender:()=>({async sendMessages(m){messages.push(m);},async close(){}})},queueName:'lesson',signingSecret});
await dispatcher.enqueue(job);let completed=0,denied=0,handled=0;
const input={message:messages[0],signingSecret,jobStore:store,storage:{},processor:{async inspect(){throw Error('Lesson must never enter upload processing');}},workerId:'worker',settle:{async complete(){completed++;},async abandon(){throw Error('Unexpected abandon');},async deadLetter(){denied++;}}};
assert.equal(await handleAzureServiceBusJobMessage({...input,processLessonRender:async req=>{handled++;assert.equal(req.jobId,job.jobId);return {state:'SUCCEEDED'};}}),'COMPLETED');
assert.equal(handled,1);assert.equal(completed,1);
assert.equal(await handleAzureServiceBusJobMessage(input),'DEAD_LETTERED');assert.equal(denied,1);
await dispatcher.close();
console.log('Hosted lesson HTTP and signed queue routing passed: tenant author roles, idempotency header, private bytes, bounded queries, cancellation/retry and missing-handler denial.');
