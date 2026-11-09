import assert from 'node:assert/strict';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';
import { createTrainingClient, TrainingApiError } from '../packages/api-client/dist/index.js';
import { learnerOpenApi } from '../packages/contracts/dist/learner-openapi.js';
import { readFile } from 'node:fs/promises';

assert.deepEqual(JSON.parse(await readFile(new URL('../packages/api-client/openapi.json',import.meta.url),'utf8')),learnerOpenApi,'Generated OpenAPI drift: rebuild contracts then api-client');
const calls=[];
const session={sessionId:'assessment:1',enrollmentId:'enrollment:1',releaseId:'release:1',activityId:'activity:1',attemptNumber:1,status:'IN_PROGRESS',expiresAt:'2030-01-01T00:00:00.000Z',assessment:{assessmentId:'assessment:def',version:1,questions:[{questionId:'q',type:'multiple_choice',prompt:'Choose',options:[{optionId:'a',text:'A'},{optionId:'b',text:'B'}]}]}};
const credential={credentialId:'credential:1',publicId:'public-test',issuerId:'org',courseVersionId:'course:1',releaseId:'release:1',policyVersion:1,title:'Training',status:'ACTIVE',supersededBy:null,verificationAllowed:true,verificationEnabled:true,sharingRevision:0,issuedAt:'2026-11-01T00:00:00.000Z',expiresAt:null,intendedUse:'Training only'};
const record=(name,result)=>(...args)=>{calls.push({name,args});return Promise.resolve(result);};
const server=createJobStatusHttpServer({
 statusService:{get:async()=>null,retry:async()=>null},
 authenticator:{authenticate:async req=>req.headers.authorization==='Bearer test'?{subject:'tester',issuer:'https://identity.test',identityTenant:'tenant',authenticationExpiresAt:'2030-01-01T00:00:00Z',roles:['author','reviewer','publisher','organization_admin','learner']}:null},
 emailVerificationService:{start:record('verificationStart',{challengeId:'c17df84f-5140-4864-82c0-69508ce508da',expiresInSeconds:600}),complete:record('verificationComplete',{}),revoke:record('verificationRevoke',{}),enrich:async principal=>({...principal,verifiedEmail:'tester@example.test',verificationExpiresAt:'2030-01-01T00:00:00Z'})},
 organizationContextResolver:{resolveActiveOrganizations:async()=>['org']},
 assessmentSessionService:{start:record('start',session),get:record('get',session),submit:record('submit',{...session,status:'PASSED',result:{score:1,maxScore:1,passed:true,demonstratedCompetencyIds:['safe'],missedCompetencyIds:[]}})},
 enrollmentService:{assign:record('assign',{enrollmentId:'enrollment:1',releaseId:'release:1',courseVersionId:'course:1',title:'Training',status:'ACTIVE'}),acknowledge:record('acknowledge',{activityId:'reading',status:'ACKNOWLEDGED'})},
 credentialService:{changeStatus:record('lifecycle',{...credential,status:'REVOKED'}),list:record('list',{items:[credential],nextCursor:null}),issue:record('issue',credential),setSharing:record('sharing',{...credential,sharingRevision:1,verificationEnabled:false})},
 publicVerificationService:{verify:async()=>({courseTitle:'Training',issuerName:'Issuer',status:'ACTIVE',issuedAt:credential.issuedAt,expiresAt:null,intendedUse:'Training only',verifiedAt:credential.issuedAt})},
 courseReviewStore:{get:record('draft',{courseVersion:{courseVersionId:'course:1',revision:1,status:'DRAFT',content:{}},decisions:[]}),saveDraft:async input=>{if(input.revision!==1)throw Error('COURSE_VERSION_STALE');return {revision:2};},recordDecision:record('review',{decisionId:'review:1',targetType:'COURSE',targetId:'course:1',decision:'APPROVE',rationale:'Reviewed'}),publish:record('publish',{releaseId:'release:1',organizationId:'org',courseVersionId:'course:1',status:'PUBLISHED',releaseHash:'a'.repeat(64),manifest:{},publishedBy:'tester',createdAt:credential.issuedAt})}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let tokenCalls=0;
const client=createTrainingClient({baseUrl:`http://127.0.0.1:${server.address().port}`,getContext:()=>({identity:'tester',organizationId:'org'}),getAccessToken:()=>{tokenCalls++;return 'test';}});
try{
 assert.equal((await client.startEmailVerification('tester@example.test')).expiresInSeconds,600);
 assert.equal((await client.completeEmailVerification('c17df84f-5140-4864-82c0-69508ce508da','123456')).verified,true);
 assert.equal((await client.revokeEmailVerification()).verified,false);
 assert.equal((await client.getCourseVersion('course:1')).courseVersion.revision,1);
 assert.equal((await client.request(api=>api.GET('/api/v1/course-versions/{courseVersionId}',{params:{path:{courseVersionId:'course:1'},header:{'X-Organization-Id':'org'}}}))).courseVersion.revision,1);
 await assert.rejects(client.request(api=>api.PUT('/api/v1/course-versions/{courseVersionId}',{params:{path:{courseVersionId:'course:1'},header:{'X-Organization-Id':'org'}},body:{revision:99,content:{}}})),error=>error instanceof TrainingApiError&&error.code==='COURSE_VERSION_STALE');
 assert.equal((await client.saveCourseVersion('course:1',1,{})).revision,2);
 await assert.rejects(client.saveCourseVersion('course:1',2,{}),error=>error instanceof TrainingApiError&&error.status===409&&error.code==='COURSE_VERSION_STALE');
 await client.reviewCourseVersion('course:1',{revision:1,targetType:'COURSE',targetId:'course:1',decision:'APPROVE',rationale:'Reviewed'},'review-key');
 assert.equal(calls.at(-1).args[0].idempotencyKey,'review-key');
 assert.equal((await client.publishCourseVersion('course:1','publish-key')).releaseId,'release:1');
 await client.assignEnrollment('learner','release:1');
 await client.acknowledgeActivity('enrollment:1','reading');
 assert.equal((await client.startAssessment('enrollment:1','release:1','activity:1','assessment-key')).status,'IN_PROGRESS');
 assert.equal(calls.at(-1).args[1].idempotencyKey,'assessment-key');
 assert.equal((await client.getAssessment('assessment:1')).assessment.questions[0].questionId,'q');
 assert.equal((await client.submitAssessment('assessment:1',[{questionId:'q',selectedOptionIds:['b']}])).result.passed,true);
 assert.deepEqual(calls.at(-1).args[2],[{questionId:'q',selectedOptionIds:['b']}]);
 assert.equal((await client.listCredentials(undefined,'learner')).items[0].credentialId,'credential:1');
 assert.equal((await client.issueCredential('enrollment:1')).credentialId,'credential:1');
 assert.equal((await client.setCredentialSharing('credential:1',false,0,'sharing-key')).verificationEnabled,false);
 assert.equal((await client.revokeCredential('credential:1','Invalid evidence','revoke-key')).status,'REVOKED');
 assert.equal(calls.at(-1).args[2].action,'revoke');
 await client.supersedeCredential('credential:1','credential:2','Requalified','supersede-key');
 assert.equal(calls.at(-1).args[2].replacementId,'credential:2');
 const before=tokenCalls;
 assert.equal((await client.verifyCredential('public-test')).courseTitle,'Training');
 assert.equal(tokenCalls,before,'Public verification must not acquire or send identity credentials');
 assert(!JSON.stringify(learnerOpenApi.components.schemas.AssessmentSession).includes('correctOptionIds'));
 assert(!JSON.stringify(learnerOpenApi.components.schemas.AssessmentSession).includes('rationale'));
 console.log('Certification client HTTP compatibility passed: generated drift, real route/status/idempotency/revision errors, assessment, issuance, sharing and anonymous verification. Service dependencies are controlled doubles; this is not hosted acceptance.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
