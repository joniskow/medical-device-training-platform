import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSimulationModelActions,applyPermittedTransform} from '../packages/model-runtime/dist/index.js';
const manifest=JSON.parse(await readFile('apps/web/src/model-manifest.json','utf8'));
const binding={modelVersionId:manifest.modelVersionId,manifestHash:manifest.sourceHash,manifest};
const action={type:'transform_component',componentId:'AIC-C02',transform:{rotationY:Math.PI/2}};
const definition={model:{modelVersionId:binding.modelVersionId,manifestHash:binding.manifestHash,componentIds:manifest.components.map(c=>c.componentId)},steps:[{action}],faults:[{diagnosis:{type:'select_component',componentId:'AIC-C01'},resolution:structuredClone(action)}]};
assert.deepEqual(validateSimulationModelActions(definition,binding),[]);
for(const [mutate,expected] of [
 [d=>d.steps[0].action.transform.rotationY=0.4,'MODEL_ACTION_TRANSFORM_NOT_CANONICAL'],
 [d=>d.steps[0].action.transform.rotationY=100,'MODEL_ACTION_TRANSFORM_NOT_PERMITTED'],
 [d=>d.steps[0].action.transform={translationX:1},'MODEL_ACTION_TRANSFORM_NOT_PERMITTED'],
 [d=>d.faults[0].resolution.transform.rotationY=.4,'MODEL_ACTION_TRANSFORM_NOT_CANONICAL'],
 [d=>d.steps[0].action.componentId='unknown','MODEL_ACTION_TRANSFORM_INVALID'],
 [d=>d.model.componentIds.pop(),'SIMULATION_COMPONENT_SET_MISMATCH'],
 [d=>d.model.manifestHash='forged','SIMULATION_MODEL_MISMATCH']]){
 const d=structuredClone(definition);mutate(d);assert.ok(validateSimulationModelActions(d,binding).some(f=>f.code===expected),expected);
}
for(const rule of [{min:1,max:2,step:.1},{min:0,max:2,step:NaN}]){
 const changed=structuredClone(binding);changed.manifest.components.find(c=>c.componentId==='AIC-C02').permittedTransforms.rotationY=rule;
 assert.ok(validateSimulationModelActions(definition,changed).some(f=>f.code.startsWith('MODEL_INITIAL')||f.code==='MODEL_TRANSFORM_RULE_INVALID'));
}
for(const component of manifest.components)for(const axis of ['rotationY','translationX']){
 const rule=component.permittedTransforms?.[axis];if(!rule)continue;
 for(const value of [rule.min,rule.max,rule.snap??rule.step]){
  const normalized=applyPermittedTransform(component,{rotationY:0,translationX:0},{[axis]:value});if(!normalized)continue;
  const d=structuredClone(definition);d.steps[0].action={type:'inspect_component',componentId:component.componentId,transform:{[axis]:normalized[axis]}};
  assert.deepEqual(validateSimulationModelActions(d,binding),[],'Canonical runtime result must be accepted for any semantic action');
 }
}
assert.equal(validateSimulationModelActions(definition,undefined)[0].code,'SIMULATION_MODEL_UNAVAILABLE');
console.log('Simulation/model actions passed: actual manifest limits, snapping, optional semantic transforms, fault actions, exact binding/components and initial pose.');
