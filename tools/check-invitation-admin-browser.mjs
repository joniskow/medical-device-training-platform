import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:test');window.confirm=()=>true;
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let createCalls=0,revokeCalls=0,denied=false,delayed=false,revoked=false;const keys=[];
const item=(id,status='PENDING')=>({invitationId:id,intendedEmail:'<img src=x>@example.test',role:'author',status,emailStatus:'ACCEPTED',expiresAt:'2026-12-01T00:00:00Z'});
window.fetch=async(url,init={})=>{
 check(init.headers['x-organization-id']==='org:test','Missing organization scope');
 if(delayed)await new Promise(r=>setTimeout(r,150));
 if(denied)return new Response(JSON.stringify({error:{message:'Denied'}}),{status:403});
 if(init.method==='POST'){
  const body=JSON.parse(init.body);
  if(url.endsWith('/revoke')){revokeCalls++;check(body.reason==='Withdrawn'&&Object.keys(body).length===1,'Invalid revoke body');revoked=true;return new Response('{}');}
  keys.push(init.headers['idempotency-key']);createCalls++;check(body.email==='new@example.test'&&body.role==='author'&&Object.keys(body).length===2,'Invalid creation body');
  if(createCalls===1)throw Error('Interrupted response');
  if(createCalls===2)check(keys[0]===keys[1],'Retry identity changed');
  else check(keys[2]!==keys[1],'New invitation reused completed request identity');
  return new Response('{}');
 }
 return new Response(JSON.stringify({items:url.includes('?')?[item('second','ACCEPTED')]:[item('first',revoked?'REVOKED':'PENDING')],nextCursor:url.includes('?')?null:'first',allowedRoles:['learner','author']}));
};
await import('/author/invitation-admin.js');
try{
 await wait();check(!q('#creation').disabled&&!document.querySelector('img'),'Initial load or safe rendering failed');check(q('article').textContent.includes('inbox delivery unconfirmed'),'Provider acceptance misrepresented as delivery');
 q('#more').click();await wait();check(document.querySelectorAll('article').length===2&&q('#more').hidden,'Pagination failed');
 check(document.querySelectorAll('article form').length===1,'Accepted invite has revoke form');
 q('#email').value='New@Example.test';q('#role').value='author';q('#create-form button').click();await wait();
 check(q('#message').textContent.includes('Interrupted response')&&!q('#creation').disabled,'Interrupted create cannot retry');
 q('#create-form button').click();await wait();await wait();check(q('#message').textContent.includes('not confirmed'),'Creation claims delivery');
 q('#email').value='new@example.test';q('#create-form button').click();await wait();await wait();check(createCalls===3,'Fresh creation failed');
 q('article textarea').value='Withdrawn';q('article button').click();await wait();await wait();check(revokeCalls===1&&!q('article form'),'Revocation failed');
 denied=true;q('#refresh').click();await wait();check(!q('article')&&q('#creation').disabled&&!q('#email').value,'Access loss retained private data');
 denied=false;q('#refresh').click();await wait();delayed=true;q('#refresh').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,200));
 check(!q('article')&&q('#creation').disabled&&!sessionStorage.getItem('mdt.auth.access-token'),'Late response restored signed-out view');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/invitation-admin.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/invitation-admin.js':'invitation-admin.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Invitation administration browser passed: scoped paging, safe rendering, stable retries, new request identity, revocation, access-loss cleanup and sign-out fencing.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
