import {courseStoryFaultContext,validateCourseStory,previewCourseStory,projectStoryNode,advanceCourseStory,type CourseStory,type StoryNode,type StoryCondition,type StoryActivityFact} from '@medical-device/simulation-schema';
type Data=Record<string,any>;
/** Local authoring and practice only. No learner evidence is created. */
export function renderStoryEditor(parent:HTMLElement,course:Data,onChange:()=>void){
 const root=document.createElement('fieldset');root.dataset.storyEditor='true';parent.append(root);
 const activities=()=> (course.modules??[]).flatMap((m:Data)=>(m.activities??[]).map((a:Data)=>({...a,moduleId:m.moduleId}))).map((a:Data,index:number)=>({...a,title:a.title||`Activity ${index+1}`}));
 const required=()=>activities().filter((a:Data)=>course.policy?.requiredActivityIds?.includes(a.activityId)||course.policy?.requiredModuleIds?.includes(a.moduleId)).map((a:Data)=>a.activityId);
 const p=(host:HTMLElement,text:string)=>{const n=document.createElement('p');n.textContent=text;host.append(n);return n;};
 const button=(host:HTMLElement,label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;host.append(b);return b;};
 let validation:HTMLElement,preview:HTMLElement,snapshot:CourseStory|undefined,currentNode='',facts:StoryActivityFact[]=[];
 const validate=()=>{const report=validateCourseStory(course.story,activities().map((a:Data)=>a.activityId),required(),courseStoryFaultContext(course));validation.textContent=report.valid?'Story structure is valid.':report.findings.map(f=>f.message).join(' ');return report.valid;};
 const changed=()=>{snapshot=undefined;preview.replaceChildren();p(preview,'Draft changed. Reset local story preview.');validate();onChange();};
 const field=(host:HTMLElement,label:string,value:string,update:(v:string)=>void,multi=false)=>{const l=document.createElement('label'),i=document.createElement(multi?'textarea':'input');l.textContent=label;i.value=value??'';i.oninput=()=>{update(i.value);changed();};l.append(i);host.append(l);return i;};
 const select=(host:HTMLElement,label:string,value:string,options:Array<[string,string]>,update:(v:string)=>void)=>{const l=document.createElement('label'),i=document.createElement('select');l.textContent=label;for(const [key,text]of options)i.add(new Option(text,key));i.value=value;i.onchange=()=>{update(i.value);changed();};l.append(i);host.append(l);return i;};
 const rebuild=(nodeId?:string)=>{draw();const groups=[...root.querySelectorAll<HTMLElement>('[data-story-node]')];(groups.find(g=>g.dataset.storyNode===nodeId)?.querySelector<HTMLElement>('input')??root.querySelector<HTMLElement>('input,button'))?.focus();};
 const structure=(run:()=>void,nodeId?:string)=>{run();onChange();snapshot=undefined;rebuild(nodeId);};
 function conditions(host:HTMLElement,items:StoryCondition[],label:string,nodeId:string){
  const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=label;box.append(legend);host.append(box);
  for(const [index,c] of items.entries()){
   const row=document.createElement('div');box.append(row);
   select(row,'Condition activity',c.activityId,activities().map((a:Data)=>[a.activityId,a.title]),v=>structure(()=>{c.activityId=v;if(c.fact==='diagnosed'||c.fact==='resolved')c.faultId='';},nodeId));
   select(row,'Recorded fact',c.fact,[['completed','Completed'],['passed','Passed'],['score','Score at least (0-1)'],['attempts','Attempt count at least'],['diagnosed','Fault diagnosed'],['resolved','Fault resolved']],v=>structure(()=>{items[index]=v==='diagnosed'||v==='resolved'?{activityId:c.activityId,fact:v,faultId:'',equals:true}:v==='score'||v==='attempts'?{activityId:c.activityId,fact:v,minimum:1}:{activityId:c.activityId,fact:v as 'passed'|'completed',equals:true};},nodeId));
   if(c.fact==='diagnosed'||c.fact==='resolved'){const ids=courseStoryFaultContext(course).find(a=>a.activityId===c.activityId)?.faultIds??[];select(row,'Simulation fault',c.faultId,[['','Choose a fault'],...ids.map(id=>[id,id] as [string,string])],v=>c.faultId=v);select(row,'Expected result',String(c.equals),[['true','Yes'],['false','No']],v=>c.equals=v==='true');}
   else if(c.fact==='completed'||c.fact==='passed')select(row,'Expected result',String(c.equals),[['true','Yes'],['false','No']],v=>c.equals=v==='true');
   else{const numeric=c as Extract<StoryCondition,{minimum:number}>;const input=field(row,'Minimum',String(numeric.minimum),v=>numeric.minimum=v.trim()?Number(v):NaN) as HTMLInputElement;input.type='number';input.min=numeric.fact==='score'?'0':'1';input.max=numeric.fact==='score'?'1':'100';input.step=numeric.fact==='score'?'0.01':'1';}
   button(row,'Remove condition',()=>structure(()=>items.splice(index,1),nodeId));
  }
  button(box,'Add condition',()=>structure(()=>items.push({activityId:activities()[0].activityId,fact:'completed',equals:true}),nodeId)).disabled=!activities().length||items.length>=200;
 }
 function showPreview(){
  preview.replaceChildren();if(!snapshot)return;
  const node=projectStoryNode(snapshot,currentNode,facts);p(preview,`${node.title}: ${node.purpose}`);
  if(!node.available)p(preview,'Prerequisites are not met for these local facts.');
  if(node.outcome)p(preview,`${node.outcome.kind}: ${node.outcome.message}. No learner evidence is recorded.`);
  const local=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Local test results (never saved as learner evidence)';local.append(summary);preview.append(local);
  for(const fact of facts){
   const row=document.createElement('div');local.append(row);const label=document.createElement('label');label.textContent=activities().find((a:Data)=>a.activityId===fact.activityId)?.title||fact.activityId;const input=document.createElement('select');
   for(const [key,text] of [['none','Not completed'],['failed','Completed, failed'],['passed','Completed, passed']])input.add(new Option(text,key));input.value=fact.completed?fact.passed?'passed':'failed':'none';input.onchange=()=>{fact.completed=input.value!=='none';fact.passed=input.value==='passed';fact.score=fact.completed?fact.passed?1:0:null;fact.attempts=fact.completed?Math.max(1,fact.attempts):0;if(!fact.completed)delete fact.faults;showPreview();};label.append(input);row.append(label);
   for(const key of ['score','attempts'] as const){const l=document.createElement('label'),n=document.createElement('input');l.textContent=key==='score'?'Local score (0-1)':'Local attempt count';n.type='number';n.min='0';n.max=key==='score'?'1':'100';n.step=key==='score'?'0.01':'1';n.value=String(fact[key]??'');n.onchange=()=>{const value=Number(n.value);if(n.value&&Number.isFinite(value)&&value>=0&&value<=Number(n.max)&&(key==='score'||Number.isInteger(value))){fact[key]=value;showPreview();}};l.append(n);row.append(l);}
   const faultIds=courseStoryFaultContext(course).find(a=>a.activityId===fact.activityId)?.faultIds??[];
   for(const faultId of faultIds){
    const label=document.createElement('label'),select=document.createElement('select');label.textContent='Local fault: '+faultId;
    for(const [value,title] of [['missing','Evidence unavailable'],['none','Not diagnosed or resolved'],['diagnosed','Diagnosed, not resolved'],['resolved','Diagnosed and resolved']])select.add(new Option(title,value));
    const existing=fact.faults?.find(f=>f.faultId===faultId);select.value=!existing?'missing':existing.resolved?'resolved':existing.diagnosed?'diagnosed':'none';select.disabled=!fact.completed;
    select.onchange=()=>{const remaining=(fact.faults??[]).filter(f=>f.faultId!==faultId);fact.faults=select.value==='missing'?remaining:[...remaining,{faultId,diagnosed:['diagnosed','resolved'].includes(select.value),resolved:select.value==='resolved'}];showPreview();};label.append(select);row.append(label);
   }

  }
  for(const c of node.choices){p(preview,c.consequence);button(preview,c.label,()=>{const result=advanceCourseStory(snapshot!,currentNode,c.choiceId,facts);if(result.accepted){currentNode=result.node.nodeId;showPreview();}}).disabled=!c.enabled;}
 }
 function checkPaths(story:CourseStory){
  if(!validate())return;
  const descriptors=activities().map((a:Data)=>({activityId:a.activityId,moduleId:a.moduleId??'module',faultIds:courseStoryFaultContext(course).find(f=>f.activityId===a.activityId)?.faultIds,kind:(['multiple_choice','multi_select','ordered_step'].includes(a.type)?'assessment':['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(a.type)?'simulation':'content') as 'assessment'|'simulation'|'content',passScore:a.assessment?.passScore??course.simulation?.definition?.scoring?.passScore??0}));
  const report=previewCourseStory(story,descriptors,required(),course.policy?.maxAttempts??3);
  preview.replaceChildren();snapshot=undefined;
  if(!report.valid){p(preview,'Set valid activity score thresholds and an attempt limit from 1 to 100 before checking paths.');return;}
  p(preview,`${report.complete?'Representative analysis complete':'Partial analysis: work limit reached'}. ${report.scenariosChecked} of ${report.totalScenarios} result scenarios; ${report.statesChecked} node visits.`);
  p(preview,'Hypothetical completed results only. This does not prove attainable scores, retry eligibility or certification. Results appear only after their activity is reached.');
  p(preview,`${report.cases.filter(c=>c.status==='blocked').length} blocked paths; ${report.unreachedNodes.length} nodes and ${report.unreachedChoices.length} choices not reached in checked cases.`);
  for(const item of report.cases){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${item.status}: ${item.nodeIds.map(id=>story.nodes.find(n=>n.nodeId===id)?.title??id).join(' -> ')}`;details.append(summary);p(details,item.reason??'Terminal story outcome reached.');for(const fact of item.facts.filter(f=>f.completed))p(details,`${activities().find((a:Data)=>a.activityId===fact.activityId)?.title}: ${fact.passed?'passed':'failed'}, score ${fact.score}, attempts ${fact.attempts}${fact.faults?.map(f=>`, ${f.faultId}: ${f.resolved?'resolved':f.diagnosed?'diagnosed only':'not diagnosed'}`).join('')??''}`);preview.append(details);}
  for(const id of report.unreachedNodes)p(preview,'Node not reached: '+story.nodes.find(n=>n.nodeId===id)?.title);
  for(const pair of report.unreachedChoices){const node=story.nodes.find(n=>n.nodeId===pair.nodeId);p(preview,`Choice not reached: ${node?.title} / ${node?.choices.find(c=>c.choiceId===pair.choiceId)?.label}`);}
 }
 function draw(){
  root.replaceChildren();const legend=document.createElement('legend');legend.textContent='Course story editor';root.append(legend);
  p(root,'Review the mission, required activities and conditional paths before approving publication. Story outcomes do not replace certification requirements.');
  if(!course.story){
   button(root,'Create story from course activities',()=>{
    const all=activities();if(!all.length||all.some((a:Data)=>!a.activityId)){p(root,'Save a course with stable activity identifiers first.');return;}
    if(!window.confirm('Create a story that visits each current activity in order? Review its mission, choices and outcomes before publication.'))return;
    const nodes:StoryNode[]=all.map((a:Data,i:number)=>({nodeId:`node:${crypto.randomUUID()}`,title:a.title||`Activity ${i+1}`,purpose:a.instructions||'Complete this activity.',activityId:a.activityId,prerequisites:[],choices:[]}));
    nodes.push({nodeId:`node:${crypto.randomUUID()}`,title:'Mission outcome',purpose:'Review the mission outcome and certification requirements.',prerequisites:[],choices:[],outcome:{kind:'success',message:'You reached the end of this mission. Certification is evaluated separately.'}});
    for(let i=0;i<nodes.length-1;i++)nodes[i].choices.push({choiceId:`choice:${crypto.randomUUID()}`,label:'Continue',consequence:'Continue to the next part of the mission.',nextNodeId:nodes[i+1].nodeId,conditions:[]});
    course.story={schemaVersion:'course-story.v1',mission:'',startNodeId:nodes[0].nodeId,nodes};structure(()=>{});
   });return;
  }
  const story=course.story as CourseStory;
  if(!Array.isArray(story.nodes)||story.nodes.some(n=>!n||!Array.isArray(n.choices)||!Array.isArray(n.prerequisites)||n.prerequisites.some(c=>!c||typeof c!=='object')||n.choices.some(c=>!c||!Array.isArray(c.conditions)||c.conditions.some(rule=>!rule||typeof rule!=='object')))){p(root,'This imported story is malformed. Restore a valid draft before editing.');return;}
  validation=p(root,'');validation.dataset.storyValidation='true';validation.setAttribute('role','status');preview=document.createElement('div');preview.dataset.storyPreview='true';
  field(root,'Mission',story.mission,v=>story.mission=v,true);
  select(root,'Starting node',story.startNodeId,story.nodes.map(n=>[n.nodeId,n.title]),v=>story.startNodeId=v);
  for(const node of story.nodes){
   const box=document.createElement('fieldset'),legend=document.createElement('legend');box.dataset.storyNode=node.nodeId;legend.textContent=node.title||'Story node';box.append(legend);root.append(box);
   field(box,'Node title',node.title,v=>node.title=v);field(box,'Purpose',node.purpose,v=>node.purpose=v,true);
   select(box,'Course activity',node.activityId??'',[['','Narrative only'],...activities().map((a:Data):[string,string]=>[a.activityId,a.title])],v=>{if(v)node.activityId=v;else delete node.activityId;});
   conditions(box,node.prerequisites,'Node prerequisites',node.nodeId);
   select(box,'Terminal outcome',node.outcome?.kind??'',[['','Continue through choices'],['success','Success'],['retry','Retry guidance'],['ended','Ended']],v=>structure(()=>{if(v){if(node.choices.length&&!window.confirm('Replace this node choices with a terminal outcome?'))return;node.choices=[];node.outcome={kind:v as 'success'|'retry'|'ended',message:''};}else delete node.outcome;},node.nodeId));
   if(node.outcome)field(box,'Outcome message',node.outcome.message,v=>node.outcome!.message=v,true);
   for(const [index,c]of node.choices.entries()){
    const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent='Choice';group.append(title);box.append(group);
    field(group,'Choice label',c.label,v=>c.label=v);field(group,'Consequence',c.consequence,v=>c.consequence=v,true);
    select(group,'Destination',c.nextNodeId,story.nodes.map(n=>[n.nodeId,n.title]),v=>c.nextNodeId=v);
    conditions(group,c.conditions,'Choice conditions',node.nodeId);
    button(group,'Remove choice',()=>{if(window.confirm('Remove this choice? Check that every remaining path reaches an outcome.'))structure(()=>node.choices.splice(index,1),node.nodeId);});
   }
   button(box,'Add choice',()=>structure(()=>{delete node.outcome;node.choices.push({choiceId:`choice:${crypto.randomUUID()}`,label:'',consequence:'',nextNodeId:story.nodes.find(n=>n.nodeId!==node.nodeId)?.nodeId??node.nodeId,conditions:[]});},node.nodeId)).disabled=node.choices.length>=20;
   button(box,'Remove node',()=>{if(story.startNodeId===node.nodeId||story.nodes.some(n=>n.choices.some(c=>c.nextNodeId===node.nodeId))){validation.textContent='Change the starting node and incoming choices before removing this node.';return;}if(window.confirm('Remove this story node?'))structure(()=>story.nodes.splice(story.nodes.indexOf(node),1));});
  }
  button(root,'Add narrative node',()=>{const nodeId=`node:${crypto.randomUUID()}`;structure(()=>story.nodes.push({nodeId,title:'New story node',purpose:'',prerequisites:[],choices:[],outcome:{kind:'ended',message:''}}),nodeId);}).disabled=story.nodes.length>=200;
  button(root,'Remove story',()=>{if(window.confirm('Remove the story? Course activities and certification requirements will remain.'))structure(()=>delete course.story);});
  button(root,'Check story paths',()=>checkPaths(story));
  button(root,'Reset local story preview',()=>{if(!validate())return;snapshot=structuredClone(story);currentNode=snapshot.startNodeId;facts=activities().map((a:Data)=>({activityId:a.activityId,completed:false,passed:false,score:null,attempts:0}));showPreview();});root.append(preview);validate();
 }
 draw();
}
