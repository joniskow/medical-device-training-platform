import {authenticatedFetch,getAccessToken,getSessionIdentity,clearAccessToken} from './auth-session.js';
import {renderVerificationQr} from './verification-qr.js';
const host=document.querySelector<HTMLElement>('#courses')!,message=document.querySelector<HTMLElement>('#message')!,reload=document.querySelector<HTMLButtonElement>('#reload')!,more=document.querySelector<HTMLButtonElement>('#more')!,signOut=document.querySelector<HTMLButtonElement>('#sign-out')!;
let generation=0,cursor:string|undefined,saving=false;
const text=(tag:string,value:string)=>{const node=document.createElement(tag);node.textContent=value;return node;};
function render(item:any,article:HTMLElement,identity:string){
 article.replaceChildren(text('h2',item.title),text('p',`Issued by ${item.issuerName}`),text('p',`${item.status} / Issued ${new Date(item.issuedAt).toLocaleDateString()}${item.expiresAt?' / Expires '+new Date(item.expiresAt).toLocaleDateString():''}`),text('p',item.intendedUse));
 const live=()=>article.isConnected&&identity===getSessionIdentity();
 const status=text('p','');status.setAttribute('role','status');
 if(item.verificationEnabled&&typeof item.publicId==='string'){
  const url=new URL('/verify',location.origin);url.searchParams.set('credential',item.publicId);
  const link=document.createElement('a');link.href=url.href;link.textContent='Open public verification';article.append(link);
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy verification link';copy.onclick=async()=>{if(!live())return;try{await navigator.clipboard.writeText(url.href);if(live())status.textContent='Link copied. Sharing does not enable discovery.';}catch{if(live())status.textContent='Copy failed. Use the public verification link.';}};article.append(copy);
  const canvas=document.createElement('canvas');canvas.hidden=true;canvas.style.maxWidth='100%';canvas.style.height='auto';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','QR code containing this credential verification URL');
  const qr=document.createElement('button');qr.type='button';qr.textContent='Show verification QR';qr.onclick=async()=>{if(!live())return;qr.disabled=true;try{await renderVerificationQr(canvas,url.href);if(live()&&canvas.isConnected)canvas.hidden=false;}catch{if(live())status.textContent='QR code could not be displayed. Use the verification link.';}finally{qr.disabled=false;}};article.append(qr,canvas);
 }else article.append(text('p','Public sharing is disabled.'));
 if(item.verificationAllowed){
  const change=document.createElement('button');change.type='button';change.textContent=item.verificationEnabled?'Disable public sharing':'Enable public sharing';const key=crypto.randomUUID();let locked=false;
  change.onclick=async()=>{
   if(saving||locked||!live())return;
   if(!window.confirm(item.verificationEnabled?'Disable public verification for this credential?':'Enable public verification for anyone with the link? This does not enable employer discovery.'))return;
   const request=generation;saving=true;change.disabled=true;reload.disabled=true;more.disabled=true;status.textContent='Updating sharing...';
   try{
    const response=await authenticatedFetch('/api/v1/my-credentials/'+encodeURIComponent(item.credentialId)+'/sharing',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({enabled:!item.verificationEnabled,revision:item.sharingRevision})});
    if(request!==generation||!live())return;
    if([401,403,404].includes(response.status)){host.replaceChildren();cursor=undefined;more.hidden=true;message.textContent='Your access changed. Refresh or sign in again.';return;}
    if(response.status===409){locked=true;throw Error('Sharing changed. Refresh your credentials before retrying.');}
    if(!response.ok)throw Error('Sharing could not be confirmed. Retry the same change or refresh to check its status.');
    const updated=await response.json();if(request!==generation||!live())return;
    render({...item,...updated},article,identity);message.textContent='Sharing updated. Employer discovery remains a separate choice.';
   }catch(error){if(request===generation&&live())status.textContent=(error as Error).message;}
   finally{saving=false;if(request===generation){reload.disabled=false;more.disabled=false;if(change.isConnected)change.disabled=locked;}}
  };article.append(change);
 }
 article.append(status);
}
async function load(append=false){
 if(saving)return;
 const request=++generation,identity=getSessionIdentity();if(!append){host.replaceChildren();cursor=undefined;}reload.disabled=true;more.disabled=true;more.hidden=true;message.textContent='Loading your credentials...';
 try{
  if(!getAccessToken())throw Error('Sign in to view your credentials.');
  const response=await authenticatedFetch('/api/v1/my-credentials'+(cursor?'?after='+encodeURIComponent(cursor):''));
  if(!response.ok)throw Error('Your credentials could not be loaded. Refresh or sign in again.');
  const data=await response.json();if(request!==generation||identity!==getSessionIdentity())return;
  for(const item of data.items){const article=document.createElement('article');render(item,article,identity);host.append(article);}
  cursor=data.nextCursor??undefined;more.hidden=!cursor;message.textContent=host.childElementCount?'Your records include expired, revoked and superseded credentials.':cursor?'Continue to the next page to check for credentials.':'No credentials have been issued to this account.';
 }catch(error){if(request===generation&&identity===getSessionIdentity()){message.textContent=(error as Error).message;if(append)more.hidden=!cursor;}}
 finally{if(request===generation){reload.disabled=false;more.disabled=false;}}
}
reload.onclick=()=>void load();more.onclick=()=>void load(true);signOut.hidden=!getAccessToken();signOut.onclick=()=>{generation++;host.replaceChildren();cursor=undefined;more.hidden=true;reload.disabled=false;clearAccessToken();message.textContent='Signed out.';signOut.hidden=true;};void load();
