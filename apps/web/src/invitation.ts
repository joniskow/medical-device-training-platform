import { authenticatedFetch,getAccessToken,clearAccessToken} from './auth-session.js';
const q=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const organization=q<HTMLInputElement>('#organization'),invitation=q<HTMLInputElement>('#invitation'),token=q<HTMLInputElement>('#token'),message=q<HTMLElement>('#message'),preview=q<HTMLElement>('#preview'),details=q<HTMLFieldSetElement>('#details'),confirmed=q<HTMLInputElement>('#confirmed'),accept=q<HTMLButtonElement>('#accept');
let generation=0,reviewed:{organizationId:string;invitationId:string;token:string;role:string}|undefined;
// Fragments are not sent to the server. Remove the secret before subsequent navigation.
const fragment=new URLSearchParams(window.location.hash.slice(1));
history.replaceState(null,'',window.location.pathname);
organization.value=fragment.get('organizationId')??'';invitation.value=fragment.get('invitationId')??'';token.value=fragment.get('token')??'';
for(const key of [...fragment.keys()])fragment.delete(key);
function clearReview(){reviewed=undefined;preview.hidden=true;confirmed.checked=false;accept.disabled=true;q('#organization-name').textContent='';q('#role').textContent='';}
q('#sign-out').onclick=()=>{generation++;clearAccessToken();organization.value='';invitation.value='';token.value='';details.disabled=true;clearReview();message.textContent='Signed out. Reopen the invitation after signing in.';};
q('#invitation-form').addEventListener('input',()=>{generation++;clearReview();});
confirmed.onchange=()=>{accept.disabled=!confirmed.checked||!reviewed;};
q<HTMLFormElement>('#invitation-form').onsubmit=async event=>{
 event.preventDefault();const current=++generation;clearReview();details.disabled=true;message.textContent='Checking invitation...';
 const input={organizationId:organization.value.trim(),invitationId:invitation.value.trim(),token:token.value.trim()};
 try{
  if(!getAccessToken())throw Error('Sign in with your verified email and reopen the invitation.');
  const response=await authenticatedFetch('/api/v1/invitations/preview',{method:'POST',headers:{authorization:`Bearer ${getAccessToken()}`,'content-type':'application/json'},body:JSON.stringify(input)});
  if(!response.ok)throw Error('This invitation is unavailable. Check your account or request a new invitation.');
  const data=await response.json();if(current!==generation)return;
  reviewed={...input,role:data.role};q('#organization-name').textContent=data.organizationName;q('#role').textContent=data.role;preview.hidden=false;message.textContent='Review the organization and role before joining.';
 }catch(error){if(current===generation)message.textContent=(error as Error).message;}
 finally{if(current===generation)details.disabled=false;}
};
accept.onclick=async()=>{
 if(!reviewed||!confirmed.checked)return;const current=++generation,input=reviewed;details.disabled=true;accept.disabled=true;
 try{
  const response=await authenticatedFetch('/api/v1/invitations/accept',{method:'POST',headers:{authorization:`Bearer ${getAccessToken()}`,'content-type':'application/json'},body:JSON.stringify({...input,confirmed:true})});
  if(!response.ok)throw Error('The invitation could not be accepted. Check My organizations in case an earlier request succeeded.');
  if(current!==generation)return;token.value='';clearReview();message.textContent='You joined the organization. Open My organizations to select it.';
 }catch(error){if(current===generation){clearReview();token.value='';message.textContent=(error as Error).message+' Reopen the invitation to retry.';}}
 finally{if(current===generation)details.disabled=false;}
};
