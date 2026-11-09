import {renderLearnerExploration} from './learner-exploration.js';
import {renderLearnerMedia} from './learner-media.js';
import { authenticatedFetch, getSessionIdentity, getOrganizationHeaders, getAccessToken, clearAccessToken } from "./auth-session.js";
import { renderVerificationQr } from './verification-qr.js';
type Data = Record<string, any>;
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const message = (value: string) => { q("#message").textContent = value; };
const el = (tag: string, value: string) => { const node = document.createElement(tag); node.textContent = value; return node; };
const mediaViews:Array<()=>void>=[];
const clearMedia=()=>{for(const dispose of mediaViews.splice(0))dispose();};
let generation = 0;
let cursor: string | null = null;
let course: Data | undefined;
let assessmentRender=0;
const startKeys = new Map<string,string>();
const storyKeys=new Map<string,{choiceId:string;key:string}>();
async function api(path: string, method = "GET", body?: unknown, key?: string): Promise<Data> {
  const token = getAccessToken();
  if (!token) throw Error("Sign in to view your assigned courses.");
  const response = await authenticatedFetch(`/api/v1/${path}`, { method, headers: { ...getOrganizationHeaders(), authorization: `Bearer ${token}`, ...(body ? {"content-type":"application/json"} : {}), ...(key ? {"idempotency-key":key} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(({CREDENTIAL_EMAIL_VERIFICATION_REQUIRED:"Open My account to create your personal profile, then sign in with a verified email and retry credential issuance. Your completed training is retained.",ORGANIZATION_CONTEXT_REQUIRED:"Choose an organization using the organization link before continuing.",CREDENTIAL_CHANGE_NOT_EFFECTIVE:"Your updated course requirements are complete. Credential replacement is scheduled for the issuer's effective date. Refresh your wallet after that date.",CREDENTIAL_RELEASE_SUPERSEDED:"You already qualified on the successor release. Use its credential in your wallet.",CREDENTIAL_CHANGE_INVALID:"The issuer must correct the published course-change configuration before a credential can be issued.",ASSESSMENT_REVIEW_REQUIRED:"An administrator must review your repeated failed attempts before you can try again.",SIMULATION_REVIEW_REQUIRED:"An administrator must review your repeated failed attempts before you can try again.",SIMULATION_COOLDOWN:"Please wait before starting another interactive attempt.",SIMULATION_ATTEMPT_LIMIT:"You have used all allowed interactive attempts.",ASSESSMENT_COOLDOWN:"Please wait before starting another attempt.",ASSESSMENT_ATTEMPT_LIMIT:"You have used all allowed attempts. Contact your training administrator.",ASSESSMENT_NOT_ACTIVE:"This attempt has expired or ended. Reopen the course to check your next attempt.",ASSESSMENT_ALREADY_ACTIVE:"An attempt is already active. Reopen the course to resume it."} as Record<string,string>)[result.error?.code] ?? result.error?.message ?? "Request failed. Please retry."),{code:result.error?.code});
  return result;
}
function button(label: string, action: () => Promise<void>, parent: HTMLElement) {
  const node = document.createElement("button"); node.textContent = label;
  node.onclick = async () => { node.disabled = true; try { await action(); } catch(error) { if(node.isConnected && getAccessToken()) message((error as Error).message); } finally { node.disabled = false; } };
  parent.append(node); return node;
}
async function list(append=false) {
  const current = generation;
  const result = await api(`enrollments${append && cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`);
  if(current !== generation) return;
  const host=q("#courses"); if(!append) host.replaceChildren();
  for(const item of result.items) button(item.title || "Untitled course",()=>open(item.enrollmentId),host);
  cursor=result.nextCursor; q("#more").hidden=!cursor;
  message(host.childElementCount ? "Choose a course to continue." : "You have no active assigned courses.");
}
async function open(id: string) {
  clearMedia();
  assessmentRender++;
  const current=++generation;
  q("#course").hidden=true; q("#assessment").hidden=true;
  const result=await api(`enrollments/${encodeURIComponent(id)}`);if(current!==generation)return;
  const story=result.content.hasStory?await api(`enrollments/${encodeURIComponent(id)}/story`):undefined;
  if(current!==generation)return;
  course=result;
  const host=q("#course");host.replaceChildren(el("h2",result.title));host.hidden=false;
  if(result.eligibility){
    const eligibility=result.eligibility;
    if(eligibility.requalification)host.append(el('p','Your current source-course credential qualifies you for the selected update modules. Complete their required activities to earn the updated credential. Other modules remain available for reference.'));
    host.append(el("p",!eligibility.configurationValid?"Certification requirements need administrator configuration.":eligibility.eligible?"You meet the configured activity and score requirements. Check your training credentials below.":"Some certification requirements remain incomplete."));
    if(eligibility.eligible)button("Get my training credential",async()=>{
      const credential=await api(`enrollments/${encodeURIComponent(result.enrollmentId)}/credential`,"POST",{});
      if(current!==generation)return;
      message(`Training credential ${credential.status.toLowerCase()}. Issued ${new Date(credential.issuedAt).toLocaleDateString()}. ${credential.expiresAt?`Expires ${new Date(credential.expiresAt).toLocaleDateString()}.`:"No expiration."}`);
      await wallet();
    },host);
    for(const requirement of eligibility.activities??[]){
      const activity=result.content.modules.flatMap((m:Data)=>m.activities).find((a:Data)=>a.activityId===requirement.activityId);
      const title=activity?.title??"Activity";
      if(requirement.reviewRequired)host.append(el("p",`${title}: administrator review is required after repeated failures.`));
      else if(!requirement.passed && ['text','rich_text','image','video','3d_viewer','hotspot'].includes(activity?.type))host.append(el('p',`${title}: review the content and mark it as reviewed.`));
      else if(!requirement.passed)host.append(el("p",`${title}: ${retryGuidance(requirement)}`));
    }
  }
  if(story)renderStory(host,story,id,current);
  for(const module of result.content.modules) {
    if(story&&!module.activities.some((a:Data)=>a.activityId===story.node.activityId))continue;
    host.append(el("h3",module.title));
    if(result.eligibility?.requalification)host.append(el('p',result.eligibility.requalification.updateModuleIds.includes(module.moduleId)?'Required update module':'Reference module: not required for this update'));
    for(const activity of module.activities) {
      if(story&&(activity.activityId!==story.node.activityId||!story.node.available))continue;
      const article=document.createElement("article");article.append(el("h4",activity.title),el("p",activity.instructions));host.append(article);
      const progress=result.progress?.find((item:Data)=>item.activityId===activity.activityId);
      if(progress)article.append(el("p",`Latest attempt: ${progress.status}${typeof progress.score==='number'?` · ${progress.score} / ${progress.maxScore}`:""}`));
      if(progress?.status==='FAILED'&&activity.remediation)renderRemediation(article,activity.remediation,id,current);
      if(["text","rich_text"].includes(activity.type)) {
        article.append(el("p",activity.text));
        if(progress?.status==='ACKNOWLEDGED')article.append(el('p','You marked this reading as reviewed.'));
        else if(activity.activityId)button('Mark as reviewed',async()=>{
          await api(`enrollments/${encodeURIComponent(result.enrollmentId)}/activities/${encodeURIComponent(activity.activityId)}/acknowledge`,'POST',{});
          if(current!==generation)return;await open(result.enrollmentId);
        },article);
      }
      else if(['3d_viewer','hotspot'].includes(activity.type)){
        const identity=getSessionIdentity();mediaViews.push(renderLearnerExploration(article,activity.type,progress?.status==='ACKNOWLEDGED',{
          active:()=>current===generation&&identity===getSessionIdentity(),
          load:()=>api(`enrollments/${encodeURIComponent(id)}/activities/${encodeURIComponent(activity.activityId)}/inspection`) as any,
          assets:inspection=>api(`releases/${encodeURIComponent(inspection.releaseId)}/model-assets/${encodeURIComponent(inspection.modelVersionId)}`) as any,
          acknowledge:async()=>{await api(`enrollments/${encodeURIComponent(id)}/activities/${encodeURIComponent(activity.activityId)}/acknowledge`,'POST',{});if(current===generation&&identity===getSessionIdentity())await open(id);}
        }));
      }
      else if(['image','video'].includes(activity.type)){
        const identity=getSessionIdentity();
        mediaViews.push(renderLearnerMedia(article,activity.type,progress?.status==='ACKNOWLEDGED',{
          active:()=>current===generation&&identity===getSessionIdentity(),
          load:()=>api(`enrollments/${encodeURIComponent(id)}/activities/${encodeURIComponent(activity.activityId)}/media`) as any,
          acknowledge:async()=>{await api(`enrollments/${encodeURIComponent(id)}/activities/${encodeURIComponent(activity.activityId)}/acknowledge`,'POST',{});if(current===generation&&identity===getSessionIdentity())await open(id);}
        }));
      }
      else if(["multiple_choice","multi_select","ordered_step"].includes(activity.type)) {
        const previous=result.assessmentSessions.find((session:Data)=>session.activityId===activity.activityId);
        if(previous) button("View / resume latest attempt",async()=>{const session=await api(`assessment-sessions/${encodeURIComponent(previous.sessionId)}`);if(current===generation)renderAssessment(session);},article);
        if(!previous || previous.status!=="PASSED") button(previous ? "Start another attempt" : "Start assessment",()=>start(activity.activityId,current),article);
      } else if(["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(activity.type)) button(progress && ["PASSED","FAILED"].includes(progress.status) ? "Start another interactive attempt" : "Open interactive activity",async()=>{
        const session=await api(`enrollments/${encodeURIComponent(result.enrollmentId)}/activities/${encodeURIComponent(activity.activityId)}/start`,"POST",{});
        if(current!==generation)return;
        const url=new URL("/learner/model",location.origin);url.searchParams.set("sessionId",session.sessionId);url.searchParams.set("releaseId",session.releaseId);url.searchParams.set("modelVersionId",session.modelVersionId);
        location.assign(url);
      },article);
      else article.append(el("p","This activity is not yet available in the course player."));
    }
  }
  message("Course opened.");
  void wallet().catch(()=>{if(current===generation)message("Course opened. Refresh to load your training credentials.");});
}
function renderStory(host:HTMLElement,story:Data,enrollmentId:string,current:number){
 const section=document.createElement('section');section.dataset.story='true';host.append(section);
 const heading=el('h3',story.node.title);heading.tabIndex=-1;
 section.append(el('p',`Mission: ${story.mission}`),heading,el('p',story.node.purpose));
 const status=el('p','');status.setAttribute('role','status');section.append(status);
 const identity=getSessionIdentity(),active=()=>current===generation&&identity===getSessionIdentity()&&section.isConnected;
 if(!story.node.available)status.textContent='This part of the mission is locked. Complete its prerequisites or contact your training administrator.';
 if(story.node.outcome){section.append(el('p',story.node.outcome.message),el('p','Story outcome: '+story.node.outcome.kind+'. Certification is evaluated separately against your recorded training results.'));}
 else if(story.node.activityId)status.textContent=story.node.available?'Complete the activity below, then refresh the story to see available choices.':status.textContent;
 const refresh=button('Refresh story',async()=>{await open(enrollmentId);if(getSessionIdentity()===identity)q('#course').querySelector<HTMLElement>('[data-story] h3')?.focus();},section);
 const choices=document.createElement('fieldset'),legend=el('legend','Choose what happens next');choices.append(legend);section.append(choices);
 const binding=JSON.stringify([identity,enrollmentId,story.releaseHash,story.revision]);
 const choicesToRender=story.node.outcome?.kind==='retry'?[{choiceId:'restart',label:'Restart mission',consequence:'Return to the beginning. Recorded results, cooldowns and attempt limits stay in effect.',enabled:true,restart:true}]:story.node.choices;
 const controls:Array<{button:HTMLButtonElement;choice:Data}>=[];
 const update=()=>{const pending=storyKeys.get(binding);for(const c of controls)c.button.disabled=!c.choice.enabled||Boolean(pending&&pending.choiceId!==c.choice.choiceId);};
 for(const choice of choicesToRender){
  const item=document.createElement('div');choices.append(item);item.append(el('p',choice.consequence));
  const control=button(choice.label,async()=>{
   if(choice.restart&&!storyKeys.has(binding)&&!window.confirm('Restart this mission? Recorded results, cooldowns and attempt limits remain unchanged.'))return;
   const pending=storyKeys.get(binding)??{choiceId:choice.choiceId,key:crypto.randomUUID()};storyKeys.set(binding,pending);
   choices.disabled=true;refresh.disabled=true;status.textContent='Saving your choice�';
   try{
    await api(`enrollments/${encodeURIComponent(enrollmentId)}/story/${choice.restart?'restart':'choices'}`,'POST',choice.restart?{revision:story.revision,confirmed:true}:{revision:story.revision,choiceId:choice.choiceId},pending.key);
    if(!active())return;
    storyKeys.delete(binding);await open(enrollmentId);
    if(getSessionIdentity()===identity)q('#course').querySelector<HTMLElement>('[data-story] h3')?.focus();
   }catch(error){
    if(!active())return;
    const code=(error as Error&{code?:string}).code;
    if(['STORY_REVISION_CONFLICT','STORY_BINDING_CHANGED','STORY_CHOICE_NOT_AVAILABLE','IDEMPOTENCY_KEY_REUSED'].includes(code??'')){
     choices.disabled=true;storyKeys.delete(binding);status.textContent='The story changed. Refresh the story before choosing again.';
    }else if(['STORY_NOT_FOUND','ACCOUNT_LOCKED','ORGANIZATION_MEMBERSHIP_REQUIRED'].includes(code??'')){
     section.replaceChildren(el('p','Story access is unavailable. Reopen your assigned courses.'));host.querySelectorAll('article').forEach(a=>a.remove());storyKeys.delete(binding);
    }else{choices.disabled=false;status.textContent='The choice response was interrupted. Retry the same choice or refresh the story.';update();}
   }finally{if(active()){refresh.disabled=false;}}
  },item);controls.push({button:control,choice});
 }
 update();
 if(!choicesToRender.length)choices.hidden=true;
}

async function start(activityId:string,current:number) {
  if(!course)return;
  const binding=`${course.enrollmentId}:${activityId}`;
  const key=startKeys.get(binding)??crypto.randomUUID();startKeys.set(binding,key);
  const session=await api("assessment-sessions","POST",{enrollmentId:course.enrollmentId,releaseId:course.releaseId,activityId},key);
  if(current!==generation)return;
  startKeys.delete(binding);renderAssessment(session);
}
function renderRemediation(host:HTMLElement,remediation:Data,enrollmentId:string,current:number) {
  const section=document.createElement('section');section.dataset.remediation='true';
  section.append(el('h4','Review this learning objective'),el('p',String(remediation.objective)),el('p','Replay the approved scene, then return to the activity. This review does not change your score or retry rules.'));
  const identity=getSessionIdentity();
  mediaViews.push(renderLearnerMedia(section,'video',false,{
    active:()=>current===generation&&identity===getSessionIdentity(),supplemental:true,startSeconds:remediation.startSeconds,
    load:()=>api(`enrollments/${encodeURIComponent(enrollmentId)}/activities/${encodeURIComponent(remediation.activityId)}/media`) as any,
    acknowledge:async()=>{}
  }));host.append(section);
}
function renderAssessment(session:Data) {
  const render=++assessmentRender;
  const current=generation,host=q("#assessment");host.replaceChildren(el("h2",`Assessment · attempt ${session.attemptNumber}`));host.hidden=false;
  host.append(el("p",session.result ? `${session.status}: ${session.result.score} / ${session.result.maxScore}` : `${session.status} · expires ${new Date(session.expiresAt).toLocaleString()}`));
  if(session.status!=="IN_PROGRESS"){
    const activity=course?.content?.modules?.flatMap((m:Data)=>m.activities).find((a:Data)=>a.activityId===session.activityId);
    if(session.status==='FAILED'&&activity?.remediation&&course)renderRemediation(host,activity.remediation,course.enrollmentId,current);
    for(const [key,title] of [['demonstratedCompetencyIds','Demonstrated competencies'],['missedCompetencyIds','Competencies to review']]){
      const values=session.result?.[key];if(Array.isArray(values)&&values.length){host.append(el('h3',title));const list=document.createElement('ul');for(const value of values)list.append(el('li',String(value)));host.append(list);}
    }
    if(session.result?.missedCompetencyIds?.length)host.append(el('p','Review the course instructions for these competencies before trying again. Ask your training administrator for help with any unclear steps.'));
    if(session.status==='EXPIRED')host.append(el('p','This attempt expired before submission. Check the current retry rules below.'));
    if(session.status==='INVALIDATED')host.append(el('p','This attempt cannot count toward certification. Contact your training administrator for the next step.'));
    const guidance=el('div','Loading current course requirements…');host.append(guidance);
    const enrollmentId=session.enrollmentId??course?.enrollmentId;
    let guidanceRequest=0;
    const refresh=async()=>{
      const request=++guidanceRequest;guidance.textContent='Loading current course requirements…';
      if(!enrollmentId){guidance.textContent='Reopen your assigned course to check current requirements.';return;}
      try{
        const latest=await api(`enrollments/${encodeURIComponent(enrollmentId)}`);if(current!==generation||render!==assessmentRender||request!==guidanceRequest)return;
        guidance.replaceChildren();
        const eligibility=latest.eligibility,requirement=eligibility?.activities?.find((item:Data)=>item.activityId===session.activityId);
        if(requirement){
          guidance.append(el('p',`Attempts used in the current allowance: ${requirement.attemptsUsed} of ${requirement.maxAttempts}.${requirement.latestAttemptNumber>requirement.attemptsUsed?` Lifetime attempts: ${requirement.latestAttemptNumber}.`:''}`),el('p',retryGuidance(requirement)));
          if(requirement.retryEligible)button('Start next assessment attempt',()=>start(session.activityId,current),guidance);
        }else guidance.append(el('p','Open the course to check this activity’s current attempt rules.'));
        guidance.append(el('p',!eligibility?.configurationValid?'Certification requirements need administrator configuration.':eligibility.eligible?'Course requirements are met. Check your credential wallet for the current credential status.':'Course requirements remain incomplete. Review the remaining requirements before continuing.'));
        if(eligibility?.configurationValid)for(const missing of eligibility.activities??[])if(!missing.passed||missing.reviewRequired){const activity=latest.content.modules.flatMap((m:Data)=>m.activities).find((a:Data)=>a.activityId===missing.activityId);guidance.append(el('p',`Remaining: ${activity?.title??missing.activityId}${missing.reviewRequired?' — administrator review required':''}.`));}
      }catch(error){if(current===generation&&render===assessmentRender&&request===guidanceRequest)guidance.textContent='Current requirements could not be loaded. Refresh the result guidance to retry.';}
    };
    button('Refresh result guidance',refresh,host);
    if(enrollmentId)button('View remaining course requirements',()=>open(enrollmentId),host);
    void refresh();return;
  }
  const form=document.createElement("form");host.append(form);
  const readers:Array<()=>{questionId:string;selectedOptionIds:string[]}>=[];
  for(const question of session.assessment.questions) {
    const field=document.createElement("fieldset");field.append(el("legend",question.prompt));form.append(field);
    if(question.type==="ordered_step") {
      const order=[...question.options];const steps=document.createElement("div");field.append(steps);
      const draw=()=>{steps.replaceChildren();order.forEach((option:Data,index:number)=>{const row=el("div",`${index+1}. ${option.text}`);const up=document.createElement("button");up.type="button";up.textContent=`Move ${option.text} up`;up.disabled=index===0;up.onclick=()=>{[order[index-1],order[index]]=[order[index],order[index-1]];draw();};row.append(up);steps.append(row);});};draw();
      readers.push(()=>({questionId:question.questionId,selectedOptionIds:order.map(option=>option.optionId)}));
    } else {
      for(const option of question.options) {const label=document.createElement("label"),input=document.createElement("input");input.type=question.type==="multiple_choice"?"radio":"checkbox";input.name=question.questionId;input.value=option.optionId;label.append(input,document.createTextNode(option.text));field.append(label);}
      readers.push(()=>({questionId:question.questionId,selectedOptionIds:[...field.querySelectorAll<HTMLInputElement>("input:checked")].map(input=>input.value)}));
    }
  }
  const submit=document.createElement("button");submit.type="submit";submit.textContent="Submit answers";form.append(submit);
  let pending:unknown;
  form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;pending??=readers.map(read=>read());for(const field of form.querySelectorAll("fieldset"))field.disabled=true;
    try {const result=await api(`assessment-sessions/${encodeURIComponent(session.sessionId)}/submit`,"POST",{answers:pending});if(current===generation){renderAssessment(result);message("Assessment submitted. Reopen the course to check your progress.");void wallet().catch(()=>{if(current===generation)message("Assessment submitted. Refresh to load your training credentials.");});}}
    catch(error){if(current===generation)message((error as Error).message);}finally{submit.disabled=false;}
  };
}
function retryGuidance(requirement:Data):string{
  if(requirement.reviewRequired)return 'An administrator must record the required content review and remediation before further attempts.';
  if(requirement.passed)return 'This activity meets the configured scoring requirement.';
  const reasons=requirement.retryBlockedReasons??[];
  if(reasons.includes('EVIDENCE_INVALID'))return 'Attempt evidence needs administrator review before another attempt.';
  if(reasons.includes('ATTEMPT_LIMIT'))return 'You have used all allowed attempts. Contact your training administrator.';
  if(reasons.includes('ATTEMPT_IN_PROGRESS'))return 'Resume your active attempt before starting another.';
  if(reasons.includes('COOLDOWN'))return `You can check for another attempt after ${new Date(requirement.retryAt).toLocaleString()}. Refresh the guidance when the waiting period ends.`;
  return requirement.retryEligible?'Another attempt is available. Review any missed competencies before starting.':'Reopen the course to check your current attempt rules.';
}
async function wallet(after?:string){
  const current=generation;const data=await api(`credentials${after?`?after=${encodeURIComponent(after)}`:""}`);if(current!==generation)return;
  const host=q("#credentials");if(!after)host.replaceChildren(el("h2","My training credentials"));
  host.querySelector('[data-more-credentials]')?.remove();
  for(const credential of data.items){const article=document.createElement("article");article.append(el("h3",credential.title),el("p",`${credential.status} · issued ${new Date(credential.issuedAt).toLocaleDateString()}${credential.expiresAt?` · expires ${new Date(credential.expiresAt).toLocaleDateString()}`:" · no expiration"}`),el("p",credential.intendedUse));host.append(article);
    if(credential.verificationEnabled){const url=new URL('/verify',location.origin);url.searchParams.set('credential',credential.publicId);const link=document.createElement('a');link.href=url.href;link.textContent='Open public verification';article.append(link);button('Copy verification link',async()=>{await navigator.clipboard.writeText(url.href);message('Verification link copied. Sharing does not enable learner discovery.');},article);
      const canvas=document.createElement('canvas');canvas.hidden=true;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','QR code containing this credential’s public verification URL');article.append(canvas);
      button('Show verification QR',async()=>{await renderVerificationQr(canvas,url.href);canvas.hidden=false;},article);
    }
    if(credential.verificationAllowed){
      const key=crypto.randomUUID();button(credential.verificationEnabled?'Disable public sharing':'Enable public sharing',async()=>{
        if(!credential.verificationEnabled&&!window.confirm('Enable public sharing? Previously shared links will work again.'))return;
        const current=generation;
        await api(`credentials/${encodeURIComponent(credential.credentialId)}/sharing`,'POST',{enabled:!credential.verificationEnabled,revision:credential.sharingRevision},key);
        if(current!==generation)return;await wallet();message(credential.verificationEnabled?'Public sharing disabled. Existing links no longer resolve.':'Public sharing enabled. Previously shared links work again.');
      },article);
    }
  }
  if(!after&&!data.items.length)host.append(el("p","No training credentials have been issued yet."));
  if(data.nextCursor)button("More credentials",()=>wallet(data.nextCursor),host).dataset.moreCredentials='true';
}
q("#refresh").onclick=()=>{void Promise.all([list(),wallet()]).catch(error=>message(error.message));};
q("#more").onclick=()=>{void list(true).catch(error=>message(error.message));};
q("#sign-out").onclick=()=>{clearMedia();generation++;noticeRequest++;clearAccessToken();course=undefined;startKeys.clear();storyKeys.clear();cursor=null;for(const id of ["#courses","#course","#assessment","#credentials","#notices"])q(id).replaceChildren();q("#more").hidden=true;q('#more-notices').hidden=true;message("Signed out.");};
let noticeCursor:string|null=null,noticeRequest=0;
async function notices(append=false){
  const request=++noticeRequest,token=getSessionIdentity(),host=q('#notices');
  try{
    const data=await api(`notifications${append&&noticeCursor?`?after=${encodeURIComponent(noticeCursor)}`:''}`);
    if(request!==noticeRequest||token!==getSessionIdentity())return;
    if(!append)host.replaceChildren();
    const decisions:Record<string,string>={keep_valid:'Existing credentials remain valid under the issuer decision.',future_learners_only:'This update applies to future learners.',update_modules:'The issuer requires selected update modules.',full_retake:'The issuer requires the updated course.',supersede_on_completion:'The issuer requires updated training before credential supersession.'};
    for(const item of data.items){
      const article=document.createElement('article');article.append(el('h3',item.title),el('p',item.message));host.append(article);
      if(item.kind==='credential'){article.append(el('p',`${item.lifecycleEvent} on ${new Date(item.occurredAt).toLocaleString()}. Current status: ${item.currentStatus}.`));button('View credential wallet',async()=>{await wallet();if(token===getSessionIdentity()&&request===noticeRequest)q('#credentials').scrollIntoView({block:'start'});},article);}
      else article.append(el('p',item.releaseNotes),el('p',`Effective ${new Date(item.effectiveAt).toLocaleString()}. ${decisions[item.decision]??''}`));
      if(item.enrollmentId)button('Open assigned updated course',()=>open(item.enrollmentId),article);
      else if(['full_retake','update_modules','supersede_on_completion'].includes(item.decision))article.append(el('p','Check your assigned courses for updated training. Contact your training administrator if it has not been assigned.'));
      if(item.read)article.append(el('p','Read'));
      else button('Mark notice as read',async()=>{await api(`notifications/${encodeURIComponent(item.notificationId)}/read`,'POST',{});if(token===getSessionIdentity()&&request===noticeRequest)await notices();},article);
    }
    noticeCursor=data.nextCursor;q('#more-notices').hidden=!noticeCursor;
    if(!host.childElementCount)host.textContent='No notices.';
  }catch(error){if(request===noticeRequest&&token===getSessionIdentity()){host.textContent='Notices could not be loaded. Use Refresh notices to retry.';q('#more-notices').hidden=true;}}
}
q('#load-notices').onclick=()=>void notices();q('#more-notices').onclick=()=>void notices(true);
void notices();

const requestedEnrollment=new URLSearchParams(location.search).get('enrollment');if(requestedEnrollment&&/^[A-Za-z0-9._:-]{1,128}$/.test(requestedEnrollment))void open(requestedEnrollment).catch(error=>message(error.message));
void Promise.all([list(),wallet()]).catch(error=>message(error.message));
