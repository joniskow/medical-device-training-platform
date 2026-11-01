import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const exercise=`
history.replaceState(null,'','/verify?credential='+ 'a'.repeat(43));
let mode='ACTIVE';const requests=[];
window.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify(mode==='LIMIT'?{error:{}}:{issuerName:'<img src=x> Issuer',courseTitle:'Device training',status:mode,issuedAt:'2026-10-30T12:00:00Z',expiresAt:null,verifiedAt:'2026-10-30T12:00:01Z',intendedUse:'Organization-issued training record'}),{status:mode==='LIMIT'?429:200});};
await import('/verify.js');const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
try{
 await wait();check(q('#record').textContent.includes('ACTIVE'),'Active result missing');check(!q('#record img'),'Issuer title rendered as HTML');check(requests[0].options.credentials==='omit','Public request sent credentials');
 mode='REVOKED';q('#retry').click();await wait();check(q('#record').textContent.includes('REVOKED'),'Revocation not refreshed');check(q('#status').textContent.includes('not currently active'),'Revocation guidance missing');
 mode='LIMIT';q('#retry').click();await wait();check(q('#record').hidden&&!q('#record').textContent,'Old verification result retained after failure');check(q('#status').textContent.includes('wait a minute'),'Rate limit guidance missing');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/verify.js'){res.setHeader('content-type','text/javascript');res.end(await readFile('apps/web/dist/verify.js'));return;}
 res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/verify.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const profile=await mkdtemp(join(tmpdir(),'mdt-verify-'));const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2000));console.log('Verification browser passed: anonymous fetch, inert public fields, current revocation, rate-limit guidance and removal of stale results.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
