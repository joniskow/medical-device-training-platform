import {authenticatedFetch,getAccessToken,getSessionIdentity,setOrganizationId,clearAccessToken,rememberCandidateCourse} from './auth-session.js';
type CertificationSummary={credentialIssuance?:'DISABLED';version:number;passScore:number;maxAttempts:number;cooldownSeconds:number;attemptTtlSeconds:number;repeatedFailureReviewAfter:number|null;expirationDays:number|null;resultSelection:string;requiredActivities:{title:string;kind:string;passScore:number|null}[]};
type CatalogCourse={publishedRevision?:number|null;certification?:CertificationSummary|null;publicId:string;title:string;issuerName:string;revision:number;audience:string;productScope:string;prerequisites:string;issuerStatement:string;intendedUse:string;accessibilityPath:string;estimatedMinutes:number;costDesignation:string;enrollmentNotice?:{version:string;text:string}};
const host=document.querySelector<HTMLElement>('#courses')!,message=document.querySelector<HTMLElement>('#message')!,reload=document.querySelector<HTMLButtonElement>('#reload')!,more=document.querySelector<HTMLButtonElement>('#more')!;
const publicId=new URLSearchParams(location.search).get('course');
let cursor:string|undefined,generation=0,enrolling=false;
const text=(tag:string,value:string)=>{const node=document.createElement(tag);node.textContent=value;return node;};
function render(course:CatalogCourse){
 const article=document.createElement('article');article.append(text('h2',course.title),text('p',`Issued by ${course.issuerName}`));
 if(publicId){
  const details=document.createElement('dl');
  for(const [label,value] of [['Audience',course.audience],['Product scope',course.productScope],['Prerequisites',course.prerequisites],['Issuer statement',course.issuerStatement],['Intended use',course.intendedUse],['Accessibility path',course.accessibilityPath],['Estimated effort',`${course.estimatedMinutes} minutes`],['Cost','Free']])details.append(text('dt',label),text('dd',value));
  article.append(details);renderRequirements(course,article);enrollmentForm(course,article);
 }else{
  article.append(text('p',course.productScope),text('p',`${course.estimatedMinutes} minutes · Free`));
  const link=document.createElement('a');link.textContent='View course details';link.href=`/catalog?course=${encodeURIComponent(course.publicId)}`;article.append(link);
 }
 host.append(article);
}
async function load(append=false){
 if(enrolling)return;
 const current=++generation;reload.disabled=true;more.disabled=true;more.hidden=true;
 if(!append){host.replaceChildren();cursor=undefined;}message.textContent='Loading courses…';
 try{
  const path=publicId?`/api/v1/catalog/${encodeURIComponent(publicId)}`:`/api/v1/catalog${cursor?'?after='+encodeURIComponent(cursor):''}`;
  const response=await fetch(path,{cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok)throw Error(response.status===404?'This course is not available.':response.status===429?'Too many requests. Wait a minute, then refresh.':'Courses could not be loaded. Refresh to retry.');
  const data=await response.json();if(current!==generation)return;
  for(const course of publicId?[data]:data.items)render(course);
  cursor=publicId?undefined:data.nextCursor??undefined;more.hidden=!cursor;
  message.textContent=host.childElementCount?'Course information is current as of this request.':cursor?'No available courses on this page. Continue to the next page.':'No public courses are available.';
 }catch(error){if(current===generation){message.textContent=(error as Error).message;if(append)more.hidden=!cursor;}}
 finally{if(current===generation){reload.disabled=false;more.disabled=false;}}
}
reload.onclick=()=>void load();more.onclick=()=>void load(true);void load();

function enrollmentForm(course:CatalogCourse,article:HTMLElement){
 if(!getAccessToken()){
  article.append(text('p','Sign in and create your personal profile before enrolling. You can then return to this course.'));
  const signIn=document.createElement('a');signIn.href='/signin';signIn.textContent='Sign in or create an account';signIn.onclick=()=>rememberCandidateCourse(course.publicId);article.append(signIn);return;
 }
 if(!course.enrollmentNotice?.version||!course.enrollmentNotice.text){article.append(text('p','Enrollment information is unavailable. Refresh to retry.'));return;}
 const form=document.createElement('form'),label=document.createElement('label'),checkbox=document.createElement('input'),submit=document.createElement('button'),status=text('p','');
 checkbox.type='checkbox';checkbox.required=true;checkbox.id='enrollment-consent';label.htmlFor=checkbox.id;label.append(checkbox,document.createTextNode(course.enrollmentNotice.text));
 submit.type='submit';submit.textContent='Enroll for free';status.setAttribute('role','status');form.append(label,submit,status);article.append(form);
 const profile=document.createElement('a');profile.href='/account';profile.textContent='Create or review my personal profile';profile.onclick=()=>rememberCandidateCourse(course.publicId);article.append(profile);
 const identity=getSessionIdentity(),request= generation,key=crypto.randomUUID();let locked=false;
 form.onsubmit=async event=>{
  event.preventDefault();if(enrolling||locked||!checkbox.checked)return;
  if(identity!==getSessionIdentity()){form.remove();message.textContent='Your session changed. Refresh before enrolling.';return;}
  enrolling=true;submit.disabled=true;checkbox.disabled=true;reload.disabled=true;status.textContent='Confirming enrollment…';
  try{
   const response=await authenticatedFetch('/api/v1/candidate-enrollments',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({publicId:course.publicId,revision:course.revision,noticeVersion:course.enrollmentNotice!.version,confirmed:true})});
   if(request!==generation||identity!==getSessionIdentity())return;
   if([401,403].includes(response.status)){locked=true;throw Error('Create your personal profile and sign in with a verified email before enrolling.');}
   if([404,409,422].includes(response.status)){locked=true;checkbox.checked=false;throw Error('Course information changed or access is unavailable. Refresh and review the disclosures again.');}
   if(!response.ok)throw Error('Enrollment could not be confirmed. Retry the same request, or check My candidate training.');
   const result=await response.json();if(request!==generation||identity!==getSessionIdentity())return;
   if(typeof result.organizationId!=='string'||typeof result.enrollmentId!=='string')throw Error('Enrollment could not be confirmed. Check My candidate training.');
   locked=true;form.replaceChildren(text('p','You are enrolled. Sharing and discovery remain separate choices.'));
   const open=document.createElement('button');open.type='button';open.textContent='Open training';open.onclick=()=>{if(identity!==getSessionIdentity()){message.textContent='Your session changed. Open My candidate training to continue.';return;}setOrganizationId(result.organizationId);location.assign('/learner/courses?enrollment='+encodeURIComponent(result.enrollmentId));};form.append(open);
  }catch(error){if(request===generation&&identity===getSessionIdentity())status.textContent=(error as Error).message;}
  finally{enrolling=false;if(request===generation){reload.disabled=false;submit.disabled=locked;checkbox.disabled=locked;}}
 };
}
const signOut=document.querySelector<HTMLButtonElement>('#sign-out')!;signOut.hidden=!getAccessToken();signOut.onclick=()=>{generation++;enrolling=false;host.replaceChildren();more.hidden=true;reload.disabled=false;clearAccessToken();signOut.hidden=true;message.textContent='Signed out. Refresh to browse courses.';};

function renderRequirements(course:CatalogCourse,article:HTMLElement){
 article.append(text('h3','Published course and certification requirements'),text('p',course.publishedRevision==null?'Published revision is unavailable.':`Published revision ${course.publishedRevision}.`));
 const c=course.certification;
 if(!c){article.append(text('p','Certification requirements are unavailable. Ask the issuer before enrolling if you need a credential.'));return;}
 if(c.credentialIssuance==='DISABLED'){article.append(text('p','This is a familiarization course. Activity results are recorded, but no credential is issued.'));return;}
 const percent=(value:number)=>`${Number((value*100).toFixed(4))}%`;
 article.append(text('p',`Certification policy version ${c.version}. Complete every required activity and meet an overall score of at least ${percent(c.passScore)} across scored activities. ${c.resultSelection==='best'?'The best completed result':'The latest attempt'} is used for each activity.`));
 const list=document.createElement('ul');for(const activity of c.requiredActivities)list.append(text('li',`${activity.title}: ${activity.kind==='assessment'?'assessment':activity.kind==='simulation'?'interactive simulation':'content completion'}${activity.passScore===null?'':`, passing score ${percent(activity.passScore)}`}.`));article.append(list);
 article.append(text('p',`Up to ${c.maxAttempts} attempts per scored activity under the published policy. Retry cooldown: ${c.cooldownSeconds} seconds. Attempt time limit: ${c.attemptTtlSeconds} seconds.${c.repeatedFailureReviewAfter===null?'':` Administrator review is required after ${c.repeatedFailureReviewAfter} failed attempts.`}`));
 article.append(text('p',c.expirationDays===null?'The credential has no scheduled expiration.':`The credential expires ${c.expirationDays} days after issuance.`),text('p','These are the standard requirements for this release. Eligible returning learners may receive issuer-defined update-module requirements. Enrollment alone does not award a credential.'));
}
