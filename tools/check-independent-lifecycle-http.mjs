import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {seedActiveOrganizationMembership,withTenantTransaction,createLifecycleGovernanceStore,createDiscoveryInquiryStore,createTechnicalReportingStore,createProtectedExportStore,createCustomerWebhookStore,createLifecycleNotificationStore,createRetentionGovernanceStore} from '../packages/db/dist/index.js';
import {createLifecycleHttp} from '../apps/api/dist/lifecycle-http.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {deriveCustomerWebhookSecret} from '../packages/db/dist/customer-webhooks.js';

const owner=new Pool({connectionString:process.env.DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:process.env.DATABASE_RUNTIME_URL??'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const prefix='independent-life:'+randomUUID(),issuer=prefix+':issuer',employer=prefix+':employer',admin=prefix+':admin',learners=[0,1,2].map(n=>prefix+':learner:'+n),course=prefix+':course',release=prefix+':release',tenant={organizationId:issuer,actorId:admin,correlationId:'independent-life-http'};
const objects=new Map(),storage={async putObject(input){objects.set(input.blobKey,input);},async readObject({blobKey}){const object=objects.get(blobKey);if(!object)throw Error('OBJECT_MISSING');return {...object,sha256:createHash('sha256').update(object.bytes).digest('hex')};}};
const exports=createProtectedExportStore(runtime,storage),master=Buffer.alloc(32,9);
const lifecycleApi=createLifecycleHttp({governance:createLifecycleGovernanceStore(runtime),discovery:createDiscoveryInquiryStore(runtime),reports:createTechnicalReportingStore(runtime),exports,webhooks:createCustomerWebhookStore(runtime),notifications:createLifecycleNotificationStore(runtime),retention:createRetentionGovernanceStore(runtime),webhookKeyIds:new Set(['v1']),webhookSigningSecret:(t,id)=>deriveCustomerWebhookSecret(master,t.organizationId,id)});
const server=createJobStatusHttpServer({statusService:{async get(){return null;},async retry(){return null;}},lifecycleApi,authenticator:{async authenticate(req){const subject=req.headers.authorization?.slice(7);return subject===admin||learners.includes(subject)?{subject,roles:subject===admin?['organization_admin','employer']:['learner']}:null;}},organizationContextResolver:{async resolveActiveOrganizations(subject){return subject===admin?[issuer,employer]:[issuer];},async resolveOrganizationRoles(subject){return subject===admin?['organization_admin','employer']:['learner'];}}});
let listening=false;
try{
 for(const organizationId of [issuer,employer]){await owner.query("INSERT INTO organizations(organization_id,name,status,created_by,request_hash,created_at,updated_at) VALUES($1,'Independent lifecycle','ACTIVE',$2,'test',now(),now())",[organizationId,admin]);await seedActiveOrganizationMembership(owner,{organizationId,subject:admin,roles:['organization_admin','employer']});}
 for(const learner of learners)await owner.query("INSERT INTO personal_accounts(user_id,display_name,status,created_at,updated_at) VALUES($1,'Independent learner','ACTIVE',now(),now())",[learner]);
 await owner.query("INSERT INTO courses(course_id,organization_id,name,status,created_by,created_at,updated_at) VALUES($1,$2,'Independent course','ACTIVE',$3,now(),now())",[course,issuer,admin]);
 await owner.query("INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$1,$2,1,'{}','PUBLISHED',$3,now(),now())",[course,issuer,admin]);
 await withTenantTransaction(owner,tenant,client=>client.query("INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED','{}',$4,$5,$1,$4,now())",[release,issuer,course,'a'.repeat(64),admin]));
 for(const [index,learner]of learners.entries())await owner.query("INSERT INTO credentials(credential_id,organization_id,learner_id,course_version_id,public_id,status,issued_at,created_at,updated_at,release_id,evidence) VALUES($1,$2,$3,$4,$1,'ACTIVE',now(),now(),now(),$5,'{}')",[prefix+':credential:'+index,issuer,learner,course,release]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));listening=true;const base=`http://127.0.0.1:${server.address().port}/api/v1`;
 const call=(path,{method='GET',body,subject=admin,org=issuer,key='independent-default'}={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+subject,'content-type':'application/json','x-organization-id':org,'idempotency-key':key},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const post=(path,body,extra={})=>call(path,{method:'POST',body,...extra});
 assert.equal((await call('/webhooks',{subject:'unknown'})).status,401);
 assert.equal((await call('/webhooks',{subject:learners[0]})).status,403);
 const hook=await post('/webhooks',{endpoint:'https://receiver.example.test/events',keyId:'v1',eventTypes:['credential.issued'],enabled:true,revision:0});assert.equal(hook.status,200);const createdHook=await hook.json();assert.match(createdHook.signingSecret,/^[a-f0-9]{64}$/);
 const listedHooks=await (await call('/webhooks')).json();assert(!JSON.stringify(listedHooks).includes(createdHook.signingSecret));assert(!JSON.stringify(listedHooks).includes('signingSecret'));
 assert(!JSON.stringify(await (await call('/webhooks',{org:employer})).json()).includes(createdHook.subscriptionId));
 const profiles=[];for(const [index,subject]of learners.entries()){
  const response=await post('/discovery/profile',{organizationId:issuer,credentialId:prefix+':credential:'+index,alias:'Independent learner '+index,coarseArea:prefix,enabled:true,revision:0},{subject});assert.equal(response.status,200);profiles.push(await response.json());
 }
 const wrong=await post('/discovery/profile',{organizationId:issuer,credentialId:prefix+':credential:0',alias:'Wrong owner',coarseArea:prefix,enabled:true,revision:1},{subject:learners[1]});assert.equal(wrong.status,403);
 const search=await call('/discovery/search?coarseArea='+encodeURIComponent(prefix),{org:employer});assert.equal(search.status,200);const found=await search.json();assert.equal(found.items.length,3);assert(!JSON.stringify(found).includes(learners[0]));
 const inquiryRequest={profileId:profiles[0].profileId,message:'Engineering inquiry test.'};const inquiryResponse=await post('/discovery/inquiries',inquiryRequest,{org:employer,key:'inquiry'});assert.equal(inquiryResponse.status,200);const inquiry=await inquiryResponse.json();
 assert.equal((await (await post('/discovery/inquiries',inquiryRequest,{org:employer,key:'inquiry'})).json()).inquiryId,inquiry.inquiryId);
 assert.equal((await post('/personal/inquiries/'+encodeURIComponent(inquiry.inquiryId)+'/response',{decision:'ACCEPTED',contact:'test@example.invalid'},{subject:learners[1]})).status,409);
 const accepted=await post('/personal/inquiries/'+encodeURIComponent(inquiry.inquiryId)+'/response',{decision:'ACCEPTED',contact:'test@example.invalid'},{subject:learners[0]});assert.equal(accepted.status,200);
 assert(JSON.stringify(await (await call('/discovery/inquiries',{org:employer})).json()).includes('test@example.invalid'));
 const withdrawn=await post('/discovery/profile',{organizationId:issuer,credentialId:prefix+':credential:0',alias:'Independent learner 0',coarseArea:prefix,enabled:false,revision:1},{subject:learners[0]});assert.equal(withdrawn.status,200);
 assert(!JSON.stringify(await (await call('/discovery/inquiries',{org:employer})).json()).includes('test@example.invalid'));
 const requested=await post('/exports',{}, {key:'export'});assert.equal(requested.status,202);const job=await requested.json();assert.equal((await exports.process({...tenant,actorId:'independent-worker'},job.exportId)).state,'SUCCEEDED');
 const exportPath='/exports/'+encodeURIComponent(job.exportId)+'/content';assert.equal((await call(exportPath)).status,200);assert.equal((await call(exportPath,{subject:learners[0]})).status,403);assert.notEqual((await call(exportPath,{org:employer})).status,200);
 await owner.query("UPDATE protected_exports SET expires_at=now()-interval '1 second' WHERE export_id=$1",[job.exportId]);assert.equal((await call(exportPath)).status,409);
 console.log('Independent lifecycle HTTP + restricted PostgreSQL passed: discovery ownership/cohort/contact consent and replay, private export admin/tenant/expiry denial, webhook creation secret and secret-free list. Identity and export object transport controlled; no cloud acceptance.');
}finally{
 if(listening)await new Promise(resolve=>server.close(resolve));
 for(const table of ['discovery_inquiries','discovery_profiles','customer_webhook_deliveries','customer_webhook_subscriptions','protected_exports','notifications','outbox_events','audit_events','credentials','release_model_bindings','release_manifests','course_versions','courses','role_assignments','organization_memberships','organizations'])await owner.query('DELETE FROM '+table+' WHERE organization_id=ANY($1::text[])',[[issuer,employer]]);
 await owner.query('DELETE FROM personal_account_events WHERE user_id=ANY($1::text[])',[learners]);await owner.query('DELETE FROM personal_accounts WHERE user_id=ANY($1::text[])',[learners]);await owner.query('DELETE FROM discovery_limits WHERE bucket LIKE $1',['%'+prefix+'%']);await runtime.end();await owner.end();
}
