import {authenticatedFetch,getAccessToken,getSessionIdentity,setOrganizationId,clearAccessToken} from './auth-session.js';
const host=document.querySelector<HTMLElement>('#courses')!,message=document.querySelector<HTMLElement>('#message')!,reload=document.querySelector<HTMLButtonElement>('#reload')!,more=document.querySelector<HTMLButtonElement>('#more')!,signOut=document.querySelector<HTMLButtonElement>('#sign-out')!;
let generation=0,cursor:string|undefined;
const text=(tag:string,value:string)=>{const node=document.createElement(tag);node.textContent=value;return node;};
async function load(append=false){
 const request=++generation,identity=getSessionIdentity();if(!append){host.replaceChildren();cursor=undefined;}reload.disabled=true;more.disabled=true;more.hidden=true;message.textContent='Loading your candidate training…';
 try{
  if(!getAccessToken())throw Error('Sign in to view your candidate training.');
  const response=await authenticatedFetch('/api/v1/my-candidate-enrollments'+(cursor?'?after='+encodeURIComponent(cursor):''));
  if(!response.ok)throw Error('Your training could not be loaded. Refresh or sign in again.');
  const data=await response.json();if(request!==generation||identity!==getSessionIdentity())return;
  for(const item of data.items){
   const article=document.createElement('article');article.append(text('h2',item.title),text('p',`Issued by ${item.issuerName}`));const open=document.createElement('button');open.type='button';open.textContent='Open training';
   open.onclick=()=>{if(identity!==getSessionIdentity()){host.replaceChildren();message.textContent='Your session changed. Refresh your training list.';return;}setOrganizationId(item.organizationId);location.assign('/learner/courses?enrollment='+encodeURIComponent(item.enrollmentId));};article.append(open);host.append(article);
  }
  cursor=data.nextCursor??undefined;more.hidden=!cursor;message.textContent=host.childElementCount?'Choose a course to continue.':cursor?'Continue to the next page to check for available training.':'No active candidate training is available. Browse the catalog to choose a course.';
 }catch(error){if(request===generation&&identity===getSessionIdentity()){message.textContent=(error as Error).message;if(append)more.hidden=!cursor;}}
 finally{if(request===generation){reload.disabled=false;more.disabled=false;}}
}
reload.onclick=()=>void load();more.onclick=()=>void load(true);signOut.hidden=!getAccessToken();signOut.onclick=()=>{generation++;host.replaceChildren();cursor=undefined;more.hidden=true;reload.disabled=false;clearAccessToken();message.textContent='Signed out.';signOut.hidden=true;};void load();
