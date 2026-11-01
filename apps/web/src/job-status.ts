import {createMediaReview} from './media-review.js';
import {createReconstructionPanel,type ReconstructionFiles} from './reconstruction-panel.js';
import {renderDraftConflict} from './draft-conflict.js';
import {createModelImportReview} from './model-import-review.js';
import {renderSourceReview} from './source-review-editor.js';
import {renderDraftHistory} from './draft-history-editor.js';
import {renderModelMappingEditor} from './model-mapping-editor.js';
import {renderModelExplorationEditor} from './model-exploration-editor.js';
import {renderMediaPicker,type ApprovedMedia} from './author-media.js';
import {renderStoryEditor} from './story-editor.js';
import type {AuthorModelPreviewAssets} from './author-model-preview.js';
import {renderSimulationEditor} from './simulation-editor.js';
import { authenticatedFetch, getSessionIdentity, getOrganizationHeaders, clearAccessToken, getAccessToken, setAccessToken, setOrganizationId } from "./auth-session.js";

type JobStatus = {
  jobId: string;
  state: string;
  nextAction: string;
  attempt: number;
  maxAttempts: number;
  canRetry: boolean;
  lastFailure?: { code?: string; message?: string };
  outcome?: { status?: string; warnings?: Array<{ code?: string; message?: string }> };
};

type UploadSession = { uploadSessionId: string; blobKey: string; uploadUrl: string };
type UploadCompletion = { processingJob?: { jobId?: string } };
type ReviewSnapshot = {
  courseVersion: { courseVersionId: string; revision: number; status: string; content: Record<string, unknown>; createdBy: string };
  decisions: Array<{ targetType: string; targetId: string; decision: string; actorId: string; rationale: string }>;
  release?: { releaseId: string; releaseHash: string; status: string };
};

const signInButton = document.querySelector<HTMLButtonElement>("#sign-in")!;
const signOutButton = document.querySelector<HTMLButtonElement>("#sign-out")!;
const identityElement = document.querySelector<HTMLElement>("#identity")!;
const demoRoleWrap = document.querySelector<HTMLElement>("#demo-role-wrap")!;
const demoRoleSelect = document.querySelector<HTMLSelectElement>("#demo-role")!;
const uploadSection = document.querySelector<HTMLElement>("#upload-section")!;
const uploadForm = document.querySelector<HTMLFormElement>("#upload-form")!;
const uploadButton = document.querySelector<HTMLButtonElement>("#upload")!;
const photoUploadForm = document.querySelector<HTMLFormElement>("#photo-upload-form")!;
const photoUploadButton = document.querySelector<HTMLButtonElement>("#photo-upload")!;
const photoUploadStatus = document.querySelector<HTMLElement>("#photo-upload-status")!;
const photoUploadResults = document.querySelector<HTMLElement>("#photo-upload-results")!;
const jobSection = document.querySelector<HTMLElement>("#job-section")!;
const reviewSection = document.querySelector<HTMLElement>("#review-section")!;
const reviewLoadForm = document.querySelector<HTMLFormElement>("#review-load-form")!;
const courseVersionInput = document.querySelector<HTMLInputElement>("#course-version-id")!;
const reviewPanel = document.querySelector<HTMLElement>("#review-panel")!;
const decisionForm = document.querySelector<HTMLFormElement>("#decision-form")!;
const publishCourseButton = document.querySelector<HTMLButtonElement>("#publish-course")!;
const reviseCourseButton=document.querySelector<HTMLButtonElement>('#revise-course')!;
let revisionAttempt:{source:string;reason:string;key:string}|undefined;
const releaseResult = document.querySelector<HTMLElement>("#release-result")!;
const form = document.querySelector<HTMLFormElement>("#job-form")!;
const jobIdInput = document.querySelector<HTMLInputElement>("#job-id")!;
const statusElement = document.querySelector<HTMLElement>("#status")!;
const details = document.querySelector<HTMLElement>("#details")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry")!;
const retryForm = document.querySelector<HTMLFormElement>("#retry-form")!;
const retryReasonInput = document.querySelector<HTMLInputElement>("#retry-reason")!;
const retryCancelButton = document.querySelector<HTMLButtonElement>("#retry-cancel")!;

const demoMode = document.body.dataset.demoMode === "true";
const demoRoleKey = "mdt.demo.role";
type DemoRole = "author" | "reviewer";
function readDemoRole(): DemoRole {
  try { return sessionStorage.getItem(demoRoleKey) === "reviewer" ? "reviewer" : "author"; }
  catch { return "author"; }
}
if (demoMode) {
  const demoRole = readDemoRole();
  setAccessToken(`demo-${demoRole}`);
  setOrganizationId("org_fixture");
  demoRoleWrap.classList.remove("hidden");
  demoRoleSelect.value = demoRole;
  demoRoleSelect.addEventListener("change", () => {
    const nextRole: DemoRole = demoRoleSelect.value === "reviewer" ? "reviewer" : "author";
    try { sessionStorage.setItem(demoRoleKey, nextRole); } catch { /* The next load defaults safely to author. */ }
    setAccessToken(`demo-${nextRole}`);
    setOrganizationId("org_fixture");
    window.location.reload();
  });
}

let accessToken = getAccessToken();
if(accessToken){
  for(const section of [uploadSection,jobSection,reviewSection])section.classList.remove('hidden');
  signInButton.classList.add('hidden');signOutButton.classList.remove('hidden');identityElement.textContent='Signed in.';
}
if (demoMode) {
  signOutButton.classList.add("hidden");
  identityElement.textContent = `Demo mode: signed in as the local ${readDemoRole()} role.`;
}

const selectedOrganization=getOrganizationHeaders()['x-organization-id'];
if(selectedOrganization){const input=document.querySelector<HTMLInputElement>('#organization-id')!;input.value=selectedOrganization;input.readOnly=true;}
let currentJobId: string | undefined;
let loadedReview: ReviewSnapshot | undefined;
let editingContent: Record<string, unknown> = {};
let draftDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveInFlight = false;
let saveBlocked = false;
let editGeneration = 0;
let editorEpoch = 0;
let recoveryKey: string | undefined;
const draftEditor = document.querySelector<HTMLFormElement>("#draft-editor")!;
const draftFields = document.querySelector<HTMLFieldSetElement>("#draft-fields")!;
const draftComparison=document.querySelector<HTMLElement>("#draft-comparison")!;
const compareDraft=document.querySelector<HTMLButtonElement>("#compare-draft")!;
const draftMessage = document.querySelector<HTMLElement>("#draft-message")!;
const draftTitle = document.querySelector<HTMLInputElement>("#draft-title")!;
const draftModules = document.querySelector<HTMLElement>("#draft-modules")!;
const courseLibrary = document.querySelector<HTMLElement>("#course-library")!;
const libraryStatus = document.querySelector<HTMLElement>("#course-library-status")!;
const moreCourses = document.querySelector<HTMLButtonElement>("#more-courses")!;
const createCourseButton = document.querySelector<HTMLButtonElement>("#create-course")!;
let nextCourseCursor: string | undefined;
let creationAttempt: { title: string; key: string } | undefined;
let libraryLoading = false;
const sourceOptions = document.querySelector<HTMLElement>("#source-options")!;
const generationStatus = document.querySelector<HTMLElement>("#generation-status")!;
const generateButton = document.querySelector<HTMLButtonElement>("#generate-course")!;
const moreSources = document.querySelector<HTMLButtonElement>("#more-sources")!;
let sourceCursor: string | undefined;
let sourcesLoading = false;
const sourceReader = document.querySelector<HTMLElement>("#source-reader")!;
const sourceReaderTitle = document.querySelector<HTMLElement>("#source-reader-title")!;
const sourceReaderStatus = document.querySelector<HTMLElement>("#source-reader-status")!;
const sourcePassages = document.querySelector<HTMLElement>("#source-passages")!;
const sourceReviewControls=document.createElement('div');sourceReader.append(sourceReviewControls);
const morePassages = document.querySelector<HTMLButtonElement>("#more-passages")!;
let readingSourceId: string | undefined;
let passageCursor: string | undefined;
let readerRequest = 0;
async function readSource(sourceId: string, more = false) {
  const request = ++readerRequest;
  const token = accessToken;
  sourceReader.classList.remove("hidden");
  sourceReaderStatus.textContent = "Loading source passages…";
  sourceReviewControls.replaceChildren();
  morePassages.disabled = true;
  if (!more) { sourcePassages.replaceChildren(); morePassages.classList.add("hidden"); }
  try {
    const source = await apiJson<{ fileName: string; sourceHash: string; items: Array<{ text: string; heading?: string; citation: Record<string, unknown> }>; nextCursor?: string }>(`/api/v1/knowledge-sources/${encodeURIComponent(sourceId)}${more && passageCursor ? `?after=${encodeURIComponent(passageCursor)}` : ""}`);
    if (request !== readerRequest || token !== accessToken) return;
    readingSourceId = sourceId;
    passageCursor = source.nextCursor;
    sourceReaderTitle.textContent = source.fileName;
    for (const passage of source.items) {
      const article = document.createElement("article");
      const heading = document.createElement("h5");
      const page = passage.citation.page;
      heading.textContent = `${typeof page === "number" ? `Page ${page}` : "Source passage"}${passage.heading ? ` — ${passage.heading}` : ""}`;
      const text = document.createElement("p");
      text.style.whiteSpace = "pre-wrap";
      text.textContent = passage.text;
      const reference = document.createElement("small");
      reference.textContent = `Reference: ${JSON.stringify(passage.citation)}`;
      article.append(heading, text, reference); sourcePassages.append(article);
    }
    sourceReaderStatus.textContent = `${sourcePassages.childElementCount} passages displayed. Compare these with the draft before approving.`;
    morePassages.classList.toggle("hidden", !passageCursor);
    renderSourceReview(sourceReviewControls,{active:()=>request===readerRequest&&token===accessToken,
      save:(input,key)=>apiJson(`/api/v1/knowledge-sources/${encodeURIComponent(sourceId)}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({...input,sourceHash:source.sourceHash})}),
      refresh:()=>loadSources()});
    if (!more) sourceReaderTitle.focus();
  } catch {
    if (request === readerRequest && token === accessToken) {
      sourceReaderStatus.textContent = "This source is unavailable or could not be loaded. Refresh the document list and try again.";
      sourcePassages.replaceChildren();
      morePassages.classList.add("hidden");
    }
  } finally { if (request === readerRequest) morePassages.disabled = false; }
}
morePassages.addEventListener("click", () => { if (readingSourceId && passageCursor) void readSource(readingSourceId, true); });
function sourceReviewButton(sourceId: string, label: string) {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = label;
  button.addEventListener("click", () => { void readSource(sourceId); });
  return button;
}
async function loadSources(more = false) {
  if (sourcesLoading) return;
  sourcesLoading = true;
  const token = accessToken;
  try {
    const page = await apiJson<{ items: Array<{ assetVersionId: string; fileName: string; state: string; chunkCount: number }>; nextCursor?: string }>(`/api/v1/knowledge-sources${more && sourceCursor ? `?after=${encodeURIComponent(sourceCursor)}` : ""}`);
    if (accessToken !== token) return;
    if (!more) sourceOptions.replaceChildren();
    for (const source of page.items) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox"; checkbox.value = source.assetVersionId;
      label.append(checkbox, document.createTextNode(`${source.fileName} — ${source.chunkCount} source passages; ${source.state === "APPROVED" ? "approved" : "awaiting review"}`));
      sourceOptions.append(label);
      sourceOptions.append(sourceReviewButton(source.assetVersionId, `Read ${source.fileName}`));
    }
    sourceCursor = page.nextCursor;
    moreSources.classList.toggle("hidden", !sourceCursor);
    generationStatus.textContent = sourceOptions.childElementCount ? "Choose the documents to use." : "No processed source documents are available yet.";
  } catch { generationStatus.textContent = "Source documents could not be loaded. Please try again."; }
  finally { sourcesLoading = false; }
}
document.querySelector("#load-sources")!.addEventListener("click", () => { void loadSources(); });
moreSources.addEventListener("click", () => { void loadSources(true); });
const generationMediaOptions=document.querySelector<HTMLElement>('#generation-media-options')!;
const generationMediaStatus=document.querySelector<HTMLElement>('#generation-media-status')!;
const moreGenerationMedia=document.querySelector<HTMLButtonElement>('#more-generation-media')!;
let generationMediaCursor:string|undefined,generationMediaRequest=0;
function clearGenerationMedia(){generationMediaRequest++;generationMediaCursor=undefined;generationMediaOptions.replaceChildren();generationMediaStatus.textContent='';moreGenerationMedia.hidden=true;moreGenerationMedia.disabled=false;}
async function loadGenerationMedia(more=false){
 const request=++generationMediaRequest,epoch=editorEpoch,identity=getSessionIdentity();
 moreGenerationMedia.disabled=true;
 try{
  const page=await apiJson<{items:Array<{assetVersionId:string;fileName:string;type:string}>;nextCursor?:string}>(`/api/v1/approved-media${more&&generationMediaCursor?`?after=${encodeURIComponent(generationMediaCursor)}`:''}`);
  if(request!==generationMediaRequest||epoch!==editorEpoch||identity!==getSessionIdentity())return;
  if(!more)generationMediaOptions.replaceChildren();
  for(const asset of page.items){
   if([...generationMediaOptions.querySelectorAll<HTMLInputElement>('input')].some(input=>input.value===asset.assetVersionId))continue;
   const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=asset.assetVersionId;
   label.append(checkbox,document.createTextNode(`${asset.fileName} (${asset.type})`));generationMediaOptions.append(label);
  }
  generationMediaCursor=page.nextCursor;moreGenerationMedia.hidden=!generationMediaCursor;
  generationMediaStatus.textContent=generationMediaOptions.childElementCount?'Choose any media to include in this generation.':'No approved media is available.';
 }catch{if(request===generationMediaRequest&&epoch===editorEpoch&&identity===getSessionIdentity())generationMediaStatus.textContent='Approved media could not be loaded. Try again.';}
 finally{if(request===generationMediaRequest)moreGenerationMedia.disabled=false;}
}
document.querySelector('#load-generation-media')!.addEventListener('click',()=>{void loadGenerationMedia();});
moreGenerationMedia.addEventListener('click',()=>{void loadGenerationMedia(true);});

document.querySelector("#generate-course-form")!.addEventListener("submit", async event => {
  event.preventDefault();
  if (generateButton.disabled) return;
  if (!loadedReview || draftDirty || saveInFlight || draftFields.disabled) { generationStatus.textContent = "Open an editable course and save your changes first."; return; }
  const sourceArtifactIds = [...sourceOptions.querySelectorAll<HTMLInputElement>("input:checked")].map(input => input.value);
  if (!sourceArtifactIds.length || sourceArtifactIds.length > 32) { generationStatus.textContent = "Choose between one and 32 source documents."; return; }
  const mediaAssetVersionIds=[...generationMediaOptions.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value);
  if(mediaAssetVersionIds.length>32){generationStatus.textContent='Choose at most 32 media assets.';return;}
  const courseVersionId = loadedReview.courseVersion.courseVersionId;
  const epoch = editorEpoch;
  const generation = editGeneration;
  generateButton.disabled = true;
  generationStatus.textContent = "Generating a draft… You can keep editing; newer edits will be preserved.";
  try {
    const response = await apiJson<{ aiRunId: string; appliedToCourse: boolean; result: { status: string; warnings?: Array<{ message: string }> } }>(`/api/v1/course-versions/${encodeURIComponent(courseVersionId)}/generate-draft`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceArtifactIds, mediaAssetVersionIds, userInstruction: document.querySelector<HTMLTextAreaElement>("#generation-instructions")!.value.trim() })
    });
    if (epoch !== editorEpoch) return;
    if (response.appliedToCourse && !draftDirty && generation === editGeneration && !saveInFlight) { courseVersionInput.value = courseVersionId; await loadReview(); }
    generationStatus.textContent = response.appliedToCourse
      ? (draftDirty ? "The generated draft was saved, but your newer edits remain here. Compare the saved course before continuing." : "Generated draft saved. Review its source references and content before approval.")
      : `Generation ${response.result.status.toLowerCase()}; the course was unchanged. Saved result: ${response.aiRunId}.`;
    if (response.result.warnings?.length) generationStatus.textContent += ` ${response.result.warnings.map(w => w.message).join(" ")}`;
  } catch { generationStatus.textContent = "Generation could not be confirmed. Reload the saved course before starting another generation."; }
  finally { generateButton.disabled = false; }
});

async function loadCourseLibrary(more = false) {
  if (libraryLoading) return;
  libraryLoading = true;
  const token = accessToken;
  try {
    const page = await apiJson<{ items: Array<{ courseVersionId: string; title: string; status: string; revision: number }>; nextCursor?: string }>(`/api/v1/courses${more && nextCourseCursor ? `?after=${encodeURIComponent(nextCourseCursor)}` : ""}`);
    if (accessToken !== token) return;
    if (!more) courseLibrary.replaceChildren();
    for (const item of page.items) {
      const row = document.createElement("li");
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = `${item.title} — ${item.status.toLowerCase()}, revision ${item.revision}`;
      open.addEventListener("click", async () => {
        if (draftDirty || saveInFlight) { libraryStatus.textContent = "Save or discard your current edits before opening another course."; return; }
        courseVersionInput.value = item.courseVersionId;
        try { await loadReview(); draftTitle.focus(); } catch { libraryStatus.textContent = "The course could not be opened. Try again."; }
      });
      row.append(open); courseLibrary.append(row);
    }
    nextCourseCursor = page.nextCursor;
    moreCourses.classList.toggle("hidden", !nextCourseCursor);
    libraryStatus.textContent = courseLibrary.childElementCount ? `${courseLibrary.childElementCount} course versions shown.` : "No courses yet. Create your first course above.";
  } catch { libraryStatus.textContent = "Courses could not be loaded. Check your connection and try again."; }
  finally { libraryLoading = false; }
}
document.querySelector("#refresh-courses")!.addEventListener("click", () => { void loadCourseLibrary(); });
moreCourses.addEventListener("click", () => { void loadCourseLibrary(true); });
document.querySelector("#course-create-form")!.addEventListener("submit", async event => {
  event.preventDefault();
  if (createCourseButton.disabled) return;
  if (draftDirty || saveInFlight) { libraryStatus.textContent = "Save or discard your current edits before creating another course."; return; }
  const title = document.querySelector<HTMLInputElement>("#course-create-title")!.value.trim();
  if (!title) return;
  if (creationAttempt?.title !== title) creationAttempt = { title, key: newIdempotencyKey("course") };
  createCourseButton.disabled = true;
  const token = accessToken;
  try {
    const created = await apiJson<{ courseVersionId: string }>("/api/v1/courses", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": creationAttempt.key }, body: JSON.stringify({ title })
    });
    if (accessToken !== token) return;
    courseVersionInput.value = created.courseVersionId;
    await loadReview();
    creationAttempt = undefined;
    document.querySelector<HTMLInputElement>("#course-create-title")!.value = "";
    await loadCourseLibrary();
    draftTitle.focus();
  } catch (error) {
    libraryStatus.textContent = error instanceof Error
      ? error.message
      : "The course could not be opened or created. Retry with the same title to recover the request.";
  }
  finally { createCourseButton.disabled = false; }
});

function markDraftDirty() {
  draftComparison.replaceChildren();
  draftDirty = true;
  editGeneration++;
  draftMessage.textContent = saveBlocked ? "Resolve the save conflict before continuing. Your edits remain here." : "Unsaved changes. Saving shortly…";
  publishCourseButton.disabled = true;
  rememberDraft();
  scheduleSave();
}

function rememberDraft() {
  if (!recoveryKey || !loadedReview) return;
  try {
    sessionStorage.setItem(recoveryKey, JSON.stringify({ revision: loadedReview.courseVersion.revision, content: editingContent }));
  } catch { draftMessage.textContent = "This browser cannot retain recovery data. Keep this tab open until saving succeeds."; }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  if (!saveBlocked && draftDirty) saveTimer = setTimeout(() => { void saveDraft(); }, 1200);
}

async function saveDraft() {
  clearTimeout(saveTimer);
  if (!loadedReview || !draftDirty || saveInFlight || saveBlocked || draftFields.disabled || !draftEditor.reportValidity()) return;
  const snapshot = loadedReview;
  const content = structuredClone(editingContent);
  const generation = editGeneration;
  const epoch = editorEpoch;
  const key = recoveryKey;
  saveInFlight = true;
  draftMessage.textContent = "Saving…";
  try {
    const result = await apiJson<{ revision: number }>(`/api/v1/course-versions/${encodeURIComponent(snapshot.courseVersion.courseVersionId)}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: snapshot.courseVersion.revision, content })
    });
    if (epoch !== editorEpoch) return;
    if (!Number.isSafeInteger(result.revision) || result.revision < snapshot.courseVersion.revision) throw new Error("The save response could not be verified.");
    snapshot.courseVersion.revision = result.revision;
    snapshot.courseVersion.content = content;
    snapshot.courseVersion.status = "DRAFT";
    document.querySelector("#review-version")!.textContent = `${snapshot.courseVersion.courseVersionId} / rev ${result.revision}`;
    document.querySelector("#review-state")!.textContent = "DRAFT";
    document.querySelector("#review-content")!.textContent = JSON.stringify({ content, decisions: snapshot.decisions }, null, 2);
    draftDirty = generation !== editGeneration;
    if (draftDirty) {
      rememberDraft();
      scheduleSave();
    } else {
      if (key) { try { sessionStorage.removeItem(key); } catch { /* storage may be unavailable */ } }
      publishCourseButton.disabled = Boolean(snapshot.release);
      draftMessage.textContent = `Saved at ${new Date().toLocaleTimeString()}. Revision ${result.revision} requires review.`;
      renderReviewTargets(snapshot);
    }
  } catch (error) {
    if (epoch !== editorEpoch) return;
    saveBlocked = error instanceof ApiRequestError && error.status === 409;
    draftMessage.textContent = error instanceof Error ? `${error.message} Your edits remain here.` : "Save failed. Your edits remain here.";
  } finally {
    saveInFlight = false;
  }
}

class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function contentRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function renderDraftModules() {
  draftModules.replaceChildren();
  if(loadedReview){
   const version=loadedReview.courseVersion,identity=getSessionIdentity(),epoch=editorEpoch;
   const active=()=>identity===getSessionIdentity()&&epoch===editorEpoch;
   const base=`/api/v1/course-versions/${encodeURIComponent(version.courseVersionId)}/history`;
   renderDraftHistory(draftModules,{active,clean:()=>!draftDirty&&!saveInFlight&&!draftFields.disabled,revision:()=>version.revision,key:()=>newIdempotencyKey('restore'),
    list:cursor=>apiJson(base+(cursor?'?beforeRevision='+cursor:'')),preview:(eventId,side)=>apiJson(base+'?eventId='+encodeURIComponent(eventId)+'&side='+side),
    restore:async(input,key)=>{draftFields.disabled=true;try{await apiJson(base,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({...input,confirmed:true})});if(!active())return;await loadReview();draftTitle.focus();}finally{if(active())draftFields.disabled=false;}}
   });
  }

  const simulation=editingContent.simulation as {definition?:unknown}|undefined;
  if(simulation?.definition)renderSimulationEditor(draftModules,simulation.definition,markDraftDirty,editingContent.model,async()=>{
    if(!loadedReview||draftDirty||saveInFlight||draftFields.disabled)throw Error('Open an editable saved draft and save changes before loading 3D.');
    const version=loadedReview.courseVersion;return apiJson<AuthorModelPreviewAssets>(`/api/v1/course-versions/${encodeURIComponent(version.courseVersionId)}/model-preview?revision=${version.revision}`);
  });
  renderSimulationCreation();
  renderStoryEditor(draftModules,editingContent,markDraftDirty);
  const modules = contentRows(editingContent.modules);
  if(editingContent._lineage){
    const impact=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Release changes and requalification';impact.append(legend);draftModules.append(impact);
    const change=(editingContent.releaseChange??{schemaVersion:'release-change.v1',classes:[],releaseNotes:'',effectiveAt:'',decision:'',rationale:'',learnerMessage:'',updateModuleIds:[]}) as Record<string,any>;
    const update=()=>{editingContent.releaseChange=change;markDraftDirty();};
    for(const [value,label] of [['cosmetic','Cosmetic / editorial'],['instructional','Instructional content'],['assessment','Assessment'],['simulation','Simulation / procedure behavior'],['certification_policy','Certification policy'],['product_revision','Product revision']]){
      const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=change.classes?.includes(value)??false;input.dataset.changeClass=value;
      input.onchange=()=>{const selected=new Set(change.classes??[]);input.checked?selected.add(value):selected.delete(value);change.classes=[...selected];update();};wrapper.append(input,document.createTextNode(label));impact.append(wrapper);
    }
    const select=document.createElement('select');select.setAttribute('aria-label','Issuer requalification decision');select.dataset.requalification='true';select.add(new Option('Choose the issuer decision',''));
    for(const [value,label] of [['keep_valid','Keep existing credentials valid'],['future_learners_only','Apply only to future learners'],['update_modules','Require selected update modules'],['full_retake','Require the entire updated course'],['supersede_on_completion','Require updated course; supersede after successful completion']])select.add(new Option(label,value));
    select.value=change.decision;select.onchange=()=>{change.decision=select.value;if(select.value!=='update_modules')change.updateModuleIds=[];update();renderDraftModules();};impact.append(select);
    for(const [key,label] of [['releaseNotes','What changed'],['rationale','Issuer decision rationale'],['learnerMessage','Message for affected learners']]){
      const wrapper=document.createElement('label'),input=document.createElement('textarea');input.value=change[key]??'';input.maxLength=4000;input.dataset.releaseChange=key;input.oninput=()=>{change[key]=input.value;update();};wrapper.append(document.createTextNode(label),input);impact.append(wrapper);
    }
    const dateLabel=document.createElement('label'),date=document.createElement('input');date.type='datetime-local';date.setAttribute('aria-label','Change effective date');date.dataset.releaseChange='effectiveAt';
    if(change.effectiveAt&&Number.isFinite(Date.parse(change.effectiveAt))){const local=new Date(change.effectiveAt);date.value=new Date(local.getTime()-local.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    date.oninput=()=>{change.effectiveAt=date.value&&Number.isFinite(new Date(date.value).getTime())?new Date(date.value).toISOString():'';update();};dateLabel.append(document.createTextNode('Effective date and time (your local time)'),date);impact.append(dateLabel);
    if(change.decision==='update_modules')for(const module of modules){
      const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.disabled=!module.moduleId;input.checked=change.updateModuleIds?.includes(module.moduleId)??false;
      input.onchange=()=>{const selected=new Set(change.updateModuleIds??[]);input.checked?selected.add(module.moduleId):selected.delete(module.moduleId);change.updateModuleIds=[...selected];update();};wrapper.append(input,document.createTextNode(`Update module: ${String(module.title??'Untitled')}${module.moduleId?'':' (configure certification requirements to assign an identifier)'}`));impact.append(wrapper);
    }
    const note=document.createElement('p');note.textContent='The publisher approves this decision with the release. Existing credentials keep their historical evidence; supersession requires a qualifying replacement credential.';impact.append(note);
  }
  const certification=document.createElement("fieldset");const heading=document.createElement("legend");heading.textContent="Certification requirements";certification.append(heading);draftModules.append(certification);
  const policy=editingContent.policy as Record<string,unknown>|undefined;
  if(policy?.schemaVersion!=="certification-policy.v1") {
    const configure=document.createElement("button");configure.type="button";configure.textContent="Configure certification requirements";
    configure.onclick=()=>{
      for(const module of modules){module.moduleId ||= crypto.randomUUID();for(const activity of contentRows(module.activities))activity.activityId ||= crypto.randomUUID();}
      const scored=modules.flatMap(module=>contentRows(module.activities)).filter(activity=>["multiple_choice","multi_select","ordered_step","simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(String(activity.type)));
      editingContent.policy={...policy,schemaVersion:"certification-policy.v1",policyId:policy?.policyId??crypto.randomUUID(),version:policy?.version??1,requiredActivityIds:scored.map(a=>a.activityId),requiredModuleIds:[],resultSelection:"latest",passScore:1,maxAttempts:policy?.maxAttempts??3,cooldownSeconds:policy?.cooldownSeconds??60,attemptTtlSeconds:policy?.attemptTtlSeconds??1800,repeatedFailureReviewAfter:null,expirationDays:null};
      markDraftDirty();renderDraftModules();
    };certification.append(configure);
  }else{
    const publicSettings=(policy.publicVerification??{enabled:false,issuerName:'',courseTitle:''}) as Record<string,unknown>;
    const publicLabel=document.createElement('label'),publicEnabled=document.createElement('input');publicEnabled.type='checkbox';publicEnabled.checked=publicSettings.enabled===true;
    publicEnabled.onchange=()=>{publicSettings.enabled=publicEnabled.checked;policy.publicVerification=publicSettings;markDraftDirty();};publicLabel.append(publicEnabled,document.createTextNode('Enable public credential verification with the reviewed fields below'));certification.append(publicLabel);
    for(const [key,label,limit] of [['issuerName','Public issuer name',160],['courseTitle','Public course title',240]] as const){
      const wrapper=document.createElement('label'),input=document.createElement('input');wrapper.textContent=label;input.value=String(publicSettings[key]??'');input.maxLength=limit;input.oninput=()=>{publicSettings[key]=input.value;policy.publicVerification=publicSettings;markDraftDirty();};wrapper.append(input);certification.append(wrapper);
    }
    const choice=document.createElement("select");choice.setAttribute("aria-label","Result used for certification");
    for(const value of ["latest","best"]){const option=new Option(value==="latest"?"Latest attempt":"Best completed attempt",value);choice.add(option);}choice.value=String(policy.resultSelection);
    choice.onchange=()=>{policy.resultSelection=choice.value;markDraftDirty();};certification.append(choice);
    for(const [key,label] of [["passScore","Overall passing threshold (0 to 1)"],["expirationDays","Credential validity in days (blank means no expiration)"],["repeatedFailureReviewAfter","Failures before administrator review (blank disables this rule)"]]){
      const wrapper=document.createElement("label");wrapper.textContent=label;const input=document.createElement("input");input.type="number";input.step=key==="passScore"?"0.01":"1";input.value=policy[key]==null?"":String(policy[key]);
      input.oninput=()=>{policy[key]=input.value===""?null:Number(input.value);markDraftDirty();};wrapper.append(input);certification.append(wrapper);
    }
    for(const module of modules){
      const moduleLabel=document.createElement("label"),moduleRequired=document.createElement("input");moduleRequired.type="checkbox";
      moduleRequired.checked=Array.isArray(policy.requiredModuleIds)&&policy.requiredModuleIds.includes(module.moduleId);
      moduleRequired.onchange=()=>{const selected=new Set(Array.isArray(policy.requiredModuleIds)?policy.requiredModuleIds:[]);moduleRequired.checked?selected.add(module.moduleId):selected.delete(module.moduleId);policy.requiredModuleIds=[...selected];markDraftDirty();};
      moduleLabel.append(moduleRequired,document.createTextNode(`Require all activities in: ${String(module.title??"Module")}`));certification.append(moduleLabel);
      for(const activity of contentRows(module.activities)){
        const label=document.createElement("label"),checkbox=document.createElement("input");checkbox.type="checkbox";
        checkbox.checked=Array.isArray(policy.requiredActivityIds)&&policy.requiredActivityIds.includes(activity.activityId);
        checkbox.onchange=()=>{const selected=new Set(Array.isArray(policy.requiredActivityIds)?policy.requiredActivityIds:[]);checkbox.checked?selected.add(activity.activityId):selected.delete(activity.activityId);policy.requiredActivityIds=[...selected];markDraftDirty();};
        label.append(checkbox,document.createTextNode(`Require: ${String(activity.title??activity.type)}`));certification.append(label);
      }
    }
  }
  modules.forEach((module, moduleIndex) => {
    const group = document.createElement("fieldset");
    group.dataset.moduleIndex=String(moduleIndex);
    const legend = document.createElement("legend");
    legend.textContent = `Module ${moduleIndex + 1}`;
    group.append(legend);
    let controlHost: HTMLElement = group;
    let currentActivity: Record<string, unknown> | undefined;
    const field = (labelText: string, value: unknown, update: (value: string) => void, multiline = false) => {
      const label = document.createElement("label");
      label.append(document.createTextNode(labelText));
      const input = document.createElement(multiline ? "textarea" : "input");
      input.value = typeof value === "string" ? value : "";
      input.addEventListener("input", () => { update(input.value); markDraftDirty(); });
      label.append(input);
      controlHost.append(label);
    };
    const button = (label: string, action: () => void | boolean | string, disabled = false) => {
      const element = document.createElement("button");
      element.type = "button"; element.textContent = label; element.disabled = disabled;
      const questionId=controlHost.dataset.questionId;
      const activity=currentActivity;
      if(activity?.activityId)element.dataset.activityControl=String(activity.activityId);
      element.addEventListener("click", () => {
        const result=action();if(result===false)return; markDraftDirty(); renderDraftModules();
        const moduleGroup=draftModules.querySelector<HTMLElement>(`[data-module-index="${moduleIndex}"]`);
        const questionGroups=[...moduleGroup?.querySelectorAll<HTMLElement>('[data-question-id]')??[]];
        const focusId=typeof result==='string'?result:questionId;
        const target=focusId?questionGroups.find(node=>node.dataset.questionId===focusId)??questionGroups[0]:undefined;
        if(!target&&activity){
          const controls=[...moduleGroup?.querySelectorAll<HTMLButtonElement>('[data-activity-control]')??[]].filter(node=>node.dataset.activityControl===activity.activityId);
          (controls.find(node=>node.textContent===label&&!node.disabled)??controls.find(node=>!node.disabled)??moduleGroup?.querySelector<HTMLElement>('input'))?.focus();
        }
        if(target){const same=[...target.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label&&!node.disabled);(same??target.querySelector<HTMLElement>('input,textarea,button'))?.focus();}
      });
      controlHost.append(element);
    };
    field("Module title", module.title, value => { module.title = value; });
    button("Move module up", () => { [modules[moduleIndex - 1], modules[moduleIndex]] = [modules[moduleIndex], modules[moduleIndex - 1]]; }, moduleIndex === 0);
    button("Move module down", () => { [modules[moduleIndex + 1], modules[moduleIndex]] = [modules[moduleIndex], modules[moduleIndex + 1]]; }, moduleIndex === modules.length - 1);
    const mediaIdentity=getSessionIdentity();
    const pickerOptions={active:()=>getSessionIdentity()===mediaIdentity&&!draftFields.disabled,load:(after?:string)=>apiJson<{items:ApprovedMedia[];nextCursor?:string}>('/api/v1/approved-media'+(after?'?after='+encodeURIComponent(after):''))};
    const activities = contentRows(module.activities);
    activities.forEach((activity, activityIndex) => {
      currentActivity=activity;
      const heading = document.createElement("h4");
      heading.textContent = `Activity ${activityIndex + 1}: ${String(activity.type ?? "Content")}`;
      group.append(heading);
      field("Activity title", activity.title, value => { activity.title = value; });
      field("Learner instructions", activity.instructions, value => { activity.instructions = value; }, true);
      if (activity.type === "text" || activity.type === "rich_text") field("Content", activity.text, value => { activity.text = value; }, true);
      if(['3d_viewer','hotspot'].includes(String(activity.type)))renderModelExplorationEditor(group,activity,contentRows((editingContent.model as Record<string,any>|undefined)?.manifest?.components),markDraftDirty);
      if(activity.type==='image'||activity.type==='video'){
        const media=(activity.media&&typeof activity.media==='object'?activity.media:{}) as Record<string,unknown>;activity.media=media;
        const binding=document.createElement('p');binding.textContent='Bound asset version: '+String(media.assetVersionId??'None');group.append(binding);
        const key=activity.type==='image'?'altText':'transcript';field(activity.type==='image'?'Image description':'Video transcript',media[key],value=>{media[key]=value;},true);
        renderMediaPicker(group,{...pickerOptions,type:activity.type,select:asset=>{media.assetVersionId=asset.assetVersionId;markDraftDirty();renderDraftModules();draftModules.querySelector<HTMLElement>('[data-module-index="'+moduleIndex+'"] input')?.focus();}});
      }
      if(['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(String(activity.type))){
        const label=document.createElement('label');label.textContent='Interactive activity type';
        const select=document.createElement('select');
        for(const [value,title] of [['simulation','Simulation'],['guided_procedure','Guided procedure'],['manipulation','Component manipulation'],['assembly','Assembly / disassembly'],['fault_troubleshooting','Fault troubleshooting'],['simulation_outcome','Simulation outcome assessment']])select.add(new Option(title,value));
        select.value=String(activity.type);select.onchange=()=>{activity.type=select.value;markDraftDirty();};label.append(select);group.append(label);
        const guidance=document.createElement('p');guidance.textContent='Configure the bound procedure steps, component actions, scoring and equivalent instructions in the simulation editor above.';group.append(guidance);
      }
      if ((activity.assessment && typeof activity.assessment === "object") || ["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(String(activity.type))) {
        const policy = editingContent.policy as Record<string, unknown> | undefined;
        if (policy) {
          field("Maximum attempts", String(policy.maxAttempts ?? ""), value => { policy.maxAttempts = Number(value); });
          field("Retry cooldown (seconds)", String(policy.cooldownSeconds ?? ""), value => { policy.cooldownSeconds = Number(value); });
          field("Attempt duration (seconds)", String(policy.attemptTtlSeconds ?? ""), value => { policy.attemptTtlSeconds = Number(value); });
        }
      }
      if (activity.assessment && typeof activity.assessment === "object") {
        const assessment = activity.assessment as Record<string, unknown>;
        field("Passing threshold (0 to 1)", String(assessment.passScore ?? ""), value => { assessment.passScore = Number(value); });
        const questions=contentRows(assessment.questions);
        questions.forEach((question,questionIndex) => {
          const questionGroup=document.createElement('fieldset'),legend=document.createElement('legend');
          questionGroup.dataset.questionId=String(question.questionId);legend.textContent=`Question ${questionIndex+1}: ${question.type==='ordered_step'?'ordered steps':question.type==='multi_select'?'multiple answer':'single choice'}`;questionGroup.append(legend);group.append(questionGroup);controlHost=questionGroup;
          field("Question", question.prompt, value => { question.prompt = value; }, true);
          field("Points", String(question.points ?? 1), value => { question.points = Number(value); });
          field("Competencies (comma separated)", Array.isArray(question.competencyIds) ? question.competencyIds.join(", ") : "", value => { question.competencyIds = value.split(",").map(item => item.trim()).filter(Boolean); });
          field("Answer rationale for reviewers", question.rationale, value => { question.rationale = value; }, true);
          const originalOptions=contentRows(question.options);
          const sequence=Array.isArray(question.correctOptionIds)?question.correctOptionIds:[];
          const options=question.type==='ordered_step'?[...originalOptions].sort((a,b)=>sequence.indexOf(a.optionId)-sequence.indexOf(b.optionId)):originalOptions;
          options.forEach((option, optionIndex) => {
            field(`Option ${optionIndex + 1}`, option.text, value => { option.text = value; });
            if (question.type !== "ordered_step") {
              const label = document.createElement("label");
              const correct = document.createElement("input");
              correct.type = "checkbox";
              correct.checked = Array.isArray(question.correctOptionIds) && question.correctOptionIds.includes(option.optionId);
              correct.addEventListener("change", () => {
                const previous = Array.isArray(question.correctOptionIds) ? question.correctOptionIds : [];
                question.correctOptionIds = correct.checked ? (question.type === "multiple_choice" ? [option.optionId] : [...new Set([...previous, option.optionId])]) : previous.filter(id => id !== option.optionId);
                markDraftDirty(); renderDraftModules();
              });
              label.append(correct, document.createTextNode(`Option ${optionIndex + 1} is correct`)); controlHost.append(label);
            } else {
              const explanation = document.createElement("p"); explanation.textContent = "Steps are listed in their correct order. Learner delivery must present a separate answer sequence."; controlHost.append(explanation);
              button(`Move step ${optionIndex + 1} up`, () => {
                [options[optionIndex - 1], options[optionIndex]] = [options[optionIndex], options[optionIndex - 1]];
                question.options=options;question.correctOptionIds = options.map(item => item.optionId);
              }, optionIndex === 0);
              button(`Move step ${optionIndex + 1} down`, () => {
                [options[optionIndex+1],options[optionIndex]]=[options[optionIndex],options[optionIndex+1]];
                question.options=options;question.correctOptionIds=options.map(item=>item.optionId);
              },optionIndex===options.length-1);
            }
            button(`Remove option ${optionIndex+1}`,()=>{
              if(!window.confirm('Remove this answer option? Review the remaining correct answers before publishing.'))return false;
              question.options=options.filter(item=>item.optionId!==option.optionId);
              question.correctOptionIds=sequence.filter(id=>id!==option.optionId);
            },options.length<=2);
          });
          button("Add answer option", () => {
            const option = { optionId: crypto.randomUUID(), text: "New option" };
            question.options = [...options, option];
            if (question.type === "ordered_step") question.correctOptionIds = (question.options as Array<{ optionId: string }>).map(item => item.optionId);
          }, options.length >= 20);
          button("Use selected source documents for this question", () => {
            question.citations = [...sourceOptions.querySelectorAll<HTMLInputElement>("input:checked")].map(input => ({ assetVersionId: input.value }));
          });
          const references = document.createElement("p"); references.textContent = `Question sources: ${JSON.stringify(question.citations ?? [])}`; controlHost.append(references);
          button('Move question up',()=>{[questions[questionIndex-1],questions[questionIndex]]=[questions[questionIndex],questions[questionIndex-1]];},questionIndex===0);
          button('Move question down',()=>{[questions[questionIndex+1],questions[questionIndex]]=[questions[questionIndex],questions[questionIndex+1]];},questionIndex===questions.length-1);
          button('Remove question',()=>{if(!window.confirm('Remove this question from the draft assessment?'))return false;assessment.questions=questions.filter(item=>item.questionId!==question.questionId);},questions.length<=1);
          controlHost=group;
        });
        for(const [type,label] of [['multiple_choice','single-choice'],['multi_select','multiple-answer'],['ordered_step','ordered-steps']])button(`Add ${label} question`,()=>{
          const options=[{optionId:crypto.randomUUID(),text:'First option'},{optionId:crypto.randomUUID(),text:'Second option'}];
          const citations=[...sourceOptions.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>({assetVersionId:input.value}));
          const addedId=crypto.randomUUID();
          assessment.questions=[...questions,{questionId:addedId,type,prompt:'',options,correctOptionIds:type==='ordered_step'?options.map(option=>option.optionId):[],points:1,competencyIds:[],rationale:'',citations}];
          return addedId;
        },questions.length>=100);
      }
      if (activity.citations) {
        const citations = document.createElement("p");
        citations.textContent = `Source references: ${JSON.stringify(activity.citations)}`;
        group.append(citations);
      }
      button(`Move activity ${activityIndex + 1} up`, () => { [activities[activityIndex - 1], activities[activityIndex]] = [activities[activityIndex], activities[activityIndex - 1]]; }, activityIndex === 0);
      button(`Move activity ${activityIndex + 1} down`, () => { [activities[activityIndex + 1], activities[activityIndex]] = [activities[activityIndex], activities[activityIndex + 1]]; }, activityIndex === activities.length - 1);
      button(`Remove activity ${activityIndex + 1}`, () => {
        const policy=editingContent.policy as Record<string,any>|undefined;
        const nodes=contentRows((editingContent.story as Record<string,unknown>|undefined)?.nodes);
        const referenced=nodes.some(node=>(activity.activityId!==undefined&&node.activityId===activity.activityId)||contentRows(node.prerequisites).some(c=>c.activityId===activity.activityId)||contentRows(node.choices).some(choice=>contentRows(choice.conditions).some(c=>c.activityId===activity.activityId)));
        if(referenced||policy?.requiredActivityIds?.includes(activity.activityId)||policy?.requiredModuleIds?.includes(module.moduleId)||(editingContent.releaseChange as Record<string,any>|undefined)?.updateModuleIds?.includes(module.moduleId)){
          draftMessage.textContent='Remove this activity from story references and certification requirements before deleting it.';return false;
        }
        if(['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(String(activity.type))){draftMessage.textContent='This activity is bound to the course simulation. Its binding must be replaced before removal.';return false;}
        if(!window.confirm(`Remove activity ${activityIndex+1} from this draft? Published releases remain unchanged.`))return false;
        module.activities=activities.filter(item=>item!==activity);
      });
    });
    renderMediaPicker(group,{...pickerOptions,select:asset=>{
      const activityId=crypto.randomUUID();module.activities=[...activities,{activityId,type:asset.type,title:asset.fileName,instructions:'',media:{assetVersionId:asset.assetVersionId,...(asset.type==='image'?{altText:''}:{transcript:''})},citations:[]}];
      markDraftDirty();renderDraftModules();[...draftModules.querySelectorAll<HTMLButtonElement>('[data-activity-control]')].find(b=>b.dataset.activityControl===activityId)?.focus();
    }});
    currentActivity=undefined;
    for(const [type,title] of [['3d_viewer','model viewer'],['hotspot','component hotspot']])button(`Add ${title} activity`,()=>{
      module.activities=[...activities,{activityId:crypto.randomUUID(),type,title:'New '+title,instructions:'',exploration:{overview:'',hotspots:[]},citations:[]}];
    },!contentRows((editingContent.model as Record<string,any>|undefined)?.manifest?.components).length);
    button("Add text activity", () => {
      module.activities = [...activities, { activityId: crypto.randomUUID(), type: "rich_text", title: "New activity", text: "", instructions: "", citations: [] }];
    });
    for (const [type, title] of [["multiple_choice", "single-choice"], ["multi_select", "multiple-answer"], ["ordered_step", "ordered-steps"]]) {
      button(`Add ${title} assessment`, () => {
        const options = [{ optionId: crypto.randomUUID(), text: "First option" }, { optionId: crypto.randomUUID(), text: "Second option" }];
        const citations = [...sourceOptions.querySelectorAll<HTMLInputElement>("input:checked")].map(input => ({ assetVersionId: input.value }));
        module.activities = [...activities, {
          activityId: crypto.randomUUID(), type, title: "New assessment", citations,
          assessment: { schemaVersion: "assessment-definition.v1", assessmentId: crypto.randomUUID(), version: 1, passScore: 0.8,
            questions: [{ questionId: crypto.randomUUID(), type, prompt: "", options, correctOptionIds: type === "ordered_step" ? options.map(option => option.optionId) : [], points: 1, competencyIds: [], rationale: "", citations }] }
        }];
        const currentPolicy = editingContent.policy && typeof editingContent.policy === "object" ? editingContent.policy as Record<string, unknown> : { policyId: crypto.randomUUID(), version: 1 };
        currentPolicy.requiredEvidence = [...new Set([...(Array.isArray(currentPolicy.requiredEvidence) ? currentPolicy.requiredEvidence : []), "assessment.passed"])];
        currentPolicy.maxAttempts ??= 3;
        currentPolicy.cooldownSeconds ??= 60;
        currentPolicy.attemptTtlSeconds ??= 1800;
        editingContent.policy = currentPolicy;
      });
    }
    draftModules.append(group);
  });
}

function renderSimulationCreation(){
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Model and simulation';box.append(legend);draftModules.append(box);
 const description=document.createElement('p');description.textContent='Save your draft and choose an approved model. Bind it for model viewers and hotspots, or create a simulation procedure. Add instructions and review scoring and certification requirements before publication.';box.append(description);
 const label=document.createElement('label'),models=document.createElement('select');label.append(document.createTextNode('Approved model'),models);models.add(new Option('Load approved models',''));box.append(label);
 const status=document.createElement('p');status.setAttribute('role','status');status.dataset.simulationCreationStatus='true';box.append(status);
 const load=document.createElement('button'),create=document.createElement('button');load.type=create.type='button';load.textContent='Load approved models';create.textContent='Create simulation from selected model';const bind=document.createElement('button');bind.type='button';bind.textContent=editingContent.model?'Replace bound model':'Bind selected model';create.disabled=!!editingContent.simulation;box.append(load,bind,create);
 let cursor:string|undefined,busy=false;const keys:Partial<Record<'simulation'|'model-binding'|'model-replacement',string>>={};
 const identity=getSessionIdentity();const current=()=>box.isConnected&&getSessionIdentity()===identity;
 const mappingEditor=editingContent.model?renderModelMappingEditor(box,((editingContent.model as any).manifest?.components??[]),{active:current,changed:()=>{delete keys['model-replacement'];},load:()=>{if(!models.value)throw Error('Choose an approved replacement model first.');return apiJson('/api/v1/approved-models?modelVersionId='+encodeURIComponent(models.value));}}):undefined;
 models.onchange=()=>{delete keys.simulation;delete keys['model-binding'];delete keys['model-replacement'];mappingEditor?.reset();};
 load.onclick=async()=>{
  if(busy)return;busy=true;load.disabled=true;
  try{const page=await apiJson<{items:Array<{modelVersionId:string;componentCount:number}>;nextCursor?:string}>('/api/v1/approved-models'+(cursor?'?after='+encodeURIComponent(cursor):''));if(!current())return;
   if(!cursor){mappingEditor?.reset();models.replaceChildren(new Option('Choose an approved model',''));}
   for(const item of page.items)models.add(new Option(`${item.modelVersionId} (${item.componentCount} components)`,item.modelVersionId));
   cursor=page.nextCursor;load.textContent=cursor?'Load more approved models':'Refresh approved models';status.textContent=models.options.length===1?'No approved models are available.':'Choose the model for this procedure.';
  }catch(error){if(current())status.textContent=error instanceof Error?error.message:'Model loading failed.';}finally{if(current()){busy=false;load.disabled=false;}}
 };
 const submit=async(mode:'simulation'|'model-binding'|'model-replacement')=>{
  if(busy)return;
  if(!loadedReview||draftDirty||saveInFlight||draftFields.disabled){status.textContent='Save or discard draft edits before binding a model or creating a simulation.';return;}
  if(!models.value){status.textContent='Choose an approved model first.';return;}
  let componentMapping:Array<{from:string;to:string|null}>|undefined;try{if(mode==='model-replacement')componentMapping=mappingEditor?.getMapping();}catch(error){status.textContent=error instanceof Error?error.message:'Review component mapping.';return;}
  if(!confirm(mode==='model-replacement'?`Replace the bound model using the selected component mapping and remove ${componentMapping?.filter(pair=>pair.to===null).length??0} unused components? Activities and scoring are preserved. Review instructions and new geometry before publishing.`:mode==='model-binding'?'Bind this approved model to the course for viewers and hotspots?':'Create a new simulation and procedure module using this approved model?'))return;
  const source=loadedReview.courseVersion,epoch=editorEpoch;const key=keys[mode]??=newIdempotencyKey(mode);busy=true;box.disabled=true;draftFields.disabled=true;
  try{await apiJson(`/api/v1/course-versions/${encodeURIComponent(source.courseVersionId)}/${mode}`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({revision:source.revision,modelVersionId:models.value,confirmed:true,...(componentMapping?{componentMapping}:{})})});
   if(!current()||epoch!==editorEpoch)return;courseVersionInput.value=source.courseVersionId;await loadReview();if(mode==='simulation')draftModules.querySelector<HTMLElement>('[data-simulation-editor] input')?.focus();else{draftMessage.textContent='Approved model bound. Add a model viewer or component hotspot activity to a module.';document.querySelector<HTMLElement>('#add-module')?.focus();}
  }catch(error){if(current()&&epoch===editorEpoch){status.textContent=error instanceof Error?error.message:'Creation failed. Retry with the same model.';if(error instanceof ApiRequestError&&[403,409].includes(error.status)){models.replaceChildren(new Option('Reload the saved draft to continue',''));create.disabled=true;bind.disabled=true;}}}
  finally{if(current()&&epoch===editorEpoch){busy=false;box.disabled=false;draftFields.disabled=false;}}
 };
 create.onclick=()=>submit('simulation');bind.onclick=()=>submit(editingContent.model?'model-replacement':'model-binding');
}

draftTitle.addEventListener("input", () => { editingContent.title = draftTitle.value; markDraftDirty(); });
document.querySelector("#add-module")!.addEventListener("click", () => {
  editingContent.modules = [...contentRows(editingContent.modules), { moduleId: crypto.randomUUID(), title: "New module", activities: [] }];
  markDraftDirty(); renderDraftModules();
});
draftEditor.addEventListener("submit", async event => {
  event.preventDefault();
  await saveDraft();
});
compareDraft.onclick=async()=>{
 if(!loadedReview||saveInFlight){draftMessage.textContent='Open a saved draft and wait for any pending save before comparing.';return;}
 const snapshot=loadedReview,epoch=editorEpoch,generation=editGeneration,identity=getSessionIdentity();
 const original=structuredClone(snapshot.courseVersion.content),local=structuredClone(editingContent),revision=snapshot.courseVersion.revision;
 draftComparison.replaceChildren();
 compareDraft.disabled=true;
 try{const latest=await apiJson<ReviewSnapshot>(`/api/v1/course-versions/${encodeURIComponent(snapshot.courseVersion.courseVersionId)}`);
  if(epoch!==editorEpoch||identity!==getSessionIdentity())return;
  if(generation!==editGeneration||revision!==snapshot.courseVersion.revision){draftMessage.textContent='The draft changed while comparing. Compare again to see current edits.';return;}
  renderDraftConflict(draftComparison,original,local,latest.courseVersion.content,revision,latest.courseVersion.revision);
 }catch(error){if(epoch===editorEpoch&&identity===getSessionIdentity())draftMessage.textContent=error instanceof Error?`${error.message} Your edits remain here.`:'Comparison failed. Your edits remain here.';}
 finally{compareDraft.disabled=false;}
};
document.querySelector("#discard-draft")!.addEventListener("click", async () => {
  if (saveInFlight) { draftMessage.textContent = "Wait for the pending save before reloading."; return; }
  if (draftDirty && !window.confirm("Discard your unsaved edits and load the saved course?")) return;
  try { await loadReview(true); } catch { draftMessage.textContent = "Reload failed. Your edits remain here."; }
});
window.addEventListener("online", () => { if (draftDirty && !saveBlocked) scheduleSave(); });
window.addEventListener("beforeunload", event => { if (draftDirty) { event.preventDefault(); event.returnValue = ""; } });

function renderMessage(message: string, error = false) {
  statusElement.textContent = message;
  statusElement.className = error ? "error" : "";
}

async function sha256Base64Url(value: string): Promise<string> {
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function requireAuth(): string {
  if (!accessToken) throw new Error("Sign in first.");
  return accessToken;
}

async function startSignIn() { window.location.assign('/signin'); }

function render(value: JobStatus) {
  currentJobId = value.jobId;
  jobIdInput.value = value.jobId;
  details.classList.remove("hidden");
  document.querySelector("#state")!.textContent = value.state;
  document.querySelector("#next-action")!.textContent = value.nextAction;
  document.querySelector("#attempt")!.textContent = `${value.attempt} / ${value.maxAttempts}`;
  const failure = document.querySelector("#failure")!;
  failure.textContent = value.lastFailure ? `${value.lastFailure.code ?? "Failure"}: ${value.lastFailure.message ?? ""}` : "";
  const warnings = document.querySelector("#warnings")!;
  warnings.replaceChildren(...(value.outcome?.warnings ?? []).map((item) => {
    const element = document.createElement("div");
    element.className = "warning";
    element.textContent = `${item.code ?? "Warning"}: ${item.message ?? ""}`;
    return element;
  }));
  retryButton.classList.toggle("hidden", !value.canRetry);
  retryForm.classList.add("hidden");
  retryReasonInput.value = "";
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = requireAuth();
  const headers = new Headers(init.headers);
  for(const [key,value] of Object.entries(getOrganizationHeaders()))headers.set(key,value);
  headers.set("authorization", `Bearer ${token}`);
  const response = await authenticatedFetch(path, { ...init, headers });
  if (!response.ok) {
    const error=await response.json().catch(()=>({}));
    const code=error.error?.code;
    if(code==="ORGANIZATION_CONTEXT_REQUIRED")throw new ApiRequestError(409,"Choose an organization using the organization link before continuing.");
    if(code==="COURSE_REVIEW_REQUIRED")throw new ApiRequestError(409,"Approve both the course and its AI draft before publishing.");
    if(code==="ROLE_SEPARATION_REQUIRED")throw new ApiRequestError(409,"A different reviewer must approve this course before publishing.");
    throw new ApiRequestError(response.status, response.status === 409 ? "This course changed or is no longer editable. Reload the saved course before trying again." : response.status === 403 ? "Your account does not have permission for this action." : `The request failed (${response.status}). Please try again.`);
  }
  return await response.json() as T;
}

function newIdempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function renderReview(snapshot: ReviewSnapshot) {
  editorEpoch++;
  clearGenerationMedia();
  draftComparison.replaceChildren();
  clearTimeout(saveTimer);
  saveBlocked = false;
  loadedReview = snapshot;
  editingContent = structuredClone(snapshot.courseVersion.content);
  draftDirty = false;
  draftTitle.value = String(editingContent.title ?? "");
  draftFields.disabled = ["PUBLISHED", "RETIRED"].includes(snapshot.courseVersion.status);
  draftMessage.textContent = draftFields.disabled ? "Published and retired courses cannot be edited." : "Changes remain a draft until reviewed.";
  renderDraftModules();
  const citedSources = new Set<string>();
  function collectCitations(value: unknown) {
    if (Array.isArray(value)) { value.forEach(collectCitations); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.assetVersionId === "string") citedSources.add(record.assetVersionId);
    Object.values(record).forEach(collectCitations);
  }
  collectCitations(snapshot.courseVersion.content);
  document.querySelector("#draft-source-links")!.replaceChildren(...[...citedSources].map((id,index) => sourceReviewButton(id, `Review cited source ${index + 1}`)));
  if (recoveryKey && !draftFields.disabled) {
    try {
      const recovery = JSON.parse(sessionStorage.getItem(recoveryKey) ?? "null");
      if (recovery && Number.isSafeInteger(recovery.revision) && recovery.content?.schemaVersion === "course-draft.v1" && typeof recovery.content.title === "string" && JSON.stringify(recovery.content) !== JSON.stringify(editingContent)) {
        editingContent = recovery.content;
        draftDirty = true;
        editGeneration++;
        saveBlocked = recovery.revision !== snapshot.courseVersion.revision;
        draftTitle.value = String(editingContent.title);
        renderDraftModules();
        draftMessage.textContent = saveBlocked ? "Recovered unsaved edits, but the saved course has changed. Review the saved content below before discarding or copying your edits." : "Recovered unsaved edits from this tab. Saving shortly…";
        if (!saveBlocked) scheduleSave();
      }
    } catch { /* Invalid or unavailable recovery storage does not replace server content. */ }
  }
  reviewPanel.classList.remove("hidden");
  document.querySelector("#review-version")!.textContent = `${snapshot.courseVersion.courseVersionId} / rev ${snapshot.courseVersion.revision}`;
  document.querySelector("#review-state")!.textContent = snapshot.release?.status ?? snapshot.courseVersion.status;
  document.querySelector("#review-decisions-count")!.textContent = String(snapshot.decisions.length);
  document.querySelector("#review-content")!.textContent = JSON.stringify({ content: snapshot.courseVersion.content, decisions: snapshot.decisions }, null, 2);
  renderReviewTargets(snapshot);
  publishCourseButton.disabled = draftDirty || Boolean(snapshot.release);
  reviseCourseButton.hidden=!snapshot.release;
  releaseResult.classList.toggle("hidden", !snapshot.release);
  if (snapshot.release) releaseResult.textContent = JSON.stringify(snapshot.release, null, 2);
}

function renderReviewTargets(snapshot: ReviewSnapshot) {
  const source = snapshot.courseVersion.content._source;
  const aiRunId = source && typeof source === "object" && !Array.isArray(source)
    ? String((source as { aiRunId?: unknown }).aiRunId ?? snapshot.courseVersion.courseVersionId)
    : snapshot.courseVersion.courseVersionId;
  document.querySelector<HTMLSelectElement>("#decision-target")!.dataset.targetId = aiRunId;
  const targets = document.querySelector<HTMLSelectElement>("#decision-target")!;
  targets.replaceChildren();
  const addTarget = (type: string, id: unknown, label: string) => {
    if (typeof id !== "string" || !id) return;
    const option = document.createElement("option"); option.value = type; option.dataset.targetId = id; option.textContent = label; targets.append(option);
  };
  addTarget("COURSE", snapshot.courseVersion.courseVersionId, "Course version");
  if (source) addTarget("AI_DRAFT", aiRunId, "AI draft");
  for (const [key,type,label] of [["model","MODEL","Model"],["simulation","SIMULATION","Simulation"],["policy","POLICY","Certification policy"]]) {
    const binding = snapshot.courseVersion.content[key] as Record<string, unknown> | undefined;
    addTarget(type, binding?.[key === "model" ? "modelVersionId" : key === "simulation" ? "simulationDefinitionId" : "policyId"], label);
  }
  for (const module of contentRows(snapshot.courseVersion.content.modules)) for (const activity of contentRows(module.activities)) {
    const assessment = activity.assessment as Record<string, unknown> | undefined;
    addTarget("ASSESSMENT", assessment?.assessmentId, `Assessment: ${String(activity.title ?? "Untitled")}`);
  }
}

async function loadReview(discard = false) {
  const courseVersionId = courseVersionInput.value.trim();
  if (!courseVersionId) return;
  requireAuth();
  const identity = getSessionIdentity();
  const snapshot = await apiJson<ReviewSnapshot>(`/api/v1/course-versions/${encodeURIComponent(courseVersionId)}`);
  const scopeHash = await sha256Base64Url(identity);
  if (getSessionIdentity() !== identity) return;
  recoveryKey = `mdt.draft.${scopeHash}.${courseVersionId}`;
  if (discard) { try { sessionStorage.removeItem(recoveryKey); } catch { /* storage may be unavailable */ } }
  renderReview(snapshot);
}

async function load() {
  if (!currentJobId) return;
  render(await apiJson<JobStatus>(`/api/v1/jobs/${encodeURIComponent(currentJobId)}`));
}

function sourceTypeFor(file: File): string {
  if (/\.glb$/i.test(file.name)) return "glb";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  throw new Error("Choose a PDF, supported image, or supported video file.");
}

async function fileSha256(file: File): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function upload(file: File, organizationId: string, productId?: string) {
  const sha256 = await fileSha256(file);
  const sourceType = sourceTypeFor(file);
  const contentType = sourceType === "glb" ? "model/gltf-binary" : file.type;
  const session = await apiJson<UploadSession>(`/api/v1/organizations/${encodeURIComponent(organizationId)}/assets/upload-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: productId || undefined, sourceType, fileName: file.name, contentType, sizeBytes: file.size, sha256 })
  });
  const privateUpload = session.uploadUrl.startsWith('/api/v1/upload-sessions/');
  const uploadResponse = await (privateUpload ? authenticatedFetch : fetch)(session.uploadUrl, {
    method: 'PUT', headers: privateUpload ? { ...getOrganizationHeaders(), 'content-type': contentType } : { 'x-ms-blob-type': 'BlockBlob', 'content-type': contentType }, body: file
  });
  if (!uploadResponse.ok) {
    throw new Error(`File upload failed (${uploadResponse.status}). Try uploading the file again.`);
  }
  return await apiJson<UploadCompletion>(`/api/v1/upload-sessions/${encodeURIComponent(session.uploadSessionId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blobKey: session.blobKey, contentType, sizeBytes: file.size, sha256 })
  });
}

signInButton.addEventListener("click", () => void startSignIn().catch((error) => renderMessage(error instanceof Error ? error.message : "Sign-in failed.", true)));
signOutButton.addEventListener("click", () => {
  readerRequest++;
  readingSourceId = undefined;
  passageCursor = undefined;
  sourceReader.classList.add("hidden");
  sourcePassages.replaceChildren();
  sourceReaderTitle.textContent = "Source passages";
  sourceReaderStatus.textContent = "";
  document.querySelector("#draft-source-links")!.replaceChildren();
  sourceOptions.replaceChildren();
  sourceCursor = undefined;
  clearGenerationMedia();
  generationStatus.textContent = "";
  document.querySelector<HTMLTextAreaElement>("#generation-instructions")!.value = "";
  moreSources.classList.add("hidden");
  courseLibrary.replaceChildren();
  libraryStatus.textContent = "";
  nextCourseCursor = undefined;
  creationAttempt = undefined;
  revisionAttempt=undefined;
  document.querySelector<HTMLTextAreaElement>('#revision-reason')!.value='';
  reviseCourseButton.hidden=true;
  moreCourses.classList.add("hidden");
  editorEpoch++;
  draftComparison.replaceChildren();
  clearTimeout(saveTimer);
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("mdt.draft.")) sessionStorage.removeItem(key);
  } catch { /* storage may be unavailable */ }
  loadedReview = undefined;
  editingContent = {};
  recoveryKey = undefined;
  draftDirty = false;
  draftTitle.value = "";
  draftModules.replaceChildren();
  document.querySelector("#review-content")!.textContent = "";
  draftMessage.textContent = "";
  releaseResult.textContent = "";
  draftFields.disabled = true;
  reviewPanel.classList.add("hidden");
  clearAccessToken();
  accessToken = undefined;
  currentJobId = undefined;
  details.classList.add("hidden");
  uploadSection.classList.add("hidden");
  photoUploadStatus.textContent = "";
  photoUploadResults.replaceChildren();
  document.querySelector<HTMLInputElement>("#photo-files")!.value = "";
  jobSection.classList.add("hidden");
  reviewSection.classList.add("hidden");
  signInButton.classList.remove("hidden");
  signOutButton.classList.add("hidden");
  identityElement.textContent = "Not signed in.";
  renderMessage("Signed out.");
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector<HTMLInputElement>("#source-file")!.files?.[0];
  const organizationId = document.querySelector<HTMLInputElement>("#organization-id")!.value.trim();
  const productId = document.querySelector<HTMLInputElement>("#product-id")!.value.trim();
  if (!file || !organizationId) return;
  uploadButton.disabled = true;
  try {
    renderMessage("Hashing, uploading, and registering the source…");
    const result = await upload(file, organizationId, productId);
    if (!result.processingJob?.jobId) throw new Error("The upload completed without a processing job.");
    currentJobId = result.processingJob.jobId;
    await load();
    renderMessage("Upload completed and processing started.");
  } catch (error) {
    renderMessage(error instanceof Error ? error.message : "Upload failed.", true);
  } finally {
    uploadButton.disabled = false;
  }
});

photoUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>("#photo-files")!;
  const files = [...(input.files ?? [])];
  const organizationId = document.querySelector<HTMLInputElement>("#organization-id")!.value.trim();
  const productId = document.querySelector<HTMLInputElement>("#product-id")!.value.trim();
  if (!organizationId) { photoUploadStatus.textContent = "Enter an organization ID first."; return; }
  if (files.length < 20 || files.length > 100) {
    photoUploadStatus.textContent = "Choose 20–100 photos for a multi-view reconstruction.";
    return;
  }
  photoUploadButton.disabled = true;
  photoUploadResults.replaceChildren();
  currentJobId = undefined;
  jobIdInput.value = "";
  const results = document.createDocumentFragment();
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      photoUploadStatus.textContent = `Uploading photo ${index + 1} of ${files.length}…`;
      const result = await upload(file, organizationId, productId);
      if (!result.processingJob?.jobId) throw new Error(`Photo ${file.name} completed without a processing job. Retry this collection.`);
      const row = document.createElement("div");
      row.className = "photo-upload-result";
      row.textContent = `${file.name} — processing job ${result.processingJob.jobId}`;
      results.append(row);
      if (result.processingJob?.jobId) currentJobId = result.processingJob.jobId;
      photoUploadResults.replaceChildren(results.cloneNode(true));
    }
    if (currentJobId) {
      jobIdInput.value = currentJobId;
      await load();
    }
    photoUploadStatus.textContent = "Photo collection uploaded. Each photo is now processing privately. After source review and rights confirmation, select the approved photos below to start reconstruction.";
  } catch (error) {
    photoUploadStatus.textContent = error instanceof Error ? error.message : "Photo collection upload failed. Retry the collection.";
  } finally {
    photoUploadButton.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentJobId = jobIdInput.value.trim();
  try { await load(); renderMessage("Status loaded. This page refreshes every 3 seconds while the job is active."); }
  catch (error) { renderMessage(error instanceof Error ? error.message : "Status request failed.", true); }
});

reviewLoadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (draftDirty) { renderMessage("Save your edits or use Discard edits before loading another course.", true); return; }
  try { await loadReview(); renderMessage("Review loaded."); }
  catch (error) { renderMessage(error instanceof Error ? error.message : "Review load failed.", true); }
});

decisionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (draftDirty || !loadedReview) { renderMessage("Load and save the course before reviewing.", true); return; }
  const courseVersionId = loadedReview.courseVersion.courseVersionId;
  const targetSelect = document.querySelector<HTMLSelectElement>("#decision-target")!;
  const targetId = targetSelect.selectedOptions[0]?.dataset.targetId || courseVersionId;
  const revisionText = document.querySelector("#review-version")!.textContent ?? "";
  const revision = Number(revisionText.match(/rev (\d+)/)?.[1] ?? 1);
  try {
    await apiJson(`/api/v1/course-versions/${encodeURIComponent(courseVersionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": newIdempotencyKey("review") },
      body: JSON.stringify({ targetType: targetSelect.value, targetId, decision: document.querySelector<HTMLSelectElement>("#decision")!.value, rationale: document.querySelector<HTMLInputElement>("#decision-rationale")!.value.trim(), revision })
    });
    await loadReview();
    renderMessage("Review decision saved.");
  } catch (error) { renderMessage(error instanceof Error ? error.message : "Review decision failed.", true); }
});

reviseCourseButton.addEventListener('click',async()=>{
  if(!loadedReview?.release||draftDirty)return;
  const source=loadedReview.courseVersion.courseVersionId,token=accessToken,epoch=editorEpoch;
  const reason=document.querySelector<HTMLTextAreaElement>('#revision-reason')!.value.trim();if(!reason){renderMessage('Describe why this course needs a new version.',true);return;}
  if(!revisionAttempt||revisionAttempt.source!==source||revisionAttempt.reason!==reason)revisionAttempt={source,reason,key:newIdempotencyKey('revise')};
  reviseCourseButton.disabled=true;
  try{
    const result=await apiJson<{courseVersionId:string}>(`/api/v1/course-versions/${encodeURIComponent(source)}/revise`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':revisionAttempt.key},body:JSON.stringify({reason})});
    if(accessToken!==token||editorEpoch!==epoch)return;
    courseVersionInput.value=result.courseVersionId;await loadReview();revisionAttempt=undefined;document.querySelector<HTMLTextAreaElement>('#revision-reason')!.value='';
    renderMessage('New version opened as a draft. Fresh review and publication are required; existing enrollments and credentials retain their original release.');
  }catch(error){if(accessToken===token)renderMessage(error instanceof Error?error.message:'New version failed. Retry with the same reason.',true);}finally{reviseCourseButton.disabled=false;}
});

publishCourseButton.addEventListener("click", async () => {
  if (draftDirty || !loadedReview) { renderMessage("Load and save the course before publishing.", true); return; }
  const courseVersionId = loadedReview.courseVersion.courseVersionId;
  try {
    const release = await apiJson<ReviewSnapshot["release"]>(`/api/v1/course-versions/${encodeURIComponent(courseVersionId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": newIdempotencyKey("publish") },
      body: "{}"
    });
    releaseResult.classList.remove("hidden");
    releaseResult.textContent = JSON.stringify(release, null, 2);
    publishCourseButton.disabled = true;
    await loadReview();
    renderMessage("Immutable release published.");
  } catch (error) { renderMessage(error instanceof Error ? error.message : "Publish failed.", true); }
});

retryButton.addEventListener("click", async () => {
  if (!currentJobId) return;
  retryForm.classList.remove("hidden");
  retryReasonInput.focus();
});

retryCancelButton.addEventListener("click", () => {
  retryForm.classList.add("hidden");
  retryReasonInput.value = "";
});

retryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentJobId) return;
  const reason = retryReasonInput.value.trim();
  if (!reason) return;
  try {
    render(await apiJson<JobStatus>(`/api/v1/jobs/${encodeURIComponent(currentJobId)}/retry`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason })
    }));
    renderMessage("Retry requested.");
  } catch (error) { renderMessage(error instanceof Error ? error.message : "Retry failed.", true); }
});


window.setInterval(() => { if (accessToken && currentJobId) void load().catch((error) => renderMessage(error instanceof Error ? error.message : "Status refresh failed.", true)); }, 3000);

createMediaReview(document.querySelector<HTMLElement>('#upload-section')!,apiJson);
createModelImportReview(document.querySelector<HTMLElement>('#upload-section')!,apiJson);
const prepareCandidateButton=document.createElement('button');prepareCandidateButton.type='button';prepareCandidateButton.textContent='Prepare reconstruction candidate';uploadSection.append(prepareCandidateButton);
let disposeCandidateWorkbench:(()=>void)|undefined;
async function openCandidateWorkbench(initial?:ReconstructionFiles){
 const session=getSessionIdentity();prepareCandidateButton.disabled=true;
 try{const module=await import('./candidate-workbench.js');if(session!==getSessionIdentity())return;
  disposeCandidateWorkbench?.();const host=document.createElement('div');uploadSection.append(host);
  const dispose=module.createCandidateWorkbench(host,file=>{if(session!==getSessionIdentity())return;const transfer=new DataTransfer();transfer.items.add(file);document.querySelector<HTMLInputElement>('#source-file')!.files=transfer.files;renderMessage('Prepared reconstruction selected. Use Upload to send it for processing and review.');},initial);
  disposeCandidateWorkbench=()=>{dispose();host.remove();};
 }catch{renderMessage('Candidate preparation could not be loaded. Retry.',true);}finally{prepareCandidateButton.disabled=false;}
};
prepareCandidateButton.onclick=()=>void openCandidateWorkbench();
createReconstructionPanel(uploadSection,apiJson,openCandidateWorkbench);
