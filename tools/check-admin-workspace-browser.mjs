import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {lessonRenderRevision} from '../packages/contracts/dist/lesson-render.js';

// Dedicated Chrome profile + explicit engineering fixtures. This verifies the UI
// integration and real WebGL preview; it does not claim live provider acceptance.
const output = resolve('output/admin-browser'); await mkdir(output, {recursive:true});
const noMembership = process.env.ADMIN_TEST_NO_MEMBERSHIP === '1';
const narrationFailure = process.env.ADMIN_TEST_NARRATION_FAILURE === '1';
let upload, generation = 0, reconstruction = 0, sourceApproved = false, rightsActive = false, activeOrg = 'org:test';
const seen = [], issues = [];
const course = {courseVersion:{courseVersionId:'course:test',revision:2,status:'DRAFT',content:{schemaVersion:'course-draft.v1',title:'Device orientation and safe preparation',modules:[{title:'Orientation',activities:[{title:'Identify the device',type:'rich_text',text:'Generated lesson from the uploaded source.',citations:[{assetVersionId:'source:pdf',page:1}]},{title:'Knowledge check',assessment:{questions:[{prompt:'What comes first?',options:[{text:'Inspect the device'},{text:'Skip inspection'}],rationale:'Inspect before use.'}]}}]}],videoLesson:{title:'Video plan',scenes:[{narration:'Inspect the device.'}]}}}};
const seed = `sessionStorage.setItem('mdt.auth.access-token','engineering-fixture');sessionStorage.setItem('mdt.auth.organization-id','org:test');`;
course.courseVersion.content.videoLessons=[{lessonId:'lesson:test',title:'Narrated orientation',durationSeconds:30,scenes:[{sceneId:'scene:1',startSeconds:0,endSeconds:30,narration:'Inspect the AIC. Confirm Ready.'}]}];
let briefSaves=0;
let renderManifest, speechSaves=0, rendered=0;
const exercise = noMembership ? `
for(let i=0;i<100&&!document.getElementById('status').textContent.includes('no company membership');i++)await new Promise(r=>setTimeout(r,50));
const signout=document.getElementById('signout');
if(signout.hidden||!document.getElementById('signin').hidden||!document.getElementById('learning-fields').disabled)document.body.dataset.testResult='Invalid account state without membership';
else{signout.click();document.body.dataset.testResult=document.getElementById('status').textContent==='Signed out.'&&!document.getElementById('signin').hidden?'PASS':'Sign-out failed';}
` : `
const q=id=>document.getElementById(id), pause=()=>new Promise(r=>setTimeout(r,100));
const wait=async(test,label)=>{for(let i=0;i<250;i++){if(test())return;await pause();}throw Error(label+' timed out: '+q('status').textContent+' / '+q('learning-status').textContent+' / '+q('model-status').textContent);};
const check=(v,m)=>{if(!v)throw Error(m);};
try{
 await wait(()=>q('status').textContent.includes('Connected'),'Company initialization');
 check(q('title').value&&q('instructions').value&&!q('video-plan').checked,'Missing learning defaults');
 q('video-plan').checked=true;q('audience').value='Service technicians';q('lesson-length').value='120';q('learning-terminology').value='AIC';
 const pdf=new File(['%PDF-1.4 engineering upload'], 'orientation.pdf',{type:'application/pdf'});const docs=new DataTransfer();docs.items.add(pdf);q('documents').files=docs.files;
 q('learning-form').requestSubmit();
 await wait(()=>q('learning-status').textContent.includes('Generated draft saved'),'PDF generation');
 check(q('learning-result').textContent.includes('Generated lesson from the uploaded source.'),'Missing lesson result');
 check(q('learning-result').textContent.includes('What comes first?'),'Missing knowledge check');
 check(q('learning-result').textContent.includes('Inspect before use.'),'Missing explanation');
 const lessonSection=q('learning-result').querySelector('section');check(lessonSection.textContent.includes('Speech & narrated lessons'),'Missing speech controls');
 const lessonDetails=lessonSection.querySelector('details');lessonDetails.open=true;const speechDetails=[...lessonDetails.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Speech for scene:1');speechDetails.open=true;
 const pace=speechDetails.querySelector('input[type=number]');check(pace.value==='1','Missing pace default');pace.value='0.9';pace.dispatchEvent(new Event('input'));
 const emphasis=speechDetails.querySelector('select');emphasis.value='moderate';emphasis.dispatchEvent(new Event('input'));
 const textareas=speechDetails.querySelectorAll('textarea');textareas[1].value='AIC. | 350';textareas[1].dispatchEvent(new Event('input'));textareas[2].value='AIC | A I C';textareas[2].dispatchEvent(new Event('input'));
 [...lessonDetails.querySelectorAll('button')].find(b=>b.textContent==='Save speech & lesson settings').click();await wait(()=>lessonDetails.textContent.includes('Settings saved'),'Speech save');
 [...lessonDetails.querySelectorAll('button')].find(b=>b.textContent==='Render speech, captions & rough cut').click();await wait(()=>lessonDetails.textContent.includes('Speech and captions are ready'),'Speech rendering');
 check(!lessonDetails.querySelector('video').hidden&&lessonDetails.querySelector('track').src.startsWith('blob:'),'Missing speech/caption playback');
 const accept=[...lessonDetails.querySelectorAll('button')].find(b=>b.textContent==='Accept reviewed rough cut');check(accept.disabled,'Rough cut accepted without listening confirmation');
 pace.value='1';pace.dispatchEvent(new Event('input'));check(lessonDetails.querySelector('video').hidden&&accept.disabled,'Stale speech retained after edit');
 q('courses').querySelector('button').click();await wait(()=>[...q('learning-result').querySelectorAll('button')].some(b=>b.textContent==='Play saved rough cut'),'Saved speech recovery button');
 const reopened=q('learning-result').querySelector('section');reopened.querySelector('details').open=true;[...reopened.querySelectorAll('button')].find(b=>b.textContent==='Play saved rough cut').click();await wait(()=>!reopened.querySelector('video').hidden,'Saved speech playback without regeneration');
 document.querySelector('[data-tab=scene]').click();
 const photos=new DataTransfer();photos.items.add(new File(['engineering-image'],'device.png',{type:'image/png'}));q('photos').files=photos.files;
 q('model-form').requestSubmit();
 await wait(()=>q('model-status').textContent.includes('Uploads are processed'),'Source review gate');
 await wait(()=>[...q('media-review').querySelectorAll('button')].some(b=>b.textContent.startsWith('Review device.png')),'Review list');
 [...q('media-review').querySelectorAll('button')].find(b=>b.textContent.startsWith('Review device.png')).click();
 await wait(()=>[...q('media-review').querySelectorAll('button')].some(b=>b.textContent==='Load private media preview'),'Private preview button');
 [...q('media-review').querySelectorAll('button')].find(b=>b.textContent==='Load private media preview').click();
 await wait(()=>q('media-review').querySelector('textarea'),'Review confirmation controls');
 q('media-review').querySelector('textarea').value='Checked the source image and its suitability for reconstruction.';q('media-review').querySelector('input[type=checkbox]').checked=true;
 [...q('media-review').querySelectorAll('button')].find(b=>b.textContent==='Approve photo').click();
 await wait(()=>q('media-review').textContent.includes('Decision saved'),'Recorded source decision');
 q('refresh-rights').click();await wait(()=>q('rights-target').value,'Rights content selection');check(!q('rights-confirm').checked,'Rights confirmation was preselected');q('register-rights').click();await wait(()=>q('rights-status').textContent.includes('Confirm that you have permission'),'Explicit permission gate');q('rights-confirm').checked=true;q('register-rights').click();await wait(()=>q('rights-status').textContent.includes('Usage permission recorded'),'Rights registration');
 q('refresh-photos').click();await wait(()=>q('approved-photos').querySelector('input:checked'),'Approved source selection');q('build-saved').click();
 await wait(()=>q('model-label').textContent.includes('Generated candidate'),'Photo reconstruction');
 check(q('viewer-message').textContent.includes('Model ready'),'Model failed to render');
 for(const id of ['rotate-left','rotate-right','zoom-in','zoom-out','reset-view'])q(id).click();
 q('background').value='dark';q('background').dispatchEvent(new Event('change'));check(q('background-preview').hidden,'Dark background not selected');
 const picture=await new Promise(r=>{const c=document.createElement('canvas');c.width=16;c.height=16;c.getContext('2d').fillRect(0,0,16,16);c.toBlob(r,'image/png');});const bg=new DataTransfer();bg.items.add(new File([picture],'background.png',{type:'image/png'}));q('background-image').files=bg.files;q('background-image').dispatchEvent(new Event('change'));check(q('background').value==='custom'&&!q('background-preview').hidden,'Custom background failed');
 if(${narrationFailure})q('narration-player').hidden=false;
 q('generate-background').click();await wait(()=>q('background-status').textContent.includes('${narrationFailure?'Background is ready, but narration could not be loaded':'Generated background is ready'}'),'AI background');check(!q('background-video').hidden,'Missing generated background');
 if(${narrationFailure})check(q('narration-player').hidden&&!q('narration-player').hasAttribute('src'),'Stale narration remained after download failure');
 document.querySelector('[data-tab=company]').click();q('reports').click();await wait(()=>q('reports-status').textContent.includes('Some reports'),'Report errors');check(q('reports-result').textContent.includes('SERVICE_UNAVAILABLE'),'Service failure was hidden');
 await wait(()=>!q('organization').disabled,'Idle company selector');q('organization').value='org:other';q('organization').dispatchEvent(new Event('change'));await wait(()=>q('status').textContent.includes('Connected')&&!q('organization').disabled,'Company switch');
 check(!q('learning-result').textContent.includes('Generated lesson'),'Private course leaked after company switch');check(q('model-canvas').hidden,'Private model retained after company switch');check(q('documents').files.length===0&&q('photos').files.length===0,'Private file selection retained');
 document.querySelector('[data-tab=scene]').click();q('sample').click();await wait(()=>q('model-label').textContent.includes('Existing example'),'Sample preview');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult=error.stack;}
`;
const assets = {'/admin.html':'apps/web/dist/admin.html','/admin.js':'apps/web/dist/admin.js','/admin-viewer.js':'apps/web/dist/admin-viewer.js','/admin.css':'apps/web/dist/admin.css','/model/nxstage-system-one.glb':'fixtures/nxstage-system-one-interactive/nxstage-system-one.glb','/api/v1/reconstructions/build:test/candidate':'fixtures/nxstage-system-one-interactive/nxstage-system-one.glb','/demo-assets/nxstage-clinical-photo-v4.png':'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png','/model/nxstage-training-scene-manifest.json':'apps/web/src/model/nxstage-training-scene-manifest.json','/api/v1/openmontage/generations/bg:test/preview':'fixtures/reference/video/aic-priming-demo.mp4'};
const server = createServer(async(req,res)=>{
 try{
  const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  if(path==='/test-seed.js'||path==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(path==='/test-seed.js'?seed:exercise);return;}
  if(path==='/admin'){let html=await readFile('apps/web/dist/admin.html','utf8');html=html.replace('<script type="module" src="/admin.js">','<script src="/test-seed.js"></script><script type="module" src="/admin.js">');html=html.replace('</body>','<script type="module" src="/exercise.js"></script></body>');res.setHeader('content-type','text/html');res.end(html);return;}
  if(assets[path]){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.mp4')?'video/mp4':path.endsWith('.json')?'application/json':'model/gltf-binary');res.end(await readFile(assets[path]));return;}
  if(path==='/api/v1/openapi.json'){res.setHeader('content-type','application/json');res.end(await readFile('packages/api-client/openapi.json'));return;}
  if(!path.startsWith('/api/v1/')){res.writeHead(404).end();return;}
  assert.equal(req.headers.authorization,'Bearer engineering-fixture');seen.push([req.method,path,req.headers['x-organization-id']]);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);const body=raw.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(raw):{};
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(path==='/api/v1/organization-contexts'){json({items:noMembership?[]:[{organizationId:'org:test',name:'Engineering test company'},{organizationId:'org:other',name:'Second engineering company'}]});return;}
  if(path.endsWith('/select')){assert(req.headers['idempotency-key']);activeOrg=decodeURIComponent(path.split('/').at(-2));json({});return;}
  assert.equal(req.headers['x-organization-id'],activeOrg);
  if(path.endsWith('/assets/upload-sessions')){upload=body;assert.equal(body.sha256.length,64);json({uploadSessionId:'upload:test',blobKey:'private/test',uploadUrl:'/api/v1/upload-sessions/upload:test/content'});return;}
  if(path==='/api/v1/media-review/photo:test/content'){res.setHeader('content-type','image/png');res.end(await readFile('fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png'));return;}
  if(path==='/api/v1/lesson-renders/render:test/content'){const kind=new URL(req.url,'http://localhost').searchParams.get('kind');res.setHeader('content-type',kind==='video'?'video/mp4':'text/vtt');res.end(kind==='video'?await readFile('fixtures/reference/video/aic-priming-demo.mp4'):'WEBVTT\n\n00:00.000 --> 00:03.000\nInspect the AIC. Confirm Ready.\n');return;}
  if(path.endsWith('/content')){assert(raw.length>0);json({});return;}
  if(path.endsWith('/complete')){assert.equal(body.sha256,upload.sha256);json({processingJob:{jobId:'job:test'}});return;}
  if(path==='/api/v1/jobs/job:test'){json({state:'SUCCEEDED'});return;}
  if(path==='/api/v1/knowledge-sources'){json({items:activeOrg==='org:test'?[{assetVersionId:'source:pdf',fileName:'orientation.pdf',state:'APPROVED',chunkCount:1}]:[]});return;}
  if(path==='/api/v1/knowledge-sources/source:pdf'){json({sourceHash:upload.sha256,items:[]});return;}
  if(path==='/api/v1/courses'){if(req.method==='POST'){assert(req.headers['idempotency-key']);json({courseVersionId:'course:test'});}else json({items:generation&&activeOrg==='org:test'?[{courseVersionId:'course:test',title:'Orientation',status:'DRAFT'}]:[]});return;}
  if(path.endsWith('/generate-draft')){assert.deepEqual(body.sourceArtifactIds,['source:pdf']);assert.equal(body.videoLesson,true);assert.equal(briefSaves,1);assert.deepEqual(body.mediaAssetVersionIds,['video:test']);assert(body.userInstruction.includes('Service technicians'));assert(body.userInstruction.includes('120 seconds'));generation++;json({appliedToCourse:true});return;}
  if(path==='/api/v1/course-versions/course:test'){if(req.method==='PUT'){assert.equal(body.revision,course.courseVersion.revision);if(body.content.lessonBrief&&!body.content.videoLessons[0].scenes[0].narrationDelivery){assert.equal(body.content.lessonBrief.audience,'Service technicians');briefSaves++;course.courseVersion.content=body.content;course.courseVersion.revision++;json({revision:course.courseVersion.revision});return;}const delivery=body.content.videoLessons[0].scenes[0].narrationDelivery;assert.equal(delivery.rate,0.9);assert.equal(delivery.emphasis,'moderate');assert.equal(delivery.pauses[0].milliseconds,350);assert.equal(delivery.pronunciations[0].alias,'A I C');course.courseVersion.content=body.content;course.courseVersion.revision++;speechSaves++;json({revision:course.courseVersion.revision});}else json(course);return;}
  if(path==='/api/v1/lesson-renders'){assert.equal(body.revision,course.courseVersion.revision);assert(req.headers['idempotency-key'].length<=200);assert.equal(body.mode,'rough-cut');const lesson=course.courseVersion.content.videoLessons[0];renderManifest={schemaVersion:'lesson-render.v1',mode:'rough-cut',artifactId:'sha256:'+'a'.repeat(64),sha256:'a'.repeat(64),captionsSha256:'b'.repeat(64),inputRevision:lessonRenderRevision(lesson),durationSeconds:30,placeholders:[],scenes:[{sceneId:'scene:1',startSeconds:0,endSeconds:30,narrationSeconds:3}],outputPath:'org:test/derived/lessons/render%3Atest/lease-1/lesson.mp4',captionsPath:'private/captions.vtt'};lesson.roughCut=renderManifest;course.courseVersion.revision++;rendered++;json({jobId:'render:test',state:'SUCCEEDED'});return;}
  if(path==='/api/v1/lesson-renders/render:test'){json({state:'SUCCEEDED',manifest:renderManifest});return;}
  if(path==='/api/v1/media-review'){json({items:[{assetVersionId:'photo:test',fileName:'device.png',state:sourceApproved?'APPROVED':'READY_FOR_REVIEW'}]});return;}
  if(path==='/api/v1/media-review/photo:test'){json({fileName:'device.png',state:'READY_FOR_REVIEW',sourceType:'image',sourceHash:upload.sha256,contentType:'image/png',contentUrl:'/api/v1/media-review/photo:test/content',width:1672,height:941,durationSeconds:0});return;}
  if(path==='/api/v1/media-review/photo:test/review'){assert.equal(body.sourceHash,upload.sha256);assert.equal(body.confirmed,true);sourceApproved=true;json({state:'APPROVED'});return;}
  if(path==='/api/v1/media-review/photo:test/rights'){assert.equal(body.confirmed,true);assert.equal(body.targetKind,'asset');assert.equal(body.sourceHash,upload.sha256);assert(req.headers['idempotency-key']);rightsActive=true;json({status:'ACTIVE'});return;}
  if(path==='/api/v1/reconstructions/sources'){json({items:sourceApproved&&rightsActive?[{assetVersionId:'photo:test',sourceHash:upload.sha256,fileName:'device.png',sourceType:'image'}]:[]});return;}
  if(path==='/api/v1/reconstructions'){if(req.method==='POST'){assert(req.headers['idempotency-key']);assert.equal(body.mode,'single-image');assert.equal(body.sources[0].sourceHash,upload.sha256);reconstruction++;json({jobId:'build:test'});}else json({enabledModes:['single-image','multi-view','video'],items:reconstruction&&activeOrg==='org:test'?[{jobId:'build:test',state:'SUCCEEDED',mode:'single-image'}]:[]});return;}
  if(path==='/api/v1/reconstructions/build:test'){json({state:'SUCCEEDED',candidateUrl:'/api/v1/reconstructions/build:test/candidate'});return;}
  if(path==='/api/v1/model-imports'){json({items:[{modelVersionId:'model:test',fileName:'Approved model',status:'APPROVED'}]});return;}
  if(path==='/api/v1/model-imports/model:test'){json({modelVersionId:'model:test',manifest:{sourceHash:'a'.repeat(64)}});return;}
  if(path==='/api/v1/approved-media'){json({items:[{assetVersionId:'video:test',fileName:'Approved reference',type:'video'}]});return;}
  if(path==='/api/v1/media-review/video:test'){json({assetVersionId:'video:test',sourceHash:'b'.repeat(64),contentType:'video/mp4',width:960,height:540,durationSeconds:3});return;}
  if(path==='/api/v1/openmontage/generations'){assert(body.prompt&&body.narrationText&&body.sceneManifest);json({generationId:'bg:test'});return;}
  if(path==='/api/v1/openmontage/generations/bg:test'){json({state:'SUCCEEDED',...(narrationFailure?{narration:{durationSeconds:3}}:{})});return;}
  if(path==='/api/v1/openmontage/generations/bg:test/narration'){json({error:{code:'NARRATION_UNAVAILABLE'}},503);return;}
  if(path==='/api/v1/openmontage/generations/bg:test/preview'){res.setHeader('content-type','video/mp4');res.end(await readFile('fixtures/reference/video/aic-priming-demo.mp4'));return;}
  if(path==='/api/v1/reports/summary'){json({courses:1,estimatedCost:null});return;}
  if(path==='/api/v1/reports/usage'){json({error:{code:'SERVICE_UNAVAILABLE',message:'Usage service not configured'}},503);return;}
  issues.push('Unexpected request: '+req.method+' '+path);json({error:{message:'Unexpected test request'}},404);
 }catch(error){issues.push(error.stack);res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'admin-workspace-chrome-'));
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/admin`],{windowsHide:true,stdio:'ignore'});
let socket;const pending=new Map();let nextId=0;
const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
try{
 let port;for(let attempt=0;attempt<100;attempt++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert(port,'Chrome did not start');const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 const browserErrors=[];socket.onmessage=event=>{const message=JSON.parse(String(event.data)),waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')browserErrors.push(message.params.exceptionDetails.text);};
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});await command('Runtime.enable');
 let result;for(let attempt=0;attempt<400;attempt++){result=(await command('Runtime.evaluate',{expression:'document.body?.dataset.testResult',returnByValue:true})).result.value;if(result)break;await new Promise(r=>setTimeout(r,100));}
 await writeFile(join(output,'result.html'),(await command('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true})).result.value);
 assert.equal(result,'PASS');assert.equal(generation,noMembership?0:1);assert.equal(reconstruction,noMembership?0:1);assert.equal(speechSaves,noMembership?0:1);assert.equal(rendered,noMembership?0:1);assert.deepEqual(issues,[]);assert.deepEqual(browserErrors,[]);
 for(const width of [320,768,1024,1440]){await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,300));assert.equal((await command('Runtime.evaluate',{expression:'document.documentElement.scrollWidth <= innerWidth',returnByValue:true})).result.value,true,`Overflow at ${width}px`);await command('Runtime.evaluate',{expression:`document.querySelector('[data-tab=company]').click()`});assert.equal((await command('Runtime.evaluate',{expression:'document.documentElement.scrollWidth <= innerWidth',returnByValue:true})).result.value,true,`Company overflow at ${width}px`);if(width===320||width===1440){const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,`scene-${width}.png`),Buffer.from(shot.data,'base64'));}}
 console.log(noMembership?'PASS: signed-in account without membership retains sign-out, blocks company actions, and can sign out; responsive layouts passed.':'PASS: PDF upload/hash-bound generation, readable lessons, speech defaults/delivery saving/revision checks/rendering/captions/listening gate/stale-playback invalidation, explicit source approval and rights, actual WebGL models, backgrounds, report errors, company isolation; layouts 320/768/1024/1440px. Engineering API fixtures, not live provider proof.');
}finally{socket?.close();for(const waiter of pending.values())clearTimeout(waiter.timer);child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
