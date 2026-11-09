import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {build} from '../apps/web/node_modules/esbuild/lib/main.js';

// Isolated engineering browser: real UI and Blob lifetimes; controlled versioned API.
const directory=resolve('output/admin-lesson-state');await mkdir(directory,{recursive:true});
const exercise=`
import {renderAdminLessons} from './apps/web/src/admin-lessons.ts';
import {lessonRenderRevision} from './packages/contracts/src/lesson-render.ts';
import {lessonDirectionRevision} from './packages/simulation-schema/src/lesson-direction.ts';
const findings=[],host=document.getElementById('host'),errors=[];
const lesson=id=>{const narration='Press Start. Verify Ready.',citation={assetVersionId:'source:fixture',page:1};return {schemaVersion:'video-lesson.v1',lessonId:'lesson:'+id,title:'Lesson '+id,durationSeconds:30,scenes:[{sceneId:'scene:'+id,startSeconds:0,endSeconds:30,narration,onScreenText:[],citations:[citation]}],direction:{schemaVersion:'lesson-direction.v1',openingProblem:'How to begin?',outcome:'Verify Ready.',beats:[{sceneId:'scene:'+id,sourceEvidence:[{citation,quote:narration}],startingCondition:'Press Start.',subject:'Start',framing:'operator',attentionTarget:'Start',action:'Press Start.',result:'Verify Ready.',narration,callouts:[],observationHoldSeconds:3,prerequisites:[],warnings:[],exactLabels:[]}]}};};
const manifest=(item,id)=>({schemaVersion:'lesson-render.v1',mode:'rough-cut',artifactId:'sha256:'+'a'.repeat(64),sha256:'a'.repeat(64),captionsSha256:'b'.repeat(64),inputRevision:lessonRenderRevision(item),durationSeconds:30,placeholders:[],scenes:item.scenes.map(s=>({...s,narrationSeconds:3})),outputPath:'org/derived/lessons/render-'+id+'/lease-1/lesson.mp4',captionsPath:'private/captions.vtt'});
const initial={courseVersionId:'course:fixture',revision:1,content:{title:'Two lessons',videoLessons:[lesson(1),lesson(2)]}};
initial.content.videoLessons.forEach((item,i)=>{item.roughCut=manifest(item,i+1);item.directionReview={revision:lessonDirectionRevision(item.direction)};});
let server,operations=[];
const services={signal:new AbortController().signal,run(button,status,action){button.disabled=true;const operation=action().catch(e=>errors.push(e.message)).finally(()=>button.disabled=false);operations.push(operation);},async wait(load){return load();},async content(path){return new Blob([path.includes('captions')?'WEBVTT':'engineering fixture'],{type:path.includes('captions')?'text/vtt':'video/mp4'});},async api(path,init){
 if(path.startsWith('/api/v1/lesson-renders/'))return {state:'SUCCEEDED',manifest:server.content.videoLessons[Number(path.at(-1))-1].roughCut};
 if(init?.method==='PUT'){const body=JSON.parse(init.body);if(body.revision!==server.revision)throw Error('STALE_REVISION');server.content=structuredClone(body.content);return {revision:++server.revision};}
 return {courseVersion:structuredClone(server)};
}};
const reset=()=>{host.replaceChildren();errors.length=0;operations=[];server=structuredClone(initial);renderAdminLessons(host,structuredClone(server),services);for(const details of host.querySelectorAll('details'))details.open=true;};
const click=async(index,title)=>{const section=host.querySelector('section').children;const groups=[...host.querySelector('section').children].filter(n=>n.tagName==='DETAILS');const button=[...groups[index].querySelectorAll('button')].find(b=>b.textContent===title);if(!button)throw Error('Button missing: '+title);button.click();await Promise.all(operations);return groups[index];};
try{
 reset();let first=await click(0,'Play saved rough cut');const url=first.querySelector('video').src;
 await click(1,'Play saved rough cut');try{await (await fetch(url)).arrayBuffer();}catch{findings.push('Playing lesson 2 revokes lesson 1 playback URL.');}
 reset();server.content.videoLessons[1].title='Updated by another editor';server.revision++;
 await click(0,'Play saved rough cut');await click(0,'Save speech & lesson settings');
 if(server.content.videoLessons[1].title!=='Updated by another editor')findings.push('Loading playback rebases the revision and silently overwrites changes from another editor.');
 reset();const scene=host.querySelector('[data-direction-scene]');const group=scene.closest('details');const narrationFields=[...group.querySelectorAll('label')].filter(label=>label.firstChild?.textContent?.startsWith('Narration'));
 if(narrationFields.length!==1)findings.push('The same scene script has two independent narration editors and stale source-review controls.');
 const text=narrationFields[0].querySelector('textarea');text.value='Press Start. Verify Ready. Inspect.';text.dispatchEvent(new Event('input'));
 const review=scene.closest('[data-lesson-direction-editor]').querySelector('input[type=checkbox]');
 if(review.checked)findings.push('Editing narration retains the old source-review confirmation.');
 await click(0,'Save speech & lesson settings');const saved=server.content.videoLessons[0];
 if(saved.scenes[0].narration!==text.value||saved.direction.beats[0].narration!==text.value||saved.directionReview)findings.push('Narration save is not synchronized with shot direction and review invalidation.');
 document.body.dataset.result=JSON.stringify({findings});
}catch(error){document.body.dataset.result=JSON.stringify({findings:[error.stack]});}
`;
await build({stdin:{contents:exercise,resolveDir:resolve('.'),sourcefile:'admin-state-test.ts'},outfile:join(directory,'test.js'),bundle:true,platform:'browser',format:'esm',target:'es2022'});
const server=createServer(async(req,res)=>{if(req.url==='/test.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(join(directory,'test.js')));}else{res.setHeader('content-type','text/html');res.end('<!doctype html><div id="host"></div><script type="module" src="/test.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'admin-state-chrome-'));
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'http://127.0.0.1:'+server.address().port],{windowsHide:true,stdio:'ignore'});
let socket,id=0;const pending=new Map();
const command=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>reject(Error('CDP_TIMEOUT')),10000);pending.set(request,{resolve,reject,timer});socket.send(JSON.stringify({id:request,method,params}));});
try{
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);socket.onmessage=e=>{const response=JSON.parse(String(e.data)),waiter=pending.get(response.id);if(waiter){pending.delete(response.id);clearTimeout(waiter.timer);response.error?waiter.reject(Error(response.error.message)):waiter.resolve(response.result);}};await new Promise(r=>socket.onopen=r);
 let result;for(let i=0;i<100;i++){const raw=(await command('Runtime.evaluate',{expression:'document.body.dataset.result',returnByValue:true})).result.value;if(raw){result=JSON.parse(raw);break;}await new Promise(r=>setTimeout(r,100));}
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));assert(result,'Browser did not finish');for(const finding of result.findings)console.log('BUG: '+finding);assert.deepEqual(result.findings,[]);
 console.log('PASS: independent lesson playback URLs, concurrent-editor revision protection, and one synchronized source-reviewed narration editor.');
}finally{socket?.close();for(const waiter of pending.values())clearTimeout(waiter.timer);child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
