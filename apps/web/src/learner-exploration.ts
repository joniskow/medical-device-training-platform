import {fetchModelAsset} from './private-model-fetch.js';
import {validateBrowserModelManifest} from '@medical-device/model-runtime';
import {validateModelExploration,type ModelExploration} from '@medical-device/simulation-schema';
import type {ModelRuntime,AuthoritativeModelState} from './model-contract.js';
type Inspection={releaseId:string;modelVersionId:string;exploration:ModelExploration};
type Assets={releaseId:string;modelVersionId:string;releaseBindingId:string;manifestHash:string;fallbackManifest:unknown;modelUrl:string};
export function renderLearnerExploration(host:HTMLElement,type:'3d_viewer'|'hotspot',acknowledged:boolean,options:{active:()=>boolean;load:()=>Promise<Inspection>;assets:(inspection:Inspection)=>Promise<Assets>;acknowledge:()=>Promise<void>}){
 const box=document.createElement('section');box.dataset.learnerExploration='true';host.append(box);
 const status=document.createElement('p');status.setAttribute('role','status');const content=document.createElement('div');
 const canvas=document.createElement('canvas');canvas.hidden=true;canvas.style.width='100%';canvas.style.height='360px';canvas.setAttribute('aria-label','Interactive model inspection');canvas.tabIndex=0;
 const selected=document.createElement('p');selected.setAttribute('role','status');
 box.append(status,content,canvas,selected);
 let data:Inspection|undefined,runtime:ModelRuntime|undefined,state:AuthoritativeModelState|undefined,abort:AbortController|undefined,epoch=0,disposed=false;
 const active=()=>!disposed&&box.isConnected&&options.active();
 const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;box.append(b);return b;};
 const close=()=>{epoch++;abort?.abort();abort=undefined;runtime?.dispose();runtime=undefined;state=undefined;canvas.hidden=true;load3d.disabled=!data;};
 const inspect=(componentId:string)=>{
  if(!active())return;
  const hotspot=data?.exploration.hotspots.find(h=>h.componentId===componentId);selected.textContent=hotspot?`${hotspot.title}: ${hotspot.text}`:`Selected component: ${componentId}`;
  if(runtime&&state){state={...state,selectedComponentId:componentId,sequence:state.sequence+1,nextSequence:state.nextSequence+1};runtime.applyAuthoritativeState(state);}
 };
 const load=button('Load inspection',()=>{void loadText();});
 const load3d=button('Load model in 3D',()=>{void loadModel();});load3d.disabled=true;
 button('Fit model',()=>runtime?.resetView());button('Close 3D view',()=>{close();status.textContent='3D closed. The inspection text remains available.';});
 const review=button('Mark as reviewed',()=>{void acknowledge();});review.disabled=true;review.hidden=acknowledged;
 if(acknowledged){const p=document.createElement('p');p.textContent='You marked this inspection as reviewed.';box.append(p);}
 async function loadText(){
  close();data=undefined;content.replaceChildren();selected.textContent='';review.disabled=true;load3d.disabled=true;load.disabled=true;const request=epoch;status.textContent='Loading inspection...';
  try{const result=await options.load();if(!active()||request!==epoch)return;data=result;
   const overview=document.createElement('p');overview.textContent=result.exploration.overview;content.append(overview);
   for(const h of result.exploration.hotspots){const heading=document.createElement('h5'),text=document.createElement('p'),b=document.createElement('button');heading.textContent=h.title;text.textContent=h.text;b.type='button';b.textContent='Inspect '+h.title;b.onclick=()=>inspect(h.componentId);content.append(heading,text,b);}
   review.disabled=false;load3d.disabled=false;load.textContent='Refresh inspection';status.textContent='Read the overview and component explanations. 3D inspection is optional and does not award a simulation score.';
  }catch(error){if(active()&&request===epoch)status.textContent=error instanceof Error?error.message:'Inspection is unavailable.';}
  finally{if(active())load.disabled=false;}
 }
 async function loadModel(){
  if(!data)return;close();const request=epoch,expected=data;load3d.disabled=true;abort=new AbortController();status.textContent='Loading private model...';
  try{
   const current=await options.load();if(!active()||request!==epoch)return;
   if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Inspection changed. Refresh the inspection before loading 3D.');
   const assets=await options.assets(current);if(!active()||request!==epoch)return;
   const manifest=validateBrowserModelManifest(assets.fallbackManifest);
   if(assets.releaseId!==current.releaseId||assets.modelVersionId!==current.modelVersionId||manifest.modelVersionId!==current.modelVersionId||manifest.releaseBindingId!==assets.releaseBindingId||manifest.sourceHash!==assets.manifestHash||!validateModelExploration(type,current.exploration,manifest.components.map(c=>c.componentId)).valid)throw Error('Published model does not match this inspection.');
   const module=await import('./author-model-runtime.js');if(!active()||request!==epoch)return;
   canvas.hidden=false;
   const created=await module.createBabylonModelRuntime({fetcher:fetchModelAsset,canvas,manifest,modelUrl:assets.modelUrl,signal:abort!.signal,onStateChange:s=>{if(active()&&request===epoch)status.textContent=['ERROR','CONTEXT_LOST'].includes(s.phase)?'3D is unavailable. Use the equivalent inspection text or reload the model.':`Model inspection: ${s.phase.replaceAll('_',' ')}. No score is recorded.`;},onSemanticAction:action=>{if(active()&&request===epoch&&action.type==='select_component'&&action.componentId)inspect(action.componentId);}});
   if(!active()||request!==epoch){created.dispose();return;}
   runtime=created;state={releaseBindingId:assets.releaseBindingId,modelVersionId:assets.modelVersionId,sequence:0,nextSequence:1,transforms:Object.fromEntries(manifest.components.map(c=>[c.componentId,{rotationY:0,translationX:0}])),scorePoints:0,completed:false,allowedActions:[]};runtime.applyAuthoritativeState(state);
  }catch(error){if(active()&&request===epoch){close();status.textContent=(error instanceof Error?error.message:'3D unavailable.')+' The inspection text remains available.';}}
  finally{if(active()&&request===epoch)load3d.disabled=false;}
 }
 async function acknowledge(){review.disabled=true;try{await options.acknowledge();}catch(error){if(active())status.textContent=error instanceof Error?error.message:'Review could not be saved. Retry.';}finally{if(active())review.disabled=false;}}
 return ()=>{disposed=true;close();content.replaceChildren();selected.textContent='';};
}
