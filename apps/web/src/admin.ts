import {authenticatedFetch, clearAccessToken, getAccessToken, getOrganizationHeaders, getSessionIdentity, setOrganizationId} from './auth-session.js';
import {beginSignIn, completeSignIn, renewAccessToken} from './managed-auth.js';
import {createMediaReview} from './media-review.js';
import {renderAdminLessons} from './admin-lessons.js';
import {createServiceWorkspace} from './service-workspace.js';
import {validateLessonBrief} from '@medical-device/simulation-schema';

const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => q<HTMLInputElement>(id).value.trim();
const say = (id: string, text: string) => { q(id).textContent = text; };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string) => { const node = document.createElement(tag); node.textContent = text; return node; };
let controller = new AbortController();
let viewer: {dispose(): void; reset(): void; rotate(delta: number): void; zoom(factor: number): void} | undefined;
let modelEpoch = 0;
let busy = 0;
const objectUrls = new Map<string, string>();
const intents = new Map<string, string>();
let creation: {title: string; courseVersionId: string} | undefined;
let approvedSources: Array<{assetVersionId: string; sourceHash: string; fileName: string; sourceType: string}> = [];
let sceneAttempt: {signature: string; manifest: any} | undefined;
let learningMedia: Array<{assetVersionId:string;fileName:string;type:string}> = [];
let serviceWorkspace: ReturnType<typeof createServiceWorkspace> | undefined;
const key = (intent: string) => { if (!intents.has(intent)) intents.set(intent, crypto.randomUUID()); return intents.get(intent)!; };
function blobUrl(slot: string, blob: Blob) {
  const old = objectUrls.get(slot); if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(blob); objectUrls.set(slot, url); return url;
}
function clearPrivateState() {
  controller.abort(); controller = new AbortController(); modelEpoch++; viewer?.dispose(); viewer = undefined;
  q('model-canvas').hidden = true;
  q('media-review').hidden = true;
  for (const url of objectUrls.values()) URL.revokeObjectURL(url); objectUrls.clear(); intents.clear(); creation = undefined;
  for (const id of ['learning-result', 'courses', 'builds', 'reports-result', 'approved-photos']) q(id).replaceChildren();
  approvedSources = []; sceneAttempt = undefined;
  learningMedia = []; q<HTMLSelectElement>('learning-media').replaceChildren(new Option('Load approved company media first',''));
  serviceWorkspace?.dispose(); serviceWorkspace = mountServices();
  for (const id of ['scene-model', 'scene-video']) q<HTMLSelectElement>(id).replaceChildren(new Option('Load company assets first', ''));
  q<HTMLSelectElement>('rights-target').replaceChildren(new Option('Load company content first','')); q<HTMLInputElement>('rights-confirm').checked=false; say('rights-status','');
  q<HTMLSelectElement>('saved-source').replaceChildren(new Option('Refresh sources', ''));
  q<HTMLVideoElement>('background-video').pause(); q<HTMLVideoElement>('background-video').removeAttribute('src'); q('background-video').hidden = true;
  q<HTMLAudioElement>('narration-player').pause(); q<HTMLAudioElement>('narration-player').removeAttribute('src'); q('narration-player').hidden = true;
  q<HTMLInputElement>('photos').value = ''; q<HTMLInputElement>('documents').value = ''; q<HTMLInputElement>('background-image').value = '';
  q<HTMLSelectElement>('background').value = 'clinical'; applyBackground();
  for(const id of ['title','instructions','audience','learning-objective','teaching-setting','source-revision','learning-terminology','prompt','narration']){const input=q<HTMLInputElement|HTMLTextAreaElement>(id);input.value=input.defaultValue;}
  for(const id of ['experience','teaching-format','lesson-length','visual-style','scene-style','scene-voice'])q<HTMLSelectElement>(id).selectedIndex=0;
  q<HTMLInputElement>('video-plan').checked=false;q<HTMLInputElement>('scene-speech').checked=true;
  say('model-label', 'No model loaded'); say('viewer-message', 'Load the example or generate your own model.');
  for (const id of ['learning-status', 'model-status', 'background-status', 'reports-status']) say(id, 'Company context changed. Refresh to load current results.');
}
async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const identity = getSessionIdentity(), signal = controller.signal;
  if (!path.startsWith('/api/v1/')) throw Error('Unsupported service address.');
  if (!getAccessToken()) throw Error('Sign in with Microsoft to use this service.');
  if (sessionStorage.getItem('mdt.auth.managed-account')) await renewAccessToken();
  if (identity !== getSessionIdentity()) throw Error('Your company or account changed. Retry in the current workspace.');
  const headers = new Headers(init.headers); for (const [name, val] of Object.entries(getOrganizationHeaders())) headers.set(name, val);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const response = await authenticatedFetch(path, {...init, headers, signal});
  if (identity !== getSessionIdentity() || signal.aborted) throw Error('Your company or account changed. Retry in the current workspace.');
  if (!response.ok) { const data = await response.json().catch(() => null); throw Error(`${data?.error?.message ?? 'The service could not complete this request.'} (${data?.error?.code ?? response.status})${response.status === 401 ? ' Sign in again.' : response.status === 403 ? ' Check company role and email verification in Account.' : response.status === 503 ? ' This service is not available in the current deployment.' : ''}`); }
  return response;
}
async function api<T = any>(path:string,init:RequestInit={}):Promise<T>{
  const identity=getSessionIdentity(),signal=controller.signal,response=await apiResponse(path,init),data=await response.json().catch(()=>null);
  if(identity!==getSessionIdentity()||signal.aborted)throw Error('Your company or account changed. Retry in the current workspace.');
  return data as T;
}
function mountServices(){return createServiceWorkspace(q('service-workspace'),{api,response:apiResponse,signal:controller.signal,organizationId:()=>getOrganizationHeaders()['x-organization-id']??''});}
const post = <T = any>(path: string, body: unknown, intent?: string) => api<T>(path, {method: 'POST', headers: intent ? {'idempotency-key': key(intent)} : {}, body: JSON.stringify(body)});
function run(button: HTMLButtonElement, status: string, action: () => Promise<void>) {
  if (button.disabled) return;
  const identity = getSessionIdentity(), signal = controller.signal; button.disabled = true;
  busy++; q<HTMLSelectElement>('organization').disabled = true;
  void action().catch(error => { if (!signal.aborted && identity === getSessionIdentity()) say(status, error instanceof Error ? error.message : 'Request failed. Refresh to retry.'); }).finally(() => { busy--; if (!signal.aborted && identity === getSessionIdentity()) button.disabled = false; if (!busy && getAccessToken()) q<HTMLSelectElement>('organization').disabled = false; });
}
async function waitFor<T extends {state: string}>(load: () => Promise<T>, status: string, label: string): Promise<T> {
  const signal = controller.signal;
  for (let attempt = 0; attempt < 100; attempt++) {
    signal.throwIfAborted(); const job = await load(); say(status, `${label}: ${job.state.toLowerCase().replaceAll('_', ' ')}. You can reopen saved results if you leave this page.`);
    if (job.state === 'SUCCEEDED') return job;
    if (['FAILED', 'DEAD_LETTERED', 'CANCELLED', 'QUARANTINED'].includes(job.state)) throw Error(`${label}: ${job.state}. Inspect the saved job in the full editor for failure details.`);
    await new Promise<void>((resolve, reject) => { const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, Math.min(1500 + attempt * 400, 6000)); signal.addEventListener('abort', aborted, {once: true}); });
  }
  throw Error(`${label} is still processing. Use saved courses or saved builds to check again; do not resubmit the same input.`);
}
async function upload(file: File, status: string) {
  if (file.size < 1 || file.size > 50 * 1024 * 1024) throw Error('Choose nonempty files up to 50 MB each.');
  const sourceType = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : '';
  if (!sourceType) throw Error('Unsupported file type. Choose a PDF, PNG, JPEG, WebP or supported video.');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const organizationId = getOrganizationHeaders()['x-organization-id']; if (!organizationId) throw Error('Choose a company first.');
  say(status, `Uploading ${file.name} to private storage…`);
  const contentType = file.type || 'application/pdf';
  const session = await post(`/api/v1/organizations/${encodeURIComponent(organizationId)}/assets/upload-sessions`, {sourceType, fileName: file.name, contentType, sizeBytes: file.size, sha256});
  const url = new URL(session.uploadUrl, location.origin), privateUpload = url.origin === location.origin && url.pathname.startsWith('/api/v1/upload-sessions/');
  if (!privateUpload && (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.core.windows.net'))) throw Error('The server returned an unsupported upload destination.');
  const response = await (privateUpload ? authenticatedFetch : fetch)(url.href, {method: 'PUT', headers: privateUpload ? {...getOrganizationHeaders(), 'content-type': contentType} : {'x-ms-blob-type': 'BlockBlob', 'content-type': contentType}, body: file, credentials: 'omit', redirect: 'error', signal: controller.signal});
  if (!response.ok) throw Error(`Upload failed (${response.status}). Refresh before retrying.`);
  const done = await post(`/api/v1/upload-sessions/${encodeURIComponent(session.uploadSessionId)}/complete`, {blobKey: session.blobKey, contentType, sizeBytes: file.size, sha256});
  if (!done.processingJob?.jobId) throw Error('Upload saved, but processing has not started. Check the full editor.');
  await waitFor(() => api(`/api/v1/jobs/${encodeURIComponent(done.processingJob.jobId)}`), status, `Checking ${file.name}`);
  return {sha256, fileName: file.name};
}
async function pages(path: string) {
  const items: any[] = []; let after: string | undefined;
  for (let index = 0; index < 50; index++) { const page = await api(path + (after ? '?after=' + encodeURIComponent(after) : '')); items.push(...page.items); if (!page.nextCursor) return items; after = page.nextCursor; }
  throw Error('This company has many sources. Select a saved source or use the full editor.');
}
async function sources() {
  const items = await pages('/api/v1/knowledge-sources');
  q<HTMLSelectElement>('saved-source').replaceChildren(...(items.length ? items.map(item => new Option(`${item.fileName} · ${item.state}`, item.assetVersionId)) : [new Option('No processed sources yet', '')]));
  say('learning-status', items.length ? 'Saved sources loaded. The first source is selected by default.' : 'Upload a PDF to create your first source.');
}
async function approvedLearningMedia(){
  learningMedia=await pages('/api/v1/approved-media');
  const options=learningMedia.map((media,index)=>new Option(`${media.fileName} · ${media.type}`,media.assetVersionId,false,index===0));
  q<HTMLSelectElement>('learning-media').replaceChildren(...(options.length?options:[new Option('No approved reference media yet','')]));
  say('learning-status',options.length?'Approved reference media loaded. The first view is selected by default; choose the source views for your lesson.':'No approved views yet. Create a document-only course, or upload and review images/video before adding a video lesson.');
}
q('refresh-learning-media').onclick=()=>run(q('refresh-learning-media'),'learning-status',approvedLearningMedia);
function renderCourse(snapshot: any) {
  const course = snapshot.courseVersion, content = course?.content ?? {}, host = q('learning-result'); host.replaceChildren();
  host.append(element('h3', content.title ?? 'Generated course'), element('p', `State: ${course?.status ?? 'Draft'} · revision ${course?.revision ?? 'unknown'}`));
  for (const module of content.modules ?? []) {
    const article = document.createElement('article'); article.append(element('h3', module.title ?? 'Module'));
    for (const activity of module.activities ?? []) {
      const box = document.createElement('div'); box.append(element('h4', activity.title ?? activity.type ?? 'Activity'));
      for (const field of ['text', 'instructions', 'description']) if (typeof activity[field] === 'string' && activity[field]) box.append(element('p', activity[field]));
      for (const question of activity.assessment?.questions ?? []) {
        box.append(element('p', question.prompt ?? 'Knowledge check')); const list = document.createElement('ul');
        for (const option of question.options ?? []) list.append(element('li', option.text ?? '')); box.append(list);
        if (question.rationale) { const details = document.createElement('details'); details.append(element('summary', 'Answer explanation'), element('p', question.rationale)); box.append(details); }
      }
      article.append(box);
    }
    host.append(article);
  }
  const details = document.createElement('details'); details.append(element('summary', 'Full generated result, citations & video plan'), element('pre', JSON.stringify(content, null, 2))); host.append(details);
  if (course?.courseVersionId) renderAdminLessons(host, course, {api, run, wait: waitFor, signal: controller.signal, content: async path => {
    const identity = getSessionIdentity(), signal = controller.signal;
    const response = await authenticatedFetch(path, {headers: getOrganizationHeaders(), signal});
    if (!response.ok) throw Error(`Lesson playback could not be loaded (${response.status}). Reopen the saved result.`);
    const blob = await response.blob(); signal.throwIfAborted();
    if (identity !== getSessionIdentity()) throw Error('Company changed. Reopen the current result.');
    return blob;
  }});
}
async function courses() {
  const page = await api('/api/v1/courses'); q('courses').replaceChildren();
  for (const course of page.items) { const button = element('button', `${course.title} · ${course.status}`); button.type = 'button'; button.className = 'secondary'; button.onclick = () => run(button, 'learning-status', async () => renderCourse(await api(`/api/v1/course-versions/${encodeURIComponent(course.courseVersionId)}`))); q('courses').append(button); }
  if (!page.items.length) q('courses').append(element('p', 'No saved courses yet.'));
  if (page.nextCursor) q('courses').append(element('p', 'More courses are available in the full editor.'));
}
q<HTMLFormElement>('learning-form').onsubmit = event => { event.preventDefault(); run(q<HTMLButtonElement>('learning-form').querySelector('button[type=submit]')!, 'learning-status', async () => {
  const includeVideo=q<HTMLInputElement>('video-plan').checked;
  if(includeVideo && !learningMedia.length)await approvedLearningMedia();
  const mediaIds=[...q<HTMLSelectElement>('learning-media').selectedOptions].map(option=>option.value).filter(Boolean);
  if(mediaIds.length>32)throw Error('Select at most 32 approved reference views.');
  if(includeVideo&&!mediaIds.length)throw Error('Choose an approved reference image/video for a narrated video, or turn off the video option to generate a document-only course.');
  if(includeVideo&&value('teaching-format')!=='orientation'&&!learningMedia.some(media=>mediaIds.includes(media.assetVersionId)&&media.type==='video'))throw Error('This teaching format needs an approved reference video. Select one, or use orientation for photo-based learning.');
  const instruction=`${value('instructions')}\nAudience: ${value('audience')}. Prior knowledge: ${value('experience')}. Format: ${value('teaching-format')}. Objective: ${value('learning-objective')}. Setting: ${value('teaching-setting')}. ${includeVideo?`Target video length: ${value('lesson-length')} seconds. `:''}Visual style: ${value('visual-style')}`;
  if(instruction.length>2000)throw Error('Shorten the learning instructions or customization values to keep the complete request within 2,000 characters.');
  const files = [...q<HTMLInputElement>('documents').files ?? []]; if (files.length > 32) throw Error('Choose at most 32 PDFs.');
  const uploaded = []; for (const file of files) uploaded.push(await upload(file, 'learning-status'));
  let ids = value('saved-source') ? [value('saved-source')] : [];
  if (uploaded.length) {
    const ready = await pages('/api/v1/knowledge-sources'); ids = [];
    for (const item of uploaded) {
      let matched: string | undefined;
      for (const source of ready.filter(source => source.fileName === item.fileName)) { const detail = await api(`/api/v1/knowledge-sources/${encodeURIComponent(source.assetVersionId)}`); if (detail.sourceHash === item.sha256) { matched = source.assetVersionId; break; } }
      if (!matched) throw Error('Source processing finished but the matching document is not available for generation yet. Refresh sources before continuing.'); ids.push(matched);
    }
  }
  if (!ids.length) throw Error('Choose a PDF or a saved source first.');
  const title = value('title'); if (!creation || creation.title !== title) { const created = await post('/api/v1/courses', {title}, 'course:' + title); creation = {title, courseVersionId: created.courseVersionId}; }
  const id = creation.courseVersionId; say('learning-status', 'Generating source-grounded lessons and knowledge checks…');
  if(includeVideo){
    const snapshot=await api(`/api/v1/course-versions/${encodeURIComponent(id)}`),brief={schemaVersion:'lesson-brief.v1',audience:value('audience'),priorKnowledge:value('experience'),task:value('title'),objective:value('learning-objective'),deviceRevision:value('source-revision'),setting:value('teaching-setting'),format:value('teaching-format'),referencePack:{sourceArtifactIds:[...new Set(ids)],approvedViewIds:mediaIds,exactLabels:[],permittedStates:[],permittedActions:[],terminology:value('learning-terminology').split('\n').map(term=>term.trim()).filter(Boolean),visualConventions:value('visual-style')}};
    const validation=validateLessonBrief(brief);if(!validation.valid)throw Error(validation.findings.map(finding=>finding.message).join(' '));
    await api(`/api/v1/course-versions/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({revision:snapshot.courseVersion.revision,content:{...snapshot.courseVersion.content,lessonBrief:brief}})});
  }
  const result = await post(`/api/v1/course-versions/${encodeURIComponent(id)}/generate-draft`, {sourceArtifactIds: [...new Set(ids)], mediaAssetVersionIds: mediaIds, videoLesson: includeVideo, userInstruction: instruction});
  renderCourse(await api(`/api/v1/course-versions/${encodeURIComponent(id)}`));
  say('learning-status', result.appliedToCourse ? 'Generated draft saved. Review the result and its source references before publishing.' : `Generation returned ${result.result?.status ?? 'no applied draft'}. The saved course is shown; inspect the full editor before retrying.`); await courses();
}); };

async function mountModel(url: string, sample = false) {
  const epoch = ++modelEpoch; viewer?.dispose(); viewer = undefined; say('viewer-message', 'Loading 3D model…');
  q('model-canvas').hidden = false;
  const {mountSceneViewer} = await import('./admin-viewer.js'); if (epoch !== modelEpoch) return;
  const loaded = await mountSceneViewer(q<HTMLCanvasElement>('model-canvas'), url); if (epoch !== modelEpoch) { loaded.dispose(); return; }
  viewer = loaded; say('model-label', sample ? 'Existing example · not generated' : 'Generated candidate · review required'); say('viewer-message', 'Model ready. Drag to rotate or use the controls below.');
}
async function showBuild(id: string) {
  const job = await api(`/api/v1/reconstructions/${encodeURIComponent(id)}`); say('model-status', `Build ${id}: ${job.state}${job.failureCode ? ' · ' + job.failureCode : ''}.`);
  if (job.candidateUrl) { const response = await authenticatedFetch(job.candidateUrl, {headers: getOrganizationHeaders(), signal: controller.signal}); if (!response.ok) throw Error('The private model is unavailable. Refresh the build.'); const blob = await response.blob(); if (blob.size > 64 * 1024 * 1024) throw Error('The model exceeds the preview size limit.'); await mountModel(blobUrl('model', blob)); }
}
async function builds() {
  const page = await api('/api/v1/reconstructions'); q('builds').replaceChildren();
  const mode = q<HTMLSelectElement>('mode'), selected = mode.value; mode.replaceChildren(...page.enabledModes.map((name: string) => new Option(({ 'single-image': 'One photo · inferred shape', 'multi-view': '20–100 overlapping photos', video: 'One video' } as Record<string, string>)[name] ?? name, name)));
  if (page.enabledModes.includes(selected)) mode.value = selected;
  q<HTMLFieldSetElement>('model-fields').disabled = !page.enabledModes.length;
  say('modes-note', page.enabledModes.length ? 'These reconstruction methods are enabled on the server. All outputs require review.' : 'Reconstruction is not enabled on this deployment. Example preview and custom backgrounds remain available.');
  for (const job of page.items) { const button = element('button', `${job.mode} · ${job.state} · ${job.jobId}`); button.type = 'button'; button.className = 'secondary'; button.onclick = () => run(button, 'model-status', () => showBuild(job.jobId)); q('builds').append(button); }
  if (page.nextCursor) q('builds').append(element('p', 'More builds are available in the full editor.'));
}
q<HTMLFormElement>('model-form').onsubmit = event => { event.preventDefault(); run(q<HTMLButtonElement>('model-form').querySelector('button[type=submit]')!, 'model-status', async () => {
  const files = [...q<HTMLInputElement>('photos').files ?? []], mode = value('mode');
  if (mode === 'multi-view' ? files.length < 20 || files.length > 100 : files.length !== 1) throw Error(mode === 'multi-view' ? 'Choose 20–100 overlapping photos of one device.' : 'Choose exactly one source file.');
  if (files.some(file => !file.type.startsWith(mode === 'video' ? 'video/' : 'image/'))) throw Error('The source files must match the selected reconstruction method.');
  const uploaded = []; for (const file of files) uploaded.push(await upload(file, 'model-status'));
  const ready = await pages('/api/v1/reconstructions/sources');
  if (uploaded.some(item => !ready.some(source => source.sourceHash === item.sha256))) {
    q<HTMLDetailsElement>('source-review').open = true;
    q<HTMLButtonElement>('media-review').querySelector<HTMLButtonElement>('[data-photo-review-load]')?.click();
    say('model-status', 'Uploads are processed. Open each private preview below and record source approval, then register content usage rights. Load approved sources and build without uploading again.'); return;
  }
  const sources = uploaded.map(item => { const found = ready.find(source => source.sourceHash === item.sha256)!; return {assetVersionId: found.assetVersionId, sourceHash: found.sourceHash}; });
  await buildSources(mode, sources);
}); };
async function buildSources(mode: string, sources: Array<{assetVersionId: string; sourceHash: string}>) {
  if (mode === 'multi-view' ? sources.length < 20 || sources.length > 100 : sources.length !== 1) throw Error(mode === 'multi-view' ? 'Select 20–100 approved photos.' : 'Select exactly one approved source.');
  const signature = JSON.stringify({mode, sources}), job = await post('/api/v1/reconstructions', {mode, sources}, 'build:' + signature);
  await builds(); await waitFor(() => api(`/api/v1/reconstructions/${encodeURIComponent(job.jobId)}`), 'model-status', '3D reconstruction'); await showBuild(job.jobId);
}
q('refresh-photos').onclick = () => run(q('refresh-photos'), 'model-status', async () => {
  approvedSources = await pages('/api/v1/reconstructions/sources'); q('approved-photos').replaceChildren();
  const mode = value('mode'), matching = approvedSources.filter(source => source.sourceType === (mode === 'video' ? 'video' : 'image'));
  matching.forEach((source, index) => { const label = document.createElement('label'), checkbox = document.createElement('input'); label.className = 'check'; checkbox.type = 'checkbox'; checkbox.value = source.assetVersionId; checkbox.checked = mode === 'multi-view' ? index < 100 : index === 0; label.append(checkbox, document.createTextNode(source.fileName)); q('approved-photos').append(label); });
  say('model-status', matching.length ? 'Approved sources loaded. Review the selected sources, then build.' : 'No approved, rights-cleared sources are available. Record source review and usage permission below, then refresh.');
});
q('refresh-rights').onclick = () => run(q('refresh-rights'), 'rights-status', async () => {
  const [assets, models] = await Promise.all([pages('/api/v1/media-review'),pages('/api/v1/model-imports')]);
  const options = [...assets.map(asset=>new Option(asset.fileName+' · source','asset|'+asset.assetVersionId)),...models.map(model=>new Option((model.fileName??model.modelVersionId)+' · model','model|'+model.modelVersionId))];
  q<HTMLSelectElement>('rights-target').replaceChildren(...(options.length?options:[new Option('No processed content yet','')]));
  q<HTMLInputElement>('rights-owner').value=q<HTMLSelectElement>('organization').selectedOptions[0]?.textContent??'My company';
  say('rights-status',options.length?'Content loaded. Check the owner, permitted use and confirmation before recording rights.':'Upload content and wait for processing first.');
});
q('register-rights').onclick = () => run(q('register-rights'), 'rights-status', async () => {
  if(!q<HTMLInputElement>('rights-confirm').checked)throw Error('Confirm that you have permission to use this content and create derivatives.');
  const [targetKind,id]=value('rights-target').split('|');if(!id||!value('rights-owner')||!value('rights-scope'))throw Error('Choose content and supply the owner and permitted use.');
  const detail=await api(`/api/v1/${targetKind==='model'?'model-imports':'media-review'}/${encodeURIComponent(id)}`);
  const body={targetKind,sourceHash:targetKind==='model'?detail.manifest.sourceHash:detail.sourceHash,ownerName:value('rights-owner'),useScope:value('rights-scope'),confirmed:true};
  await post(`/api/v1/media-review/${encodeURIComponent(id)}/rights`,body,'rights:'+id+JSON.stringify(body));
  say('rights-status','Usage permission recorded with your account. Source approval and model review remain separate.');
});
q('refresh-review').onclick = () => q('media-review').querySelector<HTMLButtonElement>('[data-photo-review-load]')?.click();
q('build-saved').onclick = () => run(q('build-saved'), 'model-status', async () => { const ids = [...q('approved-photos').querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value); await buildSources(value('mode'), approvedSources.filter(source => ids.includes(source.assetVersionId)).map(({assetVersionId, sourceHash}) => ({assetVersionId, sourceHash}))); });
q('mode').onchange = () => { q('approved-photos').replaceChildren(); if (getAccessToken()) q<HTMLButtonElement>('refresh-photos').click(); };
q('refresh-scene-assets').onclick = () => run(q('refresh-scene-assets'), 'background-status', sceneAssets);
async function sceneAssets() {
  const [models, media] = await Promise.all([pages('/api/v1/model-imports'), pages('/api/v1/approved-media')]);
  const approved = models.filter(model => model.status === 'APPROVED'), videos = media.filter(asset => asset.type === 'video');
  q<HTMLSelectElement>('scene-model').replaceChildren(...(approved.length ? approved.map(model => new Option(model.fileName ?? model.modelVersionId, model.modelVersionId)) : [new Option('No approved models yet', '')]));
  q<HTMLSelectElement>('scene-video').replaceChildren(...(videos.length ? videos.map(video => new Option(video.fileName, video.assetVersionId)) : [new Option('No approved reference videos yet', '')]));
  say('background-status', approved.length && videos.length ? 'Scene assets selected. Generation also validates their registered usage rights.' : 'Approve a company model and reference video in the full editor before generating a background. Custom background uploads work immediately.');
}
function applyBackground() {
  const setting = value('background'); q('background-video').hidden = true; q<HTMLVideoElement>('background-video').pause();
  q('background-preview').hidden = setting !== 'clinical' && setting !== 'custom';
  if (setting === 'clinical') q<HTMLImageElement>('background-preview').src = '/demo-assets/nxstage-clinical-photo-v4.png';
  if (setting === 'custom' && objectUrls.has('background')) q<HTMLImageElement>('background-preview').src = objectUrls.get('background')!;
  q('stage').style.backgroundColor = setting === 'dark' ? '#202a30' : '#eef0f1';
}
q('background').onchange = applyBackground;
q('scene-style').onchange=()=>{const prompts:Record<string,string>={clinical:'A calm photorealistic clinical exam room with soft daylight, neutral materials, and a clear floor area in the center for a medical device. Locked camera, no people, no equipment in the foreground.',classroom:'An empty bright teaching classroom with neutral walls, soft daylight and a clear demonstration area. Locked camera, no people, no foreground equipment and no signs.',studio:'An empty neutral product studio with a light gray wall and floor, soft balanced lighting and clear space for a device. Locked camera, no people, no equipment and no signs.'};q<HTMLTextAreaElement>('prompt').value=prompts[value('scene-style')]!;};
q<HTMLInputElement>('background-image').onchange = () => { const file = q<HTMLInputElement>('background-image').files?.[0]; if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) { say('model-status', 'Choose a PNG, JPEG or WebP background up to 25 MB.'); return; } q<HTMLImageElement>('background-preview').src = blobUrl('background', file); q<HTMLSelectElement>('background').value = 'custom'; applyBackground(); };
q('generate-background').onclick = () => run(q('generate-background'), 'background-status', async () => {
  const response = await fetch('/model/nxstage-training-scene-manifest.json', {signal: controller.signal}); if (!response.ok) throw Error('Scene defaults are unavailable.'); const sceneManifest = await response.json();
  if (!value('scene-model') || !value('scene-video')) await sceneAssets();
  if (!value('scene-model') || !value('scene-video')) throw Error('Choose an approved company model and reference video first. You can use a custom background image immediately.');
  const [model, video] = await Promise.all([api(`/api/v1/model-imports/${encodeURIComponent(value('scene-model'))}`), api(`/api/v1/media-review/${encodeURIComponent(value('scene-video'))}`)]);
  sceneManifest.sceneId = 'scene:admin:' + crypto.randomUUID();
  sceneManifest.model.modelVersionId = model.modelVersionId; sceneManifest.model.sourceHash = model.manifest.sourceHash;
  sceneManifest.video = {...sceneManifest.video, assetVersionId: video.assetVersionId, sourceHash: video.sourceHash, contentType: video.contentType, width: video.width, height: video.height, durationSeconds: video.durationSeconds};
  const narrationText=q<HTMLInputElement>('scene-speech').checked?value('narration'):'';
  const signature = JSON.stringify([model.modelVersionId, model.manifest.sourceHash, video.assetVersionId, video.sourceHash, value('prompt'), narrationText, value('scene-voice')]);
  if (sceneAttempt?.signature !== signature) sceneAttempt = {signature, manifest: sceneManifest};
  say('background-status', 'Requesting a generated background and narration…');
  const job = await post('/api/v1/openmontage/generations', {sceneManifest: sceneAttempt.manifest, prompt: value('prompt'), mode: 'LOCKED_INTERACTIVE', ...(narrationText?{narrationText,narrationVoice:value('scene-voice')}:{})}, 'background:' + sceneAttempt.manifest.sceneId);
  const result: any = await waitFor(() => api(`/api/v1/openmontage/generations/${encodeURIComponent(job.generationId)}`), 'background-status', 'Background generation');
  const prefix = `/api/v1/openmontage/generations/${encodeURIComponent(job.generationId)}`;
  const previewResponse = await authenticatedFetch(prefix + '/preview', {headers: getOrganizationHeaders(), signal: controller.signal}); if (!previewResponse.ok) throw Error('The generated background preview is unavailable.');
  q<HTMLVideoElement>('background-video').src = blobUrl('background-video', await previewResponse.blob()); q('background-video').hidden = false; q('background-preview').hidden = true;
  q<HTMLAudioElement>('narration-player').pause(); q('narration-player').hidden = true; q('narration-player').removeAttribute('src');
  if (result.narration) { const audio = await authenticatedFetch(prefix + '/narration', {headers: getOrganizationHeaders(), signal: controller.signal}); if (!audio.ok) throw Error('Background is ready, but narration could not be loaded. Reopen the saved generation in the full editor.'); q<HTMLAudioElement>('narration-player').src = blobUrl('narration', await audio.blob()); q('narration-player').hidden = false; }
  say('background-status', 'Generated background is ready. Press play to preview it behind your model. Review the scene and narration before publishing.');
});
q('sample').onclick = () => run(q('sample'), 'model-status', async () => { await mountModel('/model/nxstage-system-one.glb', true); say('model-status', 'Showing the existing NxStage example. Upload your own photos to generate a new candidate.'); });
q('reset-view').onclick = () => viewer?.reset(); q('rotate-left').onclick = () => viewer?.rotate(-.2); q('rotate-right').onclick = () => viewer?.rotate(.2); q('zoom-in').onclick = () => viewer?.zoom(.85); q('zoom-out').onclick = () => viewer?.zoom(1.15);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.onclick = () => { for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) { const active = tab === button; tab.setAttribute('aria-pressed', String(active)); q(tab.dataset.tab!).hidden = !active; } window.dispatchEvent(new Event('resize')); };
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-workspace-target]'))button.onclick=()=>document.querySelector<HTMLButtonElement>(`[data-tab="${button.dataset.workspaceTarget}"]`)?.click();
q('refresh-sources').onclick = () => run(q('refresh-sources'), 'learning-status', sources); q('refresh-courses').onclick = () => run(q('refresh-courses'), 'learning-status', courses); q('refresh-builds').onclick = () => run(q('refresh-builds'), 'model-status', builds);
q('reports').onclick = () => run(q('reports'), 'reports-status', async () => {
  q('reports-result').replaceChildren(); const results = await Promise.allSettled([api('/api/v1/reports/summary'), api('/api/v1/reports/usage')]);
  results.forEach((result, index) => { const article = document.createElement('article'); article.append(element('h3', index ? 'Usage & cost' : 'Company summary'), element('pre', result.status === 'fulfilled' ? JSON.stringify(result.value, null, 2) : String(result.reason.message))); q('reports-result').append(article); });
  say('reports-status', results.every(item => item.status === 'fulfilled') ? 'Live company reports loaded. Missing measurements remain null.' : 'Some reports could not be loaded. See each service response below.');
});
function enable(signedIn: boolean) {
  serviceWorkspace?.setEnabled(signedIn);
  q('signin').hidden = signedIn; q('signout').hidden = !signedIn;
  for (const id of ['learning-fields', 'model-fields']) q<HTMLFieldSetElement>(id).disabled = !signedIn;
  for (const id of ['refresh-courses', 'refresh-builds', 'refresh-review', 'refresh-photos', 'build-saved', 'refresh-rights', 'register-rights', 'refresh-scene-assets', 'generate-background', 'reports']) q<HTMLButtonElement>(id).disabled = !signedIn;
}
async function selectCompany(id: string) { await post(`/api/v1/organization-contexts/${encodeURIComponent(id)}/select`, {}, 'organization:' + id); clearPrivateState(); setOrganizationId(id); enable(true); say('status', 'Connected to your company. Upload content or open a saved result.'); await Promise.allSettled([sources().catch(error => say('learning-status', error.message)), builds().catch(error => say('model-status', error.message))]); }
q<HTMLSelectElement>('organization').onchange = () => { const select = q<HTMLSelectElement>('organization'); select.disabled = true; enable(false); clearPrivateState(); void selectCompany(select.value).catch(error => say('status', error.message)).finally(() => { select.disabled = false; }); };
q('signin').onclick = () => { sessionStorage.setItem('mdt.auth.return-admin', 'true'); run(q('signin'), 'status', beginSignIn); };
q('signout').onclick = () => { clearPrivateState(); enable(false); q<HTMLSelectElement>('organization').replaceChildren(new Option('Sign in to load your companies', '')); q<HTMLSelectElement>('organization').disabled = true; clearAccessToken(); say('status', 'Signed out.'); };
async function start() {
  const pendingAdmin = sessionStorage.getItem('mdt.auth.return-admin') === 'true';
  if (pendingAdmin) { await completeSignIn(); sessionStorage.removeItem('mdt.auth.return-admin'); }
  if (!getAccessToken()) return;
  const page = await api('/api/v1/organization-contexts'), select = q<HTMLSelectElement>('organization'); select.replaceChildren(...page.items.map((org: any) => new Option(org.name ?? org.organizationId, org.organizationId)));
  if (!page.items.length) { q('signin').hidden = true; q('signout').hidden = false; say('status', 'Your account has no company membership yet. Open Companies & memberships to create or join a company.'); return; }
  const selected = getOrganizationHeaders()['x-organization-id']; if (page.items.some((org: any) => org.organizationId === selected)) select.value = selected!;
  select.disabled = false; await selectCompany(select.value);
}
serviceWorkspace=mountServices();
void start().catch(error => { enable(false); say('status', error.message); });
createMediaReview(q('media-review'), async <T>(path: string, init?: RequestInit): Promise<T> => {
  const result = await api<T>(path, init);
  if (path.startsWith('/api/v1/media-review') && !path.slice('/api/v1/media-review'.length).split('?')[0]) q('media-review').hidden = false;
  return result;
},{rationaleDefault:'The source clearly depicts the intended device and is suitable for reconstruction.'});
window.addEventListener('pagehide', () => { controller.abort(); serviceWorkspace?.dispose(); viewer?.dispose(); for (const url of objectUrls.values()) URL.revokeObjectURL(url); });
