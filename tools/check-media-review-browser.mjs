import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../apps/web/package.json',import.meta.url))('esbuild');
const report=JSON.parse(await readFile('output/media-review/inspection.json','utf8'));
const detail={fileName:'Synthetic orbit <img src=x>',sourceType:'video',state:'READY_FOR_REVIEW',sourceHash:report.sourceSha256,contentType:'video/mp4',contentUrl:'/api/v1/media-review/video/content',width:report.width,height:report.height,durationSeconds:report.durationSeconds,frames:report.frames.map(frame=>({index:frame.index,timestampSeconds:frame.timestampSeconds,contentUrl:`/api/v1/media-review/video/frames?index=${frame.index}`})),duplicateFrameCount:0};
let frameFailure=false,deferFrame=false,releaseFrame,decisions=0,unauthorized=0;
const source=`import {createMediaReview} from './src/media-review.ts';import {authenticatedFetch,clearAccessToken} from './src/auth-session.ts';
sessionStorage.setItem('mdt.auth.access-token','synthetic-test-token');sessionStorage.setItem('mdt.auth.organization-id','org');
const original=URL.revokeObjectURL;window.revoked=[];URL.revokeObjectURL=url=>{window.revoked.push(url);original.call(URL,url);};
window.signOut=clearAccessToken;
createMediaReview(document.querySelector('main'),async(path,init)=>{const r=await authenticatedFetch(path,init);if(!r.ok)throw Error('Denied');return r.json();});window.ready=true;`;
const built=await build({stdin:{contents:source,resolveDir:resolve('apps/web'),sourcefile:'media-check.ts'},bundle:true,format:'esm',platform:'browser',write:false});
const style=(await readFile('apps/web/src/index.html','utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local');
 if(url.pathname.startsWith('/api/')){
  if(req.headers.authorization!=='Bearer synthetic-test-token'){unauthorized++;res.writeHead(401).end();return;}
  res.setHeader('cache-control','no-store');
  if(url.pathname==='/api/v1/media-review/video/content'){res.setHeader('content-type','video/mp4');res.end(await readFile('output/media-review/source.mp4'));return;}
  if(url.pathname.endsWith('/frames')){if(frameFailure){res.writeHead(503).end();return;}if(deferFrame){await new Promise(r=>releaseFrame=r);}res.setHeader('content-type','image/png');res.end(await readFile(`output/media-review/frame-${Number(url.searchParams.get('index'))}.png`));return;}
  if(url.pathname.endsWith('/review')){let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);assert.equal(input.sourceHash,report.sourceSha256);assert.equal(input.confirmed,true);assert.equal(input.decision,'APPROVE');assert(req.headers['idempotency-key']);decisions++;res.setHeader('content-type','application/json');res.end(JSON.stringify({state:'APPROVED'}));return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(url.pathname.endsWith('/video')?detail:{items:[{assetVersionId:'video',fileName:detail.fileName,state:detail.state}]}));return;
 }
 if(url.pathname==='/app.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].contents);return;}
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Media review</title><style>${style}main{display:block;max-width:1100px;margin:auto;padding:20px}button{margin:4px}img{height:auto}</style><main><h1>Media review</h1></main><script type="module" src="/app.js"></script></html>`);
 }catch(error){res.writeHead(500).end(String(error));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile=await mkdtemp(resolve(tmpdir(),'media-review-'));
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1100,1000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true,stdio:'ignore'});
let socket,id=0;const pending=new Map(),errors=[];
function command(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}assert.fail('Timed out: '+expression+' '+await evaluate('document.body.innerText'));}
const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Button missing');b.click();return true;})()`);
try{
 let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(port);
 const page=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');socket=new WebSocket(page.webSocketDebuggerUrl);socket.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});await command('Runtime.enable');await until('window.ready');
 await click('Show uploaded media');await until("document.body.innerText.includes('Review Synthetic orbit')");await click('Review '+detail.fileName+' — ready for review');await until("document.body.innerText.includes('Load sampled views')");
 assert.equal(await evaluate('document.querySelectorAll("fieldset,img").length'),0);assert.equal(decisions,0);
 frameFailure=true;await click('Load sampled views');await until("document.body.innerText.includes('Some sampled views could not')");frameFailure=false;await click('Load sampled views');await until('document.querySelectorAll("figure img").length===24&&[...document.querySelectorAll("figure img")].every(i=>i.complete&&i.naturalWidth>0)');
 assert.equal(await evaluate('document.querySelectorAll("fieldset").length'),0,'Sampled frames alone do not unlock a review decision');
 await click('Load private media preview');await until('document.querySelector("video")?.readyState>=1&&Boolean(document.querySelector("fieldset"))');
 const frame=detail.frames[12];await click(`View at ${frame.timestampSeconds.toFixed(2)} s`);await until(`Math.abs(document.querySelector('video').currentTime-${frame.timestampSeconds})<.05`);
 assert.equal(await evaluate('document.querySelectorAll("main > img").length'),0,'Filename markup stays inert');
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:1200,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await command('Emulation.setDeviceMetricsOverride',{width:1100,height:1600,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,100));const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile('output/media-review/gallery.png',Buffer.from(screenshot.data,'base64'));
 await click('Approve source');assert.equal(decisions,0);await evaluate("document.querySelector('textarea').value='Reviewed the full synthetic test clip and sampled views.';document.querySelector('input[type=checkbox]').checked=true;true");await click('Approve source');await until("document.body.innerText.includes('Decision saved')");assert.equal(decisions,1);
 await click('Close media review');assert.equal(await evaluate('document.querySelectorAll("figure,video,fieldset").length'),0);assert.equal(await evaluate('window.revoked.length'),25);
 await click('Review '+detail.fileName+' — ready for review');await until("document.body.innerText.includes('Load sampled views')");deferFrame=true;await click('Load sampled views');for(let i=0;i<100&&!releaseFrame;i++)await new Promise(r=>setTimeout(r,20));assert(releaseFrame);await click('Close media review');deferFrame=false;releaseFrame();await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('document.querySelectorAll("figure").length'),0);
 await evaluate('window.signOut();true');await until("document.body.innerText.includes('Sign in and reload media')");assert.equal(unauthorized,0);assert.equal(errors.length,0);console.log('Media review Chrome passed: real 24-frame/video decoding, timestamp seeking, private fetches, retry, inert filename, responsive gallery, explicit decision, URL cleanup and late-response/sign-out fencing.');
}finally{releaseFrame?.();socket?.close();browser.kill();if(browser.exitCode===null)await new Promise(r=>browser.once('close',r));server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
