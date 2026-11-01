import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');
history.replaceState(null,'','/#organizationId=org%3Atest&invitationId=invitation%3Atest&token='+('a'.repeat(43)));
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let calls=0,delay=false;
window.fetch=async(url,init)=>{
 check(!location.hash,'Secret remains in URL');check(!JSON.stringify(sessionStorage).includes('a'.repeat(43)),'Secret stored in session');
 check(init.method==='POST'&&!url.includes('?'),'Secret sent in URL');
 const body=JSON.parse(init.body);check(!('email' in body)&&!('verifiedEmail' in body),'Client supplied identity');
 if(delay)await new Promise(r=>setTimeout(r,150));
 if(url.endsWith('/preview'))return new Response(JSON.stringify({organizationName:'<img src=x>',role:'author'}));
 check(body.confirmed===true&&body.role==='author','Missing explicit role consent');calls++;return new Response('{}');
};
await import('/author/invitation.js');
try{
 check(!location.hash&&q('#token').value==='a'.repeat(43),'Fragment not consumed');
 q('#invitation-form button').click();await wait();check(!q('#preview').hidden&&!document.querySelector('img'),'Preview missing or unsafe');
 check(q('#accept').disabled,'Acceptance before confirmation');
 q('#confirmed').click();q('#accept').click();await wait();check(calls===1&&!q('#token').value&&q('#preview').hidden,'Successful acceptance retained secret or preview');
 q('#token').value='a'.repeat(43);delay=true;q('#invitation-form button').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,200));
 check(q('#preview').hidden&&!q('#token').value&&!sessionStorage.getItem('mdt.auth.access-token'),'Late preview restored private state');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/invitation.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/invitation.js':'invitation.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Invitation browser passed: fragment removal, no token persistence, inert authoritative preview, explicit consent, success cleanup and sign-out fencing.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
