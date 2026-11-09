import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createSourceDirection} from '../packages/ai-gateway/dist/lesson-planner.js';

// Isolated browser and in-memory API exercise the real bundled author application.
// The decoded media fixture is an engineering signal, never pronunciation evidence.
const directory=await mkdtemp(join(tmpdir(),'training-video-browser-'));
const ffmpeg=process.env.LESSON_FFMPEG ?? join(process.env.APPDATA??'','Python/Python312/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const mediaPath=join(directory,'engineering.mp4');
execFileSync(ffmpeg,['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:d=30','-f','lavfi','-i','sine=frequency=320:duration=30','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',mediaPath],{windowsHide:true});
const mediaBase64=(await readFile(mediaPath)).toString('base64');
const citation={assetVersionId:'source:manual',page:1},narration='Before pressing Start, confirm Ready. Warning: keep the cover closed. Press Start. Confirm Flowing.';
const brief={schemaVersion:'lesson-brief.v1',audience:'New operators',priorKnowledge:'Orientation complete',task:'Start flow',objective:'Verify Flowing',deviceRevision:'A',setting:'Simulation',format:'orientation',referencePack:{sourceArtifactIds:['source:manual'],approvedViewIds:['media:front'],exactLabels:['Start'],permittedStates:['Ready','Flowing'],permittedActions:['Press Start'],terminology:['Start'],visualConventions:'Neutral light; operator view'}};
const lesson={schemaVersion:'video-lesson.v1',lessonId:'lesson:browser',title:'Start flow',durationSeconds:30,learningObjectives:['Verify Flowing'],safetyBoundary:'Engineering fixture only',citations:[citation],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narration,onScreenText:['Start'],visual:{kind:'source_image',assetVersionId:'media:front',label:'Start'},citations:[citation]}]};
lesson.direction=createSourceDirection(lesson,[{assetVersionId:'source:manual',citation,text:narration}]);
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','fixture');sessionStorage.setItem('mdt.auth.organization-id','org:test');
const q=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,90)),check=(v,m)=>{if(!v)throw Error(m)};
const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
let version={courseVersionId:'course:video',revision:1,status:'DRAFT',createdBy:'author',content:{schemaVersion:'course-draft.v1',title:'Video test',lessonBrief:${JSON.stringify(brief)},videoLessons:[${JSON.stringify(lesson)}],modules:[]}},saved;
window.fetch=async(url,init={})=>{if(init.method==='PUT'){saved=JSON.parse(init.body);check(saved.revision===version.revision,'Wrong save revision');version.content=structuredClone(saved.content);version.revision++;return Response.json({revision:version.revision});}if(url.includes('/history'))return Response.json({items:[]});if(url==='/api/v1/courses')return Response.json({items:[]});return Response.json({courseVersion:structuredClone(version),decisions:[]});};
await import('/job-status.js');
const button=(text,root=document)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
const field=(text,root=q('#draft-modules'))=>[...root.querySelectorAll('label')].find(l=>l.firstChild?.textContent===text)?.querySelector('input,textarea,select');
const edit=(text,value,event='input',root)=>{const input=field(text,root);check(input,'Missing field '+text);input.focus();input.value=value;input.dispatchEvent(new Event(event,{bubbles:true}));};
const save=async()=>{q('#draft-editor').dispatchEvent(new Event('submit',{cancelable:true}));await wait();await wait();};
const reload=async()=>{q('#course-version-id').value='course:video';q('#review-load-form').dispatchEvent(new Event('submit',{cancelable:true}));await wait();await wait();};
try{
await reload();check(q('[data-lesson-direction-editor]'),'Shot editor not mounted');
edit('Audience','Refresher operators');button('Apply instructional brief').focus();check(document.activeElement===button('Apply instructional brief'),'Brief action not keyboard focusable');button('Apply instructional brief').click();await save();check(saved.content.lessonBrief.audience==='Refresher operators','Brief edit not saved');await reload();check(field('Audience').value==='Refresher operators','Brief reload lost audience');
// Applying a different brief deliberately invalidates generation. Restore the reviewed fixture to test downstream authoring.
version.content.videoLessons=[${JSON.stringify(lesson)}];await reload();
edit('Opening problem','Which visible cue confirms flow?');await save();await reload();check(field('Opening problem').value==='Which visible cue confirms flow?','Direction edit not saved/reloaded');
const scriptReview=q('[data-lesson-direction-editor]').querySelector('input[type=checkbox]');check(!scriptReview.disabled,'Valid source-linked script cannot be reviewed');scriptReview.click();await save();
edit('Pace (0.75 to 1.25)','0.95');edit('Observation pauses: unique script phrase | milliseconds (one per line)','Confirm Flowing. | 500');await save();await reload();check(field('Pace (0.75 to 1.25)').value==='0.95','Delivery controls lost on reload');
const speechOnly=[...q('#draft-modules').querySelectorAll('label')].find(l=>l.textContent==='Speech only (omit device sounds)')?.querySelector('input');check(speechOnly?.checked,'Speech-only delivery must be the default');speechOnly.click();speechOnly.click();await save();check(saved.content.videoLessons[0].scenes[0].audioMix.speechOnly===true,'Speech-only mix choice was not saved');await reload();
const bytes=Uint8Array.from(atob('${mediaBase64}'),c=>c.charCodeAt(0));const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const {lessonRenderRevision}=await import('/packages/contracts/index.js');const revision=()=>lessonRenderRevision(version.content.videoLessons[0]);
const upload=(input,file)=>{const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
const until=predicate=>new Promise(resolve=>{if(predicate()){resolve();return;}const observer=new MutationObserver(()=>{if(predicate()){observer.disconnect();resolve();}});observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});});
const manifest=mode=>({schemaVersion:'lesson-render.v1',mode,artifactId:'sha256:'+sha,sha256:sha,inputRevision:revision(),durationSeconds:30,placeholders:[],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narrationSeconds:3}],captionsSha256:'c'.repeat(64),outputPath:'engineering.mp4',captionsPath:'captions.vtt'});
const importMedia=async(mode,corrupt=false)=>{const root=q('[data-rough-cut-editor]');upload(field('Render manifest JSON',root),new File([JSON.stringify(manifest(mode))],'manifest.json',{type:'application/json'}));upload(field('Matching rough-cut or final MP4',root),new File([corrupt?'wrong bytes':bytes],'engineering.mp4',{type:'video/mp4'}));await until(()=>corrupt?root.textContent.includes('The MP4 does not match'):mode==='final'?!!field('Uploaded final media version ID'):!button('Accept reviewed rough cut').disabled);};
await importMedia('rough-cut',true);check(button('Accept reviewed rough cut').disabled,'Mismatched media could be accepted');
await importMedia('rough-cut');check(!button('Accept reviewed rough cut').disabled,'Verified preview did not enable acceptance: '+[...q('[data-rough-cut-editor]').querySelectorAll('[role=status]')].map(p=>p.textContent).join(' '));button('Accept reviewed rough cut').click();await save();check(saved.content.videoLessons[0].previewAcceptance,'Preview acceptance not persisted');
await importMedia('final');await save();check(saved.content.videoLessons[0].renderArtifact?.mode==='final','Final manifest not saved');check(field('Uploaded final media version ID'),'Final import failed to mount scorecard');
edit('Uploaded final media version ID','media:final','change');edit('Independent reviewer account ID (must match authenticated approval)','reviewer:independent','change');button('Add timestamped finding').click();edit('Defect and required correction','Inspect source label at 12 seconds','change');await save();await reload();check(field('Uploaded final media version ID').value==='media:final','Final scorecard lost on reload');check(field('Defect and required correction').value.includes('source label'),'Timestamped finding lost on reload');
edit('Result observation hold (seconds)','4');await save();check(!saved.content.videoLessons[0].renderArtifact&&!saved.content.videoLessons[0].finalReview&&!saved.content.videoLessons[0].previewAcceptance,'Shot edit retained artifact approval');
await reload();check(!field('Uploaded final media version ID'),'Stale final scorecard still offered');
// The fixture scorecard tests metadata gating only; it is not acceptance of engineering media.
const {lessonFinalReviewRevision,finalReviewDimensions}=await import('/packages/simulation-schema/index.js');
const source=${JSON.stringify(lesson)};source.durationSeconds=60;source.scenes[0].endSeconds=60;source.direction.beats[0].observationHoldSeconds=3;
source.renderArtifact={mode:'final',sha256:'a'.repeat(64),artifactId:'sha256:'+'a'.repeat(64),placeholders:[]};
source.finalReview={schemaVersion:'lesson-final-review.v1',assetVersionId:'asset:source',artifactSha256:'a'.repeat(64),lessonRevision:lessonFinalReviewRevision(source),reviewerId:'reviewer:fixture',reviewedAt:new Date().toISOString(),disposition:'APPROVE',soundAndMotionReviewed:true,fullVideoReviewed:true,dimensions:Object.fromEntries(finalReviewDimensions.map(d=>[d,'PASS'])),intervals:[{sceneId:'one',startSeconds:0,endSeconds:60}],findings:[],devices:['laptop','tablet'].map(profile=>({profile,width:1280,height:720,minLabelPixels:18,minCaptionPixels:24,maxCaptionOcclusionPercent:0,maxSyncOffsetMs:200,clippedSpeechCount:0,integratedLufs:-16,truePeakDb:-1}))};
version.content.videoLessons=[source];version.content.modules=[{moduleId:'module:video',title:'Video',activities:[]}];await reload();
for(const kind of ['beginner','refresher','remediation']){button('Create '+kind+' cut').click();await save();await reload();}
check(version.content.videoLessons.length===4,'Not all learning variants were saved');
const [baseline,beginner,refresher,remediation]=version.content.videoLessons;
check(beginner.durationSeconds>baseline.durationSeconds&&refresher.durationSeconds<baseline.durationSeconds&&remediation.durationSeconds>baseline.durationSeconds,'Variant pacing was not distinct');
check([beginner,refresher,remediation].every(v=>v.scenes[0].narration===baseline.scenes[0].narration&&!v.finalReview&&!v.renderArtifact),'Variants lost source instructions or inherited source approval');
const attach=[...document.querySelectorAll('button')].filter(b=>b.textContent==='Add reviewed cut to learner course');attach[1].click();await save();check(version.content.modules[0].activities.length===0,'Unreviewed variant became learner playback');attach[0].click();await save();check(version.content.modules[0].activities.length===1,'Reviewed source could not be attached');
const malformed=structuredClone(source);malformed.direction.beats=[null];malformed.finalReview={dimensions:null,intervals:null};version.content.videoLessons=[malformed];await reload();check(field('Lesson title'),'Malformed production metadata blanked the editable lesson');edit('Lesson title','Recoverable malformed draft');await save();await reload();check(field('Lesson title').value==='Recoverable malformed draft','Malformed production draft could not save and reload basic author edits');
check(errors.length===0,'Browser errors: '+errors.join('; '));document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.stack;}
`;
const importMap='<script type="importmap">'+JSON.stringify({imports:Object.fromEntries(['simulation-schema','contracts','model-runtime'].map(name=>['@medical-device/'+name,'/packages/'+name+'/index.js']))})+'</script>';
const learnerExercise=`
sessionStorage.setItem('mdt.auth.access-token','fixture');sessionStorage.setItem('mdt.auth.organization-id','org:test');
const check=(v,m)=>{if(!v)throw Error(m)},wait=()=>new Promise(r=>setTimeout(r,100));let mediaLoads=0,writes=0,deny=false,hold=false,releasePending;
const enrollment={enrollmentId:'enrollment:variants',title:'Variant learning',progress:[{activityId:'quiz',status:'FAILED',score:0,maxScore:1}],assessmentSessions:[],content:{modules:[{title:'Practice',activities:[{activityId:'quiz',type:'multiple_choice',title:'Predict the cue',remediation:{activityId:'video:remediation',sceneId:'one',objective:'Verify Flowing',startSeconds:7,endSeconds:20}},{activityId:'video:remediation',type:'video',title:'Reviewed remediation'}]}]}};
window.fetch=async(url,init={})=>{if(init.method&&init.method!=='GET'){writes++;throw Error('Remediation attempted a score or acknowledgement write');}if(url.endsWith('/media-content')&&hold)return new Promise(resolve=>releasePending=resolve);if(url.endsWith('/media-content'))return new Response(Uint8Array.from(atob('${mediaBase64}'),c=>c.charCodeAt(0)),{headers:{'content-type':'video/mp4'}});if(url.endsWith('/media')){mediaLoads++;if(deny)return Response.json({error:{code:'MEDIA_NOT_FOUND',message:'Media unavailable'}},{status:404});check(url.includes('video%3Aremediation'),'Remediation requested wrong activity');return Response.json({url:'/api/v1/enrollments/enrollment%3Avariants/activities/video%3Aremediation/media-content',contentType:'video/mp4',transcript:'Before pressing Start, confirm Ready. Confirm Flowing.'});}if(url==='/api/v1/enrollments')return Response.json({items:[enrollment]});if(url.startsWith('/api/v1/enrollments/'))return Response.json(enrollment);return Response.json({items:[]});};
history.replaceState({},'','?enrollment=enrollment%3Avariants');
try{await import('/learner.js');await wait();await wait();const section=document.querySelector('[data-remediation]');check(section,'Failed objective did not offer remediation');check(section.textContent.includes('Verify Flowing'),'Remediation objective missing');check(mediaLoads===0,'Remediation media loaded before learner request');const load=[...section.querySelectorAll('button')].find(b=>b.textContent==='Load media');check(load,'Remediation load control missing');load.focus();check(document.activeElement===load,'Remediation not keyboard focusable');load.click();await wait();const video=section.querySelector('video');check(video?.controls&&!video.autoplay,'Remediation playback controls missing');if(video.readyState===0)await Promise.race([new Promise(r=>video.addEventListener('loadedmetadata',r,{once:true})),new Promise((_,j)=>setTimeout(()=>j(Error('Remediation media failed to decode')),5000))]);await wait();check(Math.abs(video.currentTime-7)<0.25,'Remediation did not seek to reviewed scene');check(![...section.querySelectorAll('button')].some(b=>b.textContent==='Mark as reviewed'&&!b.hidden),'Supplemental remediation offers acknowledgement');check(mediaLoads===1&&writes===0,'Remediation changed score/retry/ack policy');check(enrollment.progress[0].score===0,'Failed score changed after remediation');
const refresh=()=>[...section.querySelectorAll('button')].find(b=>b.textContent==='Refresh media link');
deny=true;refresh().click();await wait();check(!section.querySelector('video')&&section.textContent.includes('Media unavailable'),'Revoked supplemental access retained private playback');deny=false;refresh().click();await wait();await wait();const retried=section.querySelector('video');check(retried?.controls,'Supplemental media did not recover on retry');if(!retried.readyState)await new Promise(r=>retried.addEventListener('loadedmetadata',r,{once:true}));check(Math.abs(retried.currentTime-7)<0.25,'Retry did not return to approved scene');
hold=true;refresh().click();await wait();check(releasePending,'Private media download did not reach delayed response');document.querySelector('#sign-out').click();releasePending(new Response(Uint8Array.from(atob('${mediaBase64}'),c=>c.charCodeAt(0)),{headers:{'content-type':'video/mp4'}}));await wait();await wait();check(!document.querySelector('#course video')&&!document.querySelector('#course').textContent,'Late private media response restored signed-out course');check(!retried.hasAttribute('src'),'Disposed private video retained object URL');check(writes===0&&enrollment.progress[0].score===0,'Retry/signout changed score or acknowledgement');document.body.dataset.testResult='PASS';}catch(error){document.body.dataset.testResult='FAIL: '+error.stack;}
`;
const adversarialExercise=`
const {renderLessonRoughCutEditor}=await import('/lesson-rough-cut-editor.js');
const {lessonRenderRevision}=await import('/packages/contracts/index.js');
const failures=[],wait=()=>new Promise(r=>setTimeout(r,60)),check=(v,m)=>{if(!v)throw Error(m)};
const bytes=Uint8Array.from(atob('${mediaBase64}'),c=>c.charCodeAt(0));const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const setup=()=>{const host=document.createElement('main');document.body.append(host);const lesson=${JSON.stringify(lesson)};let changes=0;renderLessonRoughCutEditor(host,lesson,()=>changes++);const root=host.firstElementChild,files=root.querySelectorAll('input[type=file]');return{host,root,lesson,files,changes:()=>changes,manifest:mode=>({schemaVersion:'lesson-render.v1',mode,artifactId:'sha256:'+sha,sha256:sha,inputRevision:lessonRenderRevision(lesson),durationSeconds:30,placeholders:[],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narrationSeconds:3}],captionsSha256:'c'.repeat(64),outputPath:'engineering.mp4',captionsPath:'captions.vtt'})};};
const upload=(input,file)=>{const dt=new DataTransfer();if(file)dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change'));};
const json=manifest=>new File([JSON.stringify(manifest)],'manifest.json',{type:'application/json'}),media=()=>new File([bytes],'fixture.mp4',{type:'video/mp4'});
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
const test=async(name,run)=>{try{await run();}catch(error){failures.push(name+': '+error.message);}};
await test('detached import',async()=>{const s=setup();let resolve;const clip=media();Object.defineProperty(clip,'arrayBuffer',{value:()=>new Promise(r=>resolve=r)});upload(s.files[0],json(s.manifest('rough-cut')));upload(s.files[1],clip);await wait();check(resolve,'Fixture did not reach delayed media read');s.host.remove();resolve(bytes.buffer);await wait();await wait();check(s.changes()===0&&!s.lesson.roughCut,'Detached import mutated the old draft or triggered autosave');});
await test('session changed during import',async()=>{const auth=await import('/auth-session.js');auth.setAccessToken('import:first');const s=setup();let resolve;const clip=media();Object.defineProperty(clip,'arrayBuffer',{value:()=>new Promise(r=>resolve=r)});upload(s.files[0],json(s.manifest('rough-cut')));upload(s.files[1],clip);await wait();check(resolve,'Session test did not reach delayed read');auth.setAccessToken('import:second');resolve(bytes.buffer);await wait();await wait();check(s.changes()===0&&!s.lesson.roughCut,'Import from previous session mutated current draft');s.host.remove();auth.clearAccessToken();});
await test('older invalid import',async()=>{const s=setup();let resolve;const old=json(s.manifest('rough-cut'));Object.defineProperty(old,'text',{value:()=>new Promise(r=>resolve=r)});upload(s.files[1],media());upload(s.files[0],old);await wait();upload(s.files[0],json(s.manifest('rough-cut')));await wait();await wait();check(!button(s.root,'Accept reviewed rough cut').disabled,'Latest valid import was not accepted');resolve('{');await wait();button(s.root,'Accept reviewed rough cut').click();check(s.lesson.previewAcceptance,'Older failed import invalidated the newer verified preview');s.host.remove();});
await test('revoked preview during final import',async()=>{const s=setup();upload(s.files[0],json(s.manifest('rough-cut')));upload(s.files[1],media());await wait();await wait();button(s.root,'Accept reviewed rough cut').click();check(s.lesson.previewAcceptance,'Initial preview not accepted');upload(s.files[1],null);upload(s.files[0],json(s.manifest('final')));let resolve;const clip=media();Object.defineProperty(clip,'arrayBuffer',{value:()=>new Promise(r=>resolve=r)});upload(s.files[1],clip);await wait();check(resolve,'Final import did not start delayed read');s.root.querySelector('textarea').value='Hold the result longer';button(s.root,'Flag current playback timestamp').click();check(!s.lesson.previewAcceptance,'Flagging did not revoke preview acceptance');resolve(bytes.buffer);await wait();await wait();check(!s.lesson.renderArtifact,'Final import ignored preview acceptance revoked during verification');s.host.remove();});
for(const invalid of [[],[{sceneId:'unknown',startSeconds:0,endSeconds:30,narrationSeconds:3}],[{sceneId:'one',startSeconds:3,endSeconds:30,narrationSeconds:3}]])await test('invalid render scenes '+JSON.stringify(invalid),async()=>{const s=setup(),manifest=s.manifest('rough-cut');manifest.scenes=invalid;upload(s.files[0],json(manifest));upload(s.files[1],media());await wait();await wait();check(!s.lesson.roughCut&&button(s.root,'Accept reviewed rough cut').disabled,'Manifest with missing/unknown/wrong-timed scenes was imported');s.host.remove();});
for(const change of ['asset','session'])await test('final review changed '+change+' during bytes check',async()=>{
  const {renderLessonFinalReviewEditor}=await import('/lesson-final-review-editor.js'),auth=await import('/auth-session.js');auth.setAccessToken('review:first');
  const host=document.createElement('main');document.body.append(host);const lesson=${JSON.stringify(lesson)};lesson.renderArtifact={mode:'final',sha256:sha,artifactId:'sha256:'+sha,placeholders:[]};renderLessonFinalReviewEditor(host,lesson,()=>{});
  const asset=[...host.querySelectorAll('label')].find(l=>l.firstChild?.textContent==='Uploaded final media version ID').querySelector('input');asset.value='media:first';asset.dispatchEvent(new Event('change'));
  let resolve;const blob=new Blob([bytes],{type:'video/mp4'});Object.defineProperty(blob,'arrayBuffer',{value:()=>new Promise(r=>resolve=r)});const originalFetch=window.fetch;
  window.fetch=async url=>{if(url.includes('/api/v1/media-review/'))return Response.json({sourceHash:sha,sourceType:'video',contentUrl:'/api/v1/fixture-private-content',contentType:'video/mp4'});const response=new Response(bytes);Object.defineProperty(response,'blob',{value:async()=>blob});return response;};
  try{button(host,'Inspect exact uploaded final video').click();await wait();check(resolve,'Review fixture did not reach delayed bytes check');if(change==='asset'){asset.value='media:second';asset.dispatchEvent(new Event('change'));}else auth.setAccessToken('review:second');resolve(bytes.buffer);await wait();await wait();check(!host.querySelector('video'),'Previous asset/session bytes appeared in current final review');}finally{window.fetch=originalFetch;host.remove();auth.clearAccessToken();}
});
await test('stale scorecard context',async()=>{
  const {renderLessonFinalReviewEditor}=await import('/lesson-final-review-editor.js'),{lessonFinalReviewRevision,finalReviewDimensions}=await import('/packages/simulation-schema/index.js');
  const lesson=${JSON.stringify(lesson)};lesson.renderArtifact={mode:'final',sha256:sha,artifactId:'sha256:'+sha,placeholders:[]};lesson.finalReview={schemaVersion:'lesson-final-review.v1',assetVersionId:'media:first',artifactSha256:sha,lessonRevision:lessonFinalReviewRevision(lesson),reviewerId:'reviewer:first',reviewedAt:new Date().toISOString(),disposition:'APPROVE',soundAndMotionReviewed:true,fullVideoReviewed:true,dimensions:Object.fromEntries(finalReviewDimensions.map(d=>[d,'PASS'])),intervals:[{sceneId:'one',startSeconds:0,endSeconds:30}],findings:[],devices:[]};
  const host=document.createElement('main');document.body.append(host);let changes=0;renderLessonFinalReviewEditor(host,lesson,()=>changes++);const approvedRevision=lesson.finalReview.lessonRevision;lesson.title='Changed while review was open';const watched=[...host.querySelectorAll('label')].find(l=>l.firstChild?.textContent==='I watched the entire final video').querySelector('input');watched.click();check(changes===0&&lesson.finalReview.lessonRevision===approvedRevision,'An obsolete scorecard could approve a changed lesson');
  host.replaceChildren();renderLessonFinalReviewEditor(host,lesson,()=>changes++);check([...host.querySelectorAll('select')].every(s=>s.value==='NOT_REVIEWED'),'Reloaded stale review inherited passing dimensions');check(![...host.querySelectorAll('label')].find(l=>l.firstChild?.textContent==='I watched the entire final video').querySelector('input').checked,'Reloaded stale review inherited full-video acceptance');host.remove();
});
document.body.dataset.testResult=failures.length?'FAIL: '+failures.join(' | '):'PASS';document.body.append(document.createTextNode(document.body.dataset.testResult));
`;
const server=createServer(async(req,res)=>{
try{
  if(req.url==='/adversarial-exercise.js'){res.setHeader('content-type','text/javascript');res.end(adversarialExercise);return;}
  if(req.url==='/adversarial-test'){res.setHeader('content-type','text/html');res.end('<!doctype html><html><body>'+importMap+'<script type="module" src="/adversarial-exercise.js"></script></body></html>');return;}
  if(req.url==='/engineering.mp4'){res.setHeader('content-type','video/mp4');res.end(await readFile(mediaPath));return;}
  if(req.url==='/learner-exercise.js'){res.setHeader('content-type','text/javascript');res.end(learnerExercise);return;}
  // Credential QR rendering is unrelated to this course journey and must never be invoked here.
  if(req.url==='/qrcode-fixture.js'){res.setHeader('content-type','text/javascript');res.end('export default {toCanvas(){throw Error("QR outside training-video fixture")}};');return;}
  if(req.url?.startsWith('/learner-test')){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/learner.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+importMap.replace('"imports":{','"imports":{"qrcode":"/qrcode-fixture.js",')+'<script type="module" src="/learner-exercise.js"></script>');return;}
  if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/index.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+importMap+'<script type="module" src="/exercise.js"></script>');return;}
  const packageFile=req.url.match(/^\/packages\/(simulation-schema|contracts|model-runtime)\/([a-z-]+\.js)$/);
  const path=packageFile?join('packages',packageFile[1],'dist',packageFile[2]):/^\/[a-z-]+\.js$/.test(req.url)?join('apps/web/dist',req.url.slice(1)):null;
  if(path){res.setHeader('content-type','text/javascript');res.end(await readFile(path));return;}
  res.writeHead(404).end();
}catch{res.writeHead(500).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
if(process.argv.includes('--serve')){
  console.log(`Training-video browser fixtures: http://127.0.0.1:${server.address().port} and http://127.0.0.1:${server.address().port}/learner-test`);
  await new Promise(()=>{});
}
try{
  for(const [name,path] of [['author','/'],['learner','/learner-test'],['adversarial','/adversarial-test']]){
    // Virtual-time --dump-dom can exhaust its budget before File/crypto/media tasks finish.
    // Poll the actual browser result in wall time so success requires the whole journey.
    const profile=join(directory,'chrome-'+name);
    const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}${path}`],{windowsHide:true,stdio:'ignore'});
    let socket,spawnError;child.on('error',error=>{spawnError=error;});
    const pending=new Map();let nextId=0;
    const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
    try{
      let port;
      for(let attempt=0;attempt<100;attempt++){
        if(spawnError)throw spawnError;
        try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}
      }
      assert(port,name+': Chrome did not start');
      const pages=await (await fetch(`http://127.0.0.1:${port}/json`)).json();const page=pages.find(page=>page.type==='page');assert(page,name+': Chrome page missing');
      socket=new WebSocket(page.webSocketDebuggerUrl);
      socket.onmessage=event=>{const message=JSON.parse(String(event.data)),waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result);}};
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser connection timed out')),5000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(Error('Browser connection failed'));};});
      let result;
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){const response=await command('Runtime.evaluate',{expression:'document.body?.dataset.testResult',returnByValue:true});result=response.result.value;if(result)break;await new Promise(r=>setTimeout(r,100));}
      const dom=await command('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
      await writeFile(join(directory,name+'-result.html'),dom.result.value);
      assert.equal(result,'PASS',name+': '+(result??'Timed out before the browser journey completed'));
    }finally{socket?.close();for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(Error('Browser closed'));}child.kill();}
  }
  console.log('Training video browser passed: author brief/script/delivery save and reload, focusable controls, media hash gate, rough-cut/final import, scorecard/finding persistence, edit invalidation, distinct evidence-preserving variants and independent approval; learner failed-objective remediation, actual media decode/scene seek, and score/acknowledgement isolation. Engineering audio signal only; human audiovisual acceptance remains separate.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
