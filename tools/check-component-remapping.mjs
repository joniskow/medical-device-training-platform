import assert from 'node:assert/strict';
import {remapCourseComponents} from '../packages/simulation-schema/dist/index.js';
const content={title:'a is a label, not a reference',simulation:{simulationDefinitionId:'sim',definition:{model:{componentIds:['a','b']},components:[{componentId:'a',allowedActions:['select_component']},{componentId:'b',initialState:'closed'}],initialState:{componentStates:{a:'ready',b:'closed'},variables:{a:'keep'}},steps:[{stepId:'a',action:{type:'select_component',componentId:'a',value:'a'},points:3}],faults:[{diagnosis:{componentId:'b'},resolution:{componentId:'a',transform:{rotationY:1}}}],scoring:{maxScore:3,stepPoints:{a:3}},equivalentPath:{instructions:[{stepId:'a',text:'Select a'}]}}},modules:[{moduleId:'a',activities:[{activityId:'a',type:'hotspot',exploration:{overview:'a',hotspots:[{componentId:'a',title:'a',text:'Inspect a'}]}},{type:'text',text:'a'}]}]};
const snapshot=structuredClone(content),mapping=[{from:'a',to:'b'},{from:'b',to:'a'}];
const result=remapCourseComponents(content,['a','b'],['a','b'],mapping);
assert.deepEqual(content,snapshot);
assert.deepEqual(result.simulation.definition.model.componentIds,['b','a']);
assert.deepEqual(result.simulation.definition.components.map(c=>c.componentId),['b','a']);
assert.deepEqual(result.simulation.definition.initialState.componentStates,{b:'ready',a:'closed'});
assert.deepEqual(result.simulation.definition.initialState.variables,{a:'keep'});
assert.equal(result.simulation.definition.steps[0].action.componentId,'b');
assert.equal(result.simulation.definition.steps[0].action.value,'a');
assert.equal(result.simulation.definition.faults[0].diagnosis.componentId,'a');
assert.equal(result.simulation.definition.faults[0].resolution.componentId,'b');
assert.deepEqual(result.simulation.definition.scoring,content.simulation.definition.scoring);
assert.deepEqual(result.simulation.definition.equivalentPath,content.simulation.definition.equivalentPath);
assert.equal(result.modules[0].activities[0].exploration.hotspots[0].componentId,'b');
assert.equal(result.modules[0].activities[0].exploration.hotspots[0].text,'Inspect a');
assert.equal(result.modules[0].activities[0].activityId,'a');
for(const invalid of [null,{},[],[{from:'a',to:'a'}],[{from:'a',to:'a'},{from:'a',to:'b'}],[{from:'a',to:'b'},{from:'b',to:'b'}],[{from:'a',to:'unknown'},{from:'b',to:'a'}],[{from:'unknown',to:'b'},{from:'b',to:'a'}],[{from:'a',to:'a',extra:true},{from:'b',to:'b'}]])assert.throws(()=>remapCourseComponents(content,['a','b'],['a','b'],invalid),/MODEL_COMPONENT_MAPPING_INVALID/);
const unknown=structuredClone(content);unknown.simulation.definition.steps[0].action.componentId='missing';assert.throws(()=>remapCourseComponents(unknown,['a','b'],['a','b'],mapping),/MODEL_COMPONENT_MAPPING_INVALID/);
const special=remapCourseComponents(content,['a','b'],['__proto__','constructor'],[{from:'a',to:'__proto__'},{from:'b',to:'constructor'}]);
assert.equal(Object.getOwnPropertyDescriptor(special.simulation.definition.initialState.componentStates,'__proto__').value,'ready');
assert.equal(Object.prototype.ready,undefined);
console.log('Component remapping passed: swaps, all structural references, text/scoring/identity preservation, input nonmutation, invalid/duplicate/missing targets and prototype-like IDs.');

const expanded=remapCourseComponents(content,['a','b'],['a','b','new'],mapping);
assert.deepEqual(expanded.simulation.definition.model.componentIds,['b','a','new']);
assert.deepEqual(expanded.simulation.definition.components[2],{componentId:'new',initialState:'initial',allowedActions:['select_component']});
assert.equal(expanded.simulation.definition.initialState.componentStates.new,'initial');
assert.deepEqual(expanded.simulation.definition.scoring,content.simulation.definition.scoring);
assert.deepEqual(expanded.simulation.definition.steps,result.simulation.definition.steps);
assert.throws(()=>remapCourseComponents(content,['a','b'],['a'],mapping),/MODEL_COMPONENT_MAPPING_INVALID/);
const inspection=remapCourseComponents({modules:content.modules},['a','b'],['a','b','new'],mapping);assert.equal(inspection.simulation,undefined);
console.log('Additional components passed: safe selection-only defaults, no authored action/score changes, inspection-only preservation and no implicit removal.');

const reduced=remapCourseComponents(expanded,['b','a','new'],['b','a'],[{from:'b',to:'b'},{from:'a',to:'a'},{from:'new',to:null}]);
assert.deepEqual(reduced.simulation.definition,result.simulation.definition);
const removal=[{from:'a',to:null},{from:'b',to:'b'}];
assert.throws(()=>remapCourseComponents(content,['a','b'],['b'],removal),/MODEL_COMPONENT_STILL_REFERENCED/);
for(const path of ['step','diagnosis','resolution','hotspot']){
 const isolated=structuredClone(content);isolated.simulation.definition.steps=[];isolated.simulation.definition.faults=[];isolated.modules=[];
 if(path==='step')isolated.simulation.definition.steps=[{action:{componentId:'a'}}];
 if(path==='diagnosis')isolated.simulation.definition.faults=[{diagnosis:{componentId:'a'}}];
 if(path==='resolution')isolated.simulation.definition.faults=[{resolution:{componentId:'a'}}];
 if(path==='hotspot')isolated.modules=[{activities:[{type:'hotspot',exploration:{hotspots:[{componentId:'a'}]}}]}];
 assert.throws(()=>remapCourseComponents(isolated,['a','b'],['b'],removal),/MODEL_COMPONENT_STILL_REFERENCED/);
}
console.log('Explicit removal passed: unused component/state cleanup and independent step/fault/hotspot reference guards.');
