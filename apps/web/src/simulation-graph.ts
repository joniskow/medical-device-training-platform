import type {SimulationDefinition} from '@medical-device/simulation-schema';
const svgNamespace='http://www.w3.org/2000/svg';
const shorten=(text:string,length=34)=>text.length>length?text.slice(0,length-1)+'…':text;

/** A navigable, editable view of the same procedure definition used by validation and replay. */
export function renderSimulationGraph(host:HTMLElement,d:SimulationDefinition,selectStep:(id:string)=>void,changed:(id:string)=>void){
 host.replaceChildren();host.className='simulation-graph';host.dataset.simulationGraph='true';
 const heading=document.createElement('h3');heading.textContent='Procedure graph';host.append(heading);
 const note=document.createElement('p');note.textContent='Select a step to edit it. Arrows show possible successors; destination preconditions choose the branch. End means no successor, not an automatic pass.';host.append(note);
 const steps=new Map(d.steps.map(s=>[s.stepId,s]));
 const indegree=new Map(d.steps.map(s=>[s.stepId,0])),rank=new Map(d.steps.map(s=>[s.stepId,0]));
 for(const step of d.steps)for(const id of step.nextStepIds)if(steps.has(id))indegree.set(id,indegree.get(id)!+1);
 const queue=d.steps.filter(s=>indegree.get(s.stepId)===0).map(s=>s.stepId),processed=new Set<string>();
 for(let i=0;i<queue.length;i++){const id=queue[i];processed.add(id);for(const next of steps.get(id)!.nextStepIds)if(steps.has(next)){rank.set(next,Math.max(rank.get(next)!,rank.get(id)!+1));indegree.set(next,indegree.get(next)!-1);if(indegree.get(next)===0)queue.push(next);}}
 const lastRank=Math.max(0,...rank.values())+1;
 for(const step of d.steps)if(!processed.has(step.stepId))rank.set(step.stepId,lastRank);
 const columns=new Map<number,number>(),positions=new Map<string,{x:number;y:number}>();
 for(const step of d.steps){const level=rank.get(step.stepId)!,column=columns.get(level)??0;columns.set(level,column+1);positions.set(step.stepId,{x:24+column*288,y:24+level*168});}
 const viewport=document.createElement('div');viewport.className='simulation-graph-viewport';viewport.tabIndex=0;viewport.setAttribute('aria-label','Scrollable procedure graph');host.append(viewport);
 const svg=document.createElementNS(svgNamespace,'svg');svg.setAttribute('width',String(Math.max(1,...columns.values())*288+24));svg.setAttribute('height',String((Math.max(0,...rank.values())+1)*168+24));svg.setAttribute('role','group');svg.setAttribute('aria-label','Procedure steps and transitions');viewport.append(svg);
 const element=(name:string,attributes:Record<string,string>)=>{const el=document.createElementNS(svgNamespace,name);for(const [key,value] of Object.entries(attributes))el.setAttribute(key,value);return el;};
 const markerId='arrow-'+crypto.randomUUID(),defs=element('defs',{}),marker=element('marker',{id:markerId,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'});marker.append(element('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#48666d'}));defs.append(marker);svg.append(defs);
 for(const step of d.steps)for(const id of step.nextStepIds){const from=positions.get(step.stepId)!,to=positions.get(id);if(!to)continue;const edge=element('path',{d:`M ${from.x+128} ${from.y+120} C ${from.x+128} ${from.y+144}, ${to.x+128} ${to.y-24}, ${to.x+128} ${to.y}`,fill:'none',stroke:'#48666d','stroke-width':'2','marker-end':`url(#${markerId})`});edge.dataset.graphEdge=`${step.stepId}->${id}`;svg.append(edge);}
 const outline=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Text outline of steps and transitions';outline.append(summary);const list=document.createElement('ol');outline.append(list);host.append(outline);
 for(const step of d.steps){
  const {x,y}=positions.get(step.stepId)!,fault=d.faults.find(f=>f.faultId===step.triggerFaultId);
  const conditions=(Array.isArray(step.preconditions)?step.preconditions:[]).filter(p=>p&&typeof p.variable==='string').map(p=>`${p.variable} = ${JSON.stringify(p.equals)}`).join(' and ');
  const flags=[step.stepId===d.initialState.currentStepId?'Start':'',d.completion.requiredStepIds.includes(step.stepId)?'Required':'',!step.nextStepIds.length?'End':''].filter(Boolean).join(' · ');
  const description=[step.title,flags,conditions?`When ${conditions}`:'No preconditions',fault?`Fault: ${fault.title}`:''].filter(Boolean).join('. ');
  const node=element('g',{transform:`translate(${x} ${y})`,role:'button',tabindex:'0','aria-label':`Edit step. ${description}`,class:'simulation-graph-node'});node.dataset.graphStep=step.stepId;
  node.append(element('rect',{width:'256',height:'120',rx:'8'}));
  const title=element('title',{});title.textContent=description;node.append(title);
  [shorten(step.title),flags,shorten(conditions?`When ${conditions}`:'No preconditions'),shorten(fault?`Fault: ${fault.title}`:'')].forEach((line,index)=>{const text=element('text',{x:'12',y:String(25+index*24)});text.textContent=line;node.append(text);});
  node.addEventListener('click',()=>selectStep(step.stepId));node.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(key==='Enter'||key===' '){event.preventDefault();selectStep(step.stepId);}});svg.append(node);
  const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=`Edit step: ${step.title}`;button.onclick=()=>selectStep(step.stepId);item.append(button);const details=document.createElement('p');details.textContent=`${description}. Next: ${step.nextStepIds.map(id=>steps.get(id)?.title??`Unknown step ${id}`).join(', ')||'end of procedure'}.`;item.append(details);list.append(item);
 }
 const controls=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Edit transitions';controls.append(legend);host.append(controls);
 const selector=(label:string)=>{const wrapper=document.createElement('label'),select=document.createElement('select');wrapper.append(document.createTextNode(label),select);for(const step of d.steps)select.add(new Option(step.title,step.stepId));controls.append(wrapper);return select;};
 const from=selector('Transition from'),to=selector('Transition to');if(d.steps.length>1)to.selectedIndex=1;
 const message=document.createElement('p');message.setAttribute('role','status');message.hidden=true;controls.append(message);
 const feedback=(text:string)=>{message.hidden=false;message.textContent=text;};
 const mutate=(remove:boolean)=>{
  const source=steps.get(from.value),target=steps.get(to.value);if(!source||!target)return;
  if(remove){if(!source.nextStepIds.includes(target.stepId)){feedback('That transition does not exist.');return;}if(!confirm('Remove this transition? Review reachability and completion requirements afterward.'))return;source.nextStepIds=source.nextStepIds.filter(id=>id!==target.stepId);}
  else{
   if(source.nextStepIds.includes(target.stepId)){feedback('That transition already exists.');return;}
   const seen=new Set<string>(),pending=[target.stepId];while(pending.length){const id=pending.pop()!;if(id===source.stepId){feedback('This transition would create a cycle. Choose another destination.');return;}if(seen.has(id))continue;seen.add(id);pending.push(...(steps.get(id)?.nextStepIds??[]));}
   source.nextStepIds.push(target.stepId);
  }
  d.completion.terminalStepIds=d.completion.terminalStepIds.filter(id=>id!==source.stepId);if(!source.nextStepIds.length)d.completion.terminalStepIds.push(source.stepId);changed(source.stepId);
 };
 for(const [label,remove] of [['Add transition',false],['Remove transition',true]] as const){const button=document.createElement('button');button.type='button';button.textContent=label;if(remove)button.className='secondary';button.onclick=()=>mutate(remove);controls.append(button);}
}
