import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../apps/web/package.json',import.meta.url))('esbuild');
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function targetUrl(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error("E4_CDP_TARGET_TIMEOUT");
}

class DevTools {
  id = 0;
  pending = new Map();
  socket;
  constructor(url) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if(message.method==='Runtime.exceptionThrown') console.error(JSON.stringify(message.params));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    };
  }
  async open() { await new Promise((resolveOpen, rejectOpen) => { this.socket.addEventListener("open", resolveOpen, { once: true }); this.socket.addEventListener("error", rejectOpen, { once: true }); }); }
  command(method, params = {}) { const id = ++this.id; return new Promise((resolveCommand, rejectCommand) => { this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return result.result?.value; }
  close() { this.socket.close(); }
}

const manifest=JSON.parse(await readFile('apps/web/dist/model-manifest.json','utf8'));
const bundled=await build({entryPoints:['apps/web/dist/learner-exploration.js'],bundle:true,external:['./author-model-runtime.js'],format:'esm',platform:'browser',write:false});
let forbiddenRequests=0;
const harness=`
import {renderLearnerExploration} from '/preview.js';
const manifest=${JSON.stringify(manifest)};window.__created=0;window.__disposed=0;window.__acks=0;window.__active=true;
window.__inspection={releaseId:'release:test',modelVersionId:manifest.modelVersionId,exploration:{overview:'<img src=x> Inspect the controller',hotspots:[{componentId:'AIC-C02',title:'Safety cover',text:'Open only after reviewing the instructions.'},{componentId:'AIC-C03',title:'Line sensor',text:'Check the sensor position.'}]}};
window.__assets={releaseId:'release:test',modelVersionId:manifest.modelVersionId,releaseBindingId:manifest.releaseBindingId,manifestHash:manifest.sourceHash,fallbackManifest:manifest,modelUrl:'/fixture.glb'};
window.__attach=()=>{const host=document.createElement('section');host.id='preview-host';document.querySelector('main').append(host);window.__dispose=renderLearnerExploration(host,'hotspot',false,{active:()=>window.__active,load:async()=>{if(window.__fail)throw Error('Fixture access denied');if(window.__defer)return new Promise(r=>window.__resolve=r);return window.__inspection;},assets:async()=>window.__assets,acknowledge:async()=>{window.__acks++;if(window.__acks===1)throw Error('Review interrupted');}});};window.__attach();`;
const server=httpServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://local');
  if(url.pathname.startsWith('/api/')){forbiddenRequests++;res.writeHead(500).end();return;}
  if(url.pathname==='/'){const style=(await readFile('apps/web/dist/learner.html','utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'</style></head><body><main><h1>Learner model inspection</h1></main><script type="module" src="/harness.js"></script></body></html>');return;}
  if(url.pathname==='/fixture.glb'){res.setHeader('content-type','model/gltf-binary');res.end(await readFile('apps/web/dist/model/aurora-infusion-controller.glb'));return;}
  res.setHeader('content-type','text/javascript');
  if(url.pathname==='/preview.js')res.end(bundled.outputFiles[0].text);
  else if(url.pathname==='/harness.js')res.end(harness);
  else if(url.pathname==='/real-runtime.js')res.end(await readFile('apps/web/dist/author-model-runtime.js'));
  else if(url.pathname==='/author-model-runtime.js')res.end("import {createBabylonModelRuntime as real} from '/real-runtime.js';export async function createBabylonModelRuntime(options){const runtime=await real(options);window.__created++;window.__runtime=runtime;const dispose=runtime.dispose;runtime.dispose=()=>{window.__disposed++;dispose();};return runtime;}");
  else res.writeHead(404).end();
 }catch(error){res.writeHead(500).end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const cdpPort=await freePort(),temp=await mkdtemp(resolve(tmpdir(),'author-model-'));
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-allow-origins=*',`--remote-debugging-port=${cdpPort}`,`--user-data-dir=${temp}`,'--window-size=900,850','about:blank'],{windowsHide:true,stdio:'ignore'});
let devtools;
try{
 devtools=new DevTools(await targetUrl(cdpPort));await devtools.open();await devtools.command('Runtime.enable');await devtools.command('Page.enable');await devtools.command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
 const until=async(expression)=>{for(let i=0;i<120;i++){if(await devtools.evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}assert.fail('Timed out: '+expression+'; '+await devtools.evaluate('document.body.innerText'));};
 const click=label=>devtools.evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)})?.click();return true;})()`);
 await until('Boolean(window.__dispose)');await click('Load inspection');await until("document.body.innerText.includes('Inspect Safety cover')");
 assert.equal(await devtools.evaluate('Boolean(document.querySelector("#preview-host img"))'),false);
 assert.equal(await devtools.evaluate('window.__acks'),0);assert.equal(await devtools.evaluate('window.__created'),0);
 await click('Inspect Safety cover');assert.equal(await devtools.evaluate("document.querySelector('[data-learner-exploration]').innerText.includes('Safety cover: Open only')"),true);
 await click('Load model in 3D');await until('window.__created===1');
 await click('Inspect Line sensor');assert.equal(await devtools.evaluate('window.__runtime.getState().selectedComponentId'),'AIC-C03');
 assert.equal(await devtools.evaluate('window.__runtime.getState().authoritative.scorePoints'),0);
 assert.equal(await devtools.evaluate('window.__acks'),0);
 await devtools.command('Emulation.setDeviceMetricsOverride',{width:768,height:1500,deviceScaleFactor:1,mobile:false});assert.equal(await devtools.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await mkdir('output',{recursive:true});await new Promise(r=>setTimeout(r,1000));const screenshot=await devtools.command('Page.captureScreenshot',{format:'png'});await writeFile('output/learner-model-inspection.png',Buffer.from(screenshot.data,'base64'));
 await click('Close 3D view');await until('window.__disposed===1');assert.equal(await devtools.evaluate('document.querySelector("canvas").hidden'),true);assert.equal(await devtools.evaluate("document.body.innerText.includes('Check the sensor position.')"),true);
 await click('Mark as reviewed');await until("document.body.innerText.includes('Review interrupted')");await click('Mark as reviewed');await until('window.__acks===2');
 await click('Load model in 3D');await until('window.__created===2');await devtools.evaluate('window.__active=false;window.__dispose();true');await until('window.__disposed===2');
 await devtools.evaluate("document.querySelector('#preview-host').remove();window.__active=true;window.__attach();window.__fail=true;true");await click('Load inspection');await until("document.body.innerText.includes('Fixture access denied')");assert.equal(await devtools.evaluate('window.__created'),2);
 await devtools.evaluate('window.__fail=false;window.__defer=true;true');await click('Load inspection');await until('Boolean(window.__resolve)');await devtools.evaluate("window.__active=false;window.__dispose();document.querySelector('#preview-host').remove();window.__resolve(window.__inspection);true");await new Promise(r=>setTimeout(r,200));assert.equal(await devtools.evaluate('window.__created'),2);
 assert.equal(forbiddenRequests,0);console.log('Learner inspection Chrome passed: actual GLB/Babylon, inert text, keyboard highlight, zero score, explicit review retry, close/disposal and denied/late response fencing; no simulation API requests.');
}finally{devtools?.close();browser.kill();if(browser.exitCode===null)await new Promise(r=>browser.once('close',r));await rm(temp,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));}


const apiServer=createJobStatusHttpServer({staticRoot:'apps/web/dist',statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async()=>null}});
await new Promise(r=>apiServer.listen(0,'127.0.0.1',r));
try{for(const route of ['/learner/author-model-runtime.js','/author/author-model-runtime.js']){const response=await fetch(`http://127.0.0.1:${apiServer.address().port}${route}`);assert.equal(response.status,200);assert(response.headers.get('content-type').includes('javascript'));assert((await response.text()).includes('createBabylonModelRuntime'));}}finally{apiServer.closeAllConnections();await new Promise(r=>apiServer.close(r));}
