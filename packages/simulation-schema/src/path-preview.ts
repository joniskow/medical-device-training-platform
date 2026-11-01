import {applySimulationAction,createInitialSimulationState,validateSimulationDefinition,type SimulationDefinition,type SimulationState} from './index.js';
type Value=string|number|boolean;
export interface SimulationPathCase {
 initialVariables:Record<string,Value>;
 status:'PASSED'|'BELOW_THRESHOLD'|'MISSING_REQUIREMENTS'|'BLOCKED'|'LIMIT_REACHED';
 score:number;steps:string[];faults:string[];missingSteps:string[];missingFaults:string[];failureCode?:string;
}
export interface SimulationPathReport {
 valid:boolean;exhaustive:boolean;totalScenarios:number;cases:SimulationPathCase[];unvisitedSteps:string[];unvisitedFaults:string[];
}

/** Author-only analysis of equality partitions; uses the same transitions as learner execution. */
export function previewSimulationPaths(definition:SimulationDefinition,limit=128):SimulationPathReport {
 if(!Number.isInteger(limit)||limit<1||limit>128)throw Error('PREVIEW_LIMIT_INVALID');
 const report:SimulationPathReport={valid:validateSimulationDefinition(definition).valid,exhaustive:false,totalScenarios:0,cases:[],unvisitedSteps:[],unvisitedFaults:[]};
 if(!report.valid)return report;
 // Equality-only guards divide each type into compared constants and one representative of all other values.
 const names=[...new Set(definition.steps.flatMap(s=>(s.preconditions??[]).map(p=>p.variable)))].sort();
 let scenarios:Array<Record<string,Value>>=[{...definition.initialState.variables}],total=1;
 for(const name of names){
  const initial=definition.initialState.variables[name];
  const compared=definition.steps.flatMap(s=>(s.preconditions??[]).filter(p=>p.variable===name).map(p=>p.equals));
  const values=[...new Set<Value>([initial,...compared])];
  if(typeof initial==='boolean'){for(const v of [false,true])if(!values.includes(v))values.push(v);}
  else if(compared.includes(initial)&&typeof initial==='number'){let other=0;while(values.includes(other))other++;values.push(other);}
  else if(compared.includes(initial)){let other='(other)';while(values.includes(other))other+='.';values.push(other);}
  total=Math.min(Number.MAX_SAFE_INTEGER,total*values.length);
  const next:Array<Record<string,Value>>=[];
  for(const scenario of scenarios){for(const value of values){if(next.length>=limit)break;next.push({...scenario,[name]:value});}if(next.length>=limit)break;}
  scenarios=next;
 }
 report.totalScenarios=total;let remainingActions=4096;
 const visitedSteps=new Set<string>(),visitedFaults=new Set<string>();
 for(const variables of scenarios){
  if(remainingActions<=0)break;
  const candidate={...definition,initialState:{...definition.initialState,variables}};
  let state:SimulationState=createInitialSimulationState(candidate),failureCode:string|undefined,limited=false;
  while(state.currentStepId||state.activeFaultId){
   if(remainingActions--<=0){limited=true;break;}
   const fault=candidate.faults.find(f=>f.faultId===state.activeFaultId),step=candidate.steps.find(s=>s.stepId===state.currentStepId);
   const expected=fault?(state.faultStage==='DIAGNOSIS'?fault.diagnosis:fault.resolution):step?.action;
   if(!expected){failureCode='ACTION_NOT_AVAILABLE';break;}
   const {type,...payload}=expected,id=`preview:${report.cases.length}:${state.nextSequence}`;
   const transition=applySimulationAction(candidate,state,{actionId:id,nonce:id,sequence:state.nextSequence,type,payload});
   if(!transition.accepted){failureCode=transition.failure?.code??'ACTION_REJECTED';break;}
   state=transition.state;
  }
  const missingSteps=candidate.completion.requiredStepIds.filter(id=>!state.completedStepIds.includes(id));
  const missingFaults=candidate.completion.requiredFaultIds.filter(id=>!state.resolvedFaultIds.includes(id));
  for(const id of state.completedStepIds)visitedSteps.add(id);for(const id of state.resolvedFaultIds)visitedFaults.add(id);
  report.cases.push({initialVariables:variables,status:limited?'LIMIT_REACHED':failureCode?'BLOCKED':missingSteps.length||missingFaults.length?'MISSING_REQUIREMENTS':state.score/candidate.scoring.maxScore>=candidate.scoring.passScore?'PASSED':'BELOW_THRESHOLD',score:state.score,steps:state.completedStepIds,faults:state.resolvedFaultIds,missingSteps,missingFaults,...(failureCode?{failureCode}:{})});
 }
 report.exhaustive=report.cases.length===total&&!report.cases.some(c=>c.status==='LIMIT_REACHED');
 report.unvisitedSteps=definition.steps.filter(s=>!visitedSteps.has(s.stepId)).map(s=>s.stepId);
 report.unvisitedFaults=definition.faults.filter(f=>!visitedFaults.has(f.faultId)).map(f=>f.faultId);
 return report;
}
