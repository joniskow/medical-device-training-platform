import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const exercise=`
const wait=()=>new Promise(r=>setTimeout(r,50)),check=(v,m)=>{if(!v)throw Error(m)};
sessionStorage.setItem('mdt.auth.managed-account','one');sessionStorage.setItem('mdt.auth.epoch','epoch-one');sessionStorage.setItem('mdt.auth.access-token','old');sessionStorage.setItem('mdt.auth.organization-id','org-one');
let calls=0;window.renewalCount=0;window.fetch=async(url,init)=>{check(url==='/api/v1/account','Unexpected network');check(init.headers.authorization==='Bearer renewed-'+window.renewalCount,'Old bearer was sent');check(!init.headers['x-organization-id'],'Profile sent tenant header');calls++;return new Response(JSON.stringify({account:{displayName:'Test',revision:calls,emailVerified:true}}));};
try{
 await import('/author/account.js');await wait();check(calls===1&&window.renewalCount===1,'Load did not renew');
 check(sessionStorage.getItem('mdt.auth.organization-id')==='org-one','Renewal cleared organization');
 document.querySelector('#display-name').value='Updated';document.querySelector('#confirmed').checked=true;document.querySelector('#save').click();await wait();
 check(calls===2&&window.renewalCount===2,'Save did not renew');check(document.querySelector('#message').textContent.includes('saved'),'Save failed');
 window.renewalFailure=true;document.querySelector('#reload').click();await wait();check(calls===2,'Failed renewal sent a request');check(document.querySelector('#account-fields').disabled,'Renewal failure left stale fields enabled');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL';document.body.append(String(error));}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/account.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 if(req.url==='/author/managed-auth.js'){res.setHeader('content-type','text/javascript');res.end(`export async function renewAccessToken(){window.renewalCount++;if(window.renewalFailure)throw Error('Sign in again.');const token='renewed-'+window.renewalCount;sessionStorage.setItem('mdt.auth.access-token',token);return token;}`);return;}
 const file={'/author/account.js':'account.js','/author/auth-session.js':'auth-session.js'}[req.url];if(file){res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));return;}res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-signin-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--window-size=320,800',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2000));
 console.log('Renewal integration Chrome passed: account reads/writes use renewed bearer, preserve organization, and suppress requests after renewal failure.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
