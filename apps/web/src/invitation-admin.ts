import { authenticatedFetch,getAccessToken,getOrganizationHeaders,clearAccessToken} from './auth-session.js';
const q=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const creation=q<HTMLFieldSetElement>('#creation'),email=q<HTMLInputElement>('#email'),role=q<HTMLSelectElement>('#role'),more=q<HTMLButtonElement>('#more');
let epoch=0,cursor:string|null=null,loading=false,mutation=false,signature='',key='';
const seen=new Set<string>();
const message=(text:string)=>{q('#message').textContent=text;};
function clear(){epoch++;cursor=null;seen.clear();q('#invitations').replaceChildren();more.hidden=true;creation.disabled=true;}
class AccessLost extends Error{}
async function api(path:string,body?:unknown,idempotencyKey?:string){
 if(!getAccessToken())throw new AccessLost('Sign in with an organization administrator account.');
 const response=await authenticatedFetch('/api/v1/invitations'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${getAccessToken()}`,...getOrganizationHeaders(),...(body?{'content-type':'application/json'}:{}),...(idempotencyKey?{'idempotency-key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(response.status===401||response.status===403)throw new AccessLost('Administrator access is unavailable. Choose your organization or sign in again.');
 if(!response.ok)throw Error(data.error?.code==='ORGANIZATION_CONTEXT_REQUIRED'?'Choose an organization before managing invitations.':response.status===503?'Invitation creation is not configured. Contact your platform administrator.':data.error?.message??'Request failed. Refresh or retry.');
 return data;
}
function failure(error:unknown,current:number){if(current!==epoch)return;if(error instanceof AccessLost){clear();email.value='';role.replaceChildren();}message((error as Error).message);}
const emailStates:Record<string,string>={PROVIDER_DELIVERED:'Accepted by recipient mail server',PROVIDER_BOUNCED:'Hard bounce; further invitations to this address are suppressed',PROVIDER_SUPPRESSED:'Suppressed by email provider',PROVIDER_QUARANTINED:'Quarantined by recipient mail system',PROVIDER_FILTEREDSPAM:'Blocked as spam',PROVIDER_EXPANDED:'Distribution list expanded; delivery unconfirmed',PROVIDER_FAILED:'Provider reported delivery failure',SUPPRESSED:'Not sent; this address is suppressed',RATE_LIMITED:'Waiting for sending capacity',SENDING:'Processing',ACCEPTED:'Accepted by email provider; inbox delivery unconfirmed',RETRY_PENDING:'Retry queued',FAILED:'Failed; contact your platform administrator',SKIPPED:'Not sent because the invitation is no longer valid'};
function render(item:Record<string,any>,current:number){
 const article=document.createElement('article'),title=document.createElement('h2'),summary=document.createElement('p');title.textContent=item.intendedEmail;summary.textContent=`${item.role.replaceAll('_',' ')} | ${item.status} | Expires ${new Date(item.expiresAt).toLocaleString()}`;const delivery=document.createElement('p');delivery.textContent='Email: '+(emailStates[item.emailStatus]??'Queued; provider acceptance unconfirmed');article.append(title,summary,delivery);
 if(item.status==='PENDING'){
  const form=document.createElement('form'),fields=document.createElement('fieldset'),legend=document.createElement('legend'),label=document.createElement('label'),reason=document.createElement('textarea'),button=document.createElement('button');
  legend.textContent='Revoke invitation';label.textContent='Reason';reason.required=true;reason.maxLength=2000;label.append(reason);button.type='submit';button.textContent='Revoke invitation';fields.append(legend,label,button);form.append(fields);article.append(form);
  form.onsubmit=async event=>{
   event.preventDefault();if(mutation||!reason.value.trim()||current!==epoch)return;
   if(!window.confirm(`Revoke the invitation for ${item.intendedEmail}? They will no longer be able to use it.`))return;
   mutation=true;fields.disabled=true;creation.disabled=true;
   try{await api('/'+encodeURIComponent(item.invitationId)+'/revoke',{reason:reason.value.trim()});if(current!==epoch)return;mutation=false;const loaded=await load();if(loaded&&current+1===epoch)message('Invitation revoked.');}
   catch(error){failure(error,current);if(current===epoch){fields.disabled=false;creation.disabled=false;}}
   finally{mutation=false;}
  };
 }
 q('#invitations').append(article);
}
async function load(append=false){
 if(append&&loading)return false;
 if(!append){clear();message('Loading invitations...');}
 const current=epoch;loading=true;more.disabled=true;
 try{
  const data=await api(append&&cursor?'?after='+encodeURIComponent(cursor):'');if(current!==epoch)return false;
  if(!append){const prior=role.value;role.replaceChildren();for(const allowed of data.allowedRoles)role.add(new Option(allowed.replaceAll('_',' '),allowed));if(data.allowedRoles.includes(prior))role.value=prior;}
  for(const item of data.items)if(!seen.has(item.invitationId)){seen.add(item.invitationId);render(item,current);}
  cursor=data.nextCursor;more.hidden=!cursor;creation.disabled=mutation;message(seen.size?'':'No invitations yet.');return true;
 }catch(error){failure(error,current);return false;}
 finally{if(current===epoch){loading=false;more.disabled=false;}}
}
q<HTMLFormElement>('#create-form').onsubmit=async event=>{
 event.preventDefault();if(mutation||creation.disabled)return;
 const body={email:email.value.trim().toLowerCase(),role:role.value},current=epoch;
 if(!body.email||!body.role)return;
 if(!window.confirm(`Invite ${body.email} as ${body.role.replaceAll('_',' ')}?`))return;
 const next=JSON.stringify(body);if(next!==signature){signature=next;key=crypto.randomUUID();}
 mutation=true;creation.disabled=true;
 try{
  await api('',body,key);if(current!==epoch)return;email.value='';signature='';key='';mutation=false;
  const loaded=await load();if(loaded&&current+1===epoch)message('Invitation created. Email delivery is queued, not confirmed.');
 }catch(error){failure(error,current);if(current===epoch)creation.disabled=false;}
 finally{mutation=false;}
};
q('#refresh').onclick=()=>{if(!mutation)void load();};
more.onclick=()=>{if(!mutation)void load(true);};
q('#sign-out').onclick=()=>{clear();clearAccessToken();email.value='';role.replaceChildren();signature='';key='';message('Signed out.');};
void load();
