import assert from 'node:assert/strict';
import { validateAssessmentDefinition, scoreAssessment, learnerAssessment, validateCourseForPublication } from '../packages/simulation-schema/dist/index.js';

const question = (questionId,type,correctOptionIds) => ({questionId,type,prompt:'Choose the supported action.',options:[{optionId:'c',text:'Third'},{optionId:'a',text:'First'},{optionId:'b',text:'Second'}],correctOptionIds,points:2,competencyIds:['safe-use'],rationale:'See the approved manual.',citations:[{assetVersionId:'source:manual',page:1}]});
const assessment={schemaVersion:'assessment-definition.v1',assessmentId:'assessment:test',version:1,passScore:0.8,questions:[question('q1','multiple_choice',['a']),question('q2','multi_select',['a','c']),question('q3','ordered_step',['c','b','a'])]};
assert.equal(validateAssessmentDefinition(assessment).valid,true);
const answers=[{questionId:'q1',selectedOptionIds:['a']},{questionId:'q2',selectedOptionIds:['c','a']},{questionId:'q3',selectedOptionIds:['c','b','a']}];
assert.deepEqual(scoreAssessment(assessment,answers),{score:6,maxScore:6,passed:true,demonstratedCompetencyIds:['safe-use'],missedCompetencyIds:[]});
const wrong=structuredClone(answers);wrong[2].selectedOptionIds=['a','b','c'];
assert.deepEqual(scoreAssessment(assessment,wrong),{score:4,maxScore:6,passed:false,demonstratedCompetencyIds:[],missedCompetencyIds:['safe-use']});
for(const bad of [[],[...answers,answers[0]],answers.map(a=>({...a,score:100})),[answers[0],answers[0],answers[2]],[{questionId:'q1',selectedOptionIds:['foreign']},...answers.slice(1)],[answers[0],{questionId:'q2',selectedOptionIds:['a','a']},answers[2]]]) assert.throws(()=>scoreAssessment(assessment,bad),/ANSWERS_INVALID/);
for(const mutate of [a=>a.passScore=0,a=>a.passScore=NaN,a=>a.questions[0].points=-1,a=>a.questions[0].correctOptionIds=['unknown'],a=>a.questions[0].correctOptionIds=['a','b'],a=>a.questions[0].citations=[],a=>a.questions[1].questionId='q1',a=>a.questions[2].correctOptionIds=['a']]) {
 const invalid=structuredClone(assessment);mutate(invalid);assert.equal(validateAssessmentDefinition(invalid).valid,false);assert.throws(()=>scoreAssessment(invalid,answers),/ASSESSMENT_INVALID/);
}
const learner=learnerAssessment(assessment);
assert.ok(!JSON.stringify(learner).includes('correctOptionIds'));
assert.ok(!JSON.stringify(learner).includes('rationale'));
assert.deepEqual(learner.questions[2].options.map(x=>x.optionId),['a','b','c']);
const course={schemaVersion:'course-draft.v1',title:'Assessment course',citations:[{assetVersionId:'source:manual'}],modules:[{title:'Knowledge',activities:[{type:'multiple_choice',assessment}]}],policy:{policyId:'policy:test',version:1,requiredEvidence:['assessment.passed']}};
const valid={course,approvedSourceArtifactIds:['source:manual'],approvedReviewTargets:['ASSESSMENT:assessment:test','POLICY:policy:test']};
Object.assign(course.policy,{maxAttempts:3,cooldownSeconds:60,attemptTtlSeconds:1800});
assert.equal(validateCourseForPublication(valid).valid,true);
assert.equal(validateCourseForPublication({...valid,approvedReviewTargets:[]}).valid,false);
const malformed=structuredClone(course);delete malformed.modules[0].activities[0].assessment;
assert.equal(validateCourseForPublication({...valid,course:malformed}).valid,false);
const foreign=structuredClone(course);foreign.modules[0].activities[0].assessment.questions[0].citations=[{assetVersionId:'foreign'}];
assert.equal(validateCourseForPublication({...valid,course:foreign}).valid,false);
console.log('Assessments passed: three question types, deterministic bounded scoring, forged/duplicate/unknown answer denial, answer-key redaction, and publication/review/source gates.');
