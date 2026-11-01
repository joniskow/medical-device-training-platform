import {fetchModelAsset} from './private-model-fetch.js';
import {applyPermittedTransform,validateBrowserModelManifest,validateSimulationModelActions} from '@medical-device/model-runtime';
import {getSessionIdentity} from './auth-session.js';
import type {SimulationDefinition,SimulationActionRequirement} from '@medical-device/simulation-schema';
import type {ModelRuntime,AuthoritativeModelState} from './model-contract.js';
export interface AuthorModelPreviewAssets {courseVersionId:string;revision:number;modelVersionId:string;manifest:Record<string,unknown>;modelUrl:string;expiresInSeconds:number}

export function createAuthorModelPreview(host:HTMLElement,definition:SimulationDefinition,loadAssets:()=>Promise<AuthorModelPreviewAssets>){
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='3D author preview';box.append(legend);host.append(box);
 const note=document.createElement('p');note.textContent='Local practice only. Load the saved draft model, then use the local procedure buttons below. Selecting the model only highlights components; it does not award progress.';box.append(note);
 const canvas=document.createElement('canvas');canvas.className='author-model-canvas';canvas.hidden=true;canvas.setAttribute('aria-label','Approved draft model preview');box.append(canvas);
 const status=document.createElement('p');status.dataset.authorModelStatus='true';status.setAttribute('role','status');box.append(status);
 const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;box.append(b);return b;};
 let runtime:ModelRuntime|undefined,state:AuthoritativeModelState|undefined,manifest:ReturnType<typeof validateBrowserModelManifest>|undefined,epoch=0,abort:AbortController|undefined;
 const identity=getSessionIdentity(),active=()=>box.isConnected&&getSessionIdentity()===identity;
 function close(message='3D preview closed. Text and keyboard preview remain available.'){
  epoch++;abort?.abort();abort=undefined;runtime?.dispose();runtime=undefined;state=undefined;manifest=undefined;canvas.hidden=true;status.textContent=message;load.disabled=false;
 }
 const load=button('Load saved draft in 3D',()=>{void start();});
 button('Fit preview model',()=>runtime?.resetView());button('Close 3D preview',()=>close());
 function reset(){if(!runtime||!state)return;state={...state,sequence:state.sequence+1,nextSequence:state.nextSequence+1,selectedComponentId:undefined,transforms:Object.fromEntries(Object.keys(state.transforms).map(id=>[id,{rotationY:0,translationX:0}]))};runtime.applyAuthoritativeState(state);}
 async function start(){
  close('Loading approved draft model...');const generation=epoch;load.disabled=true;abort=new AbortController();
  try{
   const assets=await loadAssets();if(!active()||generation!==epoch)return;
   const checked=validateBrowserModelManifest(assets.manifest);
   if(validateSimulationModelActions(definition,{modelVersionId:assets.modelVersionId,manifestHash:checked.sourceHash,manifest:checked}).length)throw Error('The approved model does not match this procedure. Reload the saved draft.');
   const module=await import('./author-model-runtime.js');if(!active()||generation!==epoch)return;
   canvas.hidden=false;
   const created=await module.createBabylonModelRuntime({fetcher:fetchModelAsset,canvas,manifest:checked,modelUrl:assets.modelUrl,signal:abort!.signal,onStateChange:s=>{if(active()&&generation===epoch)status.textContent=s.phase==='ERROR'?'3D preview unavailable. Use the text and keyboard preview.':`3D author preview: ${s.phase.replaceAll('_',' ')}. No learner evidence is recorded.`;},onSemanticAction:action=>{if(active()&&generation===epoch&&action.componentId)status.textContent=`Inspecting ${action.componentId}. Use local procedure actions to test the scenario.`;}});
   if(!active()||generation!==epoch){created.dispose();return;}
   runtime=created;manifest=checked;state={releaseBindingId:checked.releaseBindingId!,modelVersionId:assets.modelVersionId,sequence:0,nextSequence:1,transforms:Object.fromEntries(checked.components.map(c=>[c.componentId,{rotationY:0,translationX:0}])),scorePoints:0,completed:false,allowedActions:[]};runtime.applyAuthoritativeState(state);
  }catch(error){if(active()&&generation===epoch)close(error instanceof Error?`${error.message} Text and keyboard preview remain available.`:'3D preview unavailable. Text and keyboard preview remain available.');}
  finally{if(active()&&generation===epoch)load.disabled=false;}
 }
 function apply(action:SimulationActionRequirement){
  if(!runtime||!state||!manifest||!active())return;
  const next={...state,sequence:state.sequence+1,nextSequence:state.nextSequence+1,transforms:{...state.transforms},...(action.componentId?{selectedComponentId:action.componentId}:{})};
  if(action.transform&&action.componentId){const component=manifest.components.find(c=>c.componentId===action.componentId);const transform=component&&applyPermittedTransform(component,next.transforms[action.componentId],action.transform);if(!transform)return;next.transforms[action.componentId]=transform;}
  state=next;runtime.applyAuthoritativeState(state);
 }
 const observer=new MutationObserver(()=>{if(!box.isConnected){close();observer.disconnect();clearInterval(timer);}});observer.observe(document.body,{childList:true,subtree:true});
 const timer=setInterval(()=>{if(!active()){close();observer.disconnect();clearInterval(timer);}},1000);
 return {reset,apply,invalidate:()=>close('Draft changed. Save and reload the 3D preview.')};
}
