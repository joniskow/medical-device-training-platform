import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:one');
const wait=()=>new Promise(r=>setTimeout(r,60)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let outcome='ok',calls=[],pending,allowDiscard=false;window.confirm=()=>allowDiscard;
const data={title:'<img src=x> Course',releaseStatus:'PUBLISHED',mode:'PRIVATE',revision:0,details:{},publicId:null};
const choose=async()=>{q('#release').value='release:one';q('#release').dispatchEvent(new Event('change'));await wait();};
const save=()=>{q('#confirmed').checked=true;q('#form').requestSubmit();};
window.fetch=async(url,init={})=>{
 const h=new Headers(init.headers);check(h.get('authorization')==='Bearer test'&&h.get('x-organization-id')==='org:one','Missing identity/context');
 if(url.startsWith('/api/v1/enrollments/options'))return new Response(JSON.stringify({items:[{releaseId:url.includes('after=')?'release:two':'release:one',title:'<img src=x> Course',courseVersionId:'version:one'}],nextCursor:url.includes('after=')?null:'cursor'}));
 check(url==='/api/v1/releases/release%3Aone/offering','Unexpected offering destination');
 if(init.method==='POST'){
  calls.push({key:h.get('idempotency-key'),body:JSON.parse(init.body)});check(calls.at(-1).body.confirmed===true&&!('organizationId' in calls.at(-1).body),'Invalid authority body');
  if(outcome==='interrupted')throw Error('Interrupted');if(outcome==='conflict')return new Response('{}',{status:409});if(outcome==='denied')return new Response('{}',{status:403});if(outcome==='pending')return new Promise(r=>pending=r);
  const b=calls.at(-1).body;data.mode=b.mode;data.revision++;data.details=b;data.publicId=b.mode==='PRIVATE'?null:'11111111-1111-1111-1111-111111111111';
 }
 return new Response(JSON.stringify(data));
};
try{
 await import('/author/course-availability.js');await wait();check(q('#release').options.length===2&&!document.querySelector('img'),'Unsafe courses');q('#more').click();await wait();check(q('#release').options.length===3&&q('#more').hidden,'Pagination failed');await choose();
 check(q('#mode').value==='PRIVATE'&&!q('#confirmed').checked&&!q('#fields').disabled,'Private default unavailable');check(q('#context').textContent.includes('<img src=x>')&&!document.querySelector('img'),'Unsafe release title');
 q('#mode').value='PUBLIC';q('#mode').dispatchEvent(new Event('input',{bubbles:true}));q('#reason').value='Publish catalog';save();await wait();check(calls.length===0,'Missing disclosures accepted');
 for(const id of ['audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath'])q('#'+id).value=id;
 q('#reason').dispatchEvent(new Event('input',{bubbles:true}));check(!q('#confirmed').checked,'Editing did not reset confirmation');
 q('#reload').click();await wait();check(q('#mode').value==='PUBLIC','Cancelled discard lost edits');
 outcome='interrupted';save();await wait();check(calls.length===1&&!q('#fields').disabled,'Interrupted retry unavailable');outcome='ok';save();await wait();check(calls.length===2&&calls[0].key===calls[1].key,'Request identity changed on retry');check(q('#public-link a').getAttribute('href')==='/catalog?course=11111111-1111-1111-1111-111111111111'&&!q('#confirmed').checked,'Saved link/confirmation wrong');
 q('#mode').value='UNLISTED';q('#reason').value='Share directly';save();await wait();check(q('#public-link a').textContent.includes('unlisted')&&calls.at(-1).key!==calls[0].key,'Unlisted link/new change key missing');
 q('#mode').value='PRIVATE';q('#reason').value='Withdraw';outcome='conflict';save();await wait();check(q('#fields').disabled&&!q('#confirmed').checked,'Conflict allowed stale save');allowDiscard=true;q('#reload').click();await wait();await choose();check(!q('#fields').disabled&&q('#mode').value==='UNLISTED','Reload failed');
 outcome='ok';q('#mode').value='PRIVATE';q('#reason').value='Withdraw';save();await wait();check(!q('#public-link a')&&q('#mode').value==='PRIVATE','Private withdrawal retained public link');
 outcome='denied';q('#reason').value='Check access';save();await wait();check(q('#fields').disabled&&!q('#context').textContent&&!q('#audience').value,'Access loss retained disclosures');
 outcome='ok';q('#reload').click();await wait();await choose();outcome='pending';q('#reason').value='Pending';save();await wait();q('#sign-out').click();pending(new Response(JSON.stringify(data)));await wait();check(q('#fields').disabled&&!q('#context').textContent&&q('#message').textContent==='Signed out.','Late response restored content');
 sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:one');outcome='ok';q('#reload').click();await wait();await choose();check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/course-availability.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/course-availability.js':'course-availability.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',process.env.PROFILE_SCREENSHOT?'--window-size=768,1100':'--window-size=320,800',...(process.env.PROFILE_SCREENSHOT?[`--screenshot=${process.env.PROFILE_SCREENSHOT}`]:[]),`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Course availability Chrome passed: release paging, safe disclosures, private default, required consent, cancelled discard, interrupted retry, revision conflict, withdrawal, access-loss cleanup and sign-out fences.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
