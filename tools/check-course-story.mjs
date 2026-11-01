import assert from 'node:assert/strict';
import {validateCourseStory,projectStoryNode,advanceCourseStory,storyConditionMatches,validateCourseForPublication} from '../packages/simulation-schema/dist/index.js';
const choice=(choiceId,nextNodeId,conditions=[])=>({choiceId,label:choiceId,consequence:'Your selection continues the mission.',nextNodeId,conditions});
const node=(nodeId,choices,extra={})=>({nodeId,title:nodeId,purpose:'Prepare and inspect the controller.',prerequisites:[],choices,...extra});
const story={schemaVersion:'course-story.v1',mission:'Restore the synthetic controller to service.',startNodeId:'intro',nodes:[
 node('intro',[choice('practice','practice'),choice('direct','assessment')]),
 node('practice',[choice('continue','assessment')],{activityId:'practice'}),
 node('assessment',[choice('passed','success',[{activityId:'assessment',fact:'passed',equals:true}]),choice('retry','retry',[{activityId:'assessment',fact:'passed',equals:false}])],{activityId:'assessment'}),
 node('success',[],{outcome:{kind:'success',message:'Mission complete. Certification requirements are evaluated separately.'}}),
 node('retry',[],{outcome:{kind:'retry',message:'Review the procedure and use the allowed retry flow.'}})
]};
const validate=s=>validateCourseStory(s,['practice','assessment'],['assessment']);
assert.deepEqual(validate(story),{valid:true,findings:[]});
const fail=(code,mutate)=>{const s=structuredClone(story);mutate(s);const before=JSON.stringify(s),r=validate(s);assert.equal(r.valid,false,code);assert(r.findings.some(f=>f.code===code),JSON.stringify(r));assert.equal(JSON.stringify(s),before);};
fail('STORY_REQUIRED_ACTIVITY_BYPASS',s=>s.nodes[0].choices.push(choice('skip','success')));
fail('STORY_CYCLE',s=>s.nodes[1].choices.push(choice('back','intro')));
fail('STORY_UNREACHABLE',s=>s.nodes.push(node('orphan',[],{outcome:{kind:'ended',message:'Stop'}})));
fail('STORY_NODE_DUPLICATE',s=>s.nodes.push(structuredClone(s.nodes[0])));
fail('STORY_CHOICE_DUPLICATE',s=>s.nodes[0].choices.push(structuredClone(s.nodes[0].choices[0])));
fail('STORY_DESTINATION_UNKNOWN',s=>s.nodes[0].choices[0].nextNodeId='missing');
fail('STORY_TERMINAL_INVALID',s=>delete s.nodes[3].outcome);
fail('STORY_SUCCESS_REQUIRED',s=>s.nodes[3].outcome.kind='ended');
fail('STORY_ACTIVITY_UNKNOWN',s=>s.nodes[1].activityId='foreign');
fail('STORY_CONDITION_INVALID',s=>s.nodes[0].choices[0].conditions=[{activityId:'assessment',fact:'score',minimum:NaN}]);
fail('STORY_CONDITION_INVALID',s=>s.nodes[0].choices[0].conditions=[{activityId:'assessment',fact:'passed',equals:true,script:'return true'}]);
fail('STORY_NODE_INVALID',s=>s.nodes[0].query='SELECT secret');
fail('STORY_INVALID',s=>s.nodes=Array.from({length:201},()=>s.nodes[0]));
fail('STORY_NODE_INVALID',s=>s.nodes[0].choices=Array.from({length:21},(_,i)=>choice('c'+i,'practice')));
for(const value of [null,{},[],{...story,nodes:[null]},{...story,nodes:[{...story.nodes[0],choices:[null]}]}])assert.equal(validate(value).valid,false);
const facts=[{activityId:'assessment',completed:true,passed:true,score:0.9,attempts:1}];
assert.equal(projectStoryNode(story,'assessment',[]).choices.some(c=>c.enabled),false);
assert.equal(advanceCourseStory(story,'assessment','passed',[]).accepted,false);
assert.equal(advanceCourseStory(story,'intro','success',facts).accepted,false,'Destination ID cannot replace choice ID');
const success=advanceCourseStory(story,'assessment','passed',facts);assert.equal(success.accepted,true);assert.equal(success.node.outcome.kind,'success');
assert.equal(advanceCourseStory(story,'assessment','retry',facts).accepted,false);
assert.equal(advanceCourseStory(story,'assessment','retry',[{...facts[0],passed:false,score:0.2}]).node.outcome.kind,'retry');
assert.equal(advanceCourseStory(story,'assessment','passed',[...facts,...facts]).accepted,false,'Ambiguous facts fail closed');
for(const condition of [{activityId:'assessment',fact:'passed',equals:false},{activityId:'assessment',fact:'score',minimum:0},{activityId:'assessment',fact:'attempts',minimum:1}])assert.equal(storyConditionMatches(condition,[]),false);
assert.equal(storyConditionMatches({activityId:'assessment',fact:'score',minimum:0.9},facts),true);
assert.equal(storyConditionMatches({activityId:'assessment',fact:'score',minimum:0.95},facts),false);
assert.equal(storyConditionMatches({activityId:'assessment',fact:'score',minimum:0},[{...facts[0],score:null}]),false);
const gated=structuredClone(story);gated.nodes[1].prerequisites=[{activityId:'assessment',fact:'attempts',minimum:2}];
assert.equal(advanceCourseStory(gated,'intro','practice',facts).accepted,false);
assert.equal(advanceCourseStory(gated,'intro','practice',[{...facts[0],attempts:2}]).accepted,true);
assert(validateCourseForPublication({course:{story},approvedSourceArtifactIds:[]}).findings.some(f=>f.code==='STORY_POLICY_REQUIRED'));
// A converging graph must intersect all predecessor paths, not just the first visited path.
const converge=structuredClone(story);converge.nodes[0].choices[1].nextNodeId='success';assert(validate(converge).findings.some(f=>f.code==='STORY_REQUIRED_ACTIVITY_BYPASS'));
console.log('Course story contract passed: bounded DAG, strict facts/fields, mandatory-path dominance, outcomes, prerequisites, choice transitions, missing/ambiguous evidence denial and versioned-policy requirement.');

const publication=validateCourseForPublication({course:{story:converge,modules:[{moduleId:'required',activities:[{activityId:'assessment',type:'text'}]},{moduleId:'optional',activities:[{activityId:'practice',type:'text'}]}],policy:{requiredModuleIds:['required']}},approvedSourceArtifactIds:[]});
assert(publication.findings.some(f=>f.code==='STORY_REQUIRED_ACTIVITY_BYPASS'),'Publication derives mandatory nodes from required modules');
