import {authenticatedFetch,getOrganizationHeaders} from './auth-session.js';
type MediaResponse={url:string;contentType:string;altText?:string;transcript?:string};
/** Private URLs stay in this disposable view; loading media never records completion. */
export function renderLearnerMedia(host:HTMLElement,type:'image'|'video',acknowledged:boolean,options:{active:()=>boolean;load:()=>Promise<MediaResponse>;acknowledge:()=>Promise<void>}){
 const status=document.createElement('p');status.setAttribute('role','status');
 const content=document.createElement('div');
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Load media';
 const review=document.createElement('button');review.type='button';review.textContent='Mark as reviewed';review.disabled=true;review.hidden=acknowledged;
 host.append(status,refresh,content,review);
 if(acknowledged){const p=document.createElement('p');p.textContent='You marked this media activity as reviewed.';host.append(p);}
 let disposed=false,request=0,objectUrl:string|undefined,abort:AbortController|undefined;
 const active=()=>!disposed&&host.isConnected&&options.active();
 const clear=()=>{abort?.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=undefined;for(const video of content.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}for(const img of content.querySelectorAll('img'))img.removeAttribute('src');content.replaceChildren();review.disabled=true;};
 refresh.onclick=async()=>{
  const current=++request;refresh.disabled=true;clear();status.textContent='Loading private media...';
  try{
   const result=await options.load();if(!active()||current!==request)return;
   let mediaUrl=result.url;
   if(result.url.startsWith('/api/v1/enrollments/')){abort=new AbortController();const response=await authenticatedFetch(result.url,{headers:getOrganizationHeaders(),signal:abort.signal});if(!response.ok)throw Error('Media could not be downloaded.');const blob=await response.blob();if(!active()||current!==request)return;objectUrl=URL.createObjectURL(new Blob([blob],{type:result.contentType}));mediaUrl=objectUrl;}else{const url=new URL(result.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('The media address is unavailable.');}
   const formats=type==='image'?['image/png','image/jpeg','image/webp']:['video/mp4','video/webm'];
   const equivalent=type==='image'?result.altText:result.transcript;
   if(!formats.includes(result.contentType)||typeof equivalent!=='string'||!equivalent.trim())throw Error('The media description is unavailable.');
   const media=document.createElement(type==='image'?'img':'video');media.style.maxWidth='100%';
   if(media instanceof HTMLImageElement){media.alt=equivalent;media.loading='lazy';media.referrerPolicy='no-referrer';}
   else{media.controls=true;media.preload='metadata';media.playsInline=true;}
   media.onerror=()=>{if(active()&&current===request)status.textContent='Media could not play or load. Refresh the media link, or review the description below.';};
   media.src=mediaUrl;content.append(media);
   const label=document.createElement('h5');label.textContent=type==='image'?'Image description':'Video transcript';
   const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.textContent=equivalent;content.append(label,text);
   refresh.textContent='Refresh media link';status.textContent='Review the media or its description, then mark this activity as reviewed.';review.disabled=false;
  }catch(error){if(active()&&current===request){clear();status.textContent=error instanceof Error?error.message:'Media is unavailable. Retry loading it.';}}
  finally{if(active()&&current===request)refresh.disabled=false;}
 };
 review.onclick=async()=>{review.disabled=true;try{await options.acknowledge();}catch(error){if(active())status.textContent=error instanceof Error?error.message:'Review could not be saved. Retry.';}finally{if(active())review.disabled=false;}};
 return ()=>{disposed=true;request++;clear();};
}
