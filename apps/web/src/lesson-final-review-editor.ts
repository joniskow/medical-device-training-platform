import { finalReviewDimensions, lessonFinalReviewRevision, validateLessonFinalReview, type LessonFinalReview } from '@medical-device/simulation-schema';
import {authenticatedFetch,getOrganizationHeaders,getSessionIdentity} from './auth-session.js';

/** Native scorecard uses the surrounding draft autosave; reviewer authorization is enforced by publication. */
export function renderLessonFinalReviewEditor(parent: HTMLElement, lesson: Record<string, unknown>, onChange: () => void): void {
  const root=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Finished video review';root.dataset.lessonFinalReviewEditor='true';root.append(legend);parent.append(root);
  const note=document.createElement('p');note.textContent='Watch and listen to the uploaded final video on laptop and tablet. Inspect complete action intervals against the source. Automated measurements cannot approve clinical meaning. Save this scorecard, then have its named independent reviewer approve this exact saved lesson.';root.append(note);
  const artifact=lesson.renderArtifact as {sha256?:string;mode?:string}|undefined;
  if(artifact?.mode!=='final'||!artifact.sha256){const message=document.createElement('p');message.textContent='Render and upload the final video before recording its review. Rough cuts cannot be published.';root.append(message);return;}
  const previous=lesson.finalReview as LessonFinalReview|undefined;
  const openedRevision=lessonFinalReviewRevision(lesson);
  const currentPrevious=previous?.lessonRevision===openedRevision&&previous?.artifactSha256===artifact.sha256;
  const review:LessonFinalReview=currentPrevious?structuredClone(previous!):{schemaVersion:'lesson-final-review.v1',assetVersionId:'',artifactSha256:artifact.sha256,lessonRevision:'',reviewerId:'',reviewedAt:new Date().toISOString(),disposition:'CHANGES_REQUESTED',soundAndMotionReviewed:false,fullVideoReviewed:false,dimensions:Object.fromEntries(finalReviewDimensions.map(d=>[d,'NOT_REVIEWED'])) as LessonFinalReview['dimensions'],intervals:[],findings:[],devices:[]};
  const status=document.createElement('p');status.setAttribute('role','status');
  function change(){if(!root.isConnected||openedRevision!==lessonFinalReviewRevision(lesson)){status.textContent='The lesson changed while this review was open. Reload the saved draft and review its current final artifact.';return;}review.reviewedAt=new Date().toISOString();review.lessonRevision=openedRevision;lesson.finalReview=structuredClone(review);status.textContent=validateLessonFinalReview(lesson).findings.map(f=>f.message).join(' ')||'Scorecard complete. Independent approval and immutable uploaded hash will be verified on publication.';onChange();}
  function field(labelText:string,value:string,update:(value:string)=>void){const label=document.createElement('label'),input=document.createElement('input');label.textContent=labelText;input.value=value;input.onchange=()=>{update(input.value);change();};label.append(input);root.append(label);}
  function check(labelText:string,checked:boolean,update:(value:boolean)=>void){const label=document.createElement('label'),input=document.createElement('input');label.textContent=labelText;input.type='checkbox';input.checked=checked;input.onchange=()=>{update(input.checked);change();};label.append(input);root.append(label);}
  const preview=document.createElement('button'),viewer=document.createElement('div');preview.type='button';preview.textContent='Inspect exact uploaded final video';
  let previewUrl:string|undefined,previewEpoch=0,disposed=false,previewAbort:AbortController|undefined;
  function clearPreview(){previewEpoch++;previewAbort?.abort();for(const video of viewer.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}viewer.replaceChildren();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=undefined;preview.disabled=false;}
  field('Uploaded final media version ID',review.assetVersionId,v=>{if(review.assetVersionId!==v)clearPreview();review.assetVersionId=v;});
  root.append(preview,viewer);
  preview.onclick=async()=>{
    clearPreview();const epoch=previewEpoch,identity=getSessionIdentity(),assetId=review.assetVersionId,artifactHash=artifact.sha256;preview.disabled=true;previewAbort=new AbortController();
    const active=()=>!disposed&&root.isConnected&&epoch===previewEpoch&&identity===getSessionIdentity()&&assetId===review.assetVersionId&&openedRevision===lessonFinalReviewRevision(lesson);
    try{
      const response=await authenticatedFetch(`/api/v1/media-review/${encodeURIComponent(assetId)}`,{headers:getOrganizationHeaders(),signal:previewAbort.signal});if(!active())return;if(!response.ok)throw Error();
      const media=await response.json() as {sourceHash:string;sourceType:string;contentUrl:string;contentType:string};
      if(!active())return;if(media.sourceHash!==artifactHash||media.sourceType!=='video')throw Error();
      const bytes=await authenticatedFetch(media.contentUrl,{headers:getOrganizationHeaders(),signal:previewAbort.signal});if(!active())return;if(!bytes.ok)throw Error();const blob=await bytes.blob();
      if(!active())return;
      const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');if(!active())return;if(actualHash!==artifactHash)throw Error();
      previewUrl=URL.createObjectURL(new Blob([blob],{type:media.contentType}));
      const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=previewUrl;video.style.maxWidth='100%';video.setAttribute('aria-label','Exact final video for audiovisual review');viewer.replaceChildren(video);
      status.textContent='Verified final video bytes loaded. Inspect the full sound, motion, labels and source fidelity before recording your findings.';
    }catch{if(active())status.textContent='Final video could not be verified. Upload the exact rendered file and check the media version ID.';}finally{if(!disposed&&epoch===previewEpoch)preview.disabled=false;}
  };
  const observer=new MutationObserver(()=>{if(!root.isConnected){disposed=true;clearPreview();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
  if(previous?.artifactSha256!==artifact.sha256){const restart=document.createElement('button');restart.type='button';restart.textContent='Start review of current final artifact';restart.onclick=()=>{review.artifactSha256=artifact.sha256!;review.intervals=[];review.devices=[];review.findings=[];review.soundAndMotionReviewed=false;review.fullVideoReviewed=false;review.disposition='CHANGES_REQUESTED';for(const d of finalReviewDimensions)review.dimensions[d]='NOT_REVIEWED';change();root.remove();renderLessonFinalReviewEditor(parent,lesson,onChange);};root.append(restart);}
  field('Independent reviewer account ID (must match authenticated approval)',review.reviewerId,v=>review.reviewerId=v);
  check('I watched the entire final video',review.fullVideoReviewed,v=>review.fullVideoReviewed=v);
  check('I listened to the sound and inspected moving actions',review.soundAndMotionReviewed,v=>review.soundAndMotionReviewed=v);
  for(const scene of (Array.isArray(lesson.scenes)?lesson.scenes:[]) as Array<{sceneId:string;startSeconds:number;endSeconds:number}>){check(`Reviewed complete scene ${scene.sceneId}, ${scene.startSeconds}–${scene.endSeconds}s, including transitions`,review.intervals.some(i=>i.sceneId===scene.sceneId),v=>{review.intervals=review.intervals.filter(i=>i.sceneId!==scene.sceneId);if(v)review.intervals.push({sceneId:scene.sceneId,startSeconds:scene.startSeconds,endSeconds:scene.endSeconds});});}
  for(const dimension of finalReviewDimensions){const label=document.createElement('label'),select=document.createElement('select');label.textContent=dimension;for(const result of ['NOT_REVIEWED','PASS','FAIL'])select.add(new Option(result,result));select.value=review.dimensions[dimension];select.onchange=()=>{review.dimensions[dimension]=select.value as 'PASS'|'FAIL'|'NOT_REVIEWED';change();};label.append(select);root.append(label);}
  function numeric(host:HTMLElement,title:string,value:number|undefined,update:(v:number)=>void){const label=document.createElement('label'),input=document.createElement('input');label.textContent=title;input.type='number';input.step='any';input.value=value===undefined?'':String(value);input.onchange=()=>{update(input.value===''?NaN:Number(input.value));change();};label.append(input);host.append(label);}
  for(const profile of ['laptop','tablet'] as const){
    const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=`Measured ${profile} playback`;group.append(title);root.append(group);
    // Empty controls deliberately have no passing defaults: record actual measurements.
    const device=review.devices.find(d=>d.profile===profile)??{profile} as LessonFinalReview['devices'][number];
    for(const [key,label] of [['width','Playback width (pixels, ≥800)'],['height','Playback height (pixels, ≥600)'],['minLabelPixels','Smallest relevant label (pixels, ≥18)'],['minCaptionPixels','Smallest caption (pixels, ≥24)'],['maxCaptionOcclusionPercent','Task occluded by captions (percent, 0)'],['maxSyncOffsetMs','Maximum absolute synchronization offset (ms, ≤200)'],['clippedSpeechCount','Clipped speech events (0)'],['integratedLufs','Integrated loudness (LUFS, -20 to -14)'],['truePeakDb','True peak (dBTP, ≤-1)']] as const)numeric(group,label,device[key],v=>{device[key]=v;if(!review.devices.includes(device))review.devices.push(device);});
  }
  const defects=document.createElement('div'),add=document.createElement('button');root.append(defects);add.type='button';add.textContent='Add timestamped finding';root.append(add);
  function drawFindings(){defects.replaceChildren();review.findings.forEach((finding,index)=>{
    const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=`Finding ${index+1}`;group.append(title);defects.append(group);
    numeric(group,'Timestamp (seconds)',finding.timestampSeconds,v=>finding.timestampSeconds=v);
    for(const [key,label,options] of [['dimension','Dimension',finalReviewDimensions],['severity','Severity',['minor','critical']],['disposition','Disposition',['OPEN','CORRECTED']]] as const){const wrapper=document.createElement('label'),select=document.createElement('select');wrapper.textContent=label;for(const option of options)select.add(new Option(option,option));select.value=finding[key];select.onchange=()=>{Object.assign(finding,{[key]:select.value});change();};wrapper.append(select);group.append(wrapper);}
    const label=document.createElement('label'),description=document.createElement('textarea');label.textContent='Defect and required correction';description.value=finding.description;description.onchange=()=>{finding.description=description.value;change();};label.append(description);group.append(label);
  });}
  add.onclick=()=>{review.findings.push({dimension:'factualProcedural',timestampSeconds:0,severity:'critical',description:'',disposition:'OPEN'});change();drawFindings();};drawFindings();
  check('Approve this scorecard for independent sign-off',review.disposition==='APPROVE',v=>review.disposition=v?'APPROVE':'CHANGES_REQUESTED');root.append(status);
  if(previous)status.textContent=currentPrevious?(validateLessonFinalReview(lesson).findings.map(f=>f.message).join(' ')||'Saved scorecard loaded. Independent approval is verified at publication.'):'The saved scorecard is stale. Inspect the current artifact and complete a fresh review.';
}
