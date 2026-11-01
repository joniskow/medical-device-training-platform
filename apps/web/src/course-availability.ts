import {authenticatedFetch,getAccessToken,getSessionIdentity,getOrganizationHeaders,clearAccessToken} from './auth-session.js';
const q=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const fields=q<HTMLFieldSetElement>('#fields'),courses=q<HTMLSelectElement>('#release'),mode=q<HTMLSelectElement>('#mode'),reload=q<HTMLButtonElement>('#reload'),more=q<HTMLButtonElement>('#more'),confirmed=q<HTMLInputElement>('#confirmed');
const names=['audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath'] as const;
const input=(id:string)=>q<HTMLInputElement|HTMLTextAreaElement>('#'+id);
let generation=0,cursor:string|undefined,release='',revision:number|undefined,saving=false,dirty=false,key='',signature='',identity='';
const message=(value:string)=>{q('#message').textContent=value;};
function clear(){fields.disabled=true;revision=undefined;dirty=false;key='';signature='';confirmed.checked=false;q('#context').textContent='';q('#public-link').replaceChildren();for(const name of [...names,'reason','estimatedMinutes'])input(name).value='';mode.value='PRIVATE';}
function requirements(){for(const name of names)input(name).required=mode.value!=='PRIVATE';}
function render(data:any){
 revision=data.revision;mode.value=data.mode;for(const name of names)input(name).value=data.details[name]??'';input('estimatedMinutes').value=String(data.details.estimatedMinutes??30);input('reason').value='';confirmed.checked=false;dirty=false;key='';signature='';fields.disabled=false;requirements();
 q('#context').textContent=`${data.title} · ${data.releaseStatus} · availability revision ${data.revision}`;q('#public-link').replaceChildren();
 if(typeof data.publicId==='string'&&/^[0-9a-f-]{36}$/i.test(data.publicId)){const link=document.createElement('a');link.href='/catalog?course='+encodeURIComponent(data.publicId);link.textContent=data.mode==='UNLISTED'?'Open unlisted course link':'Open public course page';q('#public-link').append(link);}
}
async function request(path:string,body?:string){return authenticatedFetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{...getOrganizationHeaders(),...(body?{'content-type':'application/json','idempotency-key':key}:{})},...(body?{body}:{})});}
function current(n:number){return n===generation&&identity===getSessionIdentity();}
async function loadOffering(){
 const n=++generation;identity=getSessionIdentity();clear();if(!release)return;more.disabled=true;message('Loading course availability…');
 try{const response=await request('releases/'+encodeURIComponent(release)+'/offering');if(!current(n))return;if(!response.ok)throw Error(response.status===403?'Organization administrator access is required.':'Availability could not be loaded. Reload to retry.');const data=await response.json();if(current(n)){render(data);message('Review the disclosures and confirm before saving.');}}
 catch(error){if(current(n))message((error as Error).message);}
 finally{if(current(n))more.disabled=false;}
}
async function loadCourses(append=false){
 if(saving)return;if(!append&&dirty&&!window.confirm('Discard unsaved availability changes and reload?'))return;
 const n=++generation;identity=getSessionIdentity();if(!append){clear();release='';cursor=undefined;courses.replaceChildren(new Option('Choose a published course',''));}courses.disabled=true;reload.disabled=true;more.disabled=true;message('Loading published courses…');
 try{if(!getAccessToken())throw Error('Sign in as an organization administrator to manage availability.');const response=await request('enrollments/options?kind=releases'+(append&&cursor?'&after='+encodeURIComponent(cursor):''));if(!current(n))return;if(!response.ok)throw Error('Published courses could not be loaded. Check your organization access and retry.');const data=await response.json();if(!current(n))return;for(const item of data.items)if(![...courses.options].some(o=>o.value===item.releaseId))courses.add(new Option(`${item.title} (${item.courseVersionId})`,item.releaseId));cursor=data.nextCursor??undefined;more.hidden=!cursor;message(courses.options.length>1?'Choose a release to manage its availability.':'No published courses are available. Publish a reviewed course first.');}
 catch(error){if(current(n))message((error as Error).message);}
 finally{if(current(n)){courses.disabled=false;reload.disabled=false;more.disabled=false;}}
}
courses.onchange=()=>{if(saving)return;if(dirty&&!window.confirm('Discard unsaved availability changes?')){courses.value=release;return;}release=courses.value;void loadOffering();};
q('#form').oninput=()=>{dirty=true;confirmed.checked=false;requirements();};
// Confirmation itself must not clear the user's deliberate confirmation.
confirmed.oninput=event=>{event.stopPropagation();dirty=true;};
q<HTMLFormElement>('#form').onsubmit=async event=>{
 event.preventDefault();if(saving||revision===undefined||!confirmed.checked)return;
 if(identity!==getSessionIdentity()){generation++;clear();message('Your session changed. Reload before editing.');return;}
 const body=JSON.stringify({mode:mode.value,...Object.fromEntries(names.map(name=>[name,input(name).value.trim()])),estimatedMinutes:Number(input('estimatedMinutes').value),revision,reason:input('reason').value.trim(),confirmed:true});
 if(body!==signature){signature=body;key=crypto.randomUUID();}const n=generation;saving=true;fields.disabled=true;courses.disabled=true;reload.disabled=true;more.disabled=true;message('Saving availability…');
 try{const response=await request('releases/'+encodeURIComponent(release)+'/offering',body);if(!current(n))return;
  if([401,403,404].includes(response.status)){clear();throw Error('Access to this course changed. Reload or sign in again.');}
  if(response.status===409){revision=undefined;confirmed.checked=false;throw Error('Availability changed or this release is unavailable. Reload and review the saved settings before retrying.');}
  if(!response.ok)throw Error(response.status===422?'Check the disclosures, effort and reason before retrying.':'Save could not be confirmed. Retry the same change or reload to check the saved settings.');
  const data=await response.json();if(current(n)){render(data);message('Course availability saved. Existing enrollments retain their release-bound progress.');}
 }catch(error){if(current(n)){message((error as Error).message);fields.disabled=revision===undefined;}}
 finally{saving=false;if(current(n)){courses.disabled=false;reload.disabled=false;more.disabled=false;}}
};
reload.onclick=()=>void loadCourses();more.onclick=()=>void loadCourses(true);
q('#sign-out').onclick=()=>{generation++;clear();release='';cursor=undefined;courses.replaceChildren();more.hidden=true;reload.disabled=false;clearAccessToken();message('Signed out.');};
void loadCourses();
