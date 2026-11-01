import {createModelInteractionEditor} from './model-interaction-editor.js';
import {authenticatedFetch,getOrganizationHeaders,getSessionIdentity} from './auth-session.js';
import {validateBrowserModelManifest} from '@medical-device/model-runtime';
import type {ModelRuntime} from './model-contract.js';

export function createModelImportReview(host:HTMLElement,api:<T>(path:string,init?:RequestInit)=>Promise<T>){
 const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent='Imported model review';section.append(heading);host.append(section);
 const load=document.createElement('button');load.type='button';load.textContent='Show imported models';section.append(load);
 const list=document.createElement('div'),panel=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');section.append(list,panel,status);
 let cursor:string|undefined,epoch=0,runtime:ModelRuntime|undefined,abort:AbortController|undefined;
 let identity=getSessionIdentity();
 function dispose(){epoch++;abort?.abort();runtime?.dispose();runtime=undefined;panel.replaceChildren();}
 load.onclick=async()=>{
  const current=getSessionIdentity();if(current!==identity){dispose();list.replaceChildren();cursor=undefined;identity=current;}
  load.disabled=true;
  try{const page=await api<{items:Array<{modelVersionId:string;fileName:string;status:string}>;nextCursor?:string}>('/api/v1/model-imports'+(cursor?'?after='+encodeURIComponent(cursor):''));if(current!==getSessionIdentity())return;
   if(!cursor)list.replaceChildren();
   for(const item of page.items){const button=document.createElement('button');button.type='button';button.textContent=`Review ${item.fileName} — ${item.status.toLowerCase().replaceAll('_',' ')}`;button.onclick=()=>void open(item.modelVersionId);list.append(button);}
   cursor=page.nextCursor;load.textContent=cursor?'Load more imported models':'Refresh imported models';status.textContent=page.items.length?'Choose a model to inspect.':'No imported models are available.';
  }catch{status.textContent='Imported models could not be loaded. Sign in with a content role and retry.';}finally{load.disabled=false;}
 };
 async function open(id:string){
  dispose();const generation=epoch,current=getSessionIdentity();identity=current;const active=()=>generation===epoch&&current===getSessionIdentity();
  status.textContent='Loading model…';
  try{
   const model=await api<{fileName:string;status:string;manifest:Record<string,unknown>;contentUrl:string}>(`/api/v1/model-imports/${encodeURIComponent(id)}`);if(!active())return;
   const title=document.createElement('h3');title.textContent=model.fileName;panel.append(title);
   const description=document.createElement('p');description.textContent=`${model.status}. Verify geometry, scale, orientation and component names. Approval makes this model available for course authoring.`;panel.append(description);
   if(model.manifest.preparation){
    const preparation=model.manifest.preparation as Record<string,any>,evidence=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Author-supplied reconstruction preparation';evidence.append(summary);
    if(preparation.reconstruction?.method==='single-image-generative-hypothesis'){const warning=document.createElement('p');warning.textContent='Single-image shape hypothesis: hidden surfaces, device details and geometric accuracy remain unverified. Setting a measured scale does not verify the rest of the shape.';panel.append(warning);}
    if(model.manifest.reconstructionLineage){const linked=document.createElement('p');linked.textContent='The server verified this candidate and report against its saved reconstruction request and reviewed source versions. Device geometry and dimensions still require review.';panel.append(linked);}
    for(const text of [`Measurement: ${preparation.measurement?.meters??'unknown'} meters. Reference: ${preparation.measurement?.reference??'not provided'}`,`Source up direction: ${preparation.upAxis??'unknown'}; yaw correction: ${preparation.yawDegrees??'unknown'} degrees.`,`Rationale: ${preparation.rationale??'not provided'}`]){const p=document.createElement('p');p.textContent=text;evidence.append(p);}
    const fingerprints=document.createElement('details'),label=document.createElement('summary'),raw=document.createElement('pre');label.textContent='Source fingerprints';raw.style.whiteSpace='pre-wrap';raw.textContent=JSON.stringify({candidateHash:preparation.sourceHash,qualityReportHash:preparation.qualityReportHash,sourceImageHashes:preparation.sourceImageHashes,sourceVideoHash:preparation.sourceVideoHash},null,2);fingerprints.append(label,raw);evidence.append(fingerprints);panel.append(evidence);
   }
   const components=document.createElement('ul');for(const component of model.manifest.components as Array<{componentId:string;displayName:string;nodePath:string}>){const item=document.createElement('li');item.textContent=`${component.displayName} (${component.componentId}) — ${component.nodePath}`;components.append(item);}panel.append(components);
   if(model.status==='REVIEW_REQUIRED')createModelInteractionEditor(panel,id,model.manifest,api,()=>void open(id),active,()=>{configurationDirty=true;status.textContent='Save component interactions and reopen the preview before approving.';});
   const canvas=document.createElement('canvas');canvas.className='author-model-canvas';canvas.setAttribute('aria-label','Imported model preview');panel.append(canvas);
   const preview=document.createElement('button');preview.type='button';preview.textContent='Load imported model in 3D';panel.append(preview);
   const close=document.createElement('button');close.type='button';close.textContent='Close model review';close.onclick=()=>dispose();panel.append(close);
   let previewLoaded=false,decisionSaved=false,configurationDirty=false;
   preview.onclick=async()=>{
    preview.disabled=true;status.textContent='Loading private model preview…';abort=new AbortController();
    try{
     const checked=validateBrowserModelManifest({...model.manifest,modelVersionId:id,releaseBindingId:'review:'+id});
     const response=await authenticatedFetch(model.contentUrl,{headers:getOrganizationHeaders(),signal:abort.signal});if(!response.ok)throw Error('MODEL_DOWNLOAD_FAILED_'+response.status);const bytes=new Uint8Array(await response.arrayBuffer());if(!active())return;
     const module=await import('./author-model-runtime.js');if(!active())return;
     const created=await module.createBabylonModelRuntime({canvas,manifest:checked,modelUrl:model.contentUrl,modelBytes:bytes,signal:abort.signal,onStateChange:state=>{if(active()&&!decisionSaved)status.textContent=`Model preview: ${state.phase.toLowerCase().replaceAll('_',' ')}.`;},onSemanticAction:()=>{}});
     if(!active()){created.dispose();return;}runtime=created;previewLoaded=created.getState().phase==='READY';status.textContent=previewLoaded?'Model preview loaded. Review the geometry and component list before deciding.':'The model preview could not be verified.';
    }catch(error){if(active()){const code=error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'MODEL_PREVIEW_FAILED';status.textContent=`The model could not be previewed (${code}). Check its geometry and normalization before approval.`;preview.disabled=false;}}
   };
   if(model.status==='REVIEW_REQUIRED'){
    const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Model review decision';group.append(legend);
    const label=document.createElement('label'),rationale=document.createElement('textarea');label.append('Model review rationale',rationale);rationale.maxLength=4000;group.append(label);
    const confirmLabel=document.createElement('label'),confirmed=document.createElement('input');confirmed.type='checkbox';confirmed.style.width='24px';confirmed.style.flex='0 0 24px';confirmLabel.style.display='flex';confirmLabel.style.alignItems='center';confirmLabel.style.gap='8px';confirmLabel.append(confirmed,'I reviewed this model and confirm the decision.');group.append(confirmLabel);
    let pending:{body:string;key:string}|undefined;
    for(const [decision,text] of [['APPROVE','Approve model'],['REJECT','Reject model']] as const){const button=document.createElement('button');button.type='button';button.textContent=text;group.append(button);button.onclick=async()=>{
     if(!active())return;if(!confirmed.checked||!rationale.value.trim()||(decision==='APPROVE'&&(!previewLoaded||configurationDirty))){status.textContent='Preview the model, provide a rationale and confirm your review before approval.';return;}
     const body=JSON.stringify({sourceHash:model.manifest.sourceHash,expectedRevision:model.manifest.interactionRevision??0,decision,rationale:rationale.value.trim(),confirmed:true});if(pending?.body!==body)pending={body,key:'model-review:'+crypto.randomUUID()};group.disabled=true;
     try{const result=await api<{status:string}>(`/api/v1/model-imports/${encodeURIComponent(id)}/review`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':pending!.key},body});if(active()){decisionSaved=true;status.textContent=`Model ${result.status.toLowerCase()}. Review recorded. Refresh approved models in the course editor to use it.`;panel.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(field=>field.disabled=true);}}
     catch{if(active()){status.textContent='Review could not be saved. Check reviewer permissions and refresh the model.';group.disabled=false;}}
    };}panel.append(group);
   }
   status.textContent='Model metadata loaded. Open the 3D preview to inspect geometry.';
  }catch{if(active())status.textContent='The model could not be loaded.';}
 }
 setInterval(()=>{if(identity!==getSessionIdentity()){dispose();list.replaceChildren();cursor=undefined;identity=getSessionIdentity();status.textContent='Sign in and reload imported models.';}},1000);
}
