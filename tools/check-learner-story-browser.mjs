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
const q=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m)};
const click=t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===t);check(b&&!b.disabled,'Unavailable '+t);b.click();};
const course={enrollmentId:'enrollment:test',releaseId:'release:test',title:'Story course',assessmentSessions:[],content:{hasStory:true,modules:[{title:'Module',activities:[{activityId:'read',type:'text',title:'Read current instructions',text:'Safe reading'},{activityId:'quiz',type:'multiple_choice',title:'Hidden future assessment'}]}]}};
let revision=1,phase='intro',calls=0,conflict=false,deny=false,hold=false,resolvePending;const keys=[],restartKeys=[];let restartCalls=0;
const node=()=>phase==='intro'?{nodeId:'intro',title:'<img src=x> Briefing',purpose:'Prepare the controller',available:true,choices:[{choiceId:'begin',label:'Begin mission',consequence:'Read the instructions',enabled:true},{choiceId:'alternate',label:'Alternate route',consequence:'Another route',enabled:true}]}:phase==='read'?{nodeId:'read',title:'Read instructions',purpose:'Review the procedure',activityId:'read',available:true,choices:[{choiceId:'finish',label:'Finish story',consequence:'End this example',enabled:true}]}:{nodeId:'end',title:'Finished',purpose:'Review your results',available:true,choices:[],outcome:{kind:phase==='retry'?'retry':'success',message:'Mission complete'}};
window.fetch=async(url,init={})=>{
 if(url.startsWith('/api/')&&init.headers['x-organization-id']!=='org:test')throw Error('Missing organization');
 if(url.endsWith('/restart')){const body=JSON.parse(init.body);check(body.confirmed===true&&Object.keys(body).sort().join(',')==='confirmed,revision','Restart authority fields invalid');restartKeys.push(init.headers['idempotency-key']);restartCalls++;if(restartCalls===1){phase='intro';revision++;throw Error('Restart response lost');}return Response.json({revision,nodeId:'intro'});}
 if(url.endsWith('/choices')){
  const body=JSON.parse(init.body);check(Object.keys(body).sort().join(',')==='choiceId,revision','Client sent authority fields');keys.push(init.headers['idempotency-key']);calls++;
  if(hold)return new Promise(r=>resolvePending=r);
  if(deny)return Response.json({error:{code:'STORY_NOT_FOUND'}},{status:404});
  if(conflict)return Response.json({error:{code:'STORY_REVISION_CONFLICT'}},{status:409});
  if(calls===1)throw Error('Interrupted');
  phase=body.choiceId==='begin'?'read':'end';revision++;return Response.json({revision,nodeId:phase});
 }
 if(url.endsWith('/story'))return Response.json({enrollmentId:course.enrollmentId,releaseId:course.releaseId,releaseHash:'a'.repeat(64),mission:'<svg onload=alert(1)> Restore the controller',revision,node:node()});
 if(url==='/api/v1/enrollments')return Response.json({items:[course],nextCursor:null});
 if(url.startsWith('/api/v1/enrollments/'))return Response.json(course);
 if(url.startsWith('/api/v1/credentials')||url.startsWith('/api/v1/notifications'))return Response.json({items:[],nextCursor:null});
 throw Error('Unexpected request '+url);
};
history.replaceState({},'','?enrollment=enrollment%3Atest');await import('/learner/learner.js');
try{
 await wait();check(q('[data-story]'),'Missing mission');check(!q('#course img')&&!q('#course svg'),'Unsafe story HTML');check(!q('#course').textContent.includes('Hidden future assessment'),'Future activity exposed');check(!q('#course article'),'Intro should not launch activities');
 click('Begin mission');await wait();check(q('[data-story]').textContent.includes('interrupted'),'Missing retry explanation');check([...q('[data-story]').querySelectorAll('button')].find(b=>b.textContent==='Alternate route').disabled,'Ambiguous request allowed another choice');
 click('Begin mission');await wait();check(keys[0]===keys[1],'Retry key changed');check(q('#course').textContent.includes('Safe reading'),'Current activity missing');check(document.activeElement.textContent==='Read instructions','Choice did not restore heading focus');check(!q('#course').textContent.includes('Hidden future assessment'),'Other activities remained');
 conflict=true;click('Finish story');await wait();check(q('[data-story] fieldset').disabled,'Conflict left choices enabled');check(q('[data-story]').textContent.includes('Refresh the story'),'Conflict guidance missing');
 conflict=false;click('Refresh story');await wait();click('Finish story');await wait();check(q('[data-story]').textContent.includes('Certification is evaluated separately'),'Story implied certification');check(!q('#course article'),'Terminal retained activity controls');check(!q('[data-story] fieldset').offsetHeight,'Terminal retained choices');
 phase='retry';revision++;click('Refresh story');await wait();window.confirm=()=>false;click('Restart mission');await wait();check(restartCalls===0,'Cancelled restart submitted');window.confirm=()=>true;click('Restart mission');await wait();check(q('[data-story]').textContent.includes('interrupted'),'Interrupted restart feedback missing');click('Restart mission');await wait();check(restartKeys.length===2&&restartKeys[0]===restartKeys[1],'Restart retry key changed');check(q('[data-story]').textContent.includes('Briefing'),'Restart did not reload authoritative beginning');
 phase='read';revision++;click('Refresh story');await wait();deny=true;click('Finish story');await wait();check(!q('#course article'),'Lost access retained activity controls');check(q('[data-story]').textContent.includes('access is unavailable'),'Lost access explanation missing');
 if(!${process.argv.includes('--screenshot')}){deny=false;phase='intro';revision++;click('Story course');await wait();hold=true;click('Begin mission');await wait();check(resolvePending,'Pending choice did not start');click('Sign out');resolvePending(Response.json({revision:99,nodeId:'end'}));await wait();check(!q('#course').textContent&&!q('#courses').textContent,'Late response restored signed-out story');}else{deny=false;phase='read';revision++;click('Story course');await wait();}
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
 console.log('Learner story Chrome passed: current activity, safe text, stable retry, conflict refresh, focus, terminal distinction, access-loss cleanup and late sign-out fencing.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
