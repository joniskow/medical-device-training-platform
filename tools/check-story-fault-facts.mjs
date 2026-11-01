import assert from 'node:assert/strict';
import {projectCourseStoryFacts,validateCourseStory,storyConditionMatches,courseStoryFaultContext} from '../packages/simulation-schema/dist/index.js';
const policy={schemaVersion:'certification-policy.v1',policyId:'policy',version:1,requiredActivityIds:['sim'],requiredModuleIds:[],requiredEvidence:['simulation.completed','simulation.equivalent-path'],resultSelection:'latest',passScore:1,maxAttempts:3,cooldownSeconds:0,attemptTtlSeconds:60,repeatedFailureReviewAfter:null,expirationDays:null};
const context={policy,activities:[{activityId:'sim',moduleId:'module',kind:'simulation',passScore:1,faultIds:['fault','optional']}],releaseId:'release',releaseHash:'a'.repeat(64),now:100};
const evidence={evidenceId:'attempt',activityId:'sim',releaseId:context.releaseId,releaseHash:context.releaseHash,policyId:'policy',policyVersion:1,attemptNumber:1,status:'PASSED',score:1,maxScore:1,endedAt:1,faultOutcomes:{diagnosedFaultIds:['fault'],resolvedFaultIds:['fault']}};
const project=(items=[evidence],extra={})=>projectCourseStoryFacts({...context,evidence:items,...extra})[0];
assert.deepEqual(project().faults,[{faultId:'fault',diagnosed:true,resolved:true},{faultId:'optional',diagnosed:false,resolved:false}]);
const later={...evidence,evidenceId:'later',attemptNumber:2,endedAt:2,status:'FAILED',score:0,faultOutcomes:{diagnosedFaultIds:['fault'],resolvedFaultIds:[]}};
assert.deepEqual(project([evidence,later]).faults[0],{faultId:'fault',diagnosed:true,resolved:false});
assert.equal(project([evidence,later],{policy:{...policy,resultSelection:'best'}}).faults[0].resolved,true);
for(const status of ['IN_PROGRESS','EXPIRED','INVALIDATED'])assert.equal(project([{...later,status}]).faults,undefined);
for(const faultOutcomes of [undefined,{diagnosedFaultIds:undefined,resolvedFaultIds:['fault']},{diagnosedFaultIds:['fault','fault'],resolvedFaultIds:[]},{diagnosedFaultIds:['foreign'],resolvedFaultIds:[]},{diagnosedFaultIds:[],resolvedFaultIds:['fault']},{diagnosedFaultIds:['fault'],resolvedFaultIds:'fault'}])assert.equal(project([{...evidence,faultOutcomes}]).faults,undefined);
for(const changed of [{releaseId:'other'},{releaseHash:'b'.repeat(64)},{policyId:'other'},{policyVersion:2}])assert.equal(project([{...evidence,...changed}]).faults,undefined);
assert.equal(project([evidence,{...evidence,evidenceId:'duplicate'}]),undefined);
assert.equal(project([evidence],{activities:[{...context.activities[0],kind:'assessment'}]}),undefined);
const saved=structuredClone(evidence);project();assert.deepEqual(evidence,saved);
console.log('Story fault facts passed: selected-attempt parity, separate diagnosis/resolution, optional-fault negatives, invalid/missing/foreign evidence exclusion and nonmutation.');

const condition={activityId:'sim',fact:'diagnosed',faultId:'fault',equals:true};
const story={schemaVersion:'course-story.v1',mission:'Diagnose',startNodeId:'start',nodes:[{nodeId:'start',title:'Start',purpose:'Perform',activityId:'sim',prerequisites:[],choices:[{choiceId:'finish',label:'Finish',consequence:'Review',nextNodeId:'end',conditions:[condition]}]},{nodeId:'end',title:'Done',purpose:'Review',prerequisites:[],choices:[],outcome:{kind:'success',message:'Done'}}]};
const faultContext=[{activityId:'sim',faultIds:['fault']}];
assert.equal(validateCourseStory(story,['sim'],['sim'],faultContext).valid,true);
for(const badContext of [[],[{activityId:'other',faultIds:['fault']}],[{activityId:'sim',faultIds:['unknown']}],[...faultContext,...faultContext]])assert.equal(validateCourseStory(story,['sim'],[],badContext).valid,false);
for(const fact of ['diagnosed','resolved']){
 const c={...condition,fact};assert.equal(storyConditionMatches(c,[project()]),true);
 assert.equal(storyConditionMatches({...c,equals:false},[{...project(),faults:undefined}]),false);
 assert.equal(storyConditionMatches(c,[{...project(),faults:[...project().faults,...project().faults]}]),false);
 assert.equal(storyConditionMatches(c,[{...project(),completed:false}]),false);
}
assert.equal(storyConditionMatches({...condition,fact:'resolved',equals:false},[project([later])]),true);
assert.equal(storyConditionMatches({...condition,fact:'resolved',equals:false},[project([{...later,faultOutcomes:undefined}])]),false);
const course={simulation:{simulationDefinitionId:'definition',definition:{faults:[{faultId:'fault'}]}},modules:[{activities:[{activityId:'sim',type:'simulation',simulationDefinitionId:'definition'},{activityId:'text',type:'text',simulationDefinitionId:'definition'},{activityId:'foreign',type:'simulation',simulationDefinitionId:'other'}]}]};
assert.deepEqual(courseStoryFaultContext(course),faultContext);
console.log('Story fault conditions passed: exact simulation binding, known fault references, strict booleans, completed-only matching and missing/ambiguous negative denial.');
