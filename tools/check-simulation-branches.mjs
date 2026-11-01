import assert from 'node:assert/strict';
import {createInitialSimulationState,applySimulationAction,replaySimulation,validateSimulationDefinition,previewSimulationPaths} from '../packages/simulation-schema/dist/index.js';
const definition={schemaVersion:'simulation-definition.v1',simulationDefinitionId:'branch-test',version:1,
 model:{modelVersionId:'model',manifestHash:'hash',componentIds:['panel']},components:[{componentId:'panel',initialState:'initial',allowedActions:['select_component']}],
 initialState:{currentStepId:'start',variables:{route:true},componentStates:{panel:'initial'}},
 steps:[{stepId:'start',title:'Start',action:{type:'select_component',componentId:'panel'},nextStepIds:['left','right'],points:1},...['left','right'].map((id,i)=>({stepId:id,title:id,action:{type:'select_component',componentId:'panel'},preconditions:[{variable:'route',equals:i===0}],nextStepIds:[],points:1}))],faults:[],
 scoring:{maxScore:2,passScore:1,stepPoints:{},faultPoints:{},penalties:{}},completion:{requiredStepIds:['start'],requiredFaultIds:[],terminalStepIds:['left','right']},equivalentPath:{mode:'TEXT_KEYBOARD',instructions:['start','left','right'].map(stepId=>({stepId,text:'Select the panel'})),faultInstructions:[]}};
const action=n=>({actionId:`a${n}`,nonce:`n${n}`,sequence:n,type:'select_component',payload:{componentId:'panel',setVariables:{route:false}}});
for(const route of [true,false]){
 const d=structuredClone(definition);d.initialState.variables.route=route;assert.equal(validateSimulationDefinition(d).valid,true);
 const first=applySimulationAction(d,createInitialSimulationState(d),action(1));assert.equal(first.state.currentStepId,route?'left':'right');assert.equal(first.state.variables.route,route,'Client payload cannot change variables');
 const replay=replaySimulation(d,[action(1),action(2)]);assert.equal(replay.passed,true);assert.equal(replay.score,2);assert.deepEqual(replaySimulation(d,[action(1),action(2)]),replay);
}
const effect=structuredClone(definition);effect.steps[0].setVariables={route:false};assert.equal(applySimulationAction(effect,createInitialSimulationState(effect),action(1)).state.currentStepId,'right');
const fault=structuredClone(definition);fault.steps[0].triggerFaultId='fault';fault.faults=[{faultId:'fault',title:'Check',triggerStepId:'start',diagnosis:{type:'select_component',componentId:'panel'},resolution:{type:'select_component',componentId:'panel'},points:0,failureRule:'REJECT_AND_REMAIN',setVariables:{route:false}}];fault.completion.requiredFaultIds=['fault'];fault.equivalentPath.faultInstructions=[{faultId:'fault',text:'Select to diagnose and resolve'}];
const resolved=replaySimulation(fault,[action(1),action(2),action(3)]);assert.equal(resolved.state.currentStepId,'right');assert.equal(resolved.state.variables.route,false);assert.equal(replaySimulation(fault,[action(1),action(2),action(3),action(4)]).passed,true);
const missing=structuredClone(definition);missing.initialState.variables.route='other';missing.steps[1].preconditions[0].equals='left';missing.steps[2].preconditions[0].equals='right';missing.steps[0].setVariables={route:'neither'};
const initial=createInitialSimulationState(missing),blocked=applySimulationAction(missing,initial,action(1));assert.equal(blocked.failure.code,'BRANCH_NOT_RESOLVED');assert.deepEqual(blocked.state,initial);assert.equal(blocked.scoreDelta,0);
const noFaultRoute=structuredClone(fault);noFaultRoute.initialState.variables.route='other';noFaultRoute.steps[1].preconditions[0].equals='left';noFaultRoute.steps[2].preconditions[0].equals='right';noFaultRoute.faults[0].setVariables={route:'neither'};
const diagnosed=replaySimulation(noFaultRoute,[action(1),action(2)]).state;const rejectedResolution=applySimulationAction(noFaultRoute,diagnosed,action(3));assert.equal(rejectedResolution.failure.code,'BRANCH_NOT_RESOLVED');assert.deepEqual(rejectedResolution.state,diagnosed,'Unmatched fault resolution must preserve diagnosis, score and sequence');
for(const mutate of [d=>d.equivalentPath.instructions=d.equivalentPath.instructions.filter(i=>i.stepId!=='right'),d=>d.steps[2].preconditions=[{variable:'route',equals:true}],d=>d.steps[0].setVariables={unknown:true},d=>d.steps[0].setVariables={route:1},d=>d.steps[1].preconditions=[{variable:'unknown',equals:true}],d=>d.initialState.variables.route=Infinity,d=>d.steps[0].nextStepIds=['left','left'],d=>d.steps[1].nextStepIds=['start']]){
 const d=structuredClone(definition);mutate(d);assert.equal(validateSimulationDefinition(d).valid,false);
}
const before=structuredClone(definition),paths=previewSimulationPaths(definition);
assert.deepEqual(definition,before,'Path analysis mutated the author definition');assert.equal(paths.exhaustive,true);assert.equal(paths.totalScenarios,2);assert.deepEqual(paths.cases.map(c=>c.status),['PASSED','PASSED']);assert.deepEqual(paths.unvisitedSteps,[]);assert.equal(paths.cases[0].initialVariables.route,true);
const capped=previewSimulationPaths(definition,1);assert.equal(capped.exhaustive,false);assert.equal(capped.cases.length,1);assert.deepEqual(capped.unvisitedSteps,['right']);
assert.deepEqual(previewSimulationPaths(effect).unvisitedSteps,['left'],'Constant effects must expose unreachable alternatives');
assert.deepEqual(previewSimulationPaths(fault).unvisitedFaults,[]);
const incomplete=structuredClone(definition);incomplete.completion.requiredStepIds.push('left');assert.equal(previewSimulationPaths(incomplete).cases[1].status,'MISSING_REQUIREMENTS');assert.deepEqual(previewSimulationPaths(incomplete).cases[1].missingSteps,['left']);
const lowScore=structuredClone(definition);lowScore.steps[2].points=0;assert.equal(previewSimulationPaths(lowScore).cases[1].status,'BELOW_THRESHOLD');
const strings=structuredClone(missing);delete strings.steps[0].setVariables;const stringsReport=previewSimulationPaths(strings);assert.equal(stringsReport.totalScenarios,3);assert.equal(stringsReport.cases[0].status,'BLOCKED');assert.equal(stringsReport.cases.filter(c=>c.status==='PASSED').length,2);
const invalid=structuredClone(definition);invalid.steps[2].preconditions[0].equals=true;assert.equal(previewSimulationPaths(invalid).valid,false);assert.equal(previewSimulationPaths(invalid).cases.length,0);
assert.throws(()=>previewSimulationPaths(definition,129),/PREVIEW_LIMIT_INVALID/);
const budgeted=structuredClone(definition);const flags=Object.fromEntries(Array.from({length:7},(_,i)=>['flag'+i,false]));budgeted.initialState={...budgeted.initialState,currentStepId:'s0',variables:flags};
budgeted.steps=Array.from({length:40},(_,i)=>({stepId:'s'+i,title:'Step '+i,action:{type:'select_component',componentId:'panel'},nextStepIds:i<39?['s'+(i+1)]:[],points:1,...(i===0?{setVariables:Object.fromEntries(Object.keys(flags).map(key=>[key,true]))}:{preconditions:Object.keys(flags).map(variable=>({variable,equals:true}))})}));budgeted.completion={requiredStepIds:[],requiredFaultIds:[],terminalStepIds:['s39']};budgeted.equivalentPath.instructions=budgeted.steps.map(s=>({stepId:s.stepId,text:'Select panel'}));budgeted.scoring.maxScore=40;
const budgetReport=previewSimulationPaths(budgeted);assert.equal(budgetReport.totalScenarios,128);assert.equal(budgetReport.exhaustive,false);assert.equal(budgetReport.cases.at(-1).status,'LIMIT_REACHED');assert.ok(budgetReport.cases.length<128);
console.log('Path analysis passed: exhaustive equality cases, current-state-first ordering, branch/fault coverage, unmet requirements, below-threshold paths, partial reports and no draft mutation.');

console.log('Simulation branches passed: both routes, typed effects, post-fault routing, client-value rejection, deterministic scoring, unmatched rollback and invalid graph/variable rejection.');
