import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const exercise = `
sessionStorage.setItem('mdt.auth.access-token','test');
sessionStorage.setItem('mdt.auth.organization-id','org:test');
let saved;const historyKeys=[];
let conflict=false;let delayComparison=false,releaseComparison,failComparison=false;
let delaySave=false;
let writes=0;
let generationRequest;
const creationKeys=[],revisionKeys=[];let published=false;
const version = {courseVersionId:'course:test',revision:1,status:'DRAFT',createdBy:'author',content:{schemaVersion:'course-draft.v1',title:'Original',model:{modelVersionId:'keep',manifestHash:'hash:test',manifest:{sourceHash:'hash:test',components:[{componentId:'panel'},{componentId:'cover',permittedTransforms:{rotationY:{min:0,max:2,step:1}}}]}},modules:[{title:'Module',activities:[{type:'text',text:'Read this',citations:[{page:1}]}]}]}};
const simulation={schemaVersion:'simulation-definition.v1',simulationDefinitionId:'sim:test',version:1,model:{modelVersionId:'keep',manifestHash:'hash:test',componentIds:['panel','cover']},components:[{componentId:'panel',initialState:'idle',allowedActions:['select_component']},{componentId:'cover',initialState:'closed',allowedActions:['open_component']}],initialState:{currentStepId:'identify',variables:{ready:false},componentStates:{panel:'idle',cover:'closed'}},steps:[{stepId:'identify',title:'Identify panel',action:{type:'select_component',componentId:'panel'},nextStepIds:['open'],points:2,triggerFaultId:'blocked'},{stepId:'open',title:'Open cover',action:{type:'open_component',componentId:'cover'},nextStepIds:[],points:3}],faults:[{faultId:'blocked',title:'Blocked line',triggerStepId:'identify',diagnosis:{type:'select_component',componentId:'cover'},resolution:{type:'open_component',componentId:'cover'},points:2,failureRule:'REJECT_AND_REMAIN'}],scoring:{maxScore:7,passScore:.8,stepPoints:{identify:2,open:3},faultPoints:{blocked:2},penalties:{}},completion:{requiredStepIds:['identify','open'],requiredFaultIds:['blocked'],terminalStepIds:['open']},equivalentPath:{mode:'TEXT_KEYBOARD',instructions:[{stepId:'identify',text:'Select panel'},{stepId:'open',text:'Open cover'}],faultInstructions:[{faultId:'blocked',text:'Select cover, then open'}]}};
const approvedModel=version.content.model;delete version.content.model;const bindingKeys=[],replacementKeys=[];let delayComponents=false,releaseComponents;
const simulationCreationKeys=[];
let learnerRequests=0;
window.fetch = async (_url, init={}) => {
 if(_url.includes('/history')){if(init.method==='POST'){historyKeys.push(new Headers(init.headers).get('idempotency-key'));const body=JSON.parse(init.body);check(body.confirmed&&body.reason==='Undo mistaken title'&&body.eventId==='history:one'&&body.side==='before','Invalid restore request');if(historyKeys.length===1)throw Error('Interrupted restoration');version.content.title='Restored course';version.revision++;return Response.json({revision:version.revision});}if(_url.includes('eventId='))return Response.json({revision:version.revision,status:'DRAFT',current:version.content,selected:{...version.content,title:'Restored course'}});return Response.json({items:[{eventId:'history:one',eventType:'COURSE_DRAFT_EDITED',actorId:'<img src=x>',createdAt:'2026-10-30',revision:1,nextRevision:2}]});}
 if(_url.startsWith('/api/v1/approved-media'))return Response.json(_url.includes('?')?{items:[{assetVersionId:'media:second',fileName:'Second image',type:'image',contentType:'image/png'},{assetVersionId:'media:video',fileName:'Procedure video',type:'video',contentType:'video/mp4'}]}:{items:[{assetVersionId:'media:first',fileName:'<img src=x> Diagram',type:'image',contentType:'image/png'}],nextCursor:'media:first'});
 if(_url.includes('model-sessions')||_url.includes('assessment-sessions')||_url.includes('/enrollments')){learnerRequests++;throw Error('Preview sent learner request');}
 if(_url.startsWith('/api/v1/approved-models?modelVersionId=')){if(delayComponents)await new Promise(resolve=>{releaseComponents=resolve;});return Response.json({components:[{componentId:'new-panel',displayName:'<img src=x> Panel'},{componentId:'new-cover',displayName:'Cover'},{componentId:'new-sensor',displayName:'Additional sensor'}]});}
 if(_url.startsWith('/api/v1/approved-models'))return new Response(JSON.stringify(_url.includes('?after=')?{items:[{modelVersionId:'keep',componentCount:2}]}:{items:[{modelVersionId:'<img src=x>',componentCount:1}],nextCursor:'next'}));
 if(_url.endsWith('/model-replacement')){replacementKeys.push(new Headers(init.headers).get('idempotency-key'));const body=JSON.parse(init.body);if(body.confirmed!==true||body.modelVersionId!=='keep')throw Error('Invalid replacement');check(JSON.stringify(body.componentMapping)===JSON.stringify([{from:'panel',to:'new-panel'},{from:'cover',to:'new-cover'}]),'Replacement mapping body incorrect');if(replacementKeys.length===1)throw Error('Interrupted replacement');version.revision++;return Response.json({revision:version.revision});}
 if(_url.endsWith('/model-binding')){bindingKeys.push(new Headers(init.headers).get('idempotency-key'));const body=JSON.parse(init.body);if(body.confirmed!==true||body.modelVersionId!=='keep')throw Error('Invalid model binding');if(bindingKeys.length===1)throw Error('Interrupted binding');version.content.model=approvedModel;version.revision++;return Response.json({revision:version.revision});}
 if(_url.endsWith('/simulation')){simulationCreationKeys.push(new Headers(init.headers).get('idempotency-key'));const body=JSON.parse(init.body);if(body.modelVersionId!=='keep'||body.confirmed!==true)throw Error('Invalid simulation creation request');if(simulationCreationKeys.length===1)throw Error('Interrupted creation');version.content.simulation={simulationDefinitionId:simulation.simulationDefinitionId,definition:simulation};version.revision++;return new Response(JSON.stringify({revision:version.revision}));}
 if(_url.startsWith('/api/')&&new Headers(init.headers).get('x-organization-id')!=='org:test')throw Error('Author request missing organization context');
 if(decodeURIComponent(_url).startsWith('/api/v1/knowledge-sources/source:test')) return new Response(JSON.stringify({fileName:'Manual.pdf',sourceHash:'a'.repeat(64),items:[{text:'<script>unsafe source</script> Prime before use.',citation:{assetVersionId:'source:test',page:2},heading:'Priming'}]}));
 if(_url==='/api/v1/knowledge-sources') return new Response(JSON.stringify({items:[{assetVersionId:'source:test',fileName:'Manual.pdf',state:'APPROVED',chunkCount:3}]}));
 if(_url.endsWith('/revise')){revisionKeys.push(init.headers.get('idempotency-key'));if(revisionKeys.length===1)throw Error('Revision response interrupted');published=false;version.courseVersionId='course:revision';version.status='DRAFT';version.content._lineage={sourceReleaseId:'release:test'};return new Response(JSON.stringify({courseVersionId:version.courseVersionId}));}
 if(_url.endsWith('/generate-draft')) {
  generationRequest=JSON.parse(init.body);
  version.content={...version.content,title:'Generated course'};version.revision++;
  return new Response(JSON.stringify({aiRunId:'ai:test',appliedToCourse:true,result:{status:'DRAFT',warnings:[{message:'Review required'},{code:'SOURCE_CONTEXT_PARTIAL',message:'Source source:test: 16 of 40 passages supplied. Review omitted passages before approving the draft.'}]}}));
 }
 if(_url==='/api/v1/courses' && init.method==='POST') {
  creationKeys.push(init.headers.get('idempotency-key'));
  if(creationKeys.length===1) throw Error('Connection interrupted after create');
  return new Response(JSON.stringify({courseVersionId:version.courseVersionId}));
 }
 if(_url==='/api/v1/courses') return new Response(JSON.stringify({items:[{courseVersionId:version.courseVersionId,title:version.content.title,status:'DRAFT',revision:version.revision}]}));
 if(init.method==='PUT') { writes++; saved=JSON.parse(init.body); if(conflict || saved.revision!==version.revision) return new Response('{}',{status:409}); if(delaySave) await new Promise(r=>setTimeout(r,100)); version.content=saved.content;version.revision++; return new Response(JSON.stringify({revision:version.revision})); }
 if(failComparison)throw Error('Comparison unavailable');
 if(delayComparison)await new Promise(resolve=>{releaseComparison=resolve;});
 return new Response(JSON.stringify({courseVersion:version,decisions:[],...(published?{release:{releaseId:"release:test",status:"PUBLISHED"}}:{})}));
};
await import('/job-status.js');
const wait=()=>new Promise(r=>setTimeout(r,40));
const q=s=>document.querySelector(s);
const check=(value,message)=>{if(!value)throw Error(message)};
try {
 check(q('#review-section').getClientRects().length>0&&!q('#sign-out').classList.contains('hidden'),'Signed-in author workspace is hidden');
 q('#course-create-title').value='Original';
 q('#course-create-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 check(q('#course-library-status').textContent.includes('Retry'),'Interrupted creation lacked retry guidance');
 q('#course-create-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();await wait();
 check(creationKeys.length===2 && creationKeys[0]===creationKeys[1],'Creation retry did not reuse its key');
 check(q('#draft-title').value==='Original','Created course did not open in editor');
 check(q('#course-library button').textContent.includes('Original'),'Course was not listed');
 const creationButton=label=>[...q('#draft-modules').querySelectorAll('button')].find(b=>b.textContent===label);
 creationButton('Load approved models').click();await wait();check(!q('#draft-modules img'),'Model label injected markup');creationButton('Load more approved models').click();await wait();
 const modelSelect=[...q('#draft-modules').querySelectorAll('label')].find(n=>n.firstChild.textContent==='Approved model').querySelector('select');modelSelect.value='keep';modelSelect.dispatchEvent(new Event('change'));
 window.confirm=()=>false;creationButton('Bind selected model').click();await wait();check(bindingKeys.length===0,'Cancelled binding submitted');
 window.confirm=()=>true;creationButton('Bind selected model').click();await wait();check(!q('#draft-fields').disabled,'Interrupted binding locked editor');creationButton('Bind selected model').click();await wait();await wait();
 check(bindingKeys.length===2&&bindingKeys[0]===bindingKeys[1],'Binding retry changed identity');check(!version.content.simulation&&version.content.modules.length===1,'Binding added a simulation/module');check(!!creationButton('Replace bound model'),'Bound model replacement missing');check(document.activeElement===q('#add-module'),'Binding did not restore useful focus');
 creationButton('Load approved models').click();await wait();creationButton('Load more approved models').click();await wait();const reboundSelect=[...q('#draft-modules').querySelectorAll('label')].find(n=>n.firstChild.textContent==='Approved model').querySelector('select');reboundSelect.value='keep';reboundSelect.dispatchEvent(new Event('change'));
 window.confirm=()=>false;creationButton('Create simulation from selected model').click();await wait();check(simulationCreationKeys.length===0,'Cancelled creation submitted');
 window.confirm=()=>true;creationButton('Create simulation from selected model').click();await wait();check(!q('#draft-fields').disabled,'Interrupted creation locked editor');creationButton('Create simulation from selected model').click();await wait();await wait();
 check(simulationCreationKeys.length===2&&simulationCreationKeys[0]===simulationCreationKeys[1],'Simulation retry identity changed');check(!!q('[data-simulation-editor]')&&!q('#draft-fields').disabled,'Created simulation did not open');check(q('[data-simulation-editor]').contains(document.activeElement),'Created simulation did not receive focus');
 q('#load-sources').click();await wait();
 check(q('#source-options').textContent.includes('Manual.pdf'),'Sources missing');
 q('#source-options button').click();await wait();
 check(q('#source-passages').textContent.includes('Page 2'),'Page citation missing');
 check(q('#source-passages').textContent.includes('Prime before use.'),'Source passage missing');
 check(!q('#source-passages script'),'Source text became executable markup');
 q('#source-options input').checked=true;
 q('#load-generation-media').click();await wait();check(!q('#generation-media-options').querySelector('img'),'Generation media filename was executable');
 q('#generation-media-options input').checked=true;q('#more-generation-media').click();await wait();
 check(q('#generation-media-options').querySelectorAll('input').length===3,'Generation media paging failed');
 q('#generate-course-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();await wait();
 check(generationRequest.sourceArtifactIds[0]==='source:test','Source selection not sent');check(generationRequest.mediaAssetVersionIds[0]==='media:first','Generation media selection missing');
 check(q('#draft-title').value==='Generated course','Generated content not opened');
 check(q('#generation-status').textContent.includes('Review required'),'Generation warnings missing');check(q('#generation-status').textContent.includes('16 of 40 passages'),'Partial source coverage not shown to author');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['test',null,'org:test'])));
 const hash=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 sessionStorage.setItem('mdt.draft.'+hash+'.course:test',JSON.stringify({revision:version.revision,content:{...version.content,title:'Recovered from refresh'}}));
 q('#course-version-id').value='course:test';
 q('#review-load-form').dispatchEvent(new Event('submit',{cancelable:true})); await wait();
 check(q('#draft-title').value==='Recovered from refresh','Recovery snapshot was not restored');
 q('#draft-title').value='Edited';q('#draft-title').dispatchEvent(new Event('input'));
 check(q('#publish-course').disabled,'Unsaved publication was enabled');
 q('#add-module').click();
 for(const label of ['Add single-choice assessment','Add multiple-answer assessment','Add ordered-steps assessment']) [...q('#draft-modules').querySelectorAll('button')].find(button=>button.textContent===label).click();
 [...q('#draft-modules').querySelectorAll('button')].find(button=>button.textContent==='Configure certification requirements').click();
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();await wait();
 check(saved.content.title==='Edited','Title not saved');
 check(saved.content.modules.length===2,'Module not added');
 check(saved.content.model.modelVersionId==='keep','Model binding lost');
 check(saved.content.modules[0].activities[0].citations[0].page===1,'Citation lost');
 const assessments=saved.content.modules[0].activities.filter(activity=>activity.assessment);
 check(assessments.length===3,'Assessment authoring types missing');
 check(saved.content.policy.schemaVersion==='certification-policy.v1'&&saved.content.policy.requiredActivityIds.length===3,'Certification requirements not saved');
 check(assessments.every(activity=>activity.assessment.questions[0].citations[0].assetVersionId==='source:test'),'Assessment source selection lost');
 check(q('#decision-target').querySelectorAll('option[value="ASSESSMENT"]').length===3,'Saved assessments missing review targets');
 const findButton=(label,root=q('#draft-modules'))=>[...root.querySelectorAll('button')].find(node=>node.textContent===label);
 let confirmRemoval=false;window.confirm=()=>confirmRemoval;
 const questionNodes=()=>[...q('#draft-modules').querySelectorAll('[data-question-id]')];
 const firstQuestionId=questionNodes()[0].dataset.questionId;
 check(findButton('Remove question',questionNodes()[0]).disabled,'Only question can be removed');
 for(const label of ['Add single-choice question','Add multiple-answer question','Add ordered-steps question'])findButton(label).click();
 check(questionNodes().length===6,'Multiple question types not added');
 const extraSingleId=questionNodes()[1].dataset.questionId,orderedId=questionNodes()[3].dataset.questionId;
 const question=id=>questionNodes().find(node=>node.dataset.questionId===id);
 const editQuestion=(id,label,value)=>{const field=[...question(id).querySelectorAll('label')].find(n=>n.firstChild.textContent===label).querySelector('input,textarea');field.value=value;field.dispatchEvent(new Event('input'));};
 editQuestion(orderedId,'Option 1','Step A');editQuestion(orderedId,'Option 2','Step B');findButton('Add answer option',question(orderedId)).click();editQuestion(orderedId,'Option 3','Step C');
 findButton('Move step 3 up',question(orderedId)).click();findButton('Move step 1 down',question(orderedId)).click();
 findButton('Move question up',question(orderedId)).click();check(questionNodes()[2].dataset.questionId===orderedId,'Question move up failed');check(document.activeElement.closest('[data-question-id]')?.dataset.questionId===orderedId,'Question movement lost keyboard focus');findButton('Move question down',question(orderedId)).click();
 findButton('Remove question',question(extraSingleId)).click();check(!!question(extraSingleId),'Cancelled question deletion applied');confirmRemoval=true;findButton('Remove question',question(extraSingleId)).click();check(!question(extraSingleId),'Question deletion failed');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 let savedQuestions=saved.content.modules[0].activities.find(a=>a.assessment).assessment.questions;
 check(savedQuestions.length===3&&savedQuestions[0].questionId===firstQuestionId,'Question identity/order not persisted');
 let ordered=savedQuestions.find(x=>x.questionId===orderedId);check(ordered.options.map(x=>x.text).join(',')==='Step C,Step A,Step B'&&ordered.correctOptionIds.join(',')===ordered.options.map(x=>x.optionId).join(','),'Ordered-step sequence lost');check(ordered.citations[0].assetVersionId==='source:test','New question citations lost');
 findButton('Remove option 1',question(orderedId)).click();q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 ordered=saved.content.modules[0].activities.find(a=>a.assessment).assessment.questions.find(x=>x.questionId===orderedId);check(ordered.options.length===2&&ordered.correctOptionIds.length===2&&!ordered.options.some(x=>x.text==='Step C'),'Option deletion retained answer reference');check(findButton('Remove option 1',question(orderedId)).disabled,'Minimum options not protected');
 // A valid imported assessment can store its correct sequence independently of option delivery order.
 const imported=version.content.modules[0].activities.find(a=>a.assessment).assessment.questions.find(x=>x.questionId===orderedId);imported.correctOptionIds=[...imported.correctOptionIds].reverse();const expectedFirst=imported.options.find(x=>x.optionId===imported.correctOptionIds[0]).text;
 q('#review-load-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 check([...question(orderedId).querySelectorAll('label')].find(n=>n.firstChild.textContent==='Option 1').querySelector('input').value===expectedFirst,'Imported correct order displayed incorrectly');
 editQuestion(orderedId,'Question','Follow the reviewed sequence');q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 check(saved.content.modules[0].activities.find(a=>a.assessment).assessment.questions.find(x=>x.questionId===orderedId).correctOptionIds.join(',')===imported.correctOptionIds.join(','),'Unrelated edit changed imported answer sequence');


 for(const questionData of saved.content.modules[0].activities.find(a=>a.assessment).assessment.questions){
  editQuestion(questionData.questionId,'Question','Reviewed prompt');editQuestion(questionData.questionId,'Answer rationale for reviewers','Source explains the correct result');editQuestion(questionData.questionId,'Competencies (comma separated)','procedure:one');
  if(questionData.type!=='ordered_step'){const correct=question(questionData.questionId).querySelector('input[type=checkbox]');if(!correct.checked)correct.click();}
 }
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 const {validateAssessmentDefinition,scoreAssessment}=await import('/assessment-validation.js');const authored=saved.content.modules[0].activities.find(a=>a.assessment).assessment;
 check(validateAssessmentDefinition(authored).valid,'No-code multi-question assessment failed schema validation');check(scoreAssessment(authored,authored.questions.map(x=>({questionId:x.questionId,selectedOptionIds:x.correctOptionIds}))).passed,'Authored correct answers did not pass server scoring');

 const simulationRoot=()=>q('[data-simulation-editor]');const simulationStatus=()=>q('[data-simulation-preview]').textContent;
 const simEdit=(host,label,value)=>{const control=[...host.querySelectorAll('label')].find(n=>n.firstChild.textContent===label).querySelector('input,textarea,select');control.value=value;control.dispatchEvent(new Event(control.tagName==='SELECT'?'change':'input'));};
 check(simulationRoot()&&q('[data-simulation-validation]').textContent.includes('structure is valid'),'Bound simulation editor unavailable');
 const graphRoot=()=>q('[data-simulation-graph]');
 check(graphRoot().querySelectorAll('[data-graph-step]').length===2&&graphRoot().querySelectorAll('[data-graph-edge]').length===1,'Graph does not match procedure');
 const graphNode=graphRoot().querySelector('[data-graph-step="open"]');graphNode.focus();graphNode.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(q('[data-step-id="open"]').contains(document.activeElement),'Graph keyboard navigation did not focus step editor');
 simEdit(graphRoot(),'Transition from','open');simEdit(graphRoot(),'Transition to','identify');findButton('Add transition',graphRoot()).click();check(graphRoot().textContent.includes('would create a cycle'),'Graph allowed a cycle');check(graphRoot().querySelectorAll('[data-graph-edge]').length===1,'Rejected edge mutated graph');
 simEdit(graphRoot(),'Transition from','identify');simEdit(graphRoot(),'Transition to','open');findButton('Add transition',graphRoot()).click();check(graphRoot().textContent.includes('already exists'),'Duplicate edge not explained');
 confirmRemoval=false;findButton('Remove transition',graphRoot()).click();check(graphRoot().querySelectorAll('[data-graph-edge]').length===1,'Cancelled transition removal applied');confirmRemoval=true;findButton('Remove transition',graphRoot()).click();check(graphRoot().querySelectorAll('[data-graph-edge]').length===0&&q('[data-simulation-validation]').textContent.includes('cannot be reached'),'Transition removal did not update reachability');
 findButton('Add transition',graphRoot()).click();check(graphRoot().querySelectorAll('[data-graph-edge]').length===1&&q('[data-simulation-validation]').textContent.includes('structure is valid'),'Graph reconnection did not restore valid procedure');
 const firstStep=()=>q('[data-step-id="identify"]');simEdit(firstStep(),'Step title','<img src=x> Identify panel');simEdit(firstStep(),'Step points','3');simEdit(simulationRoot(),'Maximum score','8');simEdit(firstStep(),'Equivalent keyboard instructions','Use keyboard to select the panel');simEdit(firstStep(),'Hints (one per line)','Locate the panel');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.simulation.definition.steps[0].points===3&&saved.content.simulation.definition.scoring.stepPoints.identify===3,'Step score edits diverged');check(saved.content.simulation.definition.equivalentPath.instructions[0].text==='Use keyboard to select the panel','Equivalent instructions not saved');check(saved.content.simulation.definition.model.modelVersionId==='keep','Simulation binding changed');
 const previewClick=label=>findButton(label,simulationRoot()).click();previewClick('Reset local simulation preview');previewClick('Try step: Open cover');check(simulationStatus().includes('Rejected'),'Out-of-order preview accepted');previewClick('Try step: <img src=x> Identify panel');check(simulationStatus().includes('Fault: blocked'),'Fault not triggered');previewClick('Try resolution: Blocked line');check(simulationStatus().includes('Rejected'),'Undiagnosed fault resolved');previewClick('Try diagnosis: Blocked line');previewClick('Try resolution: Blocked line');previewClick('Try step: Open cover');check(simulationStatus().includes('Completed and passed')&&simulationStatus().includes('Score 8 of 8'),'Deterministic preview did not pass');check(!simulationRoot().querySelector('img')&&learnerRequests===0,'Preview injected content or sent learner evidence');
 simEdit(q('[data-fault-id="blocked"]'),'Fault failure rule','INVALIDATE_SESSION');previewClick('Reset local simulation preview');previewClick('Try step: <img src=x> Identify panel');previewClick('Try resolution: Blocked line');check(simulationStatus().includes('Attempt invalidated'),'Terminal fault rule did not end local preview');previewClick('Try diagnosis: Blocked line');check(simulationStatus().includes('SESSION_INVALIDATED'),'Invalidated preview accepted further actions');simEdit(q('[data-fault-id="blocked"]'),'Fault failure rule','REJECT_AND_REMAIN');
 simEdit(q('[data-step-id="open"]'),'Required rotation Y (radians, optional)','0.4');previewClick('Reset local simulation preview');check(simulationStatus().includes('blocked')&&q('[data-simulation-validation]').textContent.includes('snapped value'),'Noncanonical model transform was executable');
 simEdit(q('[data-step-id="open"]'),'Required rotation Y (radians, optional)','10');findButton('Check scenario paths',simulationRoot()).click();check(q('[data-simulation-paths]').textContent.includes('blocked'),'Out-of-range model transform passed path analysis');
 simEdit(q('[data-step-id="open"]'),'Required rotation Y (radians, optional)','');
 simEdit(firstStep(),'Equivalent keyboard instructions','');previewClick('Reset local simulation preview');check(simulationStatus().includes('blocked')&&q('[data-simulation-validation]').textContent.includes('equivalent'),'Missing equivalent path did not block preview');simEdit(firstStep(),'Equivalent keyboard instructions','Use keyboard to select the panel');
 simEdit(q('[data-step-id="open"]'),'Next step','identify');previewClick('Reset local simulation preview');check(simulationStatus().includes('blocked')&&q('[data-simulation-validation]').textContent.includes('cycles'),'Cyclic procedure was executable');simEdit(q('[data-step-id="open"]'),'Next step','');
 simEdit(q('[data-fault-id="blocked"]'),'Fault title','Reviewed blocked line');simEdit(q('[data-fault-id="blocked"]'),'Fault points','3');simEdit(q('[data-fault-id="blocked"]'),'Equivalent fault instructions','Diagnose the cover, then open it');simEdit(simulationRoot(),'Maximum score','9');
 simEdit(firstStep(),'Step title','Renamed step');check(simulationStatus().includes('Draft changed'),'Edited draft retained preview state');previewClick('Reset local simulation preview');check(simulationStatus().includes('reset'),'Preview reset failed');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 // Structural authoring must preserve links, identities and completion while requiring real instructions.
 findButton('Insert step after this step',q('[data-step-id="open"]')).click();
 const addedStep=[...simulationRoot().querySelectorAll('[data-step-id]')].find(el=>!['identify','open'].includes(el.dataset.stepId));const addedStepId=addedStep.dataset.stepId;
 check(addedStep.contains(document.activeElement),'Inserted step did not receive focus');previewClick('Reset local simulation preview');check(simulationStatus().includes('blocked'),'New step with blank instructions was executable');
 simEdit(addedStep,'Step title','Final inspection');simEdit(addedStep,'Equivalent keyboard instructions','Select the panel to inspect it');
 findButton('Add fault at this step',addedStep).click();const addedFault=[...simulationRoot().querySelectorAll('[data-fault-id]')].find(el=>el.dataset.faultId!=='blocked');const addedFaultId=addedFault.dataset.faultId;
 check(addedFault.contains(document.activeElement),'New fault did not receive focus');previewClick('Reset local simulation preview');check(simulationStatus().includes('blocked'),'Blank fault instructions were executable');
 simEdit(addedFault,'Fault title','Inspection fault');simEdit(addedFault,'Equivalent fault instructions','Select the panel to diagnose, then select it again to resolve');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 const structural=saved.content.simulation.definition;
 check(structural.steps.find(x=>x.stepId==='open').nextStepIds[0]===addedStepId&&structural.completion.terminalStepIds.includes(addedStepId),'Inserted terminal links incorrect');check(structural.completion.requiredFaultIds.includes(addedFaultId)&&structural.steps.find(x=>x.stepId===addedStepId).triggerFaultId===addedFaultId,'New fault not wired');
 previewClick('Reset local simulation preview');for(const label of ['Try step: Renamed step','Try diagnosis: Reviewed blocked line','Try resolution: Reviewed blocked line','Try step: Open cover','Try step: Final inspection','Try diagnosis: Inspection fault','Try resolution: Inspection fault'])previewClick(label);check(simulationStatus().includes('Completed and passed'),'Authored procedure/fault did not complete');
 const newStep=()=>[...simulationRoot().querySelectorAll('[data-step-id]')].find(el=>el.dataset.stepId===addedStepId);
 findButton('Remove procedure step',newStep()).click();check(!!newStep()&&q('[data-simulation-validation]').textContent.includes('attached faults'),'Attached fault did not block step removal');
 confirmRemoval=false;findButton('Remove fault',addedFault).click();check(addedFault.isConnected,'Cancelled fault removal applied');confirmRemoval=true;findButton('Remove fault',addedFault).click();
 // Use no-code variable conditions to turn the inserted step into an alternate terminal path.
 const toggle=(host,label)=>{const wrapper=[...host.querySelectorAll('label')].find(n=>n.textContent===label);check(!!wrapper,'Missing checkbox '+label);wrapper.querySelector('input').click();};
 simEdit(simulationRoot(),'New variable name','branchFlag');findButton('Add scenario variable',simulationRoot()).click();
 toggle(q('[data-step-id="open"]'),'Require variable: branchFlag');toggle(q('[data-step-id="open"]'),'Required value: branchFlag');toggle(newStep(),'Require variable: branchFlag');
 toggle(q('[data-step-id="open"]'),'Required on every successful path');toggle(newStep(),'Required on every successful path');
 simEdit(q('[data-step-id="open"]'),'Next step','');toggle(firstStep(),'Branch destination: Final inspection');
 toggle(q('[data-fault-id="blocked"]'),'Set variable: branchFlag');toggle(q('[data-fault-id="blocked"]'),'Assigned value: branchFlag');
 previewClick('Reset local simulation preview');for(const label of ['Try step: Renamed step','Try diagnosis: Reviewed blocked line','Try resolution: Reviewed blocked line'])previewClick(label);check(simulationStatus().includes('Current step: open'),'True branch did not select open');previewClick('Try step: Open cover');check(simulationStatus().includes('Completed and passed'),'True branch did not complete');
 toggle(q('[data-fault-id="blocked"]'),'Assigned value: branchFlag');previewClick('Reset local simulation preview');for(const label of ['Try step: Renamed step','Try diagnosis: Reviewed blocked line','Try resolution: Reviewed blocked line'])previewClick(label);check(simulationStatus().includes('Current step: '+addedStepId),'False branch did not select alternate');previewClick('Try step: Final inspection');check(simulationStatus().includes('Completed below threshold'),'Alternate branch score was not preserved');
 findButton('Check scenario paths',simulationRoot()).click();check(q('[data-simulation-paths]').textContent.includes('Complete equality-case check')&&q('[data-simulation-paths]').textContent.includes('BELOW THRESHOLD'),'Path report omitted below-threshold outcome');check(q('[data-simulation-paths]').textContent.includes('Not reached in checked cases'),'Effect-forced branch coverage was not reported');check(learnerRequests===0&&!q('[data-simulation-paths] img'),'Path analysis issued learner requests or rendered markup');
 toggle(q('[data-fault-id="blocked"]'),'Assigned value: branchFlag');check(q('[data-simulation-paths]').textContent.includes('Run scenario-path checks again'),'Edited draft retained stale path report');findButton('Check scenario paths',simulationRoot()).click();check(q('[data-simulation-paths]').textContent.includes('PASSED'),'Updated path report did not reflect changed effect');toggle(q('[data-fault-id="blocked"]'),'Assigned value: branchFlag');
 findButton('Remove variable: branchFlag',simulationRoot()).click();check(simulationRoot().textContent.includes('Remove this variable from preconditions'),'Referenced variable removal was accepted');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.simulation.definition.steps[0].nextStepIds.length===2&&saved.content.simulation.definition.faults[0].setVariables.branchFlag===false,'Branch authoring was not persisted');
 window.__graphSnapshot=graphRoot().cloneNode(true);[...graphRoot().querySelectorAll('select')].forEach((select,i)=>window.__graphSnapshot.querySelectorAll('select')[i].selectedIndex=select.selectedIndex);
 // Restore the linear route before testing structural removal.
 simEdit(firstStep(),'Next step','open');toggle(q('[data-step-id="open"]'),'Require variable: branchFlag');toggle(newStep(),'Require variable: branchFlag');toggle(q('[data-fault-id="blocked"]'),'Set variable: branchFlag');findButton('Remove variable: branchFlag',simulationRoot()).click();
 simEdit(q('[data-step-id="open"]'),'Next step',addedStepId);
 confirmRemoval=false;findButton('Remove procedure step',newStep()).click();check(!!newStep(),'Cancelled step removal applied');confirmRemoval=true;findButton('Remove procedure step',newStep()).click();check(!newStep(),'Step removal failed');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();const cleaned=saved.content.simulation.definition;
 check(!JSON.stringify(cleaned).includes(addedStepId)&&!JSON.stringify(cleaned).includes(addedFaultId),'Removed structural IDs retained');check(cleaned.completion.terminalStepIds.includes('open')&&cleaned.steps.find(x=>x.stepId==='open').nextStepIds.length===0,'Terminal predecessor not restored');check(cleaned.model.modelVersionId==='keep'&&cleaned.simulationDefinitionId==='sim:test'&&learnerRequests===0,'Structural editing changed identity or sent learner evidence');
 delaySave=true;
 q('#draft-title').value='Saving edit';q('#draft-title').dispatchEvent(new Event('input'));
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));
 q('#draft-title').value='Newer edit';q('#draft-title').dispatchEvent(new Event('input'));
 await new Promise(r=>setTimeout(r,1500));
 check(saved.content.title==='Newer edit','Autosave lost edits typed during a pending save');check(saved.content.simulation.definition.faults[0].title==='Reviewed blocked line'&&saved.content.simulation.definition.scoring.faultPoints.blocked===3,'Fault edits not persisted');
 check(q('#draft-title').value==='Newer edit','Save response replaced newer input');
 delaySave=false;
 published=true;version.status='PUBLISHED';q('#review-load-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(!q('#revise-course').hidden,'Revision control missing');q('#revision-reason').value='Updated safety procedure';q('#revise-course').click();await wait();check(document.body.textContent.includes('Revision response interrupted'),'Revision error missing');q('#revise-course').click();await wait();await wait();check(revisionKeys.length===2&&revisionKeys[0]===revisionKeys[1],'Revision retry changed key');check(q('#course-version-id').value==='course:revision'&&!q('#draft-fields').disabled,'Successor draft did not open');
 q('[data-change-class="simulation"]').click();
 const decision=q('[data-requalification]');decision.value='full_retake';decision.dispatchEvent(new Event('change'));
 for(const [key,value] of [['releaseNotes','Updated procedure'],['rationale','Safety steps changed'],['learnerMessage','Complete updated training']]){const field=q('[data-release-change="'+key+'"]');field.value=value;field.dispatchEvent(new Event('input'));}
 const effective=q('[data-release-change="effectiveAt"]');effective.value='2026-11-01T09:00';effective.dispatchEvent(new Event('input'));
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 check(saved.content.releaseChange.decision==='full_retake'&&saved.content.releaseChange.classes.includes('simulation'),'Impact choices not saved');check(saved.content.releaseChange.learnerMessage==='Complete updated training','Learner message lost');
 const storyRoot=()=>q('[data-story-editor]'),storyPreview=()=>q('[data-story-preview]');
 const storyButton=(label,host=storyRoot())=>findButton(label,host);
 const storyField=(label,host=storyRoot())=>[...host.querySelectorAll('label')].find(l=>l.firstChild?.textContent===label)?.querySelector('input,textarea,select');
 window.confirm=()=>false;storyButton('Create story from course activities').click();check(!storyField('Mission'),'Cancelled story creation applied');
 window.confirm=()=>true;storyButton('Create story from course activities').click();check(storyField('Mission'),'Story was not created');
 const mission=storyField('Mission');mission.value='Restore <img src=x> the controller';mission.dispatchEvent(new Event('input'));check(!storyRoot().querySelector('img'),'Story HTML executed');
 check(q('[data-story-validation]').textContent==='Story structure is valid.','Starter story did not validate: '+q('[data-story-validation]').textContent);
 storyButton('Check story paths').click();check(storyPreview().textContent.includes('result scenarios')&&storyPreview().textContent.includes('Hypothetical completed results'),'Story path report missing');check(storyPreview().querySelector('details'),'Path examples missing');
 storyButton('Reset local story preview').click();check(storyPreview().querySelector('details'),'Missing local story facts');
 const nodesBefore=[...storyRoot().querySelectorAll('[data-story-node]')];
 const firstStoryNode=nodesBefore[0];storyButton('Remove node',firstStoryNode).click();check(q('[data-story-validation]').textContent.includes('incoming choices'),'Starting node deletion was not blocked');
 const destination=storyField('Destination',firstStoryNode),originalDestination=destination.value;
 destination.value=firstStoryNode.dataset.storyNode;destination.dispatchEvent(new Event('change'));check(q('[data-story-validation]').textContent.includes('loops'),'Story cycle was not rejected');check(storyPreview().textContent.includes('Draft changed'),'Editing retained stale preview');
 destination.value=originalDestination;destination.dispatchEvent(new Event('change'));
 storyButton('Reset local story preview').click();
 for(let i=0;i<storyPreview().querySelectorAll('details select').length;i++){const select=storyPreview().querySelectorAll('details select')[i];select.value='passed';select.dispatchEvent(new Event('change'));}
 for(let i=0;i<nodesBefore.length-1;i++){const next=storyButton('Continue',storyPreview());check(!next.disabled,'Completed local activity did not unlock choice');next.click();}
 check(storyPreview().textContent.includes('No learner evidence is recorded'),'Local story did not reach terminal outcome');
 storyButton('Add narrative node').click();check(document.activeElement.closest('[data-story-node]'),'Added narrative node did not receive focus');check(q('[data-story-validation]').textContent.includes('purpose')||q('[data-story-validation]').textContent.includes('Nodes need'),'Incomplete node was accepted');
 const newNode=[...storyRoot().querySelectorAll('[data-story-node]')].at(-1);window.confirm=()=>false;storyButton('Remove node',newNode).click();check(storyRoot().contains(newNode),'Cancelled node removal applied');window.confirm=()=>true;storyButton('Remove node',newNode).click();
 check(q('[data-story-validation]').textContent==='Story structure is valid.','Node removal damaged original story');
 const choiceGroup=storyRoot().querySelector('[data-story-node] fieldset');storyButton('Add condition',choiceGroup).click();
 const conditionActivity=storyField('Condition activity');check(conditionActivity,'Condition control missing');
 const fact=storyField('Recorded fact');fact.value='score';fact.dispatchEvent(new Event('change'));const minimum=storyField('Minimum');minimum.value='2';minimum.dispatchEvent(new Event('input'));check(q('[data-story-validation]').textContent.includes('normalized score'),'Out-of-range story condition accepted');
 storyButton('Remove condition').click();
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.story.mission.includes('Restore'),'Story edits not saved');check(saved.content.story.nodes.length===nodesBefore.length,'Story structure lost during save');
 // Activity structure controls retain stable references and keyboard focus.
 const originalActivityIds=saved.content.modules[0].activities.map(a=>a.activityId);
 findButton('Add text activity').click();
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 const removable=saved.content.modules[0].activities.at(-1).activityId;
 const activityControl=(id,prefix)=>[...q('[data-module-index="0"]').querySelectorAll('[data-activity-control]')].find(b=>b.dataset.activityControl===id&&b.textContent.startsWith(prefix));
 const total=originalActivityIds.length+1;
 check(activityControl(removable,'Move activity '+total+' down').disabled,'Last activity can move beyond end');
 activityControl(removable,'Move activity '+total+' up').click();check(document.activeElement.dataset.activityControl===removable,'Activity move lost keyboard focus');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.modules[0].activities.at(-2).activityId===removable,'Activity reorder not persisted');
 activityControl(removable,'Move activity '+(total-1)+' down').click();
 window.confirm=()=>false;activityControl(removable,'Remove activity').click();check(!!activityControl(removable,'Remove activity'),'Cancelled activity removal applied');
 window.confirm=()=>true;activityControl(removable,'Remove activity').click();check(!activityControl(removable,'Remove activity'),'Unreferenced activity removal failed');check(document.activeElement.closest('[data-module-index="0"]'),'Activity removal lost focus');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(JSON.stringify(saved.content.modules[0].activities.map(a=>a.activityId))===JSON.stringify(originalActivityIds),'Activity removal damaged original ordering');
 const protectedId=saved.content.policy.requiredActivityIds[0];activityControl(protectedId,'Remove activity').click();check(q('#draft-message').textContent.includes('certification requirements'),'Required activity removal was not explained');check(!!activityControl(protectedId,'Remove activity'),'Required activity was deleted');
 const storyOnly=saved.content.modules[0].activities.find(a=>a.activityId&&!saved.content.policy.requiredActivityIds.includes(a.activityId)&&!['simulation','simulation_outcome','fault_troubleshooting'].includes(a.type));
 check(storyOnly,'Fixture must include a story-only activity');activityControl(storyOnly.activityId,'Remove activity').click();check(q('#draft-message').textContent.includes('story references'),'Story activity removal not guarded');
 const addMediaPicker=()=>[...q('[data-module-index="0"]').querySelectorAll('[data-media-picker]')].find(n=>n.querySelector('legend').textContent==='Add image or video activity');
 const loadMedia=async picker=>{findButton('Load approved media',picker).click();await wait();check(!picker.querySelector('img'),'Media filename injected markup');findButton('Load more approved media',picker).click();await wait();};
 const chooseMedia=(picker,id)=>{const select=picker.querySelector('select');select.value=id;select.dispatchEvent(new Event('change'));};
 const mediaField=label=>[...q('[data-module-index="0"]').querySelectorAll('label')].find(n=>n.firstChild.textContent===label).querySelector('textarea');
 let picker=addMediaPicker();await loadMedia(picker);chooseMedia(picker,'media:first');findButton('Add selected media',picker).click();check(document.activeElement.dataset.activityControl,'Added media lost focus');
 mediaField('Image description').value='Cover layout';mediaField('Image description').dispatchEvent(new Event('input'));
 picker=q('[data-media-picker]');await loadMedia(picker);check(![...picker.querySelectorAll('option')].some(o=>o.value==='media:video'),'Replacement offered wrong media type');chooseMedia(picker,'media:second');
 window.confirm=()=>false;findButton('Replace selected media',picker).click();q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.modules[0].activities.at(-1).media.assetVersionId==='media:first','Cancelled replacement applied');
 window.confirm=()=>true;findButton('Replace selected media',picker).click();
 picker=addMediaPicker();await loadMedia(picker);chooseMedia(picker,'media:video');findButton('Add selected media',picker).click();mediaField('Video transcript').value='Identify and open the cover.';mediaField('Video transcript').dispatchEvent(new Event('input'));
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();const mediaSaved=saved.content.modules[0].activities.slice(-2);check(mediaSaved[0].media.assetVersionId==='media:second'&&mediaSaved[0].media.altText==='Cover layout','Image replacement/description not saved');check(mediaSaved[1].type==='video'&&mediaSaved[1].media.transcript.includes('Identify'),'Video transcript not saved');
 version.content.modules[0].activities.push({activityId:'interactive:test',type:'simulation',simulationDefinitionId:simulation.simulationDefinitionId,title:'Interactive procedure'});
 q('#review-load-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 for(const type of ['guided_procedure','manipulation','assembly']){
  const select=[...q('#draft-modules').querySelectorAll('label')].find(n=>n.firstChild.textContent==='Interactive activity type').querySelector('select');select.value=type;select.dispatchEvent(new Event('change'));
  q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();const activity=saved.content.modules[0].activities.find(a=>a.activityId==='interactive:test');check(activity.type===type&&activity.simulationDefinitionId===simulation.simulationDefinitionId,'Interactive type/binding not saved');
 }
 findButton('Add model viewer activity').click();let exploration=[...document.querySelectorAll('[data-exploration-editor]')].at(-1);
 const editExploration=(root,label,value)=>{const input=[...root.querySelectorAll('label')].find(n=>n.firstChild.textContent===label).querySelector('input,textarea');input.value=value;input.dispatchEvent(new Event('input'));};
 editExploration(exploration,'Model overview','Inspect the controller');check(exploration.textContent.includes('Inspection content is valid.'),'Viewer overview invalid');
 findButton('Add component hotspot activity').click();exploration=[...document.querySelectorAll('[data-exploration-editor]')].at(-1);editExploration(exploration,'Model overview','Review the panel');findButton('Add component hotspot',exploration).click();check(document.activeElement.tagName==='SELECT','New hotspot lost keyboard focus');
 let component=exploration.querySelector('select');component.value='panel';component.dispatchEvent(new Event('change'));editExploration(exploration,'Hotspot title','Panel');editExploration(exploration,'Hotspot explanation','Read the panel indicators');check(exploration.textContent.includes('Inspection content is valid.'),'Hotspot did not validate');
 findButton('Add component hotspot',exploration).click();const duplicate=exploration.querySelector('[data-hotspot-index="1"]');component=duplicate.querySelector('select');component.value='panel';component.dispatchEvent(new Event('change'));editExploration(duplicate,'Hotspot title','Duplicate');editExploration(duplicate,'Hotspot explanation','Duplicate');check(exploration.textContent.includes('Choose each hotspot component once'),'Duplicate hotspot accepted');
 window.confirm=()=>false;findButton('Remove hotspot',duplicate).click();check(exploration.querySelectorAll('[data-hotspot-index]').length===2,'Cancelled hotspot removal applied');window.confirm=()=>true;findButton('Remove hotspot',duplicate).click();check(exploration.textContent.includes('Inspection content is valid.'),'Removal did not restore valid hotspots');
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();const inspections=saved.content.modules[0].activities.slice(-2);check(inspections[0].type==='3d_viewer'&&inspections[1].type==='hotspot'&&inspections[1].exploration.hotspots[0].componentId==='panel','Inspection content not saved');
 const beforeReplacement=JSON.stringify(version.content);
 creationButton('Load approved models').click();await wait();creationButton('Load more approved models').click();await wait();const replaceSelect=[...q('#draft-modules').querySelectorAll('label')].find(n=>n.firstChild.textContent==='Approved model').querySelector('select');replaceSelect.value='keep';replaceSelect.dispatchEvent(new Event('change'));
 delayComponents=true;creationButton('Load replacement components').click();await wait();replaceSelect.value='';replaceSelect.dispatchEvent(new Event('change'));delayComponents=false;releaseComponents();await wait();check(q('[data-model-mapping]').querySelectorAll('select').length===0,'Late component response restored cleared mapping');replaceSelect.value='keep';replaceSelect.dispatchEvent(new Event('change'));
 creationButton('Load replacement components').click();await wait();const mappingSelects=[...q('[data-model-mapping]').querySelectorAll('select')];check(q('[data-model-mapping]').textContent.includes('1 or more additional components'),'Additional component disclosure missing');check(mappingSelects.length===2&&mappingSelects[0].options.length===5&&!q('[data-model-mapping] img'),'Mapping rows missing or labels executed markup');check(document.activeElement===mappingSelects[0],'Mapping load did not focus first component');
 window.confirm=()=>true;creationButton('Replace bound model').click();await wait();check(!replacementKeys.length,'Incomplete mapping submitted');
 for(const select of mappingSelects){select.value='new-panel';select.dispatchEvent(new Event('change'));}creationButton('Replace bound model').click();await wait();check(!replacementKeys.length,'Duplicate mapping submitted');mappingSelects[1].value='new-cover';mappingSelects[1].dispatchEvent(new Event('change'));
 mappingSelects[0].value=[...mappingSelects[0].options].find(option=>option.textContent==='Remove unused component').value;mappingSelects[0].dispatchEvent(new Event('change'));let removalPrompt='';window.confirm=message=>{removalPrompt=message;return false;};creationButton('Replace bound model').click();await wait();check(removalPrompt.includes('remove 1 unused components')&&!replacementKeys.length,'Removal confirmation omitted exact consequence');mappingSelects[0].value='new-panel';mappingSelects[0].dispatchEvent(new Event('change'));
 window.confirm=()=>false;creationButton('Replace bound model').click();await wait();check(!replacementKeys.length,'Cancelled replacement submitted');window.confirm=()=>true;
 creationButton('Replace bound model').click();await wait();creationButton('Replace bound model').click();await wait();await wait();check(replacementKeys.length===2&&replacementKeys[0]===replacementKeys[1],'Replacement retry identity changed');check(JSON.stringify(version.content)===beforeReplacement,'Replacement changed authored content');check(creationButton('Create simulation from selected model').disabled,'Existing simulation allowed duplicate creation');check(document.activeElement===q('#add-module'),'Replacement focus lost');
 storyButton('Add condition',storyRoot().querySelector('[data-story-node] fieldset')).click();let faultActivity=storyField('Condition activity');faultActivity.value='interactive:test';faultActivity.dispatchEvent(new Event('change'));
 let faultKind=storyField('Recorded fact');faultKind.value='resolved';faultKind.dispatchEvent(new Event('change'));check(q('[data-story-validation]').textContent.includes('known simulation fault'),'Missing fault accepted');const faultSelect=storyField('Simulation fault');check([...faultSelect.options].some(option=>option.value==='blocked'),'Bound fault not offered');faultSelect.value='blocked';faultSelect.dispatchEvent(new Event('change'));check(q('[data-story-validation]').textContent==='Story structure is valid.','Known fault rejected');q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();check(saved.content.story.nodes.some(node=>[...node.prerequisites,...node.choices.flatMap(choice=>choice.conditions)].some(condition=>condition.fact==='resolved'&&condition.faultId==='blocked')),'Fault condition not saved');
 storyButton('Reset local story preview').click();const localResults=()=>[...storyPreview().querySelectorAll('details select')].filter(select=>[...select.options].some(option=>option.value==='passed'));
 for(let index=0;index<localResults().length;index++){const select=localResults()[index];select.value='passed';select.dispatchEvent(new Event('change'));}
 const localFault=()=>[...storyPreview().querySelectorAll('label')].find(label=>label.firstChild.textContent==='Local fault: blocked').querySelector('select');check(!localFault().disabled&&storyButton('Continue',storyPreview()).disabled,'Missing fault history did not block local choice');localFault().value='diagnosed';localFault().dispatchEvent(new Event('change'));check(storyButton('Continue',storyPreview()).disabled,'Diagnosis alone satisfied resolution');localFault().value='resolved';localFault().dispatchEvent(new Event('change'));check(!storyButton('Continue',storyPreview()).disabled,'Resolved local fault did not unlock choice');localFault().value='missing';localFault().dispatchEvent(new Event('change'));check(storyButton('Continue',storyPreview()).disabled,'Unavailable local history retained result');storyButton('Check story paths').click();check(!storyPreview().textContent.includes('Set valid activity score thresholds')&&storyPreview().textContent.includes('blocked paths'),'Fault path report unavailable');check(learnerRequests===0,'Local fault preview issued learner requests');
 storyButton('Remove condition').click();q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 window.__storySnapshot=storyRoot().cloneNode(true);[...storyRoot().querySelectorAll('select')].forEach((source,index)=>{window.__storySnapshot.querySelectorAll('select')[index].value=source.value;});
 const historyRoot=()=>q('[data-draft-history]'),historyButton=label=>[...historyRoot().querySelectorAll('button')].find(button=>button.textContent===label);
 historyButton('Load saved history').click();await wait();check(!historyRoot().querySelector('img'),'History actor rendered markup');const historySelect=historyRoot().querySelector('select');historySelect.value='history:one';historySelect.dispatchEvent(new Event('change'));historyButton('Compare snapshot').click();await wait();check(historyRoot().textContent.includes('Course title')&&historyRoot().textContent.includes('Restored course'),'History comparison missing');q('#draft-title').value='Edit after comparison';q('#draft-title').dispatchEvent(new Event('input'));historyButton('Restore reviewed snapshot').click();await wait();check(!historyKeys.length&&historyRoot().textContent.includes('Compare again'),'Stale comparison could restore over edits');q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();historyButton('Compare snapshot').click();await wait();historyButton('Restore reviewed snapshot').click();await wait();check(historyKeys.length===0,'Restore without reason submitted');const historyReason=historyRoot().querySelector('textarea');historyReason.value='Undo mistaken title';historyReason.dispatchEvent(new Event('input'));window.confirm=()=>false;historyButton('Restore reviewed snapshot').click();await wait();check(historyKeys.length===0,'Cancelled restoration submitted');window.confirm=()=>true;historyButton('Restore reviewed snapshot').click();await wait();check(!q('#draft-fields').disabled,'Interrupted restore locked editor');historyButton('Restore reviewed snapshot').click();await wait();await wait();check(historyKeys.length===2&&historyKeys[0]===historyKeys[1],'Restore retry changed key');check(q('#draft-title').value==='Restored course'&&document.activeElement===q('#draft-title'),'Restore did not reload/focus draft');
 conflict=true;
 q('#draft-title').value='Conflict edit';q('#draft-title').dispatchEvent(new Event('input'));
 q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();
 check(q('#draft-title').value==='Conflict edit','Conflict discarded edits');
 check(q('#draft-message').textContent.includes('Your edits remain here'),'Conflict message missing');
 const recoveryKey=Object.keys(sessionStorage).find(key=>key.startsWith('mdt.draft.'));
 check(!!recoveryKey,'Missing session recovery snapshot');
 const recovery=JSON.parse(sessionStorage.getItem(recoveryKey));
 check(recovery.content.title==='Conflict edit','Recovery lost unsaved content');
 const count=writes;
 version.content.title='<img src=x> Concurrent saved title';version.revision++;
 q('#compare-draft').click();await wait();
 const comparison=q('#draft-comparison');
 check(comparison.textContent.includes('Restored course')&&comparison.textContent.includes('Conflict edit')&&comparison.textContent.includes('Concurrent saved title'),'Three-way conflict content missing');
 check(comparison.textContent.includes('changed in both versions')&&!comparison.querySelector('img'),'Conflict values not inert or overlap missing');
 check(document.activeElement===comparison.querySelector('h4'),'Conflict heading not focused');
 check(writes===count&&q('#draft-title').value==='Conflict edit'&&JSON.parse(sessionStorage.getItem(recoveryKey)).content.title==='Conflict edit','Comparison changed local edits or saved');
 q('#draft-title').value='Retained conflict';q('#draft-title').dispatchEvent(new Event('input'));
 await new Promise(r=>setTimeout(r,1300));
 check(writes===count,'Conflict triggered an automatic overwrite retry');
 check(!comparison.childElementCount,'Editing retained outdated comparison');
 failComparison=true;q('#compare-draft').click();await wait();failComparison=false;
 check(q('#draft-message').textContent.includes('Your edits remain here')&&q('#draft-title').value==='Retained conflict'&&!q('#compare-draft').disabled,'Comparison failure lost edits or blocked retry');
 delayComparison=true;q('#compare-draft').click();await wait();
 q('#draft-title').value='Edited during comparison';q('#draft-title').dispatchEvent(new Event('input'));releaseComparison();await wait();
 check(!comparison.childElementCount&&q('#draft-message').textContent.includes('Compare again'),'Late comparison overwrote newer edits');
 delayComparison=false;
 window.confirm=()=>false;q('#discard-draft').click();await wait();
 check(q('#draft-title').value==='Edited during comparison'&&sessionStorage.getItem(recoveryKey),'Cancelled reload discarded edits');
 window.confirm=()=>true;q('#discard-draft').click();await wait();
 check(q('#draft-title').value==='<img src=x> Concurrent saved title'&&!sessionStorage.getItem(recoveryKey)&&!comparison.childElementCount,'Confirmed reload failed to adopt saved draft');
 q('#compare-draft').click();await wait();
 check(comparison.textContent.includes('matches the latest saved version'),'Equal-content comparison missing');
 delayComparison=true;q('#compare-draft').click();await wait();q('#sign-out').click();releaseComparison();await wait();
 check(!comparison.childElementCount,'Late comparison restored private data after sign-out');
 check(!Object.keys(sessionStorage).some(key=>key.startsWith('mdt.draft.')),'Sign-out retained private recovery data');
 check(q('#draft-title').value==='','Sign-out retained editor content');
 check(q('#course-library').childElementCount===0,'Sign-out retained organization library');
 check(q('#source-passages').childElementCount===0,'Sign-out retained source passages');check(!q('#generation-media-options').childElementCount,'Sign-out retained generation media');
 if(${process.argv.includes('--story-screenshot')}){const main=document.createElement('main');main.append(window.__storySnapshot);document.body.replaceChildren(main);document.documentElement.style.scrollBehavior='auto';window.scrollTo({top:0,left:0,behavior:'instant'});await wait();check(document.documentElement.scrollWidth<=window.innerWidth,'Story editor overflowed viewport');}
 if(${process.argv.includes('--graph-screenshot')}){const main=document.createElement('main');if(${process.argv.includes('--graph-compact')}){main.style.width='328px';main.style.margin='0';}main.append(window.__graphSnapshot);document.body.replaceChildren(main);check(document.documentElement.scrollWidth<=window.innerWidth,'Graph overflowed the page viewport');if(${process.argv.includes('--graph-compact')})check(main.getBoundingClientRect().width<=360&&main.scrollWidth<=360,'Graph overflowed compact content frame');}
 document.body.dataset.testResult='PASS';
} catch(error) { document.body.dataset.testResult='FAIL: '+error.message; }
`;
const server = createServer(async (req,res) => {
  try {
    if(req.url==='/assessment-validation.js'){res.setHeader('content-type','text/javascript');res.end(await readFile('packages/simulation-schema/dist/assessment.js'));return;}
    if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/index.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
    const file = { '/job-status.js':'job-status.js', '/auth-session.js':'auth-session.js' }[req.url];
    if(!file){res.writeHead(404).end();return;}
    res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
  } catch {res.writeHead(500).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 const profile=await mkdtemp(join(tmpdir(),'mdt-editor-'));
 const screenshotArgs=[];if(process.argv.includes('--story-screenshot')){await mkdir('output',{recursive:true});screenshotArgs.push('--window-size=768,1400','--screenshot='+resolve('output/story-editor.png'));}if(process.argv.includes('--graph-screenshot')){await mkdir('output',{recursive:true});screenshotArgs.push(process.argv.includes('--graph-compact')?'--window-size=360,1000':'--window-size=768,1000','--screenshot='+resolve(process.argv.includes('--graph-compact')?'output/simulation-graph-compact.png':'output/simulation-graph.png'));}
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',...screenshotArgs,`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=8000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();
 const timer=setTimeout(()=>child.kill(),30000);
 try {await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});} finally {clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.match(/data-test-result="([^"]*)"/)?.[1]??output.slice(-1800));
 console.log('Browser editor passed: story creation/conditions/local preview/save, assessment editing/scoring, simulation procedure/fault editing, deterministic preview and rejection, cycle/equivalent-path validation, learner API isolation, autosave, conflicts and sign-out.');
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
