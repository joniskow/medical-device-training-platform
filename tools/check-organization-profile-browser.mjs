import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:one');
const wait=()=>new Promise(r=>setTimeout(r,50)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let mode='ok',posts=0;const keys=[];
const profile={organizationId:'org:one',name:'<img src=x>',description:'Description',website:'https://example.test',revision:1};
window.fetch=async(url,init={})=>{
 check(url==='/api/v1/organization-profile','Unexpected route');check(init.headers['x-organization-id']==='org:one','Missing tenant context');
 if(mode==='denied')return new Response('{}',{status:403});
 if(init.method!=='POST')return new Response(JSON.stringify(profile));
 keys.push(init.headers['idempotency-key']);const body=JSON.parse(init.body);check(!body.organizationId&&!body.actorId,'Spoofable fields');
 if(mode==='interrupted'&&++posts===1)throw Error('Interrupted');
 if(mode==='conflict')return new Response('{}',{status:409});
 if(mode==='late')await new Promise(r=>setTimeout(r,150));
 Object.assign(profile,{name:body.name,description:body.description,website:body.website,revision:profile.revision+1});return new Response(JSON.stringify(profile));
};
await import('/author/organization-settings.js');
try{
 await wait();check(!q('#profile-fields').disabled,'Profile unavailable');check(q('#profile-name').value==='<img src=x>'&&!document.querySelector('img'),'Unsafe name rendering');
 check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');
 q('#profile-name').value='Updated';q('#profile-reason').value='Correction';mode='interrupted';q('button[type=submit]').click();await wait();
 check(!q('#profile-fields').disabled&&q('#message').textContent.includes('Interrupted'),'Interrupted save not retryable');
 q('button[type=submit]').click();await wait();check(keys[0]===keys[1],'Retry identity changed');check(q('#message').textContent.includes('saved'),'Save acknowledgement missing');
 mode='ok';q('#profile-name').value='Next';q('#profile-reason').value='Another correction';q('button[type=submit]').click();await wait();check(keys[2]!==keys[1],'Fresh change reused old identity');
 mode='conflict';q('#profile-reason').value='Stale correction';q('button[type=submit]').click();await wait();check(q('#profile-fields').disabled&&q('#message').textContent.includes('Reload'),'Conflict permits stale save');
 mode='ok';q('#reload').click();await wait();check(!q('#profile-fields').disabled,'Reload did not restore editing');
 mode='denied';q('#profile-reason').value='Access changed';q('button[type=submit]').click();await wait();check(q('#profile-fields').disabled&&!q('#profile-name').value&&!q('#context').textContent,'Access loss retained private profile');
 mode='ok';q('#reload').click();await wait();mode='late';q('#profile-reason').value='Late update';q('button[type=submit]').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,220));
 check(q('#profile-fields').disabled&&!q('#profile-name').value&&!q('#context').textContent&&q('#message').textContent==='Signed out.','Late save restored private state');
 mode='ok';sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:one');q('#reload').click();await wait();
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/organization-settings.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/organization-settings.js':'organization-settings.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',process.env.PROFILE_SCREENSHOT?'--window-size=768,1100':'--window-size=320,800',...(process.env.PROFILE_SCREENSHOT?[`--screenshot=${process.env.PROFILE_SCREENSHOT}`]:[]),`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Organization settings Chrome passed: safe rendering, tenant headers, interrupted retry identity, fresh edit, conflict reload, access-loss cleanup, late-save sign-out and narrow layout.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
