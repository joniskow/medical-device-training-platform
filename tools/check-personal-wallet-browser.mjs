import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
const decoder=(await webRequire('esbuild').build({entryPoints:[webRequire.resolve('jsqr')],bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;
const exercise=`
const wait=()=>new Promise(r=>setTimeout(r,60)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
const record={credentialId:'credential:one',issuerName:'<img src=x> Issuer',title:'<img src=x> Training',status:'REVOKED',issuedAt:'2026-10-01T00:00:00Z',expiresAt:null,intendedUse:'Product training',verificationEnabled:false,verificationAllowed:true,sharingRevision:0,publicId:'a'.repeat(43)};let outcome='ok',pending,confirmed=true;const keys=[];window.confirm=()=>confirmed;const button=label=>[...q('#courses article').querySelectorAll('button')].find(n=>n.textContent===label);
window.fetch=async(url,init={})=>{check(url.startsWith('/api/v1/my-credentials'),'Wrong route');const h=new Headers(init.headers);check(h.get('authorization')==='Bearer test'&&!h.has('x-organization-id'),'Wallet depended on organization');if(url.endsWith('/sharing')){keys.push(h.get('idempotency-key'));check(init.method==='POST','Sharing method wrong');const body=JSON.parse(init.body);check(Object.keys(body).sort().join(',')==='enabled,revision','Sharing authority fields');if(outcome==='interrupted')throw Error('Interrupted');if(outcome==='pending')return new Promise(r=>pending=r);if(outcome==='conflict')return new Response('{}',{status:409});record.verificationEnabled=body.enabled;record.sharingRevision++;return new Response(JSON.stringify(record));}if(outcome==='pending')return new Promise(r=>pending=r);if(outcome==='fail')return new Response('{}',{status:403});return new Response(JSON.stringify({items:[{...record,issuerName:url.includes('after=')?'Second issuer':record.issuerName,verificationEnabled:url.includes('after=')}],nextCursor:url.includes('after=')?null:'next'}));};
try{
 await import('/wallet.js');await wait();check(q('#message').textContent.includes('Sign in'),'Anonymous wallet not denied');sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','irrelevant');q('#reload').click();await wait();
 check(q('#courses').textContent.includes('REVOKED')&&!q('#courses img')&&!q('#courses a'),'Status/privacy/rendering incorrect');q('#more').click();await wait();check(q('#courses').children.length===2&&q('#courses').textContent.includes('Second issuer')&&q('#more').hidden,'Wallet paging failed');check(q('#courses a').getAttribute('href')===location.origin+'/verify?credential='+record.publicId,'Verification link wrong');
 confirmed=false;button('Enable public sharing').click();await wait();check(keys.length===0,'Cancelled confirmation sent change');confirmed=true;outcome='interrupted';button('Enable public sharing').click();await wait();check(keys.length===1&&!button('Enable public sharing').disabled,'Interrupted sharing not retryable');outcome='ok';button('Enable public sharing').click();await wait();check(keys.length===2&&keys[0]===keys[1],'Sharing retry key changed');check(q('#courses article:first-child a'),'Enabled sharing missing link');
 button('Show verification QR').click();await wait();const canvas=q('#courses article:first-child canvas');check(!canvas.hidden,'QR hidden');const {default:decode}=await import('/qr-decoder.js');const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);check(decode(pixels.data,pixels.width,pixels.height)?.data===location.origin+'/verify?credential='+record.publicId,'QR did not encode actual verification URL');
 button('Disable public sharing').click();await wait();check(!q('#courses article:first-child a')&&!q('#courses article:first-child canvas'),'Withdrawal retained link/QR');outcome='conflict';button('Enable public sharing').click();await wait();check(button('Enable public sharing').disabled&&q('#courses article').textContent.includes('Refresh'),'Conflict allowed stale retry');
 outcome='fail';q('#reload').click();await wait();check(!q('#courses').children.length&&q('#message').textContent.includes('could not'),'Denied request retained records');outcome='pending';q('#reload').click();await wait();q('#sign-out').click();pending(new Response(JSON.stringify({items:[record]})));await wait();check(!q('#courses').children.length&&q('#message').textContent==='Signed out.','Late response restored records');check(!sessionStorage.getItem('mdt.auth.access-token'),'Sign-out retained token');
 sessionStorage.setItem('mdt.auth.access-token','test');outcome='ok';q('#reload').click();await wait();outcome='pending';button('Enable public sharing').click();await wait();q('#sign-out').click();pending(new Response(JSON.stringify({...record,verificationEnabled:true})));await wait();check(!q('#courses').children.length&&q('#message').textContent==='Signed out.','Late sharing response restored content');
 check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/qr-decoder.js'){res.setHeader('content-type','text/javascript');res.end(decoder);return;}
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/wallet.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/wallet.js':'wallet.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-organization-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',process.env.PROFILE_SCREENSHOT?'--window-size=768,1100':'--window-size=320,800',...(process.env.PROFILE_SCREENSHOT?[`--screenshot=${process.env.PROFILE_SCREENSHOT}`]:[]),`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Personal wallet Chrome passed: anonymous denial, organization-independent requests, inert records, lifecycle status, sharing visibility, confirmation, stable retry, conflict, independently decoded QR, withdrawal, multi-issuer paging, access-loss clearing and late-response sign-out.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
