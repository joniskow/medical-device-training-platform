import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','unused');
const wait=()=>new Promise(r=>setTimeout(r,50)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let account=null,mode='ok',posts=0;const keys=[];
window.fetch=async(url,init={})=>{
 check(url==='/api/v1/account','Unexpected route');check(!init.headers['x-organization-id'],'Personal account used tenant header');
 if(mode==='denied')return new Response('{}',{status:403});
 if(init.method!=='POST')return new Response(JSON.stringify({account}));
 keys.push(init.headers['idempotency-key']);const body=JSON.parse(init.body);check(!body.subject&&!body.emailVerified&&body.confirmed===true,'Spoofable identity fields');
 if(mode==='interrupted'&&++posts===1)throw Error('Interrupted');
 if(mode==='conflict')return new Response('{}',{status:409});
 if(mode==='late')await new Promise(r=>setTimeout(r,150));
 account={userId:'one',displayName:body.displayName,revision:(account?.revision??0)+1,emailVerified:false};return new Response(JSON.stringify({account}));
};
await import('/author/account.js');
try{
 await wait();check(!q('#account-fields').disabled&&q('#save').textContent.includes('Create'),'No-membership profile creation unavailable');
 q('#display-name').value='<img src=x>';q('#save').click();await wait();check(keys.length===0,'Consent bypassed');
 q('#confirmed').checked=true;mode='interrupted';q('#save').click();await wait();check(!q('#account-fields').disabled,'Interrupted create not retryable');
 q('#save').click();await wait();check(keys[0]===keys[1],'Retry identity changed');check(q('#message').textContent.includes('saved')&&!document.querySelector('img'),'Creation failed or unsafe text');
 check(q('#verification').textContent.includes('does not confirm'),'Unverified identity overstated');check(!q('#confirmed').checked,'Consent not reset');
 mode='ok';q('#display-name').value='Changed';q('#confirmed').checked=true;q('#save').click();await wait();check(keys[2]!==keys[1],'Update reused creation key');
 mode='conflict';q('#display-name').value='Stale';q('#confirmed').checked=true;q('#save').click();await wait();check(q('#account-fields').disabled&&q('#message').textContent.includes('Reload'),'Conflict allowed stale retry');
 mode='ok';q('#reload').click();await wait();mode='denied';q('#confirmed').checked=true;q('#save').click();await wait();check(q('#account-fields').disabled&&!q('#display-name').value&&!q('#verification').textContent,'Access loss retained private data');
 mode='ok';q('#reload').click();await wait();mode='late';q('#confirmed').checked=true;q('#save').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,220));
 check(q('#account-fields').disabled&&!q('#display-name').value&&q('#message').textContent==='Signed out.','Late response restored account');
 mode='ok';sessionStorage.setItem('mdt.auth.access-token','test');q('#reload').click();await wait();
 check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/account.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/account.js':'account.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',process.env.ACCOUNT_SCREENSHOT?'--window-size=768,1100':'--window-size=320,800',...(process.env.ACCOUNT_SCREENSHOT?[`--screenshot=${process.env.ACCOUNT_SCREENSHOT}`]:[]),`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Personal account Chrome passed: independent profile creation, explicit consent, no tenant headers, safe text, interrupted retry, revision conflict, current verification copy, access-loss cleanup and late-response sign-out.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
