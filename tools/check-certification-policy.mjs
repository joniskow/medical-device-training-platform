import assert from 'node:assert/strict';
import { evaluateCertification,validCertificationPolicy,projectCourseStoryFacts,storyConditionMatches } from '../packages/simulation-schema/dist/index.js';
const policy={schemaVersion:'certification-policy.v1',policyId:'policy',version:1,requiredActivityIds:['quiz','sim'],requiredModuleIds:[],resultSelection:'latest',passScore:.8,maxAttempts:3,cooldownSeconds:60,attemptTtlSeconds:1800,repeatedFailureReviewAfter:null,expirationDays:365};
const activities=[{activityId:'quiz',moduleId:'module',kind:'assessment',passScore:.8},{activityId:'sim',moduleId:'module',kind:'simulation',passScore:1},{activityId:'read',moduleId:'reading',kind:'content',passScore:0}];
policy.requiredEvidence=['assessment.passed','simulation.completed','simulation.equivalent-path'];
const base={releaseId:'release',releaseHash:'a'.repeat(64),policyId:'policy',policyVersion:1,attemptNumber:1,status:'PASSED',score:10,maxScore:10,endedAt:1000};
const evidence=[{...base,evidenceId:'quiz-session',activityId:'quiz'},{...base,evidenceId:'sim-attempt',activityId:'sim'}];
const run=(changes={})=>evaluateCertification({policy,activities,evidence,releaseId:'release',releaseHash:'a'.repeat(64),now:62000,...changes});
assert.equal(run().eligible,true);assert.deepEqual(run(),run());
const familiarization=run({policy:{...policy,credentialIssuance:'DISABLED'}});
assert.equal(familiarization.eligible,false);assert(familiarization.missing.includes('CREDENTIAL_ISSUANCE_DISABLED'));assert(familiarization.activities.every(activity=>activity.passed));
assert.equal(validCertificationPolicy({...policy,credentialIssuance:'sometimes'},activities),false);
assert.equal(validCertificationPolicy({...policy,publicVerification:{enabled:true,issuerName:'',courseTitle:'Title'}},activities),false);
assert.equal(validCertificationPolicy({...policy,publicVerification:{enabled:true,issuerName:'Issuer',courseTitle:'Title',learnerEmail:'private'}},activities),false);
assert.equal(validCertificationPolicy({...policy,publicVerification:{enabled:false}},activities),true);
assert.equal(run({evidence:[evidence[0]]}).eligible,false);
assert.equal(validCertificationPolicy({...policy,requiredActivityIds:['read']},activities),false);
assert.equal(validCertificationPolicy({...policy,requiredActivityIds:[],requiredModuleIds:['module']},activities),true);
assert.equal(validCertificationPolicy({...policy,requiredActivityIds:['unknown']},activities),false);
assert.equal(validCertificationPolicy({...policy,expirationDays:-1},activities),false);
assert.equal(validCertificationPolicy({...policy,maxAttempts:Infinity},activities),false);
for(const field of ['releaseId','releaseHash','policyId','policyVersion'])assert.equal(run({evidence:evidence.map(e=>({...e,[field]:field==='policyVersion'?2:'foreign'}))}).eligible,false);
const fail={...evidence[0],evidenceId:'quiz-failed',attemptNumber:2,status:'FAILED',score:0};
assert.equal(run({evidence:[...evidence,fail]}).eligible,false);
assert.equal(run({policy:{...policy,resultSelection:'best'},evidence:[...evidence,fail]}).eligible,true);
assert.equal(run({evidence:[{...evidence[0],status:'INVALIDATED'},evidence[1]]}).eligible,false);
assert.equal(run({evidence:[{...evidence[0],score:999},evidence[1]]}).eligible,false);
assert.equal(run({evidence:[...evidence,{...evidence[0],evidenceId:'duplicate'}]}).eligible,false);
assert.equal(run({policy:{...policy,repeatedFailureReviewAfter:1,resultSelection:'best'},evidence:[...evidence,fail]}).eligible,false);
assert.equal(run({evidence:[fail,evidence[1]],now:1001}).activities[0].retryEligible,false);
assert.equal(run({evidence:[fail,evidence[1]]}).activities[0].retryEligible,true);
assert.equal(run({policy:{...policy,maxAttempts:1},evidence:[fail,evidence[1]]}).activities[0].retryEligible,false);
assert.equal(run({evidence:[{...fail,status:'IN_PROGRESS'},evidence[1]]}).activities[0].retryEligible,false);
assert.equal(run({policy:{...policy,requiredModuleIds:['reading']}}).eligible,false);
assert.deepEqual(run({evidence:[fail,evidence[1]],now:1001}).activities[0].retryBlockedReasons,['COOLDOWN']);
assert.equal(run({evidence:[fail,evidence[1]],now:1001}).activities[0].retryAt,61000);
assert.ok(run({policy:{...policy,maxAttempts:1},evidence:[fail,evidence[1]]}).activities[0].retryBlockedReasons.includes('ATTEMPT_LIMIT'));
assert.ok(run({evidence:[{...fail,status:'IN_PROGRESS'},evidence[1]]}).activities[0].retryBlockedReasons.includes('ATTEMPT_IN_PROGRESS'));
assert.ok(run({policy:{...policy,repeatedFailureReviewAfter:1},evidence:[fail,evidence[1]]}).activities[0].retryBlockedReasons.includes('REVIEW_REQUIRED'));
assert.deepEqual(run({evidence:[fail,evidence[1]]}).activities[0].retryBlockedReasons,[]);
assert.equal(run({evidence:[fail,evidence[1]]}).activities[0].maxAttempts,3);
const reset=run({policy:{...policy,maxAttempts:2,repeatedFailureReviewAfter:1},evidence:[fail,evidence[1]],resetThrough:{quiz:2}});
assert.equal(reset.eligible,false);assert.equal(reset.activities[0].attemptsUsed,0);assert.equal(reset.activities[0].latestAttemptNumber,2);assert.equal(reset.activities[0].retryEligible,true);assert.equal(reset.activities[0].canReset,false);
assert.equal(run({evidence:[{...fail,status:'IN_PROGRESS'},evidence[1]]}).activities[0].canReset,false);
assert.equal(run().activities[0].canReset,false);
assert.ok(run({evidence:[fail,evidence[1]],resetThrough:{quiz:2},now:1001}).activities[0].retryBlockedReasons.includes('COOLDOWN'));
assert.equal(run({evidence:[{...fail,attemptNumber:101},evidence[1]],resetThrough:{quiz:100}}).activities[0].attemptsUsed,1);
assert.equal(run({evidence:[{...fail,attemptNumber:101},evidence[1]],resetThrough:{quiz:100}}).activities[0].canReset,true);
console.log('Certification policy passed: deterministic evaluation, required activities/modules, passive-only denial, exact bindings, best/latest, invalidation, malformed evidence, review threshold and retry limits.');

const storyFacts=(changes={})=>projectCourseStoryFacts({policy,activities,evidence,releaseId:'release',releaseHash:'a'.repeat(64),now:62000,...changes});
assert.deepEqual(storyFacts().find(f=>f.activityId==='quiz'),{activityId:'quiz',completed:true,passed:true,score:1,attempts:1});
assert.deepEqual(storyFacts().find(f=>f.activityId==='read'),{activityId:'read',completed:false,passed:false,score:null,attempts:0});
for(const selection of ['latest','best']) {
 const changes={policy:{...policy,resultSelection:selection},evidence:[...evidence,fail]};
 assert.equal(storyFacts(changes).find(f=>f.activityId==='quiz').passed,run(changes).activities[0].passed);
 assert.equal(storyFacts(changes).find(f=>f.activityId==='quiz').attempts,2);
}
for(const field of ['releaseId','releaseHash','policyId','policyVersion']) {
 const facts=storyFacts({evidence:evidence.map(e=>({...e,[field]:field==='policyVersion'?2:'foreign'}))});
 assert(facts.every(f=>!f.completed&&!f.passed&&f.score===null&&f.attempts===0));
}
for(const bad of [{...evidence[0],score:999},{...evidence[0],endedAt:999999},{...evidence[0],attemptNumber:0}]) {
 const facts=storyFacts({evidence:[bad,evidence[1]]});assert(!facts.some(f=>f.activityId==='quiz'));
 assert.equal(storyConditionMatches({activityId:'quiz',fact:'passed',equals:false},facts),false);
}
assert(!storyFacts({evidence:[...evidence,{...evidence[0],evidenceId:'duplicate'}]}).some(f=>f.activityId==='quiz'));
for(const status of ['IN_PROGRESS','EXPIRED','INVALIDATED']) {
 const result=storyFacts({evidence:[{...evidence[0],status},evidence[1]]}).find(f=>f.activityId==='quiz');
 assert.equal(result.completed,false);assert.equal(result.score,null);assert.equal(result.passed,false);
}
const reading={...base,evidenceId:'read-ack',activityId:'read',score:1,maxScore:1};
assert.equal(storyFacts({evidence:[...evidence,reading]}).find(f=>f.activityId==='read').completed,true);
assert.deepEqual(storyFacts({policy:{...policy,resultSelection:'unknown'}}),[]);
console.log('Story facts passed: shared best/latest selection, optional reading, release/policy boundaries, active/invalidated attempts and malformed evidence fail-closed.');
