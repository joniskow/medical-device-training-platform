import { authenticatedFetch,getAccessToken,getOrganizationHeaders,clearAccessToken} from './auth-session.js';
const q=<T extends Element>(selector:string)=>document.querySelector<T>(selector)!;
const fields=q<HTMLFieldSetElement>('#profile-fields'),reload=q<HTMLButtonElement>('#reload'),message=q<HTMLElement>('#message'),context=q<HTMLElement>('#context');
const name=q<HTMLInputElement>('#profile-name'),description=q<HTMLTextAreaElement>('#profile-description'),website=q<HTMLInputElement>('#profile-website'),reason=q<HTMLTextAreaElement>('#profile-reason');
let generation=0,revision=0,key='',signature='',saving=false;
const headers=()=>({authorization:`Bearer ${getAccessToken()}`,...getOrganizationHeaders()});
function clear(){revision=0;key='';signature='';fields.disabled=true;name.value='';description.value='';website.value='';reason.value='';context.textContent='';}
function render(data:{organizationId:string;name:string;description:string;website:string;revision:number}){name.value=data.name;description.value=data.description;website.value=data.website;revision=data.revision;context.textContent=`Editing: ${data.name} (${data.organizationId})`;fields.disabled=false;}
async function load(){
 if(saving)return;const current=++generation;clear();message.textContent='Loading organization profile…';
 try{
  if(!getAccessToken())throw Error('Sign in before editing organization settings.');
  const response=await authenticatedFetch('/api/v1/organization-profile',{headers:headers()});
  if(!response.ok)throw Error(response.status===403?'Administrator access is required for this organization.':response.status===409?'Choose an organization before editing settings.':'Profile could not be loaded. Reload to retry.');
  const data=await response.json();if(current!==generation)return;render(data);message.textContent='Make your changes and provide a reason before saving.';
 }catch(error){if(current===generation)message.textContent=(error as Error).message;}
}
q<HTMLFormElement>('#profile-form').onsubmit=async event=>{
 event.preventDefault();if(saving||!revision)return;
 const body={name:name.value.trim(),description:description.value.trim(),website:website.value.trim(),revision,reason:reason.value.trim()},encoded=JSON.stringify(body),current=generation;
 if(encoded!==signature){signature=encoded;key=crypto.randomUUID();}
 saving=true;fields.disabled=true;reload.disabled=true;message.textContent='Saving profile…';
 try{
  const response=await authenticatedFetch('/api/v1/organization-profile',{method:'POST',headers:{...headers(),'content-type':'application/json','idempotency-key':key},body:encoded});
  if(current!==generation)return;
  if([401,403].includes(response.status)){clear();throw Error('Your access changed. Sign in or select an organization again.');}
  if(response.status===409){revision=0;throw Error('The profile changed. Reload the saved profile before editing again.');}
  if(!response.ok)throw Error(response.status===422?'Check the name, HTTPS website and reason, then retry.':'Save could not be confirmed. Retry the same change or reload to check the saved profile.');
  const data=await response.json();if(current!==generation)return;render(data);reason.value='';key='';signature='';message.textContent='Organization profile saved.';
 }catch(error){if(current===generation){message.textContent=(error as Error).message;fields.disabled=!revision;}}
 finally{saving=false;if(current===generation)reload.disabled=false;}
};
reload.addEventListener('click',()=>void load());
q('#sign-out').addEventListener('click',()=>{generation++;clearAccessToken();clear();reload.disabled=false;message.textContent='Signed out.';});
void load();
