import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let delayed=true,calls=0,createCalls=0,created=false,lateCreate=false;const keys=[],creationKeys=[];
window.fetch=async(url,init={})=>{
 if(init.method==='POST'&&url==='/api/v1/organization-contexts'){
  if(lateCreate){await new Promise(r=>setTimeout(r,100));return new Response(JSON.stringify({organizationId:'org:new',name:'New'}));}
  creationKeys.push(init.headers['idempotency-key']);check(init.body===JSON.stringify({name:'<img src=x>'}),'Creation body includes unexpected fields');
  if(++createCalls===1)throw Error('Creation interrupted');
  check(creationKeys[0]===creationKeys[1],'Creation retry changed identity');created=true;return new Response(JSON.stringify({organizationId:'org:new',name:'<img src=x>'}));
 }
 if(init.method!=='POST'&&created)return new Response(JSON.stringify({items:[{organizationId:'org:new',name:'<img src=x>'},{organizationId:'org:b'}]}));
 if(init.method!=='POST')return new Response(JSON.stringify({items:[]}));
 if(delayed){await new Promise(r=>setTimeout(r,100));return new Response('{}');}
 keys.push(init.headers['idempotency-key']);check(init.body==='{}','Selection included spoofable fields');
 if(++calls===1)throw Error('Selection interrupted');
 check(keys[0]===keys[1],'Retry changed selection identity');check(url.includes('org%3Ab'),'Wrong selected organization');
 sessionStorage.setItem('selection-tested','true');return new Response('{}');
};
await import('/author/organizations.js');
try{
 await wait();check(q('#selection').disabled&&!q('#creation').disabled,'First-time onboarding unavailable');
 lateCreate=true;q('#organization-name').value='New';q('#create-form button').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,150));
 check(q('#creation').disabled&&!q('#create-message').textContent&&!sessionStorage.getItem('mdt.auth.organization-id'),'Late creation restored signed-out state');
 lateCreate=false;sessionStorage.setItem('mdt.auth.access-token','test');q('#refresh').click();await wait();
 q('#organization-name').value='<img src=x>';q('#create-form button').click();await wait();check(q('#create-message').textContent.includes('Creation interrupted'),'Creation error missing');
 q('#create-form button').click();await wait();await wait();check(q('#organizations').value==='org:new','Created organization was not selected');check(!document.querySelector('img'),'Unsafe organization name');
 check(!q('#selection').disabled,'Organization choices unavailable');check(!document.querySelector('img'),'Unsafe organization identifier');
 q('#organizations').value='org:b';q('#organization-form button').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,150));
 check(!sessionStorage.getItem('mdt.auth.organization-id')&&!sessionStorage.getItem('mdt.auth.access-token'),'Late selection restored signed-out context');
 delayed=false;sessionStorage.setItem('mdt.auth.access-token','test');q('#refresh').click();await wait();q('#organizations').value='org:b';q('#organization-form button').click();await wait();
 check(q('#message').textContent.includes('Selection interrupted'),'Interrupted selection error missing');check(!q('#selection').disabled,'Retry unavailable');q('#organization-form button').click();
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/author/jobs'){res.setHeader('content-type','text/html');res.end("<body><script>document.body.dataset.testResult=sessionStorage.getItem('mdt.auth.organization-id')==='org:b'&&sessionStorage.getItem('selection-tested')==='true'?'PASS':'FAIL: context missing after reload';</script></body>");return;}
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/organizations.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/organizations.js':'organizations.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Organization creation and picker passed: creation replay and sign-out fencing, inert identifiers, interrupted retry, sign-out fencing and clean workspace reload with selected context.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
