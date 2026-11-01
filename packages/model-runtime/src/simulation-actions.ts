import {applyPermittedTransform} from './browser.js';
import type {ModelComponentManifest} from './glb-manifest.js';
export interface ModelActionFinding {code:string;path:string;message:string;severity:'error'}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

/** Checks action geometry using the same normalization as authoritative learner sessions. */
export function validateSimulationModelActions(definition:unknown,binding:unknown):ModelActionFinding[]{
 const findings:ModelActionFinding[]=[];
 const fail=(code:string,path:string,message:string)=>findings.push({code,path,message,severity:'error'});
 if(!record(definition)||!record(definition.model)||!record(binding)||!record(binding.manifest)||!Array.isArray(binding.manifest.components)){
  fail('SIMULATION_MODEL_UNAVAILABLE','simulation.model','Load the bound model manifest before preview or publication.');return findings;
 }
 const model=binding.manifest;
 if(definition.model.modelVersionId!==binding.modelVersionId||definition.model.manifestHash!==binding.manifestHash||model.sourceHash!==binding.manifestHash)fail('SIMULATION_MODEL_MISMATCH','simulation.model','Simulation and approved model identity/hash must match.');
 const components=new Map<string,ModelComponentManifest>();
 for(const value of model.components as unknown[]){
  if(!record(value)||typeof value.componentId!=='string'||components.has(value.componentId)){fail('MODEL_COMPONENT_INVALID','simulation.model','Model components must have unique identifiers.');continue;}
  components.set(value.componentId,value as unknown as ModelComponentManifest);
  const rules=value.permittedTransforms;
  if(rules!==undefined&&!record(rules)){fail('MODEL_TRANSFORM_RULE_INVALID','simulation.model','Model transform rules are malformed.');continue;}
  for(const axis of ['rotationY','translationX'] as const){
   const rule=record(rules)?rules[axis]:undefined;if(rule===undefined)continue;
   if(!record(rule)||typeof rule.min!=='number'||typeof rule.max!=='number'||!Number.isFinite(rule.min)||!Number.isFinite(rule.max)||rule.min>rule.max||typeof rule.step!=='number'||!Number.isFinite(rule.step)||rule.step<=0||(rule.snap!==undefined&&(typeof rule.snap!=='number'||!Number.isFinite(rule.snap)||rule.snap<=0))){fail('MODEL_TRANSFORM_RULE_INVALID',`simulation.model.${value.componentId}.${axis}`,'Transform bounds and increments must be finite and valid.');continue;}
   const initial=applyPermittedTransform(value as unknown as ModelComponentManifest,{rotationY:0,translationX:0},{[axis]:0});
   if(!initial||initial[axis]!==0)fail('MODEL_INITIAL_TRANSFORM_INVALID',`simulation.model.${value.componentId}.${axis}`,'The model must permit the initial zero transform.');
  }
 }
 const ids=definition.model.componentIds;
 if(!Array.isArray(ids)||ids.length!==components.size||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!components.has(id)))fail('SIMULATION_COMPONENT_SET_MISMATCH','simulation.model.componentIds','Simulation component identities must exactly match the approved model.');
 const actions:Array<{path:string;action:unknown}>=[];
 for(const [index,step] of (Array.isArray(definition.steps)?definition.steps:[]).entries())if(record(step))actions.push({path:`simulation.steps[${index}].action`,action:step.action});
 for(const [index,fault] of (Array.isArray(definition.faults)?definition.faults:[]).entries())if(record(fault))for(const key of ['diagnosis','resolution'])actions.push({path:`simulation.faults[${index}].${key}`,action:fault[key]});
 for(const {path,action} of actions){
  if(!record(action)||action.transform===undefined)continue;
  const component=typeof action.componentId==='string'?components.get(action.componentId):undefined;
  if(!component||!record(action.transform)||!Object.keys(action.transform).length||Object.entries(action.transform).some(([key,value])=>!['rotationY','translationX'].includes(key)||typeof value!=='number'||!Number.isFinite(value))){fail('MODEL_ACTION_TRANSFORM_INVALID',path,'A transform needs a known component and finite supported axes.');continue;}
  // Do not normalize against malformed rules: the manifest findings already block execution.
  if(findings.some(f=>f.code==='MODEL_TRANSFORM_RULE_INVALID'))continue;
  const requested=action.transform as {rotationY?:number;translationX?:number};
  const normalized=applyPermittedTransform(component,{rotationY:0,translationX:0},requested);
  if(!normalized)fail('MODEL_ACTION_TRANSFORM_NOT_PERMITTED',path,'The approved model does not permit this transform.');
  else for(const axis of ['rotationY','translationX'] as const)if(requested[axis]!==undefined&&requested[axis]!==normalized[axis])fail('MODEL_ACTION_TRANSFORM_NOT_CANONICAL',`${path}.transform.${axis}`,`Use the permitted snapped value ${normalized[axis]} instead of ${requested[axis]}.`);
 }
 return findings;
}
