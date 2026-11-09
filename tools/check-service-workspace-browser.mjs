import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {build} from '../apps/web/node_modules/esbuild/lib/main.js';
const bundle=await build({stdin:{contents:`import {createServiceWorkspace} from './apps/web/src/service-workspace.ts';globalThis.createServiceWorkspace=createServiceWorkspace;`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const issues=[];let writes=0;
const contract=JSON.parse(await readFile(process.env.ADMIN_SERVICE_CONTRACT??'packages/api-client/openapi.json','utf8'));
const exercise=String.raw`
const host=document.getElementById('host'),controller=new AbortController();let events=[];
const response=async(path,init)=>{events.push([path,init]);const response=await fetch(path,{...init,headers:{...init?.headers,'content-type':'application/json'}});if(!response.ok)throw Error((await response.json()).error.message);return response;};
const services={response,api:async(path,init)=>await(await response(path,init)).json(),signal:controller.signal,organizationId:()=> 'org:test'};
const workspace=createServiceWorkspace(host,services);workspace.setEnabled(true);
const q=id=>document.getElementById(id),pause=()=>new Promise(r=>setTimeout(r,30)),check=(v,m)=>{if(!v)throw Error(m);};
const wait=async(test,label)=>{for(let i=0;i<200;i++){if(test())return;await pause();}throw Error(label+': '+q('services-status').textContent);};
const choose=(area,path)=>{q('service-area').value=area;q('service-area').dispatchEvent(new Event('change'));q('service-action').value=path;check(q('service-action').value===path,'Missing action '+path);q('service-action').dispatchEvent(new Event('change'));};
const field=name=>host.querySelector('[data-field="'+name+'"]');
const apply=()=>{const review=q('service-execute').nextElementSibling;check(!review.hidden,'Review missing');const consent=review.querySelector('input[type=checkbox]');consent.checked=true;consent.dispatchEvent(new Event('change'));[...review.querySelectorAll('button')].find(b=>b.textContent==='Apply changes').click();};
const submit=()=>q('service-execute').closest('form').requestSubmit();
try{
 await wait(()=>q('service-area').options.length>0,'Catalogue');let actionCount=0;
 for(const area of [...q('service-area').options].map(o=>o.value)){q('service-area').value=area;q('service-area').dispatchEvent(new Event('change'));for(const action of [...q('service-action').options].map(o=>o.value)){q('service-action').value=action;q('service-action').dispatchEvent(new Event('change'));actionCount++;}}
 check(actionCount>50,'Incomplete catalogue');check(!q('service-action').textContent.includes('Machine integration'),'Machine endpoint offered to human identity');
 choose('Reports & exports','POST /api/v1/exports');submit();check(events.length===0,'Write before confirmation');check(q('service-execute').nextElementSibling.querySelector('button').disabled,'Apply enabled without confirmation');apply();
 await wait(()=>q('service-result').textContent.includes('SUCCEEDED'),'Export');[...q('service-result').querySelectorAll('button')].find(b=>b.textContent==='Download private result').click();await wait(()=>q('service-result').querySelector('a[download]'),'JSON download');check((await(await fetch(q('service-result').querySelector('a').href)).json()).summary.courses===2,'Downloaded JSON incorrect');
 choose('Account & preferences','POST /api/v1/personal/notification-preferences');check(!field('enabled').checked&&field('revision').value==='0','Unsafe consent defaults');submit();apply();await wait(()=>field('revision').value==='1','Returned notification revision');
 choose('Connections & automation','PUT /api/v1/webhooks/{subscriptionId}');field('subscriptionId').value='subscription:test';[...host.querySelectorAll('button')].find(b=>b.textContent==='Load saved settings').click();await wait(()=>field('revision').value==='4','Load existing connection');check(field('endpoint').value==='https://example.test/events','Saved endpoint missing');check(field('enabled').checked,'Saved enabled flag not loaded');submit();check(host.querySelector('form').checkValidity(),'Valid HTTPS URL rejected');apply();await wait(()=>q('service-result').querySelector('input[type=password]'),'Masked secret');check(q('service-result').querySelector('input').value==='engineering-secret','Secret result missing');check(field('revision').value==='5','Returned revision not loaded');
 choose('Reports & exports','GET /api/v1/reports/usage');submit();await wait(()=>q('services-status').textContent.includes('Usage dependency unavailable'),'503 message');
 workspace.dispose();check(!host.textContent,'Disposed private content remained');controller.abort();document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult=error.stack;}
`;
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/admin'){res.setHeader('content-type','text/html');res.end('<!doctype html><div id="host"></div><script type="module" src="/bundle.js"></script><script type="module" src="/exercise.js"></script>');return;}
 if(path==='/bundle.js'||path==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(path==='/bundle.js'?bundle.outputFiles[0].text:exercise);return;}
 if(path==='/api/v1/openapi.json'){json(contract);return;}if(path==='/favicon.ico'){res.writeHead(204).end();return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);const body=raw.length?JSON.parse(raw):{};
 if(req.method!=='GET'){writes++;assert(req.headers['idempotency-key']);}
 if(path==='/api/v1/exports'){assert.deepEqual(body,{kind:'summary',format:'json'});json({exportId:'export:test',state:'SUCCEEDED'});return;}
 if(path==='/api/v1/exports/export%3Atest/content'){json({summary:{courses:2}});return;}
 if(path==='/api/v1/personal/notification-preferences'){assert.deepEqual(body,{enabled:false,revision:0});json({enabled:false,revision:1});return;}
 if(path==='/api/v1/webhooks'&&req.method==='GET'){json({items:[{subscriptionId:'subscription:test',endpoint:'https://example.test/events',keyId:'key:test',eventTypes:['credential.issued'],enabled:true,revision:4}]});return;}
 if(path==='/api/v1/webhooks/subscription%3Atest'){assert.equal(body.revision,4);assert.equal(body.endpoint,'https://example.test/events');assert.deepEqual(body.eventTypes,['credential.issued']);json({subscriptionId:'subscription:test',revision:5,signingSecret:'engineering-secret'});return;}
 if(path==='/api/v1/reports/usage'){json({error:{message:'Usage dependency unavailable'}},503);return;}
 issues.push(req.method+' '+path);json({error:{message:'Unexpected test request'}},404);
 }catch(error){issues.push(error.stack);res.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'admin-workspace-chrome-'));
const child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/admin`],{windowsHide:true,stdio:'ignore'});
let socket;const pending=new Map();let nextId=0;
const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
try{
 let port;for(let attempt=0;attempt<100;attempt++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert(port,'Chrome did not start');const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
 const browserErrors=[];socket.onmessage=event=>{const message=JSON.parse(String(event.data)),waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(Error(message.error.message)):waiter.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')browserErrors.push(message.params.exceptionDetails.text);};
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});await command('Runtime.enable');
 let result;for(let attempt=0;attempt<400;attempt++){result=(await command('Runtime.evaluate',{expression:'document.body?.dataset.testResult',returnByValue:true})).result.value;if(result)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result,'PASS');assert.deepEqual(issues,[]);assert.deepEqual(browserErrors,[]);assert.equal(writes,3);console.log('PASS: every catalogue action renders; controlled export download, explicit confirmation, notification revisions, saved connection settings, masked secrets, error handling and disposal.');
}finally{socket?.close();for(const waiter of pending.values())clearTimeout(waiter.timer);child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
