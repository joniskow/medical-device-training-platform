import assert from 'node:assert/strict';
import {previewCourseStory} from '../packages/simulation-schema/dist/index.js';
const choice=(choiceId,nextNodeId,conditions=[])=>({choiceId,label:choiceId,consequence:'Continue',nextNodeId,conditions});
const node=(nodeId,choices,extra={})=>({nodeId,title:nodeId,purpose:'Test path',prerequisites:[],choices,...extra});
const activity={activityId:'quiz',moduleId:'m',kind:'assessment',passScore:0.8};
const story={schemaVersion:'course-story.v1',mission:'Test mission',startNodeId:'quiz',nodes:[
 node('quiz',[choice('pass','success',[{activityId:'quiz',fact:'passed',equals:true}]),choice('fail','retry',[{activityId:'quiz',fact:'passed',equals:false}])],{activityId:'quiz'}),
 node('success',[],{outcome:{kind:'success',message:'Done'}}),node('retry',[],{outcome:{kind:'retry',message:'Review'}})
]};
const before=JSON.stringify(story),report=previewCourseStory(story,[activity],['quiz']);
assert.equal(report.valid,true);assert.equal(report.complete,true);assert(report.cases.some(c=>c.status==='success'));assert(report.cases.some(c=>c.status==='retry'));assert.deepEqual(report.unreachedChoices,[]);assert.deepEqual(report.unreachedNodes,[]);assert.equal(JSON.stringify(story),before);
assert.deepEqual(report,previewCourseStory(story,[activity],['quiz']),'Analysis must be deterministic');
const gap=structuredClone(story);gap.nodes[0].choices[1].conditions=[{activityId:'quiz',fact:'score',minimum:0.9}];
assert(previewCourseStory(gap,[activity],['quiz']).cases.some(c=>c.status==='blocked'),'Low score with no enabled branch must be reported');
const impossible=structuredClone(story);impossible.nodes[0].prerequisites=[{activityId:'quiz',fact:'completed',equals:true}];
const blocked=previewCourseStory(impossible,[activity],['quiz']);assert(blocked.cases.every(c=>c.status==='blocked'));assert(blocked.cases.every(c=>c.facts.every(f=>!f.completed)),'Cannot assume a result before an activity is available');assert(blocked.unreachedNodes.includes('success'));
const attempts=structuredClone(story);attempts.nodes[0].choices[1].conditions=[{activityId:'quiz',fact:'attempts',minimum:3}];
assert(previewCourseStory(attempts,[activity],['quiz'],2).unreachedChoices.some(c=>c.choiceId==='fail'));assert(!previewCourseStory(attempts,[activity],['quiz'],3).unreachedChoices.some(c=>c.choiceId==='fail'));
const optional=structuredClone(story);optional.nodes.unshift(node('intro',[choice('go','quiz')],{prerequisites:[{activityId:'future',fact:'completed',equals:true}]}));optional.startNodeId='intro';
assert(previewCourseStory(optional,[activity,{...activity,activityId:'future'}],['quiz']).cases.every(c=>c.status==='blocked'));
const reading=structuredClone(story);const readReport=previewCourseStory(reading,[{...activity,kind:'content'}],['quiz']);assert.equal(readReport.totalScenarios,1);assert.equal(readReport.cases[0].status,'success');assert(readReport.unreachedNodes.includes('retry'));
const long={schemaVersion:'course-story.v1',mission:'Long bounded fixture',startNodeId:'n0',nodes:Array.from({length:100},(_,i)=>node('n'+i,i===99?[]:[choice('next','n'+(i+1))],{activityId:'a'+(i%4),...(i===99?{outcome:{kind:'success',message:'Done'}}:{})}))};
const longReport=previewCourseStory(long,Array.from({length:4},(_,i)=>({...activity,activityId:'a'+i})),[]);
assert.equal(longReport.complete,false);assert.equal(longReport.statesChecked,4096);assert(longReport.cases.length<=128);
const wide={schemaVersion:'course-story.v1',mission:'Many branches',startNodeId:'n0',nodes:Array.from({length:5},(_,i)=>node('n'+i,i===4?[]:Array.from({length:5},(_,j)=>choice('c'+j,'n'+(i+1))),i===4?{outcome:{kind:'success',message:'Done'}}:{}))};
const wideReport=previewCourseStory(wide,[],[]);assert.equal(wideReport.complete,false);assert.equal(wideReport.cases.length,128);assert(wideReport.statesChecked<=4096);
assert.equal(previewCourseStory({...story,nodes:[]},[activity],[]).valid,false);
assert.equal(previewCourseStory(story,[activity],[],0).valid,false);
console.log('Story paths passed: pass/retry/blocked routes, no future facts, conditional gaps, attempt thresholds, reading semantics, deterministic nonmutation and scenario/result/work bounds.');

const faultActivity={...activity,activityId:'sim',kind:'simulation',faultIds:['fault']};
const faultStory={schemaVersion:'course-story.v1',mission:'Fault paths',startNodeId:'sim',nodes:[
 node('sim',[choice('resolved','success',[{activityId:'sim',fact:'resolved',faultId:'fault',equals:true}]),choice('diagnosed-only','retry',[{activityId:'sim',fact:'diagnosed',faultId:'fault',equals:true},{activityId:'sim',fact:'resolved',faultId:'fault',equals:false}]),choice('not-diagnosed','retry',[{activityId:'sim',fact:'diagnosed',faultId:'fault',equals:false}])],{activityId:'sim'}),
 node('success',[],{outcome:{kind:'success',message:'Done'}}),node('retry',[],{outcome:{kind:'retry',message:'Review'}})
]};
const faultSnapshot=JSON.stringify(faultStory),faultReport=previewCourseStory(faultStory,[faultActivity],['sim']);
assert.equal(faultReport.valid,true);assert.equal(faultReport.complete,true);assert.deepEqual(faultReport.unreachedChoices,[]);
assert(faultReport.cases.some(c=>c.status==='blocked'&&c.facts[0].faults===undefined));
assert(faultReport.cases.some(c=>c.choiceIds.includes('diagnosed-only')));assert(faultReport.cases.some(c=>c.choiceIds.includes('resolved')));assert(faultReport.cases.some(c=>c.choiceIds.includes('not-diagnosed')));
assert(faultReport.cases.every(c=>c.facts.every(f=>!f.faults||f.faults.every(outcome=>!outcome.resolved||outcome.diagnosed))));assert.equal(JSON.stringify(faultStory),faultSnapshot);
assert.equal(previewCourseStory(faultStory,[{...faultActivity,faultIds:['other']}],[]).valid,false);
const futureFault=structuredClone(faultStory);futureFault.nodes[0].prerequisites=[{activityId:'sim',fact:'resolved',faultId:'fault',equals:true}];assert(previewCourseStory(futureFault,[faultActivity],[]).cases.every(c=>c.status==='blocked'&&!c.facts[0].faults));
const manyFaults=structuredClone(faultStory),faultIds=Array.from({length:10},(_,i)=>'fault'+i);manyFaults.nodes[0].choices[0].conditions=faultIds.map(faultId=>({activityId:'sim',fact:'resolved',faultId,equals:true}));
const boundedFaults=previewCourseStory(manyFaults,[{...faultActivity,faultIds:['fault',...faultIds]}],[]);assert.equal(boundedFaults.valid,true);assert.equal(boundedFaults.complete,false);assert(boundedFaults.totalScenarios>128);assert(boundedFaults.scenariosChecked<=128&&boundedFaults.cases.length<=128&&boundedFaults.statesChecked<=4096);
console.log('Fault path analysis passed: unavailable/negative/diagnosed/resolved outcomes, no impossible resolution or future evidence, exact reference validation and bounded partial coverage.');
