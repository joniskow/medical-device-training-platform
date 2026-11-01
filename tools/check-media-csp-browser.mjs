import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {readBrowserAuthConfig} from '../apps/api/dist/browser-auth-config.js';
const root=await mkdtemp(join(tmpdir(),'mdt-media-csp-'));
await writeFile(join(root,'learner.html'),'<!doctype html><html><body><script type="module" src="/learner/learner.js"></script></body></html>');
await writeFile(join(root,'learner.js'),`
const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push({uri:e.blockedURI,directive:e.effectiveDirective}));
for(const tag of ['img','video'])for(const domain of ['fixture.blob.core.windows.net','blocked.invalid']){
 const node=document.createElement(tag);node.src='https://'+domain+'/policy-fixture';if(tag==='video')node.preload='auto';document.body.append(node);
}
setTimeout(()=>{
 const forbidden=violations.filter(v=>v.uri.startsWith('https://blocked.invalid'));
 const allowed=violations.filter(v=>v.uri.startsWith('https://fixture.blob.core.windows.net'));
 document.body.dataset.testResult=forbidden.some(v=>v.directive==='img-src')&&forbidden.some(v=>v.directive==='media-src')&&!allowed.length?'PASS':JSON.stringify(violations);
 for(const media of document.querySelectorAll('img,video'))media.removeAttribute('src');
},250);
`);
const config=readBrowserAuthConfig({BROWSER_AUTH_ENABLED:'true',BROWSER_AUTH_AUTHORITY:'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111',ENTRA_TENANT_ID:'11111111-1111-1111-1111-111111111111',BROWSER_AUTH_CLIENT_ID:'22222222-2222-2222-2222-222222222222',BROWSER_AUTH_API_SCOPE:'api://22222222-2222-2222-2222-222222222222/user_impersonation',APPLICATION_ORIGIN:'https://training.example'});
for(const configured of [false,true]){
 const server=createJobStatusHttpServer({staticRoot:root,browserAuthConfig:configured?config:undefined,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async()=>null}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/learner/courses`;
  const response=await fetch(url);assert.equal(response.status,200);
  const policy=response.headers.get('content-security-policy');
  assert(policy.includes("img-src 'self' https://*.blob.core.windows.net"));assert(policy.includes("media-src 'self' https://*.blob.core.windows.net"));assert(policy.includes("script-src 'self'"));
  const profile=await mkdtemp(join(tmpdir(),'mdt-csp-chrome-'));
  // Resolve probes locally so the test checks policy without contacting external storage.
  const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-proxy-server','--host-resolver-rules=MAP fixture.blob.core.windows.net 127.0.0.1,MAP blocked.invalid 127.0.0.1',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=2000',url],{windowsHide:true});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
  try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
  assert.match(output,/data-test-result="PASS"/,output.slice(-1800));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
console.log('Media CSP Chrome passed with managed auth on/off: Azure Blob image/video sources permitted, unrelated origins blocked, same-origin scripts retained. No media playback or network delivery claimed.');
