import {createAuthorModelPreview,type AuthorModelPreviewAssets} from './author-model-preview.js';
import {validateSimulationModelActions} from '@medical-device/model-runtime';
import {validateSimulationDefinition,replaySimulation,previewSimulationPaths,type SimulationDefinition,type SimulationAction,type SimulationActionRequirement} from '@medical-device/simulation-schema';
import {renderVariables,renderVariableRules} from './simulation-variables.js';
import {renderSimulationGraph} from './simulation-graph.js';

/** Draft-only editing and local preview. Never sends learner actions or creates evidence. */
export function renderSimulationEditor(parent:HTMLElement,value:unknown,onChange:()=>void,modelBinding?:unknown,loadModel?:()=>Promise<AuthorModelPreviewAssets>){
 if(!value||typeof value!=='object')return;
 const d=value as SimulationDefinition;
 const root=document.createElement('fieldset');root.dataset.simulationEditor='true';const legend=document.createElement('legend');legend.textContent='Simulation procedure editor';root.append(legend);parent.append(root);
 const paragraph=(host:HTMLElement,label:string)=>{const p=document.createElement('p');p.textContent=label;host.append(p);return p;};
 if(!Array.isArray(d.steps)||!Array.isArray(d.faults)||!d.scoring||!d.initialState||!d.initialState.variables||typeof d.initialState.variables!=='object'||Array.isArray(d.initialState.variables)||!d.model||!d.completion||!d.equivalentPath||!Array.isArray(d.model.componentIds)||!Array.isArray(d.equivalentPath.instructions)||!Array.isArray(d.equivalentPath.faultInstructions)||!d.scoring.stepPoints||!d.scoring.faultPoints||d.steps.some(s=>!s||!s.action||!Array.isArray(s.nextStepIds))||d.faults.some(f=>!f||!f.diagnosis||!f.resolution)){paragraph(root,'A structured simulation definition must be generated or bound to this draft before editing.');return;}
 paragraph(root,`Bound model: ${d.model.modelVersionId}. Simulation version: ${d.version}. Model and simulation identities are preserved.`);
 paragraph(root,'Edit the draft procedure and equivalent keyboard instructions. Preview is local author practice and cannot award progress or credentials.');
 const validation=document.createElement('div');validation.dataset.simulationValidation='true';validation.setAttribute('role','status');
 const preview=document.createElement('div');preview.dataset.simulationPreview='true';preview.setAttribute('role','status');
 const actions=document.createElement('div');let snapshot:SimulationDefinition|undefined,trace:SimulationAction[]=[];
 const pathReport=document.createElement('div');pathReport.dataset.simulationPaths='true';pathReport.setAttribute('role','status');
 const graph=document.createElement('section');root.append(graph);
 const modelPreview=loadModel?createAuthorModelPreview(root,d,loadModel):undefined;
 function drawGraph(){renderSimulationGraph(graph,d,id=>{const field=[...root.querySelectorAll<HTMLElement>('[data-step-id]')].find(el=>el.dataset.stepId===id);field?.querySelector<HTMLInputElement>('input')?.focus();field?.scrollIntoView({block:'nearest'});},id=>rebuild(id));}
 function validate(){
  const report=validateSimulationDefinition(d);report.findings.push(...validateSimulationModelActions(d,modelBinding));report.valid=report.findings.every(f=>f.severity!=='error');validation.replaceChildren();paragraph(validation,report.valid?'Simulation structure is valid. Publication still requires source, model and reviewer approval.':'Fix simulation validation findings before preview or publication.');
  for(const finding of report.findings)paragraph(validation,`${finding.path}: ${finding.message}`);
  return report.valid;
 }
 function changed(){modelPreview?.invalidate();snapshot=undefined;trace=[];actions.replaceChildren();pathReport.textContent='Draft changed. Run scenario-path checks again.';preview.textContent='Draft changed. Reset preview to test the current definition.';validate();drawGraph();onChange();}
 function rebuild(focusId?:string){
  const anchor=document.createComment('simulation editor');root.replaceWith(anchor);
  renderSimulationEditor(parent,d,onChange,modelBinding,loadModel);const replacement=parent.lastElementChild as HTMLElement;anchor.replaceWith(replacement);
  const target=[...replacement.querySelectorAll<HTMLElement>('[data-step-id],[data-fault-id]')].find(el=>el.dataset.stepId===focusId||el.dataset.faultId===focusId);
  (target??replacement).querySelector<HTMLElement>('input,select,button')?.focus();onChange();
 }
 function button(host:HTMLElement,label:string,run:()=>void){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;host.append(b);return b;}
 function structuralError(message:string){validation.textContent=message;}
 function field(host:HTMLElement,label:string,current:string|number,update:(value:string)=>void,multiline=false){
  const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));const control=document.createElement(multiline?'textarea':'input');control.value=String(current??'');control.oninput=()=>{update(control.value);changed();};wrapper.append(control);host.append(wrapper);return control;
 }
 function select(host:HTMLElement,label:string,current:string,values:Array<[string,string]>,update:(value:string)=>void){
  const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));const control=document.createElement('select');for(const [id,title] of values)control.add(new Option(title,id));control.value=current;control.onchange=()=>{update(control.value);changed();};wrapper.append(control);host.append(wrapper);
 }
 function actionEditor(host:HTMLElement,label:string,action:SimulationActionRequirement){
  const box=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=label;box.append(title);host.append(box);
  select(box,'Action',action.type,['select_component','activate_target','transform_component','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault','request_hint'].map(x=>[x,x.replaceAll('_',' ')]),v=>{action.type=v as SimulationActionRequirement['type'];});
  select(box,'Component',action.componentId??'',[['','No component'],...d.model.componentIds.map(id=>[id,id] as [string,string])],v=>{if(v)action.componentId=v;else delete action.componentId;});
  if(action.type==='activate_target')field(box,'Interaction target ID',action.targetId??'',v=>{if(v.trim())action.targetId=v.trim();else delete action.targetId;});
  field(box,'Action value',action.value??'',v=>{if(v)action.value=v;else delete action.value;});
  select(box,'Action step reference',action.stepId??'',[['','No step reference'],...d.steps.map(s=>[s.stepId,s.title] as [string,string])],v=>{if(v)action.stepId=v;else delete action.stepId;});
  for(const key of ['rotationY','translationX'] as const)field(box,key==='rotationY'?'Required rotation Y (radians, optional)':'Required translation X (meters, optional)',action.transform?.[key]??'',v=>{if(v.trim())action.transform={...action.transform,[key]:Number(v)};else if(action.transform){delete action.transform[key];if(!Object.keys(action.transform).length)delete action.transform;}});
 }
 select(root,'Starting step',d.initialState.currentStepId,d.steps.map(s=>[s.stepId,s.title]),v=>{d.initialState.currentStepId=v;});
 field(root,'Maximum score',d.scoring.maxScore,v=>{d.scoring.maxScore=Number(v);});
 field(root,'Simulation passing threshold (0 to 1)',d.scoring.passScore,v=>{d.scoring.passScore=Number(v);});
 renderVariables(root,d,changed,()=>rebuild());
 for(const step of d.steps){
  const box=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=`Procedure step: ${step.stepId}`;box.dataset.stepId=step.stepId;box.append(title);root.append(box);
  field(box,'Step title',step.title,v=>{step.title=v;});field(box,'Hints (one per line)',(step.hints??[]).join('\n'),v=>{step.hints=v.split('\n').map(x=>x.trim()).filter(Boolean);},true);
  field(box,'Step points',d.scoring.stepPoints[step.stepId]??step.points,v=>{step.points=Number(v);d.scoring.stepPoints[step.stepId]=Number(v);});
  if(step.nextStepIds.length>1)paragraph(box,'Exactly one destination must match its preconditions. Next step replaces the branch list with a single successor.');
  select(box,'Next step',step.nextStepIds[0]??'',[['','End of procedure'],...d.steps.filter(s=>s.stepId!==step.stepId).map(s=>[s.stepId,s.title] as [string,string])],v=>{step.nextStepIds=v?[v]:[];d.completion.terminalStepIds=d.completion.terminalStepIds.filter(id=>id!==step.stepId);if(!v)d.completion.terminalStepIds.push(step.stepId);for(const check of box.querySelectorAll<HTMLInputElement>('[data-branch-target]'))check.checked=check.dataset.branchTarget===v;});
  actionEditor(box,'Required step action',step.action);
  const requiredLabel=document.createElement('label'),required=document.createElement('input');required.type='checkbox';required.checked=d.completion.requiredStepIds.includes(step.stepId);requiredLabel.append(required,document.createTextNode('Required on every successful path'));box.append(requiredLabel);
  required.onchange=()=>{d.completion.requiredStepIds=d.completion.requiredStepIds.filter(id=>id!==step.stepId);if(required.checked)d.completion.requiredStepIds.push(step.stepId);changed();};
  for(const destination of d.steps.filter(s=>s!==step)){
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.branchTarget=destination.stepId;check.checked=step.nextStepIds.includes(destination.stepId);label.append(check,document.createTextNode(`Branch destination: ${destination.title}`));box.append(label);
   check.onchange=()=>{step.nextStepIds=step.nextStepIds.filter(id=>id!==destination.stepId);if(check.checked)step.nextStepIds.push(destination.stepId);d.completion.terminalStepIds=d.completion.terminalStepIds.filter(id=>id!==step.stepId);if(!step.nextStepIds.length)d.completion.terminalStepIds.push(step.stepId);rebuild(step.stepId);};
  }
  renderVariableRules(box,d,step,true,changed);
  const instructions=d.equivalentPath.instructions.find(x=>x.stepId===step.stepId);
  field(box,'Equivalent keyboard instructions',instructions?.text??'',v=>{const existing=d.equivalentPath.instructions.find(x=>x.stepId===step.stepId);if(existing)existing.text=v;else d.equivalentPath.instructions.push({stepId:step.stepId,text:v});},true);
  button(box,'Insert step after this step',()=>{
   if(step.nextStepIds.length>1){structuralError('Choose a single successor before inserting a step.');return;}
   const stepId=`step:${crypto.randomUUID()}`;
   d.steps.splice(d.steps.indexOf(step)+1,0,{stepId,title:'New procedure step',action:{type:'select_component',componentId:d.model.componentIds[0]},nextStepIds:[...step.nextStepIds],points:0});
   step.nextStepIds=[stepId];d.scoring.stepPoints[stepId]=0;d.completion.requiredStepIds.push(stepId);
   d.completion.terminalStepIds=d.completion.terminalStepIds.map(id=>id===step.stepId?stepId:id);
   d.equivalentPath.instructions.push({stepId,text:''});rebuild(stepId);
  });
  button(box,'Add fault at this step',()=>{
   if(step.triggerFaultId||d.faults.some(f=>f.triggerStepId===step.stepId)){structuralError('Remove the existing fault before adding another fault at this step.');return;}
   const faultId=`fault:${crypto.randomUUID()}`,componentId=d.model.componentIds[0];
   d.faults.push({faultId,title:'New fault',triggerStepId:step.stepId,diagnosis:{type:'select_component',componentId},resolution:{type:'select_component',componentId},points:0,failureRule:'REJECT_AND_REMAIN'});
   step.triggerFaultId=faultId;d.scoring.faultPoints[faultId]=0;d.completion.requiredFaultIds.push(faultId);d.equivalentPath.faultInstructions.push({faultId,text:''});rebuild(faultId);
  });
  button(box,'Remove procedure step',()=>{
   const references=[...d.steps.filter(s=>s!==step).map(s=>s.action),...d.faults.flatMap(f=>[f.diagnosis,f.resolution])];
   if(d.steps.length===1||step.nextStepIds.length>1||(d.initialState.currentStepId===step.stepId&&step.nextStepIds.length!==1)||step.triggerFaultId||d.faults.some(f=>f.triggerStepId===step.stepId)||references.some(a=>a.stepId===step.stepId)){
    structuralError('Keep at least one step. Remove attached faults and action references, and choose a single successor where needed before removing this step.');return;
   }
   if(!confirm('Remove this procedure step, its score and equivalent instructions? Review the maximum score afterward.'))return;
   const predecessors=d.steps.filter(s=>s.nextStepIds.includes(step.stepId));
   for(const predecessor of predecessors)predecessor.nextStepIds=[...new Set(predecessor.nextStepIds.flatMap(id=>id===step.stepId?step.nextStepIds:[id]))];
   if(d.initialState.currentStepId===step.stepId)d.initialState.currentStepId=step.nextStepIds[0];
   d.steps=d.steps.filter(s=>s!==step);delete d.scoring.stepPoints[step.stepId];
   d.completion.requiredStepIds=d.completion.requiredStepIds.filter(id=>id!==step.stepId);
   d.completion.terminalStepIds=[...new Set(d.completion.terminalStepIds.flatMap(id=>id===step.stepId?predecessors.filter(s=>!s.nextStepIds.length).map(s=>s.stepId):[id]))];
   d.equivalentPath.instructions=d.equivalentPath.instructions.filter(i=>i.stepId!==step.stepId);rebuild(predecessors[0]?.stepId??d.initialState.currentStepId);
  });
 }
 for(const fault of d.faults){
  const box=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=`Fault: ${fault.faultId}`;box.dataset.faultId=fault.faultId;box.append(title);root.append(box);
  field(box,'Fault title',fault.title,v=>{fault.title=v;});paragraph(box,`Trigger step: ${fault.triggerStepId}.`);
  select(box,'Fault failure rule',fault.failureRule,[['REJECT_AND_REMAIN','Reject incorrect action and allow correction'],['INVALIDATE_SESSION','End the attempt after an incorrect fault action']],v=>{fault.failureRule=v as typeof fault.failureRule;});
  field(box,'Fault points',d.scoring.faultPoints[fault.faultId]??fault.points,v=>{fault.points=Number(v);d.scoring.faultPoints[fault.faultId]=Number(v);});
  actionEditor(box,'Diagnosis action',fault.diagnosis);actionEditor(box,'Resolution action',fault.resolution);
  renderVariableRules(box,d,fault,false,changed);
  const requiredLabel=document.createElement('label'),required=document.createElement('input');required.type='checkbox';required.checked=d.completion.requiredFaultIds.includes(fault.faultId);requiredLabel.append(required,document.createTextNode('Fault required on every successful path'));box.append(requiredLabel);required.onchange=()=>{d.completion.requiredFaultIds=d.completion.requiredFaultIds.filter(id=>id!==fault.faultId);if(required.checked)d.completion.requiredFaultIds.push(fault.faultId);changed();};
  field(box,'Equivalent fault instructions',d.equivalentPath.faultInstructions.find(x=>x.faultId===fault.faultId)?.text??'',v=>{const existing=d.equivalentPath.faultInstructions.find(x=>x.faultId===fault.faultId);if(existing)existing.text=v;else d.equivalentPath.faultInstructions.push({faultId:fault.faultId,text:v});},true);
  button(box,'Remove fault',()=>{
   if(!confirm('Remove this fault, its score and equivalent instructions? Review the maximum score afterward.'))return;
   d.faults=d.faults.filter(f=>f!==fault);for(const step of d.steps)if(step.triggerFaultId===fault.faultId)delete step.triggerFaultId;
   delete d.scoring.faultPoints[fault.faultId];d.completion.requiredFaultIds=d.completion.requiredFaultIds.filter(id=>id!==fault.faultId);
   d.equivalentPath.faultInstructions=d.equivalentPath.faultInstructions.filter(i=>i.faultId!==fault.faultId);rebuild(fault.triggerStepId);
  });
 }
 const reset=document.createElement('button');reset.type='button';reset.textContent='Reset local simulation preview';
 reset.onclick=()=>{
  actions.replaceChildren();snapshot=undefined;trace=[];if(!validate()){preview.textContent='Preview blocked by validation findings.';return;}
  snapshot=structuredClone(d);modelPreview?.reset();preview.textContent='Preview reset. Choose a procedure or fault action to test.';
  const choices=[...snapshot.steps.map(s=>({label:`Try step: ${s.title}`,action:s.action})),...snapshot.faults.flatMap(f=>[{label:`Try diagnosis: ${f.title}`,action:f.diagnosis},{label:`Try resolution: ${f.title}`,action:f.resolution}])];
  for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=choice.label;button.onclick=()=>{
   if(!snapshot)return;const before=replaySimulation(snapshot,trace);const {type,...payload}=choice.action;
   trace.push({actionId:crypto.randomUUID(),nonce:crypto.randomUUID(),sequence:before.state.nextSequence,type,payload});const result=replaySimulation(snapshot,trace),last=result.trace.at(-1)!;if(last.accepted)modelPreview?.apply(choice.action);
   preview.textContent=`${last.accepted?'Accepted':`Rejected: ${last.code}`} / Score ${result.score} of ${snapshot.scoring.maxScore} / ${result.state.invalidated?'Attempt invalidated':result.completed?result.passed?'Completed and passed':'Completed below threshold':'In progress'} / Current step: ${result.state.currentStepId??'none'} / Fault: ${result.state.activeFaultId??'none'}`;
  };actions.append(button);}
 };
 const paths=button(root,'Check scenario paths',()=>{
  pathReport.replaceChildren();if(!validate()){paragraph(pathReport,'Path checks blocked by validation findings.');return;}
  const report=previewSimulationPaths(structuredClone(d));
  paragraph(pathReport,`${report.exhaustive?'Complete equality-case check':'Partial check: preview limit reached'}: ${report.cases.length} of ${report.totalScenarios} initial-variable cases. These are hypothetical author previews; published initial values are unchanged. Correct configured actions are used; this is not a review of model geometry or every possible learner mistake.`);
  for(const [index,item] of report.cases.entries()){
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Case ${index+1}${index===0?' (configured initial values)':''}: ${item.status.replaceAll('_',' ')} / Score ${item.score} of ${d.scoring.maxScore}`;details.append(summary);pathReport.append(details);
   paragraph(details,`Initial variables: ${JSON.stringify(item.initialVariables)}`);paragraph(details,`Steps: ${item.steps.map(id=>d.steps.find(s=>s.stepId===id)?.title??id).join(' → ')||'none'}`);
   if(item.failureCode)paragraph(details,`Blocked: ${item.failureCode}`);
   if(item.missingSteps.length||item.missingFaults.length)paragraph(details,`Missing requirements: ${[...item.missingSteps,...item.missingFaults].join(', ')}`);
  }
  if(report.unvisitedSteps.length||report.unvisitedFaults.length)paragraph(pathReport,`Not reached in checked cases: ${[...report.unvisitedSteps,...report.unvisitedFaults].join(', ')}`);
 });
 root.append(validation,reset,preview,actions,paths,pathReport);validate();drawGraph();
}
