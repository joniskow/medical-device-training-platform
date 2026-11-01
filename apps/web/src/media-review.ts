import {authenticatedFetch,getOrganizationHeaders,getSessionIdentity} from './auth-session.js';
import {renderSourceReview} from './source-review-editor.js';

export function createMediaReview(host:HTMLElement,api:<T>(path:string,init?:RequestInit)=>Promise<T>){
 const section=document.createElement('section'),heading=document.createElement('h2'),load=document.createElement('button'),list=document.createElement('div'),panel=document.createElement('div'),status=document.createElement('p');
 heading.textContent='Image and video review';load.type='button';load.textContent='Show uploaded media';status.setAttribute('role','status');section.append(heading,load,list,panel,status);host.append(section);
 let cursor:string|undefined,epoch=0,identity=getSessionIdentity(),objectUrl:string|undefined,abort:AbortController|undefined;
 const galleryUrls=new Set<string>();
 function dispose(){epoch++;abort?.abort();panel.querySelector('video')?.pause();panel.replaceChildren();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=undefined;for(const url of galleryUrls)URL.revokeObjectURL(url);galleryUrls.clear();}
 load.onclick=async()=>{
  const session=getSessionIdentity();load.disabled=true;
  try{const result=await api<{items:Array<{assetVersionId:string;fileName:string;state:string}>;nextCursor?:string}>('/api/v1/media-review'+(cursor?'?after='+encodeURIComponent(cursor):''));if(session!==getSessionIdentity())return;
   if(!cursor)list.replaceChildren();for(const item of result.items){const button=document.createElement('button');button.type='button';button.textContent=`Review ${item.fileName} — ${item.state.toLowerCase().replaceAll('_',' ')}`;button.onclick=()=>void open(item.assetVersionId);list.append(button);}cursor=result.nextCursor;load.textContent=cursor?'More media':'Refresh media';status.textContent=result.items.length?'Choose an image or video to review.':'No media is ready for review.';
  }catch{status.textContent='Media could not be listed. Check your content-role access.';}finally{load.disabled=false;}
 };
 async function open(id:string){
  dispose();abort=new AbortController();identity=getSessionIdentity();const generation=epoch,session=identity,active=()=>generation===epoch&&session===getSessionIdentity();status.textContent='Loading media inspection…';
  try{
   const item=await api<{fileName:string;state:string;sourceType:string;sourceHash:string;contentType:string;contentUrl:string;width:number;height:number;durationSeconds:number;frames?:Array<{index:number;timestampSeconds:number;contentUrl:string}>;uniqueFrameCount?:number;duplicateFrameCount?:number}>(`/api/v1/media-review/${encodeURIComponent(id)}`);if(!active())return;
   const title=document.createElement('h3'),summary=document.createElement('p');title.textContent=item.fileName;summary.textContent=`${item.width} × ${item.height}${item.sourceType==='video'?`, ${item.durationSeconds} seconds`:''}. Decoding passed. Inspect content, rights and suitability; provide alternative text or a transcript when adding it to a course.`;panel.append(title,summary);
   const preview=document.createElement('button');preview.type='button';preview.textContent='Load private media preview';panel.append(preview);
   const viewer=document.createElement('div'),decision=document.createElement('div'),close=document.createElement('button');close.type='button';close.textContent='Close media review';close.onclick=dispose;panel.append(viewer,decision,close);
   if(item.frames?.length){
    const frameSection=document.createElement('section'),heading=document.createElement('h4'),note=document.createElement('p'),loadFrames=document.createElement('button'),gallery=document.createElement('div');heading.textContent='Sampled video views';loadFrames.type='button';loadFrames.textContent='Load sampled views';
    note.textContent=`${item.frames.length} views sampled across the video. ${item.duplicateFrameCount??0} identical views. Review camera movement, occlusion and lighting before reconstruction. Select a timestamp to seek the loaded video.`;
    gallery.style.display='grid';gallery.style.gridTemplateColumns='repeat(auto-fit, minmax(min(100%, 160px), 1fr))';gallery.style.gap='12px';frameSection.append(heading,note,loadFrames,gallery);panel.insertBefore(frameSection,decision);
    loadFrames.onclick=async()=>{
     loadFrames.disabled=true;gallery.replaceChildren();for(const url of galleryUrls)URL.revokeObjectURL(url);galleryUrls.clear();
     try{
      for(const frame of item.frames!){
       const response=await authenticatedFetch(frame.contentUrl,{headers:getOrganizationHeaders(),signal:abort!.signal});if(!response.ok)throw Error('FRAME_UNAVAILABLE');const blob=await response.blob();if(!active())return;
       const url=URL.createObjectURL(new Blob([blob],{type:'image/png'}));galleryUrls.add(url);
       const figure=document.createElement('figure'),image=document.createElement('img'),seek=document.createElement('button');figure.style.margin='0';image.src=url;image.style.width='100%';image.alt=`Sampled video view at ${frame.timestampSeconds.toFixed(2)} seconds`;await image.decode();if(!active())return;seek.type='button';seek.textContent=`View at ${frame.timestampSeconds.toFixed(2)} s`;seek.onclick=()=>{const video=viewer.querySelector('video');if(video&&Number.isFinite(video.duration)){video.currentTime=Math.min(frame.timestampSeconds,video.duration);video.focus();}else status.textContent='Load the private video preview to seek this timestamp.';};figure.append(image,seek);gallery.append(figure);
      }
      if(active())status.textContent='Sampled views loaded. Inspect the full video before recording a decision.';
     }catch{if(active()){status.textContent='Some sampled views could not be loaded. Retry or reprocess the video.';loadFrames.disabled=false;}}
    };
   }
   preview.onclick=async()=>{
    preview.disabled=true;status.textContent='Loading private media…';
    try{const response=await authenticatedFetch(item.contentUrl,{headers:getOrganizationHeaders(),signal:abort!.signal});if(!response.ok)throw Error('MEDIA_LOAD_FAILED');const blob=await response.blob();if(!active())return;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(new Blob([blob],{type:item.contentType}));
     const media=document.createElement(item.sourceType==='image'?'img':'video');media.style.maxWidth='100%';media.style.maxHeight='480px';
     if(media instanceof HTMLVideoElement){media.controls=true;media.preload='metadata';media.setAttribute('aria-label',item.fileName);}else media.alt='Uploaded media under review';
     const ready=()=>{if(!active())return;status.textContent='Media loaded. Inspect it before recording a decision.';if(item.state==='READY_FOR_REVIEW')renderSourceReview(decision,{subject:'media',active,save:(input,key)=>api(`/api/v1/media-review/${encodeURIComponent(id)}/review`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({...input,sourceHash:item.sourceHash})}),refresh:async()=>{status.textContent='Decision saved. Refresh the course media selector to use approved media.';}});};
     media.addEventListener(item.sourceType==='image'?'load':'loadedmetadata',ready,{once:true});media.onerror=()=>{if(active()){decision.replaceChildren();preview.disabled=false;status.textContent='The browser cannot preview this media. Retry or inspect the original.';}};media.src=objectUrl;viewer.replaceChildren(media);
    }catch{if(active()){preview.disabled=false;status.textContent='Private media could not be loaded. Retry or refresh the item.';}}
   };
   status.textContent='Inspection loaded. Open the media preview.';
  }catch{if(active())status.textContent='No valid inspection report is available. Reprocess this upload before review.';}
 }
 setInterval(()=>{if(identity!==getSessionIdentity()){dispose();list.replaceChildren();cursor=undefined;identity=getSessionIdentity();status.textContent='Sign in and reload media.';}},1000);
}
