import { authenticatedFetch, getSessionIdentity, getOrganizationHeaders, getAccessToken, clearAccessToken } from "./auth-session.js";
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const status = (message: string) => { q("#message").textContent = message; };
type Kind = "members" | "releases";
let epoch = 0;
const cursors: Record<Kind,string | null> = {members:null,releases:null};
const select = (kind: Kind) => q<HTMLSelectElement>(kind === "members" ? "#member" : "#release");
async function api(path: string, body?: unknown,key?:string) {
  const token=getAccessToken(); if(!token) throw Error("Sign in with an administrator account to assign training.");
  const response=await authenticatedFetch(`/api/v1/${path}`,{method:body?"POST":"GET",headers:{...getOrganizationHeaders(),authorization:`Bearer ${token}`,...(body?{"content-type":"application/json"}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok) throw Error(response.status===403 ? (path.startsWith("course-change-jobs")?"Operator access is required to recover failed jobs.":"Your account does not have permission to assign training.") : data.error?.code==="ORGANIZATION_CONTEXT_REQUIRED" ? "Choose an organization using the organization link before continuing." : data.error?.code==="ENROLLMENT_MEMBER_REQUIRED" ? "This member is no longer active. Refresh the choices." : data.error?.code==="ENROLLMENT_NOT_FOUND" ? "This course is no longer available. Refresh the choices." : data.error?.code==="ENROLLMENT_INACTIVE" ? "This learner has an inactive enrollment. Contact your training administrator." : data.error?.message ?? "Request failed. Retry when your connection is restored.");
  return data;
}
async function load(kind: Kind, current: number, append=false) {
  const data=await api(`enrollments/options?kind=${kind}${append && cursors[kind] ? `&after=${encodeURIComponent(cursors[kind]!)}`:""}`);
  if(current!==epoch)return;
  const target=select(kind);
  if(!append)target.replaceChildren(new Option(kind==="members"?"Choose a member":"Choose a course",""));
  for(const item of data.items) {
    const id=kind==="members"?item.learnerId:item.releaseId;
    if([...target.options].some(option=>option.value===id))continue;
    target.add(new Option(kind==="members"?item.learnerId:`${item.title || "Untitled course"} (${item.courseVersionId})`,id));
  }
  cursors[kind]=data.nextCursor;q(`#more-${kind}`).hidden=!data.nextCursor;
}
async function refresh() {
  clearCredentials();clearImpact();clearFailedJobs();
  const current=++epoch;
  q<HTMLFieldSetElement>("#choices").disabled=true;status("Loading available courses and members…");
  try {
    await Promise.all([load("members",current),load("releases",current)]);
    if(current!==epoch)return;
    q<HTMLFieldSetElement>("#choices").disabled=false;
    status(select("members").options.length<2 ? "No active organization members are available." : select("releases").options.length<2 ? "Publish a reviewed course before assigning training." : "Choose a course and learner account.");
  }catch(error){if(current===epoch)status((error as Error).message);}
}
for(const kind of ["members","releases"] as Kind[])q<HTMLButtonElement>(`#more-${kind}`).onclick=async()=>{
  const current=epoch,node=q<HTMLButtonElement>(`#more-${kind}`);node.disabled=true;
  try{await load(kind,current,true);}catch(error){if(current===epoch)status((error as Error).message);}finally{node.disabled=false;}
};
q<HTMLFormElement>("#assignment-form").onsubmit=async event=>{
  event.preventDefault();const current=epoch;
  const learnerId=select("members").value,releaseId=select("releases").value;
  if(!learnerId||!releaseId){status("Choose both a published course and a learner.");return;}
  const title=select("releases").selectedOptions[0].textContent;
  q<HTMLFieldSetElement>("#choices").disabled=true;q<HTMLButtonElement>("#refresh").disabled=true;
  try{await api("enrollments",{learnerId,releaseId});if(current===epoch)status(`${title} is assigned to ${learnerId}. Repeating this assignment will keep the existing enrollment.`);}
  catch(error){if(current===epoch)status(`${(error as Error).message} Your selection is retained; you can retry safely.`);}
  finally{if(current===epoch){q<HTMLFieldSetElement>("#choices").disabled=false;q<HTMLButtonElement>("#refresh").disabled=false;}}
};
q("#refresh").onclick=()=>void refresh();
q("#sign-out").onclick=()=>{
  clearCredentials();
  clearImpact();clearFailedJobs();epoch++;clearAccessToken();
  for(const kind of ["members","releases"] as Kind[]){select(kind).replaceChildren();cursors[kind]=null;q(`#more-${kind}`).hidden=true;}
  q<HTMLFieldSetElement>("#choices").disabled=true;q<HTMLButtonElement>("#refresh").disabled=false;status("Signed out.");
};
let credentialEpoch=0,credentialCursor:string|null=null;
const credentialRows:Array<Record<string,any>>=[];
function clearCredentials(){credentialEpoch++;credentialRows.length=0;credentialCursor=null;q('#credential-admin').replaceChildren();q('#more-credentials').hidden=true;q('#attempt-reviews').replaceChildren();q('#more-reviews').hidden=true;q('#attempt-admin').replaceChildren();q('#more-attempts').hidden=true;}
select('members').onchange=clearCredentials;
async function loadCredentials(append=false){
  if(!append)clearCredentials();const current=credentialEpoch,learnerId=select('members').value;
  if(!learnerId){status('Select a learner account first.');return;}
  const data=await api(`credentials?learnerId=${encodeURIComponent(learnerId)}${append&&credentialCursor?`&after=${encodeURIComponent(credentialCursor)}`:''}`);
  if(current!==credentialEpoch)return;
  const host=q('#credential-admin');
  for(const item of data.items){
    if(credentialRows.some(row=>row.credentialId===item.credentialId))continue;credentialRows.push(item);
    const article=document.createElement('article'),title=document.createElement('h3');title.textContent=`${item.title} · ${item.status}`;article.append(title);host.append(article);
    if(item.status==='REVOKED')continue;
    const form=document.createElement('form'),fields=document.createElement('fieldset');form.append(fields);article.append(form);
    const legend=document.createElement('legend');legend.textContent='Change credential status';fields.append(legend);
    const label=(name:string,node:HTMLElement)=>{const wrapper=document.createElement('label');wrapper.append(document.createTextNode(name),node);fields.append(wrapper);};
    const action=document.createElement('select');action.add(new Option('Revoke','revoke'));if(item.status!=='SUPERSEDED')action.add(new Option('Supersede with updated credential','supersede'));label('Action',action);
    const replacement=document.createElement('select');replacement.dataset.replacementFor=item.credentialId;replacement.disabled=true;label('Replacement credential',replacement);
    action.onchange=()=>{replacement.disabled=action.value!=='supersede';replacement.required=action.value==='supersede';};
    const reason=document.createElement('textarea');reason.required=true;reason.maxLength=2000;label('Reason (recorded in the audit history)',reason);
    const submit=document.createElement('button');submit.type='submit';submit.textContent='Apply credential change';fields.append(submit);
    let signature='',key='';
    form.onsubmit=async event=>{event.preventDefault();const body={reason:reason.value.trim(),...(action.value==='supersede'?{replacementId:replacement.value}:{})};
      if(!body.reason || (action.value==='supersede'&&!replacement.value)){status('Provide a reason and any required replacement.');return;}
      if(!window.confirm(`Confirm ${action.value} for ${item.title}? This change is recorded permanently.${action.value==='revoke'?' Credentials that depend on this qualification will also be revoked.':''}`))return;
      const next=JSON.stringify([action.value,body]);if(next!==signature){signature=next;key=crypto.randomUUID();}fields.disabled=true;
      try{await api(`credentials/${encodeURIComponent(item.credentialId)}/${action.value}`,body,key);if(current===credentialEpoch){status('Credential status updated.');await loadCredentials();}}
      catch(error){if(current===credentialEpoch)status(`${(error as Error).message} Your reason is retained; retry the same request safely.`);}finally{fields.disabled=false;}
    };
  }
  for(const node of host.querySelectorAll<HTMLSelectElement>('select[data-replacement-for]')){
    const original=credentialRows.find(row=>row.credentialId===node.dataset.replacementFor),value=node.value;node.replaceChildren(new Option('Choose an active newer credential',''));
    for(const candidate of credentialRows)if(candidate.credentialId!==original?.credentialId&&candidate.courseId===original?.courseId&&candidate.courseVersionId!==original?.courseVersionId&&candidate.status==='ACTIVE')node.add(new Option(`${candidate.title} · ${new Date(candidate.issuedAt).toLocaleDateString()}`,candidate.credentialId));node.value=value;
  }
  credentialCursor=data.nextCursor;q('#more-credentials').hidden=!credentialCursor;if(!credentialRows.length)host.textContent='No credentials found for this learner.';
}
q('#load-credentials').onclick=()=>void loadCredentials().catch(error=>status(error.message));
q<HTMLButtonElement>('#more-credentials').onclick=async()=>{const node=q<HTMLButtonElement>('#more-credentials');node.disabled=true;try{await loadCredentials(true);}catch(error){status((error as Error).message);}finally{node.disabled=false;}};
let reviewCursor:string|null=null;
let reviewMode:'review'|'reset'='review';
async function loadReviews(append=false){
  const mode=reviewMode,current=credentialEpoch,learnerId=select('members').value;if(!learnerId){status('Select a learner account first.');return;}
  const data=await api(`attempt-reviews?learnerId=${encodeURIComponent(learnerId)}&mode=${mode}${append&&reviewCursor?`&after=${encodeURIComponent(reviewCursor)}`:''}`);
  if(current!==credentialEpoch||mode!==reviewMode)return;
  const host=q('#attempt-reviews');if(!append)host.replaceChildren();
  for(const item of data.items){
    const form=document.createElement('form'),title=document.createElement('h3'),label=document.createElement('label'),reason=document.createElement('textarea'),submit=document.createElement('button');
    title.textContent=`${item.title} · ${item.activityTitle} · ${item.throughAttempt} lifetime attempts${mode==='reset'?` · reset grants ${item.maxAttempts} attempts`:''}`;
    label.append(document.createTextNode('Content review and remediation completed (required)'),reason);reason.required=true;reason.maxLength=2000;submit.textContent=mode==='reset'?'Reset attempt allowance':'Resolve required review';submit.type='submit';form.append(title,label,submit);host.append(form);
    let savedReason='',key='';
    form.onsubmit=async event=>{event.preventDefault();const value=reason.value.trim();if(!value)return;if(mode==='reset'&&!window.confirm(`Grant ${item.maxAttempts} new attempts after the recorded content review? Prior results remain stored; cooldowns and revoked credentials are unchanged.`))return;if(savedReason!==value){savedReason=value;key=crypto.randomUUID();}submit.disabled=true;
      try{await api(`attempt-reviews/${encodeURIComponent(item.enrollmentId)}/${encodeURIComponent(item.activityId)}${mode==='reset'?'/reset':''}`,{reason:value,throughAttempt:item.throughAttempt},key);if(current!==credentialEpoch||mode!==reviewMode)return;await loadReviews();status(mode==='reset'?'Attempt allowance reset. Prior results, cooldowns and credential status are preserved.':'Review recorded. Published attempt limits and cooldowns still apply.');}
      catch(error){if(current===credentialEpoch)status((error as Error).message);}finally{submit.disabled=false;}
    };
  }
  reviewCursor=data.nextCursor;q('#more-reviews').hidden=!reviewCursor;
  if(!host.childElementCount)host.textContent=mode==='reset'?'No attempts currently qualify for reset.':'No required reviews in the loaded assignments.';
}
q('#load-reviews').onclick=()=>{reviewMode='review';void loadReviews().catch(error=>status(error.message));};
q('#load-resets').onclick=()=>{reviewMode='reset';void loadReviews().catch(error=>status(error.message));};
q('#more-reviews').onclick=()=>void loadReviews(true).catch(error=>status(error.message));
let attemptCursor:string|null=null;
async function loadAttempts(append=false){
  const current=credentialEpoch,learnerId=select('members').value;if(!learnerId){status('Select a learner account first.');return;}
  const data=await api(`attempts?learnerId=${encodeURIComponent(learnerId)}${append&&attemptCursor?`&after=${encodeURIComponent(attemptCursor)}`:''}`);
  if(current!==credentialEpoch)return;const host=q('#attempt-admin');if(!append)host.replaceChildren();
  for(const item of data.items){
    const article=document.createElement('article'),title=document.createElement('h3'),impact=document.createElement('p');title.textContent=`${item.kind} · ${item.activityId} · attempt ${item.attemptNumber} · ${item.status}`;
    impact.textContent=item.affectedCredentials.length?`Credentials to revoke: ${item.affectedCredentials.map((c:Record<string,any>)=>c.credentialId).join(', ')}`:'No issued credentials will be revoked.';article.append(title,impact);host.append(article);if(item.status==='INVALIDATED')continue;
    const form=document.createElement('form'),label=document.createElement('label'),reason=document.createElement('textarea'),submit=document.createElement('button');label.append(document.createTextNode('Reason for invalidation'),reason);reason.required=true;reason.maxLength=2000;submit.type='submit';submit.textContent='Invalidate attempt';form.append(label,submit);article.append(form);
    let saved='',key='';form.onsubmit=async event=>{event.preventDefault();const value=reason.value.trim();if(!value)return;
      if(!window.confirm(`Invalidate this attempt and revoke ${item.affectedCredentials.length} credential(s)? Original evidence remains in the audit history.`))return;
      if(value!==saved){saved=value;key=crypto.randomUUID();}submit.disabled=true;
      try{await api(`attempts/${item.kind}/${encodeURIComponent(item.attemptId)}/invalidate`,{reason:value,previewToken:item.previewToken},key);if(current!==credentialEpoch)return;clearCredentials();await loadAttempts();status('Attempt invalidated and affected credentials revoked. Reload credentials for their current status.');}
      catch(error){if(current===credentialEpoch)status((error as Error).message);}finally{submit.disabled=false;}
    };
  }
  attemptCursor=data.nextCursor;q('#more-attempts').hidden=!attemptCursor;if(!host.childElementCount)host.textContent='No attempts found.';
}
q('#load-attempts').onclick=()=>void loadAttempts().catch(error=>status(error.message));
q('#more-attempts').onclick=()=>void loadAttempts(true).catch(error=>status(error.message));
let impactEpoch=0,impactCursor:string|null=null;
function clearImpact(){impactEpoch++;impactCursor=null;q('#course-impact').replaceChildren();q('#more-impact').hidden=true;}
select('releases').onchange=clearImpact;
async function loadImpact(append=false){
  if(!append)clearImpact();const current=impactEpoch,releaseId=select('releases').value;if(!releaseId){status('Select a published updated course first.');return;}
  const data=await api(`course-changes/${encodeURIComponent(releaseId)}${append&&impactCursor?`?after=${encodeURIComponent(impactCursor)}`:''}`);if(current!==impactEpoch)return;
  const host=q('#course-impact');
  const line=(text:string)=>{const p=document.createElement('p');p.textContent=text;host.append(p);};
  if(!append){line(`${data.title}: ${data.totalAffected} affected learners. Effective ${new Date(data.change.effectiveAt).toLocaleString()}.`);line(data.change.learnerMessage);for(const job of data.jobs)line(`${job.kind}: ${job.state}; processed ${job.processed}; skipped ${job.skipped}. ${job.state==='PENDING'?`Next scheduled run: ${new Date(job.nextAttemptAt).toLocaleString()}.`:''}${job.errorCode?` Error: ${job.errorCode}.`:''}`);if(data.change.decision==='update_modules')line('Learners with a current source credential complete the selected update modules; others must complete the full course.');}
  for(const learner of data.items)line(`${learner.learnerId}: ${learner.membershipActive?'active membership':'membership inactive'}; updated enrollment: ${learner.targetEnrollmentStatus??'not assigned'}; prior credentials: ${learner.previousCredentialCount}.`);
  impactCursor=data.nextCursor;q('#more-impact').hidden=!impactCursor;
}
q('#load-impact').onclick=()=>void loadImpact().catch(error=>status(error.message));q('#more-impact').onclick=()=>void loadImpact(true).catch(error=>status(error.message));
let failedEpoch=0,failedCursor:string|null=null;
const failedIds=new Set<string>();
function clearFailedJobs(){failedEpoch++;failedCursor=null;failedIds.clear();q('#failed-jobs').replaceChildren();q('#more-failed-jobs').hidden=true;}
async function loadFailedJobs(append=false){
  if(!append)clearFailedJobs();const current=failedEpoch;
  try{
    const data=await api(`course-change-jobs${append&&failedCursor?`?after=${encodeURIComponent(failedCursor)}`:''}`);
    if(current!==failedEpoch)return;
    const host=q('#failed-jobs');
    if(!append&&!data.items.length){host.textContent='No failed course-update, qualification, or credential-notice jobs.';}
    for(const item of data.items){
      if(failedIds.has(item.jobId))continue;failedIds.add(item.jobId);
      const article=document.createElement('article'),title=document.createElement('h3'),info=document.createElement('p');
      title.textContent=`${item.kind} · ${item.jobId}`;info.textContent=`${item.attempts} failed attempts. ${item.errorCode??'Processing failed'}. Completed ${item.processed}; skipped ${item.skipped}.`;
      const form=document.createElement('form'),fields=document.createElement('fieldset'),legend=document.createElement('legend'),label=document.createElement('label'),reason=document.createElement('textarea'),button=document.createElement('button');
      legend.textContent='Retry failed job';label.textContent='Recovery reason / correction made';reason.required=true;reason.maxLength=2000;label.append(reason);button.type='submit';button.textContent='Retry job';fields.append(legend,label,button);form.append(fields);article.append(title,info,form);host.append(article);
      let savedReason='',key='';
      form.onsubmit=async event=>{
        event.preventDefault();const value=reason.value.trim();if(!value)return;
        if(!window.confirm('Retry this failed job from its saved progress? Qualification and effective-date checks still apply.'))return;
        if(value!==savedReason){savedReason=value;key=crypto.randomUUID();}fields.disabled=true;
        try{await api(`course-change-jobs/${encodeURIComponent(item.jobId)}/retry`,{reason:value,retryToken:item.retryToken},key);if(current!==failedEpoch)return;status('Recovery accepted. The worker will resume this job.');await loadFailedJobs();}
        catch(error){if(current===failedEpoch){status((error as Error).message);fields.disabled=false;}}
      };
    }
    failedCursor=data.nextCursor;q('#more-failed-jobs').hidden=!failedCursor;
  }catch(error){if(current===failedEpoch)status((error as Error).message);}
}
q('#load-failed-jobs').onclick=()=>void loadFailedJobs();q('#more-failed-jobs').onclick=()=>void loadFailedJobs(true);
void refresh();
