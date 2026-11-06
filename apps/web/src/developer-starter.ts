import { createTrainingClient, prepareModelAction, TrainingApiError, type ModelSession, type ModelState, type ModelAction } from '@medical-device/api-client';
import { validateBrowserModelManifest, validateAuthoritativeModelState, type ModelManifest } from '@medical-device/model-runtime';
import { authenticatedFetch, clearAccessToken, getAccessToken, getOrganizationHeaders, getSessionIdentity, setOrganizationId } from './auth-session.js';
import { renewAccessToken } from './managed-auth.js';
import { mountTrainingViewer, type TrainingViewer, type TrainingViewerAction } from './training-viewer.js';

const q=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text:string)=>{const node=document.createElement(tag);node.textContent=text;return node;};
const api=createTrainingClient({getAccessToken:()=>sessionStorage.getItem('mdt.auth.managed-account')?renewAccessToken():getAccessToken(),getContext:()=>({identity:getSessionIdentity(),organizationId:getOrganizationHeaders()['x-organization-id']})});
let session:ModelSession|undefined,state:ModelState|undefined,manifest:ModelManifest|undefined,viewer:TrainingViewer|undefined,pending:ModelAction|undefined;
let epoch=0,listGeneration=0,busy=false,viewerReady=false,ended=false,selecting=false,cursor:string|null=null,operation=new AbortController();
let organizationIntent:{organizationId:string;key:string}|undefined;
const message=(text:string)=>{q('status').textContent=text;};
const pendingKey=()=>`mdt.developer.pending.${session!.sessionId}`;
function clearActivity(){epoch++;operation.abort();operation=new AbortController();viewer?.dispose();viewer=undefined;session=undefined;state=undefined;manifest=undefined;pending=undefined;busy=false;viewerReady=false;ended=false;q('activity').hidden=true;q('courses').hidden=false;q('debrief').hidden=true;q('feedback').textContent='';q('controls').replaceChildren();}
function failure(error:unknown){
  if(error instanceof Error&&error.name==='AbortError')return;
  message(error instanceof Error?error.message:'The request could not be completed.');
  if(error instanceof TrainingApiError&&([401,403].includes(error.status)||error.code==='SESSION_CONTEXT_CHANGED')){
    clearActivity();q('course').hidden=true;q('course-list').replaceChildren();
    for(const key of Object.keys(sessionStorage))if(key.startsWith('mdt.developer.pending.'))sessionStorage.removeItem(key);
  }
}
function button(label:string,run:()=>Promise<unknown>){const node=element('button',label);node.type='button';node.onclick=()=>void run().catch(failure);return node;}
function renderState(){
  if(!state||!session||!manifest)return;
  q('step-title').textContent=state.completed?'Exercise complete':state.activeStepTitle??'Activity';
  q('step-instructions').textContent=state.activeStepInstructions??'Review the recorded result below.';
  q('progress').textContent=state.completed?'All required actions are recorded.':`Recorded action sequence: ${state.sequence}`;
  const selection=q<HTMLSelectElement>('components');
  if(!selection.options.length)for(const component of manifest.components)selection.add(new Option(component.displayName,component.componentId));
  selection.value=state.focusComponentId??state.selectedComponentId??manifest.components[0].componentId;
  renderControls();
  q('inspect').hidden=!state.allowedActions.includes('inspect_component');
  q<HTMLButtonElement>('retry').hidden=!pending;
  for(const id of ['select-component','inspect','hint'])q<HTMLButtonElement>(id).disabled=busy||Boolean(pending)||state.completed||ended;
  q<HTMLButtonElement>('retry').disabled=busy;
  viewer?.setEnabled(!busy&&!pending&&!state.completed&&!ended);
}
function renderControls(){
  q('controls').replaceChildren();if(!state)return;
  const componentId=q<HTMLSelectElement>('components').value;
  for(const choice of state.interactionOptions??[]){
    if(choice.componentId!==componentId)continue;
    const control=button(choice.label,()=>submit({type:choice.type,componentId:choice.componentId,targetId:choice.targetId,transform:choice.transform,source:'KEYBOARD'}));
    control.disabled=busy||Boolean(pending)||state.completed||ended;
    q('controls').append(control);
    if(choice.blockedReason)q('controls').append(element('small',choice.blockedReason));
  }
}
function apply(next:ModelState){
  if(!manifest||!validateAuthoritativeModelState(manifest,next)||!session||next.releaseBindingId!==session.releaseBindingId||next.modelVersionId!==session.modelVersionId)throw new TrainingApiError(502,'INVALID_MODEL_STATE','The activity returned an invalid model state. Resume before continuing.');
  if(state&&next.sequence<state.sequence)return;
  state=next;if(viewerReady)viewer?.applyState(state);renderState();
}
async function submit(action:TrainingViewerAction){
  if(!session||!state||busy||pending||state.completed||ended)return;
  pending=prepareModelAction(session,state,action);sessionStorage.setItem(pendingKey(),JSON.stringify(pending));
  await sendPending();
}
async function sendPending(){
  if(!pending||!session||busy)return;
  const current=epoch,request=pending;busy=true;renderState();
  try{
    const result=await api.submitAction(session.sessionId,request,operation.signal);if(current!==epoch)return;
    if(result.status==='retryable_network_failure')throw new TrainingApiError(0,'NETWORK_ERROR',result.feedback);
    sessionStorage.removeItem(pendingKey());pending=undefined;
    q('feedback').textContent=result.feedback;
    if(result.state)apply(result.state);
    if(result.status==='expired_session'||result.status==='version_mismatch'){ended=true;viewer?.setEnabled(false);message(result.feedback);await showDebrief();}
    if(state?.completed)await showDebrief();
  }catch(error){if(current===epoch){if(error instanceof TrainingApiError&&error.status>=400&&error.status<500&&error.status!==429){sessionStorage.removeItem(pendingKey());pending=undefined;}failure(error);}}
  finally{if(current===epoch){busy=false;renderState();}}
}
async function showDebrief(){
  if(!session)return;const current=epoch;
  const result=await api.getDebrief(session.sessionId,operation.signal);if(current!==epoch)return;
  q('debrief').hidden=false;q('debrief-summary').textContent=`${result.status}. ${result.hintsUsed} hints used; ${result.rejectedAttempts} rejected task attempts.${result.eventsTruncated?' The event list shows the first 500 records; counts cover the full history.':''}`;
  q('debrief-steps').replaceChildren(...result.steps.map(step=>element('li',`${step.completed?'Completed':'Remaining'}: ${step.title}. ${step.explanation}`)));
  q('debrief-events').replaceChildren(...result.events.map(event=>element('li',`${event.outcome}: ${event.feedback}`)));
}
async function launch(enrollmentId:string,activity:{activityId:string;title:string;instructions:string}){
  clearActivity();const current=epoch,signal=operation.signal;
  const started=await api.startActivity(enrollmentId,activity.activityId,signal);if(current!==epoch)return;
  session=started;state=started.state;
  const asset=await api.getModelAsset(started.releaseId,started.modelVersionId,signal);if(current!==epoch)return;
  manifest=validateBrowserModelManifest(asset.fallbackManifest);
  if(asset.releaseBindingId!==started.releaseBindingId||manifest.releaseBindingId!==started.releaseBindingId||manifest.modelVersionId!==started.modelVersionId||manifest.sourceHash!==asset.manifestHash)throw new TrainingApiError(502,'MODEL_BINDING_MISMATCH','The returned model does not match this activity.');
  q('activity').hidden=false;q('activity-title').textContent=activity.title||'Interactive activity';q('briefing').textContent=activity.instructions;
  q('course').hidden=true;q('courses').hidden=true;
  q<HTMLSelectElement>('components').replaceChildren();
  const saved=sessionStorage.getItem(pendingKey());if(saved){try{const action=JSON.parse(saved) as ModelAction;if(action.releaseBindingId===started.releaseBindingId&&action.modelVersionId===started.modelVersionId&&typeof action.clientActionId==='string')pending=action;else sessionStorage.removeItem(pendingKey());}catch{sessionStorage.removeItem(pendingKey());}}
  apply(started.state);q('activity-title').focus();
  viewer=mountTrainingViewer({canvas:q<HTMLCanvasElement>('training-canvas'),camera:manifest.components.some(component=>component.componentId==='nxstage-cycler-handle')?{alpha:Math.PI/2,beta:1.2,radius:13.5,target:[0,3.6,0]}:undefined,onAction:action=>void submit(action).catch(failure),onStatus:status=>{if(current===epoch)q('viewer-status').textContent=status.message??(status.phase==='READY'?'3D model ready.':status.phase==='REDUCED_COMPLEXITY'?'3D model ready with reduced effects.':status.phase==='CONTEXT_LOST'?'Restoring the model. The component controls remain available.':'Loading the model…');}});
  try{
    const url=new URL(asset.modelUrl,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/v1/'))throw Error('The starter requires API-proxied private model delivery.');
    const response=await authenticatedFetch(url.href,{signal,headers:getOrganizationHeaders()});if(!response.ok)throw new TrainingApiError(response.status,'MODEL_LOAD_FAILED','The model could not be loaded.');
    const bytes=new Uint8Array(await response.arrayBuffer());if(current!==epoch)return;
    await viewer.load({manifest,modelBytes:bytes,state:state!,signal});if(current!==epoch)return;
    viewerReady=true;viewer.applyState(state!);viewer.setHintsVisible(q<HTMLInputElement>('highlights').checked);renderState();
  }catch(error){if(current!==epoch)return;if(error instanceof TrainingApiError&&[401,403].includes(error.status)){failure(error);return;}q('viewer-status').textContent='3D is unavailable. Use the component list and named controls to continue.';}
  if(state?.completed)await showDebrief();
}
async function openCourse(enrollmentId:string){
  clearActivity();const current=epoch;const course=await api.getEnrollment(enrollmentId,operation.signal);if(current!==epoch)return;
  q('course').hidden=false;q('course-title').textContent=course.title;q('activities').replaceChildren();
  if(course.content.hasStory){q('activities').append(element('p','This course uses story navigation. Open it in the learner player.'));return;}
  for(const module of course.content.modules)for(const activity of module.activities){if(!['simulation','guided_procedure','manipulation','assembly','fault_troubleshooting','simulation_outcome'].includes(activity.type))continue;const card=element('article','');card.append(element('h3',activity.title||module.title),element('p',activity.instructions),button('Open activity',()=>launch(enrollmentId,activity)));q('activities').append(card);}
}
async function courses(more=false){const current=epoch,generation=++listGeneration;const page=await api.listEnrollments(more?cursor??undefined:undefined,operation.signal);if(current!==epoch||generation!==listGeneration)return;if(!more)q('course-list').replaceChildren();for(const course of page.items)q('course-list').append(button(course.title||'Training course',()=>openCourse(course.enrollmentId)));cursor=page.nextCursor;q('more').hidden=!cursor;if(!page.items.length&&!more)q('course-list').append(element('p','No active enrollments in this organization. Ask the author to assign the reviewed familiarization course.'));}
q('select-organization').onclick=()=>void(async()=>{const organizationId=q<HTMLSelectElement>('organizations').value;if(!organizationId||selecting)return;selecting=true;q<HTMLButtonElement>('select-organization').disabled=true;
  if(organizationIntent?.organizationId!==organizationId)organizationIntent={organizationId,key:crypto.randomUUID()};
  clearActivity();q('course').hidden=true;q('course-list').replaceChildren();
  try{await api.selectOrganization(organizationId,organizationIntent.key,operation.signal);organizationIntent=undefined;setOrganizationId(organizationId);await courses();}
  catch(error){if(error instanceof TrainingApiError&&!error.retryable)organizationIntent=undefined;throw error;}
  finally{selecting=false;q<HTMLButtonElement>('select-organization').disabled=false;}
})().catch(failure);
q('refresh').onclick=()=>void courses().catch(failure);q('more').onclick=()=>void courses(true).catch(failure);
q('back-to-courses').onclick=()=>{clearActivity();q('course').hidden=true;};
q('signout').onclick=()=>{clearActivity();q('course-list').replaceChildren();q('course').hidden=true;for(const key of Object.keys(sessionStorage))if(key.startsWith('mdt.developer.pending.'))sessionStorage.removeItem(key);clearAccessToken();message('Signed out.');};
q('components').onchange=renderControls;
q('select-component').onclick=()=>void submit({type:'select_component',componentId:q<HTMLSelectElement>('components').value,source:'KEYBOARD'}).catch(failure);
q('inspect').onclick=()=>void submit({type:'inspect_component',componentId:state?.focusComponentId??q<HTMLSelectElement>('components').value,stepId:state?.activeStepId,source:'KEYBOARD'}).catch(failure);
q('hint').onclick=()=>void submit({type:'request_hint',stepId:state?.activeStepId,source:'KEYBOARD'}).catch(failure);
q('retry').onclick=()=>void sendPending().catch(failure);
q('resume').onclick=()=>void(async()=>{if(!session||!state||busy)return;const current=epoch;const result=await api.resume(session,state.nextSequence,operation.signal);if(current!==epoch)return;ended=['expired_session','version_mismatch'].includes(result.status);if(result.state)apply(result.state);renderState();q('feedback').textContent=result.feedback;})().catch(failure);
q('debrief-button').onclick=()=>void showDebrief().catch(failure);q('reset-view').onclick=()=>viewer?.resetView();q('focus').onclick=()=>{if(state?.focusComponentId)viewer?.focusComponent(state.focusComponentId);};q('highlights').onchange=()=>viewer?.setHintsVisible(q<HTMLInputElement>('highlights').checked);
window.addEventListener('pagehide',clearActivity);
if(getAccessToken())void(async()=>{const organizations=await api.listOrganizations();const select=q<HTMLSelectElement>('organizations');for(const organization of organizations.items)select.add(new Option(organization.name??organization.organizationId,organization.organizationId));const selected=getOrganizationHeaders()['x-organization-id'];if(selected){select.value=selected;await courses();}})().catch(failure);
else message('Sign in with Microsoft, then choose an organization and course.');
