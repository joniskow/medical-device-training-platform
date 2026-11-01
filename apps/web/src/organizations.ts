import { authenticatedFetch,getAccessToken,getOrganizationHeaders,setOrganizationId,clearAccessToken} from './auth-session.js';
const choices=document.querySelector<HTMLSelectElement>('#organizations')!,message=document.querySelector<HTMLElement>('#message')!,fields=document.querySelector<HTMLFieldSetElement>('#selection')!;
const creation=document.querySelector<HTMLFieldSetElement>('#creation')!,nameInput=document.querySelector<HTMLInputElement>('#organization-name')!,createMessage=document.querySelector<HTMLElement>('#create-message')!;
let generation=0,key='',target='',createKey='',createName='',creating=false;
document.querySelector('#sign-out')!.addEventListener('click',()=>{generation++;clearAccessToken();creation.disabled=true;nameInput.value='';createMessage.textContent='';createKey='';createName='';choices.replaceChildren();fields.disabled=true;message.textContent='Signed out.';});
async function load(){
  const current=++generation;creation.disabled=creating||!getAccessToken();fields.disabled=true;choices.replaceChildren();message.textContent='Loading your organizations…';
  try{
    const token=getAccessToken();if(!token)throw Error('Sign in before choosing an organization.');
    const response=await authenticatedFetch('/api/v1/organization-contexts',{headers:{authorization:`Bearer ${token}`}});
    if(!response.ok)throw Error('Organizations could not be loaded. Refresh to retry.');
    const data=await response.json();if(current!==generation)return false;
    choices.add(new Option('Choose an organization',''));
    for(const item of data.items)choices.add(new Option(item.name??item.organizationId,item.organizationId));
    choices.value=getOrganizationHeaders()['x-organization-id']??'';
    fields.disabled=!data.items.length;message.textContent=data.items.length?'Choose the organization you want to work in. Switching reloads the workspace.':'You have no active organization memberships. Create an organization or contact your administrator.';return true;
  }catch(error){if(current===generation)message.textContent=(error as Error).message;return false;}
}
document.querySelector<HTMLFormElement>('#organization-form')!.onsubmit=async event=>{
  event.preventDefault();const selected=choices.value,current=generation;if(!selected)return;
  if(target!==selected){target=selected;key=crypto.randomUUID();}fields.disabled=true;
  try{
    const response=await authenticatedFetch(`/api/v1/organization-contexts/${encodeURIComponent(selected)}/select`,{method:'POST',headers:{authorization:`Bearer ${getAccessToken()}`,'content-type':'application/json','idempotency-key':key},body:'{}'});
    if(!response.ok)throw Error(response.status===403?'Your membership changed. Refresh the organization list.':'Selection failed. Retry to keep the same request.');
    if(current!==generation)return;setOrganizationId(selected);window.location.replace('/author/jobs');
  }catch(error){if(current===generation){message.textContent=(error as Error).message;fields.disabled=false;}}
};
document.querySelector<HTMLFormElement>('#create-form')!.onsubmit=async event=>{
  event.preventDefault();const name=nameInput.value.trim(),current=generation;if(!name||creating)return;
  if(name!==createName){createName=name;createKey=crypto.randomUUID();}
  creating=true;creation.disabled=true;createMessage.textContent='Creating organization...';
  try{
    const response=await authenticatedFetch('/api/v1/organization-contexts',{method:'POST',headers:{authorization:`Bearer ${getAccessToken()}`,'content-type':'application/json','idempotency-key':createKey},body:JSON.stringify({name})});
    if(!response.ok)throw Error(response.status===409?'This request conflicts with an earlier creation or your access changed. Refresh to check your organizations.':'Creation failed. Retry to keep the same request.');
    const result=await response.json();if(current!==generation)return;
    const loaded=await load();if(current+1!==generation)return;
    if(!loaded){createMessage.textContent='Organization created. Refresh your organizations to continue.';return;}
    choices.value=result.organizationId;nameInput.value='';createMessage.textContent='Organization created. Choose Use this organization to continue.';
  }catch(error){if(current===generation)createMessage.textContent=(error as Error).message;}
  finally{creating=false;creation.disabled=!getAccessToken();}
};
document.querySelector('#refresh')!.addEventListener('click',()=>void load());
void load();
