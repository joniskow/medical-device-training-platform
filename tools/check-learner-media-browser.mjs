import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
const decoder=(await webRequire('esbuild').build({entryPoints:[webRequire.resolve('jsqr')],bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','fixture');sessionStorage.setItem('mdt.auth.organization-id','org:test');
const q=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,60)),check=(v,m)=>{if(!v)throw Error(m)};
const launches=[];let loads=0,acks=0,fail=false,hold=false,resolvePending,invalid=false;
const course={enrollmentId:'enrollment:test',title:'Media course',progress:[],assessmentSessions:[],content:{modules:[{title:'Media',activities:[{activityId:'picture',type:'image',title:'Picture'},{activityId:'clip',type:'video',title:'Clip'}]}]}};
for(const type of ['guided_procedure','manipulation','assembly'])course.content.modules[0].activities.push({activityId:type,type,title:type});
window.fetch=async(url,init={})=>{
 if(url.endsWith('/start')){check(init.method==='POST'&&init.body==='{}','Interactive launch supplied authority fields');launches.push(url);return Response.json({error:{code:'SIMULATION_COOLDOWN',message:'Wait'}},{status:409});}
 if(url.includes('/media')){loads++;if(hold)return new Promise(r=>resolvePending=r);if(fail)return Response.json({error:{code:'MEDIA_NOT_FOUND',message:'Media unavailable'}},{status:404});return Response.json({url:invalid?'javascript:alert(1)':'https://private.test/fixture',contentType:url.includes('picture')?'image/png':'video/mp4',altText:'<img src=x> Cover diagram',transcript:'<script>bad</script> Open cover.'});}
 if(url.endsWith('/acknowledge')){check(init.method==='POST'&&init.body==='{}','Forged acknowledgement fields');if(++acks===1)throw Error('Interrupted acknowledgement');course.progress=[{activityId:'picture',status:'ACKNOWLEDGED'}];return Response.json({});}
 if(url==='/api/v1/enrollments')return Response.json({items:[course]});
 if(url.startsWith('/api/v1/enrollments/'))return Response.json(course);
 return Response.json({items:[]});
};
history.replaceState({},'','?enrollment=enrollment%3Atest');await import('/learner/learner.js');
const click=(label,root=document)=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent===label);check(b,'Missing '+label);b.click();};
try{
 await wait();check(loads===0&&acks===0,'Opening course loaded or acknowledged media');
 for(const b of [...document.querySelectorAll('button')].filter(b=>b.textContent==='Open interactive activity')){b.click();await wait();}check(launches.length===3&&['guided_procedure','manipulation','assembly'].every(t=>launches.some(u=>u.includes('/'+t+'/start'))),'Interactive catalog types did not launch');
 let article=q('#course article');check([...article.querySelectorAll('button')].find(b=>b.textContent==='Mark as reviewed').disabled,'Acknowledgement available before loading');
 click('Load media',article);await wait();check(article.querySelector('img').alt.includes('Cover diagram'),'Image description missing');check(!article.querySelector('script')&&article.querySelectorAll('img').length===1,'Description rendered markup');check(acks===0,'Loading acknowledged media');
 click('Mark as reviewed',article);await wait();check(article.textContent.includes('Interrupted'),'Interrupted acknowledgement guidance missing');click('Mark as reviewed',article);await wait();check(q('#course article').textContent.includes('marked this media'),'Acknowledgement not refreshed');
 const clip=q('#course article:nth-of-type(2)');click('Load media',clip);await wait();const video=clip.querySelector('video');check(video.controls&&!video.autoplay&&video.preload==='metadata','Video playback controls invalid');check(clip.textContent.includes('Open cover.')&&!clip.querySelector('script'),'Transcript unsafe or missing');
 video.dispatchEvent(new Event('error'));check(clip.textContent.includes('Refresh the media link'),'Media error missing recovery');
 fail=true;click('Refresh media link',clip);await wait();check(!clip.querySelector('video'),'Access failure retained media');check([...clip.querySelectorAll('button')].find(b=>b.textContent==='Mark as reviewed').disabled,'Access failure retained acknowledgement');fail=false;
 invalid=true;click('Refresh media link',clip);await wait();check(!clip.querySelector('video'),'Unsafe URL was rendered');invalid=false;
 hold=true;click('Refresh media link',clip);await wait();check(resolvePending,'Pending media load missing');click('Sign out');resolvePending(Response.json({url:'https://private.test/late',contentType:'video/mp4',transcript:'Late transcript'}));await wait();check(!q('#course').textContent&&!q('#course video'),'Late response restored signed-out media');check(!video.hasAttribute('src'),'Disposed video retained URL');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;

const server=createServer(async(req,res)=>{try{
 if(req.url==='/qr-decoder.js'){res.setHeader('content-type','text/javascript');res.end(decoder);return;}
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/learner.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/learner/learner.js':'learner.js','/learner/auth-session.js':'auth-session.js','/learner/learner-media.js':'learner-media.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 await mkdir('output',{recursive:true});
 const profile=await mkdtemp(join(tmpdir(),'mdt-learner-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',...(process.argv.includes('--screenshot')?['--screenshot='+join(process.cwd(),'output','learner-story.png'),'--window-size=768,2000']:[]),`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Learner media Chrome passed: on-demand image/video, inert equivalent text, explicit acknowledgement/retry, refresh/errors, unsafe URL rejection and late sign-out disposal.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
