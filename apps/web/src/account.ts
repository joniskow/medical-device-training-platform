import { pendingCandidateCourseUrl, authenticatedFetch,getAccessToken,clearAccessToken} from './auth-session.js';
const q=<T extends Element>(selector:string)=>document.querySelector<T>(selector)!;
const fields=q<HTMLFieldSetElement>('#account-fields'),name=q<HTMLInputElement>('#display-name'),confirmed=q<HTMLInputElement>('#confirmed'),reload=q<HTMLButtonElement>('#reload'),save=q<HTMLButtonElement>('#save'),message=q<HTMLElement>('#message'),verification=q<HTMLElement>('#verification');
let generation=0,revision:number|undefined,key='',signature='',loaded=false,saving=false;
function clear(){fields.disabled=true;name.value='';confirmed.checked=false;verification.textContent='';revision=undefined;loaded=false;key='';signature='';}
function render(account:{displayName:string;revision:number;emailVerified:boolean}|null){
 name.value=account?.displayName??'';revision=account?.revision;loaded=true;fields.disabled=false;confirmed.checked=false;save.textContent=account?'Save profile':'Create personal profile';
 verification.textContent=account?(account.emailVerified?'Email verification is confirmed by your current sign-in.':'Your current sign-in does not confirm a verified email. Verification is required for organization invitations.') :'';
}
async function load(){
 if(saving)return;const current=++generation;clear();message.textContent='Loading your personal profile…';
 try{
  if(!getAccessToken())throw Error('Sign in to create or edit your personal profile.');
  const response=await authenticatedFetch('/api/v1/account',{headers:{authorization:`Bearer ${getAccessToken()}`}});
  if(!response.ok)throw Error([401,403].includes(response.status)?'Your account is unavailable. Sign in again or contact support.':'Your profile could not be loaded. Reload to retry.');
  const data=await response.json();if(current!==generation)return;render(data.account);message.textContent=data.account?'Your personal profile is ready to edit.':'Create your personal profile. You do not need an organization membership.';
 }catch(error){if(current===generation)message.textContent=(error as Error).message;}
}
q<HTMLFormElement>('#account-form').onsubmit=async event=>{
 event.preventDefault();if(saving||!loaded||!confirmed.checked)return;
 const body={action:revision===undefined?'create':'update',displayName:name.value.trim(),...(revision===undefined?{}:{revision}),confirmed:true},encoded=JSON.stringify(body),current=generation;
 if(encoded!==signature){signature=encoded;key=crypto.randomUUID();}
 saving=true;fields.disabled=true;reload.disabled=true;message.textContent='Saving your profile…';
 try{
  const response=await authenticatedFetch('/api/v1/account',{method:'POST',headers:{authorization:`Bearer ${getAccessToken()}`,'content-type':'application/json','idempotency-key':key},body:encoded});
  if(current!==generation)return;
  if([401,403].includes(response.status)){clear();throw Error('Your account access changed. Sign in again or contact support.');}
  if([404,409].includes(response.status)){loaded=false;throw Error('Your account state changed. Reload your profile before editing again.');}
  if(!response.ok)throw Error('Save could not be confirmed. Retry the same change or reload to check your profile.');
  const data=await response.json();if(current!==generation)return;render(data.account);key='';signature='';message.textContent='Your personal profile is saved.';
 }catch(error){if(current===generation){message.textContent=(error as Error).message;fields.disabled=!loaded;}}
 finally{saving=false;if(current===generation)reload.disabled=false;}
};
reload.addEventListener('click',()=>void load());
q('#sign-out').addEventListener('click',()=>{generation++;clearAccessToken();clear();reload.disabled=false;message.textContent='Signed out.';});
void load();

const returnCourse=pendingCandidateCourseUrl();if(returnCourse){const link=document.createElement('a');link.href=returnCourse;link.textContent='Return to selected course';document.querySelector('nav')?.append(link);}
