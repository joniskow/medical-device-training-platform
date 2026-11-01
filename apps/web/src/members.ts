import { authenticatedFetch,getAccessToken,getOrganizationHeaders,clearAccessToken} from './auth-session.js';
const q=<T extends HTMLElement>(id:string)=>document.querySelector<T>(id)!;
let epoch=0,cursor:string|null=null;const seen=new Set<string>();
const message=(value:string)=>{q('#message').textContent=value;};
async function api(path:string,body?:unknown,key?:string){
  const token=getAccessToken();if(!token)throw Error('Sign in with an organization administrator account.');
  const response=await authenticatedFetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...getOrganizationHeaders(),...(body?{'content-type':'application/json','idempotency-key':key!}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error?.code==='ORGANIZATION_CONTEXT_REQUIRED'?'Choose an organization before managing members.':response.status===403?'You no longer have administrator access to this organization.':data.error?.message??'Request failed. Retry safely or refresh the member list.');
  return data;
}
function clear(){epoch++;cursor=null;seen.clear();q('#members').replaceChildren();q('#more').hidden=true;}
function statusForm(member:Record<string,any>,current:number){
  const form=document.createElement('form'),fields=document.createElement('fieldset'),legend=document.createElement('legend');form.dataset.kind='status';legend.textContent='Membership access';fields.append(legend);
  const actionLabel=document.createElement('label'),action=document.createElement('select');actionLabel.textContent='Action';actionLabel.append(action);
  for(const [value,label] of [['ACTIVE','Reactivate'],['SUSPENDED','Suspend'],['REMOVED','Remove']])if(value!==member.status&&(member.status!=='REMOVED'||value==='ACTIVE'))action.add(new Option(label,value));
  const explanation=document.createElement('p');explanation.textContent='Suspension blocks organization access and retains roles. Removal also clears assigned roles. Reactivating a removed member restores learner access only. Training and credential history is preserved.';
  const reasonLabel=document.createElement('label'),reason=document.createElement('textarea'),save=document.createElement('button');reasonLabel.textContent='Reason for access change';reason.required=true;reason.maxLength=2000;reasonLabel.append(reason);save.type='submit';save.textContent='Change membership';fields.append(actionLabel,explanation,reasonLabel,save);form.append(fields);
  let signature='',key='';
  form.onsubmit=async event=>{
    event.preventDefault();const value=reason.value.trim();if(!value)return;
    if(!window.confirm(`${action.selectedOptions[0].textContent} ${member.subject}? ${explanation.textContent}`))return;
    const next=JSON.stringify([action.value,value]);if(next!==signature){signature=next;key=crypto.randomUUID();}fields.disabled=true;
    try{await api(`members/${encodeURIComponent(member.subject)}/status`,{status:action.value,reason:value,revision:member.revision},key);if(current!==epoch)return;const loaded=await load();if(loaded&&current+1===epoch)message('Membership updated. Access changes on the next request.');}
    catch(error){if(current===epoch){message((error as Error).message);fields.disabled=false;}}
  };
  return form;
}
async function load(append=false){
  if(!append){clear();message('Loading members...');}const current=epoch;
  try{
    const data=await api(`members${append&&cursor?`?after=${encodeURIComponent(cursor)}`:''}`);if(current!==epoch)return;
    for(const member of data.items){
      if(seen.has(member.subject))continue;seen.add(member.subject);
      const article=document.createElement('article'),title=document.createElement('h2'),state=document.createElement('p');title.textContent=member.subject;state.textContent=`${member.status} · ${member.roles.join(', ')}`;article.append(title,state);q('#members').append(article);
      if(member.status!=='ACTIVE'){article.append(statusForm(member,current));continue;}
      const form=document.createElement('form'),fields=document.createElement('fieldset'),legend=document.createElement('legend');form.dataset.kind='roles';legend.textContent='Organization roles';fields.append(legend);
      const boxes:HTMLInputElement[]=[];
      for(const role of data.allowedRoles){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=role;box.checked=member.roles.includes(role);label.append(box,document.createTextNode(role.replaceAll('_',' ')));fields.append(label);boxes.push(box);}
      const label=document.createElement('label'),reason=document.createElement('textarea'),save=document.createElement('button');label.textContent='Reason for this role change';reason.required=true;reason.maxLength=2000;label.append(reason);save.type='submit';save.textContent='Save roles';fields.append(label,save);form.append(fields);article.append(form);
      let signature='',key='';
      form.onsubmit=async event=>{
        event.preventDefault();const roles=boxes.filter(box=>box.checked).map(box=>box.value).sort(),value=reason.value.trim();if(!roles.length||!value){message('Select at least one role and enter a reason.');return;}
        if(!window.confirm(`Change ${member.subject}'s roles to ${roles.join(', ')}? Access changes on their next request.`))return;
        const next=JSON.stringify([roles,value]);if(next!==signature){signature=next;key=crypto.randomUUID();}fields.disabled=true;
        try{await api(`members/${encodeURIComponent(member.subject)}/roles`,{roles,reason:value,revision:member.revision},key);if(current!==epoch)return;const loaded=await load();if(loaded&&current+1===epoch)message('Roles saved. Access changes on the next request.');}
        catch(error){if(current===epoch){message((error as Error).message);fields.disabled=false;}}
      };
      article.append(statusForm(member,current));
    }
    cursor=data.nextCursor;q('#more').hidden=!cursor;message(!seen.size?'No organization members found.':'');return true;
  }catch(error){if(current===epoch)message((error as Error).message);return false;}
}
q('#refresh').onclick=()=>void load();q('#more').onclick=()=>void load(true);q('#sign-out').onclick=()=>{clear();clearAccessToken();message('Signed out.');};
void load();
