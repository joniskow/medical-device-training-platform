import assert from "node:assert/strict";
import {
  applySimulationAction,
  createInitialSimulationState,
  replaySimulation,
  validateCourseForPublication,
  validateSimulationDefinition
} from "../packages/simulation-schema/dist/index.js";

const modelManifest = {
  schemaVersion: "model-manifest.v1",
  format: "glb",
  unitSystem: "meter",
  scaleMeters: 1,
  upAxis: "Y",
  handedness: "right",
  origin: "bounding-box-center",
  forwardAxis: "-Z",
  normalizationStatus: "CANONICAL",
  sceneNodeCount: 2,
  meshCount: 1,
  materialCount: 1,
  triangleCount: 1,
  components: [
    { componentId: "AIC-C01", nodePath: "Controller/Panel", displayName: "Control panel", aliases: [], interactionCapabilities: ["select"] },
    { componentId: "AIC-C02", nodePath: "Controller/Cover", displayName: "Safety cover", aliases: [], interactionCapabilities: ["open"] }
  ]
};

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

const validSimulation = validateSimulationDefinition(simulation);
assert.equal(validSimulation.valid, true);
assert.deepEqual(validSimulation.findings, []);

// Stable identity must be unambiguous before graph traversal or publication.
for (const [code, mutate] of [
  ['MODEL_COMPONENT_DUPLICATE', draft => draft.model.componentIds.push(draft.model.componentIds[0])],
  ['COMPONENT_DUPLICATE', draft => draft.components.push({...draft.components[0], initialState:'different'})],
  ['STEP_DUPLICATE', draft => draft.steps.push({...draft.steps[0], title:'Conflicting duplicate', nextStepIds:[]})],
  ['FAULT_DUPLICATE', draft => draft.faults.push({...draft.faults[0], points:100})]
]) {
  const draft=structuredClone(simulation); mutate(draft);
  const before=JSON.stringify(draft), report=validateSimulationDefinition(draft);
  assert.equal(report.valid,false,code);
  assert(report.findings.some(f=>f.code===code),code);
  assert.equal(JSON.stringify(draft),before,'Validation cannot repair or mutate author content');
}
for(const transitions of [null,42,{},'open-cover']) {
  const draft=structuredClone(simulation);draft.steps[0].nextStepIds=transitions;
  const report=validateSimulationDefinition(draft);
  assert.equal(report.valid,false);
  assert(report.findings.some(f=>f.code==='STEP_TRANSITIONS_REQUIRED'));
}

const invalidSimulation = validateSimulationDefinition({
  ...simulation,
  steps: [{ ...simulation.steps[0], action: { type: "select_component", componentId: "NOT-IN-MODEL" }, script: "return true;" }]
});
assert.equal(invalidSimulation.valid, false);
assert.ok(invalidSimulation.findings.some((finding) => finding.code === "MODEL_COMPONENT_UNKNOWN"));
assert.ok(invalidSimulation.findings.some((finding) => finding.code === "ARBITRARY_EXECUTION_FORBIDDEN"));

const actions = [
  { actionId: "action-1", sequence: 1, nonce: "nonce-1", type: "select_component", payload: { componentId: "AIC-C01" } },
  { actionId: "action-2", sequence: 2, nonce: "nonce-2", type: "select_component", payload: { componentId: "AIC-C02" } },
  { actionId: "action-3", sequence: 3, nonce: "nonce-3", type: "open_component", payload: { componentId: "AIC-C02" } },
  { actionId: "action-4", sequence: 4, nonce: "nonce-4", type: "open_component", payload: { componentId: "AIC-C02" } }
];
const replay = replaySimulation(simulation, actions);
assert.equal(replay.completed, true);
assert.equal(replay.passed, true);
assert.equal(replay.score, 7);
assert.equal(replay.trace.filter((entry) => entry.accepted).length, 4);

const duplicate = applySimulationAction(simulation, replay.state, actions[3]);
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.failure?.code, "ACTION_REPLAYED");
assert.equal(duplicate.state.nextSequence, replay.state.nextSequence);

const terminalFault=structuredClone(simulation);terminalFault.faults[0].failureRule='INVALIDATE_SESSION';
const faultState=applySimulationAction(terminalFault,createInitialSimulationState(terminalFault),actions[0]).state;
const wrongFaultAction={...actions[1],payload:{componentId:'AIC-C01'}};
const benign=applySimulationAction(simulation,faultState,wrongFaultAction);assert.equal(benign.accepted,false);assert.equal(benign.state.invalidated,undefined);assert.equal(benign.state.nextSequence,2);
for(const invalid of [{...wrongFaultAction,sequence:99},{...wrongFaultAction,actionId:actions[0].actionId},{...wrongFaultAction,payload:null},{...wrongFaultAction,type:'unknown'}])assert.equal(applySimulationAction(terminalFault,faultState,invalid).state.invalidated,undefined,'Protocol errors cannot terminate an attempt');
const terminal=applySimulationAction(terminalFault,faultState,wrongFaultAction);assert.equal(terminal.accepted,false);assert.equal(terminal.state.invalidated,true);assert.equal(terminal.state.score,2);assert.equal(terminal.state.nextSequence,3);assert.equal(terminal.failure.code,'FAULT_SESSION_INVALIDATED');
assert.equal(applySimulationAction(terminalFault,terminal.state,{...actions[1],sequence:3}).failure.code,'SESSION_INVALIDATED');
const terminalReplay=replaySimulation(terminalFault,[actions[0],wrongFaultAction,...actions.slice(1)]);assert.equal(terminalReplay.completed,false);assert.equal(terminalReplay.passed,false);assert.equal(terminalReplay.score,2);assert.equal(terminalReplay.state.invalidated,true);
const historyInitial=createInitialSimulationState(simulation);assert.deepEqual(historyInitial.diagnosedFaultIds,[]);
const historyTriggered=applySimulationAction(simulation,historyInitial,actions[0]).state;
const historyBefore=structuredClone(historyTriggered),historyDiagnosed=applySimulationAction(simulation,historyTriggered,actions[1]);
assert.equal(historyDiagnosed.accepted,true);assert.deepEqual(historyDiagnosed.state.diagnosedFaultIds,['fault:blocked-line']);assert.deepEqual(historyDiagnosed.state.resolvedFaultIds,[]);assert.deepEqual(historyTriggered,historyBefore);
assert.deepEqual(applySimulationAction(simulation,historyDiagnosed.state,actions[1]).state.diagnosedFaultIds,['fault:blocked-line']);
const historyResolved=applySimulationAction(simulation,historyDiagnosed.state,actions[2]);assert.equal(historyResolved.accepted,true);assert.deepEqual(historyResolved.state.diagnosedFaultIds,['fault:blocked-line']);assert.deepEqual(historyResolved.state.resolvedFaultIds,['fault:blocked-line']);
const legacy=structuredClone(historyDiagnosed.state);delete legacy.diagnosedFaultIds;assert.deepEqual(applySimulationAction(simulation,legacy,actions[2]).state.diagnosedFaultIds,['fault:blocked-line']);assert.equal(legacy.diagnosedFaultIds,undefined);
const failedResolution=applySimulationAction(terminalFault,historyDiagnosed.state,{...actions[2],payload:{componentId:'AIC-C01'}});assert.equal(failedResolution.state.invalidated,true);assert.deepEqual(failedResolution.state.diagnosedFaultIds,['fault:blocked-line']);assert.deepEqual(failedResolution.state.resolvedFaultIds,[]);

assert.equal(replaySimulation(terminalFault,actions).passed,true,'Correct fault resolution must remain valid');

const transformSimulation = structuredClone(simulation);
transformSimulation.initialState = { currentStepId: "open-cover", variables: { ready: true }, componentStates: { "AIC-C01": "idle", "AIC-C02": "closed" } };
transformSimulation.components[1].allowedActions = ["transform_component"];
transformSimulation.steps = [{ stepId: "open-cover", title: "Open the safety cover", action: { type: "transform_component", componentId: "AIC-C02", transform: { rotationY: 1.5707963267948966 } }, nextStepIds: [], points: 3, preconditions: [{ variable: "ready", equals: true }] }];
transformSimulation.faults = [];
transformSimulation.scoring = { maxScore: 3, passScore: 1, stepPoints: { "open-cover": 3 }, faultPoints: {}, penalties: {} };
transformSimulation.completion = { requiredStepIds: ["open-cover"], requiredFaultIds: [], terminalStepIds: ["open-cover"] };
transformSimulation.equivalentPath = { mode: "TEXT_KEYBOARD", instructions: [{ stepId: "open-cover", text: "Open the safety cover." }], faultInstructions: [] };
assert.equal(validateSimulationDefinition(transformSimulation).valid, true);
const transformState = applySimulationAction(transformSimulation, createInitialSimulationState(transformSimulation), { actionId: "transform-1", sequence: 1, nonce: "transform-1", type: "transform_component", payload: { componentId: "AIC-C02", transform: { rotationY: 1.5707963267948966 } } });
assert.equal(transformState.accepted, true);
assert.equal(transformState.scoreDelta, 3);
const blockedTransformSimulation = structuredClone(transformSimulation);
blockedTransformSimulation.initialState.variables.ready = false;
const blockedTransform = applySimulationAction(blockedTransformSimulation, createInitialSimulationState(blockedTransformSimulation), { actionId: "transform-2", sequence: 1, nonce: "transform-2", type: "transform_component", payload: { componentId: "AIC-C02", transform: { rotationY: 1.5707963267948966 } } });
assert.equal(blockedTransform.accepted, false);
assert.equal(blockedTransform.failure?.code, "PRECONDITION_NOT_MET");

const course = {
  schemaVersion: "course-draft.v1",
  title: "Aurora Infusion Controller certification",
  citations: [{ assetVersionId: "asset:manual", citation: { page: 1, anchor: "procedure" } }],
  model: { modelVersionId: "model:aic-001", manifestHash: "manifest:aic-001", manifest: modelManifest },
  simulation: { simulationDefinitionId: "sim:aic-001", definition: simulation },
  policy: { policyId: "policy:aic-001", version: 1, maxAttempts: 3, cooldownSeconds: 60, attemptTtlSeconds: 1800, requiredEvidence: ["simulation.completed", "simulation.equivalent-path"] },
  modules: [{ title: "Procedure", activities: [{ type: "simulation", simulationDefinitionId: "sim:aic-001", citations: [{ assetVersionId: "asset:manual" }] }] }]
};
const publication = validateCourseForPublication({
  course,
  approvedSourceArtifactIds: ["asset:manual"],
  approvedReviewTargets: ["MODEL:model:aic-001", "SIMULATION:sim:aic-001", "POLICY:policy:aic-001"],
  aiWarnings: []
});
assert.equal(publication.valid, true);
for(const type of ['guided_procedure','manipulation','assembly']){
 const typed=structuredClone(course);typed.modules[0].activities[0].type=type;
 const input={course:typed,approvedSourceArtifactIds:['asset:manual'],approvedReviewTargets:['MODEL:model:aic-001','SIMULATION:sim:aic-001','POLICY:policy:aic-001']};
 assert.equal(validateCourseForPublication(input).valid,true,type);
 delete typed.modules[0].activities[0].simulationDefinitionId;
 assert(validateCourseForPublication(input).findings.some(f=>f.code==='SIMULATION_BINDING_REQUIRED'),type+' allowed missing binding');
}
const changedCourse={...course,_lineage:{sourceReleaseId:'release:previous'}};
const checkChange=(releaseChange)=>validateCourseForPublication({course:{...changedCourse,releaseChange},approvedSourceArtifactIds:['asset:manual'],approvedReviewTargets:['MODEL:model:aic-001','SIMULATION:sim:aic-001','POLICY:policy:aic-001']});
assert.ok(checkChange(undefined).findings.some(f=>f.code==='RELEASE_CHANGE_REQUIRED'));
const change={schemaVersion:'release-change.v1',classes:['simulation'],releaseNotes:'Changed procedure',effectiveAt:'2026-11-01T00:00:00.000Z',decision:'full_retake',rationale:'Competency changed',learnerMessage:'Complete updated training',updateModuleIds:[]};
assert.equal(checkChange(change).valid,true);
const {validReleaseChange}=await import('../packages/simulation-schema/dist/index.js');
const updateDecision={...change,decision:'update_modules',updateModuleIds:['update']};
assert.ok(checkChange(updateDecision).findings.some(f=>f.code==='UPDATE_POLICY_REQUIRED'));
assert.equal(validReleaseChange(updateDecision,[{moduleId:'update',activities:[{type:'simulation'}]}]),true);
assert.equal(validReleaseChange(updateDecision,[{moduleId:'update',activities:[{type:'text'}]}]),false);
assert.equal(validReleaseChange({...updateDecision,updateModuleIds:['update','update']},[{moduleId:'update',activities:[{type:'simulation'}]}]),false);
for(const decision of ['keep_valid','future_learners_only','supersede_on_completion'])assert.equal(validReleaseChange({...change,decision},[]),true);
for(const invalid of [{...change,classes:[]},{...change,classes:['unknown']},{...change,learnerMessage:''},{...change,effectiveAt:'not a date'},{...change,rationale:''},{...change,decision:'automatic_pass'},{...change,updateModuleIds:['unknown']},{...change,decision:'update_modules'}])assert.equal(checkChange(invalid).valid,false);

for(const mutate of [
 draft=>draft.model.manifest.components.push(structuredClone(draft.model.manifest.components[0])),
 draft=>draft.simulation.definition.steps.push(structuredClone(draft.simulation.definition.steps[0]))
]) {
 const draft=structuredClone(course);mutate(draft);
 const report=validateCourseForPublication({course:draft,approvedSourceArtifactIds:['source:aic-001']});
 assert.equal(report.valid,false);
 assert(report.findings.some(f=>['MODEL_COMPONENT_DUPLICATE','STEP_DUPLICATE'].includes(f.code)));
}

const blockedPublication = validateCourseForPublication({
  course: { ...course, citations: [], simulation: { ...course.simulation, definition: { ...simulation, equivalentPath: { ...simulation.equivalentPath, instructions: [] } } } },
  approvedSourceArtifactIds: [],
  approvedReviewTargets: [],
  aiWarnings: [{ code: "SOURCE_CONFLICT", severity: "warning", message: "Conflicting source claims require review." }]
});
assert.equal(blockedPublication.valid, false);
assert.ok(blockedPublication.findings.some((finding) => finding.code === "CITATION_REQUIRED"));
assert.ok(blockedPublication.findings.some((finding) => finding.code === "REVIEW_REQUIRED"));
assert.ok(blockedPublication.findings.some((finding) => finding.code === "SOURCE_CONFLICT"));
for (const instructions of [[{faultId:simulation.faults[0].faultId,text:''}],[{faultId:'unknown-fault',text:'Diagnose it'}],[null]]) {
  const invalid=structuredClone(simulation);invalid.equivalentPath.faultInstructions=instructions;
  assert.equal(validateSimulationDefinition(invalid).valid,false,'Invalid equivalent fault instructions must block validation');
  const publication=validateCourseForPublication({course:{...course,simulation:{...course.simulation,definition:invalid}},approvedSourceArtifactIds:['source:aic-001']});
  assert.ok(publication.findings.some(f=>f.code==='EQUIVALENT_FAULT_INSTRUCTION_INVALID'));
}

for(const requirement of [{type:'select_component'},{type:'transform_component',componentId:'AIC-C01'},{type:'inspect_component',transform:{rotationY:1}},{type:'inspect_component',componentId:'AIC-C01',transform:{}},{type:'complete_step',value:'x'.repeat(2001)}]){
 const invalid=structuredClone(simulation);invalid.steps[0].action=requirement;assert.equal(validateSimulationDefinition(invalid).valid,false,'Untransportable action must block execution/publication');
}
console.log("Simulation schema passed: validation, deterministic replay, replay protection, equivalent path, and publication blockers.");
