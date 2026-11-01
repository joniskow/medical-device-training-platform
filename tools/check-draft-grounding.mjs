import assert from 'node:assert/strict';
import {createSourceGroundedDraftService} from '../packages/ai-gateway/dist/index.js';
const citation={assetVersionId:'source',page:3,section:'Setup',charStart:10,charEnd:80};
const original={schemaVersion:'course-draft.v1',title:'Setup',citations:[citation],modules:[{title:'Preparation',activities:[{type:'rich_text',text:'Review setup.',citations:[citation]}]}]};
const assessment={schemaVersion:'assessment-definition.v1',assessmentId:'assessment:setup',version:1,passScore:.8,questions:[{questionId:'q:setup',type:'multiple_choice',prompt:'Which step comes first?',options:[{optionId:'a',text:'Review setup'},{optionId:'b',text:'Skip setup'}],correctOptionIds:['a'],points:1,competencyIds:['setup'],rationale:'The source requires setup review.',citations:[citation]}]};
function addAssessment(d,type='multiple_choice'){const a=d.modules[0].activities[0];a.type=type;delete a.text;a.assessment=structuredClone(assessment);a.assessment.questions[0].type=type;if(type==='ordered_step')a.assessment.questions[0].correctOptionIds=['a','b'];return a.assessment;}
const simulation = {
  schemaVersion: "simulation-definition.v1",
  simulationDefinitionId: "sim:aic-001",
  version: 1,
  model: { modelVersionId: "model:aic-001", manifestHash: "manifest:aic-001", componentIds: ["AIC-C01", "AIC-C02"] },
  components: [
    { componentId: "AIC-C01", initialState: "idle", allowedActions: ["select_component"] },
    { componentId: "AIC-C02", initialState: "closed", allowedActions: ["open_component"] }
  ],
  initialState: { currentStepId: "identify-panel", variables: { ready: false }, componentStates: { "AIC-C01": "idle", "AIC-C02": "closed" } },
  steps: [
    { stepId: "identify-panel", title: "Identify the control panel", action: { type: "select_component", componentId: "AIC-C01" }, nextStepIds: ["open-cover"], points: 2, triggerFaultId: "fault:blocked-line" },
    { stepId: "open-cover", title: "Open the safety cover", action: { type: "open_component", componentId: "AIC-C02" }, nextStepIds: [], points: 3 }
  ],
  faults: [
    { faultId: "fault:blocked-line", title: "Blocked line", triggerStepId: "identify-panel", diagnosis: { type: "select_component", componentId: "AIC-C02" }, resolution: { type: "open_component", componentId: "AIC-C02" }, points: 2, failureRule: "REJECT_AND_REMAIN" }
  ],
  scoring: { maxScore: 7, passScore: 0.8, stepPoints: { "identify-panel": 2, "open-cover": 3 }, faultPoints: { "fault:blocked-line": 2 }, penalties: {} },
  completion: { requiredStepIds: ["identify-panel", "open-cover"], requiredFaultIds: ["fault:blocked-line"], terminalStepIds: ["open-cover"] },
  equivalentPath: {
    mode: "TEXT_KEYBOARD",
    instructions: [
      { stepId: "identify-panel", text: "Select the control panel using the keyboard." },
      { stepId: "open-cover", text: "Choose open safety cover." }
    ],
    faultInstructions: [{ faultId: "fault:blocked-line", text: "Select the cover to diagnose the blocked line, then choose open." }]
  }
};

function addSimulation(d,type='simulation'){
 d.simulation={simulationDefinitionId:simulation.simulationDefinitionId,definition:structuredClone(simulation)};
 d.model={modelVersionId:simulation.model.modelVersionId,manifestHash:simulation.model.manifestHash,manifest:{components:simulation.model.componentIds.map(componentId=>({componentId}))}};
 d.modules[0].activities[0]={type,simulationDefinitionId:simulation.simulationDefinitionId,citations:[citation]};return d.simulation.definition;
}
const trustedModel={modelVersionId:simulation.model.modelVersionId,manifestHash:simulation.model.manifestHash,manifest:{components:simulation.model.componentIds.map(componentId=>({componentId}))}};
let output,recorded,saved;
const service=createSourceGroundedDraftService({
 knowledge:{listForAssetVersions:async()=>[{assetVersionId:'source',text:'Setup source.',citation},{assetVersionId:'unused',text:'Other source.',citation:{assetVersionId:'unused',page:1}}]},
 gateway:{execute:async request=>{assert.deepEqual(request.input.sourceChunks[0].citation,citation);assert.deepEqual(request.input.modelContext,trustedModel);assert.ok(Array.isArray(request.input.mediaContext));return {operation:'generate_course_draft',status:'DRAFT',output,citations:['source','invented'],warnings:[],metrics:{inputTokens:17,outputTokens:9},providerMetadata:{provider:'azure-openai',deployment:'fixture',model:'fixture',apiVersion:'fixture'}};}},
 aiRuns:{record:async input=>{recorded=input.result;return 'ai:test';}},
 draftStore:{getApprovedMediaForGeneration:async(tenant,ids)=>{assert.equal(tenant.organizationId,'org');return [{assetVersionId:'image:approved',sourceType:'image',contentType:'image/png'},{assetVersionId:'video:approved',sourceType:'video',contentType:'video/mp4'}].filter(asset=>ids.includes(asset.assetVersionId));},getApprovedModelForGeneration:async()=>structuredClone(trustedModel),get:async()=>({courseVersion:{revision:4,status:'DRAFT',content:{model:trustedModel}}}),saveGeneratedDraft:async input=>{saved=input;return true;}}
});
async function run(change,mediaAssetVersionIds=["image:approved","video:approved"]){output=structuredClone(original);change?.(output);saved=undefined;const before=JSON.stringify(output);const result=await service.generate({organizationId:'org',courseVersionId:'course',correlationId:'test'},{sourceArtifactIds:['source','unused'],mediaAssetVersionIds});assert.equal(JSON.stringify(output),before,'Validation mutated provider output');return result;}
await run();assert.equal(recorded.status,'DRAFT');assert.deepEqual(recorded.citations,['source']);assert.equal(saved.revision,4);assert.deepEqual(saved.content.model,trustedModel,'Regeneration lost approved model');
const cases=[
 ['AI_CITATION_INVALID',d=>delete d.citations],
 ['AI_CITATION_INVALID',d=>d.modules[0].activities[0].citations=[]],
 ['AI_CITATION_INVALID',d=>d.citations=[{...citation,assetVersionId:'foreign'}]],
 ['AI_CITATION_INVALID',d=>d.citations=[{...citation,page:4}]],
 ['AI_CITATION_INVALID',d=>d.citations=[{assetVersionId:'source',page:3}]],
 ['AI_CITATION_INVALID',d=>d.citations=[{...citation,charEnd:81}]],
 ['AI_CITATION_INVALID',d=>{addAssessment(d).questions[0].citations=[{...citation,section:'Unknown'}];}],
 ['AI_DRAFT_STRUCTURE_INVALID',d=>d.modules=[]],
 ['AI_DRAFT_STRUCTURE_INVALID',d=>d.title=''],
 ['AI_DRAFT_STRUCTURE_INVALID',d=>d.modules[0].activities=[]],
 ['AI_DRAFT_STRUCTURE_INVALID',d=>d.modules[0].activities=[null]],
 ['AI_DRAFT_FIELD_FORBIDDEN',d=>d._lineage={releaseId:'forged'}],
 ['AI_DRAFT_FIELD_FORBIDDEN',d=>d.modules[0].activities[0].javascript='alert(1)'],
 ['AI_DRAFT_STRUCTURE_INVALID',d=>{let next=d;for(let i=0;i<40;i++)next=next.child={};}]
];
for(const [code,change] of cases){const result=await run(change);assert.equal(result.result.failure.code,code);assert.equal(recorded.status,'REJECTED');assert.equal(recorded.output,undefined);assert.equal(saved,undefined);assert.equal(result.appliedToCourse,false);assert.deepEqual(recorded.metrics,{inputTokens:17,outputTokens:9});}
await run(d=>{d.citations=[{charEnd:80,page:3,section:'Setup',assetVersionId:'source',charStart:10}];});assert.equal(recorded.status,'DRAFT','Object key order changed locator match');
for(const type of ['multiple_choice','multi_select','ordered_step']){await run(d=>addAssessment(d,type));assert.equal(recorded.status,'DRAFT');assert.ok(saved,'Valid assessment not applied');}
const badAssessments=[
 d=>{d.modules[0].activities[0].type='multiple_choice';},
 d=>{addAssessment(d).passScore=2;},
 d=>{addAssessment(d).questions[0].correctOptionIds=['unknown'];},
 d=>{addAssessment(d).questions[0].correctOptionIds=['a','b'];},
 d=>{addAssessment(d,'ordered_step').questions[0].correctOptionIds=['a'];},
 d=>{addAssessment(d).questions[0].points=-1;},
 d=>{addAssessment(d).questions[0].rationale='';},
 d=>{addAssessment(d).questions[0].competencyIds=[];},
 d=>{const a=addAssessment(d);a.questions.push(structuredClone(a.questions[0]));},
 d=>{addAssessment(d);d.modules.push(structuredClone(d.modules[0]));},
 d=>{d.modules[0].activities[0].assessment=structuredClone(assessment);}
];
for(const change of badAssessments){await run(change);assert.equal(recorded.failure.code,'AI_ASSESSMENT_INVALID');assert.equal(recorded.output,undefined);assert.equal(saved,undefined);}
await run(d=>{d.modules[0].activities[0].type='invented_activity';});assert.equal(recorded.failure.code,'AI_ACTIVITY_TYPE_INVALID');assert.equal(saved,undefined);
for(const type of ['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly']){await run(d=>addSimulation(d,type));assert.equal(recorded.status,'DRAFT');assert.ok(saved);}
for(const change of [
 d=>{d.modules[0].activities[0].type='simulation';},
 d=>{addSimulation(d).steps[0].nextStepIds=['missing'];},
 d=>{addSimulation(d).faults[0].resolution.componentId='unknown';},
 d=>{addSimulation(d).equivalentPath.instructions=[];},
 d=>{addSimulation(d).scoring.maxScore=-1;}
]){await run(change);assert.equal(recorded.failure.code,'AI_SIMULATION_INVALID');assert.equal(saved,undefined);assert.equal(recorded.output,undefined);}
for(const change of [
 d=>{addSimulation(d);d.simulation.simulationDefinitionId='other';},
 d=>{addSimulation(d);d.modules[0].activities[0].simulationDefinitionId='other';},
 d=>{addSimulation(d);d.model.manifestHash='other';},
 d=>{addSimulation(d);d.model.modelVersionId='other';},
 d=>{addSimulation(d);d.model.manifest.components=[];}
]){await run(change);assert.ok(['AI_SIMULATION_BINDING_INVALID','AI_MODEL_CONTEXT_INVALID'].includes(recorded.failure.code));assert.equal(saved,undefined);}
let providerCalls=0;
function modelService(model,lookup){return createSourceGroundedDraftService({knowledge:{listForAssetVersions:async()=>[{assetVersionId:'source',text:'Setup',citation}]},draftStore:{get:async()=>({courseVersion:{revision:1,status:'DRAFT',content:{model}}}),getApprovedModelForGeneration:lookup},gateway:{execute:async()=>{providerCalls++;return {status:'DRAFT',operation:'generate_course_draft',output:{...structuredClone(original),model:trustedModel},warnings:[],citations:[],metrics:{},providerMetadata:{provider:'azure-openai',deployment:'fixture',model:'fixture',apiVersion:'fixture'}};}},aiRuns:{record:async()=> 'ai:model'}});}
const modelTenant={organizationId:'org',courseVersionId:'course',correlationId:'test'};
await assert.rejects(modelService(trustedModel,undefined).generate(modelTenant,{sourceArtifactIds:['source']}),/APPROVED_MODEL_CONTEXT_UNAVAILABLE/);
await assert.rejects(modelService(trustedModel,async()=>{throw Error('APPROVED_MODEL_NOT_FOUND');}).generate(modelTenant,{sourceArtifactIds:['source']}),/APPROVED_MODEL_NOT_FOUND/);
await assert.rejects(modelService({...trustedModel,manifestHash:'stale'},async()=>trustedModel).generate(modelTenant,{sourceArtifactIds:['source']}),/COURSE_MODEL_BINDING_STALE/);
assert.equal(providerCalls,0,'Unavailable model reached provider');
assert.equal((await modelService(undefined,undefined).generate(modelTenant,{sourceArtifactIds:['source']})).result.failure.code,'AI_MODEL_CONTEXT_INVALID','Invented unbound model accepted');
const exploration={overview:'Inspect setup.',hotspots:[{componentId:simulation.model.componentIds[0],title:'Panel',text:'Review this panel.'}]};
function addExploration(d,type='hotspot'){d.modules[0].activities[0]={type,exploration:structuredClone(exploration),citations:[citation]};return d.modules[0].activities[0].exploration;}
for(const type of ['hotspot','3d_viewer']){await run(d=>addExploration(d,type));assert.equal(recorded.status,'DRAFT');assert.ok(saved);}
await run(d=>{addExploration(d,'3d_viewer').hotspots=[];});assert.equal(recorded.status,'DRAFT');
for(const change of [
 d=>{addExploration(d).overview='';},
 d=>{addExploration(d).hotspots=[];},
 d=>{addExploration(d).hotspots[0].componentId='invented';},
 d=>{const e=addExploration(d);e.hotspots.push(structuredClone(e.hotspots[0]));},
 d=>{addExploration(d).hotspots[0].text='';},
 d=>{addExploration(d).hotspots[0].score=10;},
 d=>{d.modules[0].activities[0].exploration=structuredClone(exploration);}
]){await run(change);assert.equal(recorded.failure.code,'AI_EXPLORATION_INVALID');assert.equal(saved,undefined);assert.equal(recorded.output,undefined);}
const unboundInspection=createSourceGroundedDraftService({knowledge:{listForAssetVersions:async()=>[{assetVersionId:'source',text:'Setup',citation}]},gateway:{execute:async()=>{const content=structuredClone(original);addExploration(content);return {operation:'generate_course_draft',status:'DRAFT',output:content,warnings:[],citations:[],metrics:{},providerMetadata:{provider:'azure-openai',deployment:'fixture',model:'fixture',apiVersion:'fixture'}};}},aiRuns:{record:async()=> 'ai:inspection'}});
assert.equal((await unboundInspection.generate(modelTenant,{sourceArtifactIds:['source']})).result.failure.code,'AI_EXPLORATION_INVALID');
function addStory(d){
 addAssessment(d);d.modules[0].moduleId='module';d.modules[0].activities[0].activityId='quiz';
 d.policy={schemaVersion:'certification-policy.v1',policyId:'policy',version:1,requiredActivityIds:['quiz'],requiredModuleIds:[],resultSelection:'latest',passScore:.8,maxAttempts:3,cooldownSeconds:0,attemptTtlSeconds:1800,repeatedFailureReviewAfter:null,expirationDays:365,requiredEvidence:['assessment.passed']};
 const choice=(choiceId,nextNodeId)=>({choiceId,nextNodeId,label:'Continue',consequence:'Continue the mission.',conditions:[]});
 d.story={schemaVersion:'course-story.v1',mission:'Review setup.',startNodeId:'intro',nodes:[
 {nodeId:'intro',title:'Start',purpose:'Prepare.',prerequisites:[],choices:[choice('begin','quiz')]},
 {nodeId:'quiz',title:'Assessment',purpose:'Check setup.',activityId:'quiz',prerequisites:[],choices:[choice('finish','end')]},
 {nodeId:'end',title:'Done',purpose:'Finish.',prerequisites:[],choices:[],outcome:{kind:'success',message:'Mission complete; certification is evaluated separately.'}}
 ]};return d.story;
}
await run(d=>addStory(d));assert.equal(recorded.status,'DRAFT');assert.ok(saved);
await run(d=>{addStory(d);d.policy.requiredActivityIds=[];d.policy.requiredModuleIds=['module'];});assert.equal(recorded.status,'DRAFT');
for(const change of [
 d=>{addStory(d);delete d.policy;},
 d=>{addStory(d);d.policy.requiredActivityIds=['unknown'];},
 d=>{addStory(d);d.policy.maxAttempts=0;},
 d=>{addStory(d);d.policy.passScore=2;},
 d=>{addStory(d);d.policy.requiredEvidence=[];}
]){await run(change);assert.equal(recorded.failure.code,'AI_POLICY_INVALID');assert.equal(saved,undefined);}
for(const change of [
 d=>{const s=addStory(d);s.nodes[0].choices.push({...s.nodes[0].choices[0],choiceId:'skip',nextNodeId:'end'});},
 d=>{const s=addStory(d);s.nodes[1].choices[0].nextNodeId='intro';},
 d=>{const s=addStory(d);s.nodes[1].activityId='unknown';},
 d=>{const s=addStory(d);s.nodes[0].choices[0].conditions=[{activityId:'quiz',fact:'invented',equals:true}];},
 d=>{const s=addStory(d);d.policy.requiredActivityIds=[];d.policy.requiredModuleIds=['module'];s.nodes[0].choices.push({...s.nodes[0].choices[0],choiceId:'skip',nextNodeId:'end'});}
]){await run(change);assert.equal(recorded.failure.code,'AI_STORY_INVALID');assert.equal(saved,undefined);assert.equal(recorded.output,undefined);}
function addMedia(d,type='image'){const media=type==='image'?{assetVersionId:'image:approved',altText:'Diagram of setup.'}:{assetVersionId:'video:approved',transcript:'First review setup.'};d.modules[0].activities[0]={type,media,citations:[citation]};return media;}
for(const type of ['image','video']){await run(d=>addMedia(d,type));assert.equal(recorded.status,'DRAFT');assert.ok(saved);}
for(const change of [
 d=>{addMedia(d).assetVersionId='foreign';},
 d=>{addMedia(d).assetVersionId='video:approved';},
 d=>{addMedia(d).altText='';},
 d=>{addMedia(d,'video').transcript='';},
 d=>{addMedia(d).url='https://external.test/media';},
 d=>{addMedia(d).transcript='Wrong field';},
 d=>{d.modules[0].activities[0].media={assetVersionId:'image:approved',altText:'Diagram'};}
]){await run(change);assert.equal(recorded.failure.code,'AI_MEDIA_INVALID');assert.equal(recorded.output,undefined);assert.equal(saved,undefined);}
await run(d=>addMedia(d),[]);assert.equal(recorded.failure.code,'AI_MEDIA_INVALID','Unselected approved media accepted');assert.equal(saved,undefined);
await assert.rejects(run(undefined,['missing']),/APPROVED_MEDIA_NOT_FOUND/);
await assert.rejects(run(undefined,['image:approved','image:approved']),/MEDIA_REQUEST_INVALID/);
console.log('Draft grounding passed: exact course/activity/nested locators, actual cited assets, structural/protected-field limits, immutable provider results, audited rejection with usage and no draft writes.');
