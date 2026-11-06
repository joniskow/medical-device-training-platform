import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';

/** Called by the PostgreSQL fixture. HTTP, state transitions and GLB delivery are real; identity is a test principal. */
export async function checkDeveloperBrowser({upstream,organizationId,sessionId,expire}){
 const base=upstream;
 const profile=await mkdtemp(resolve(tmpdir(),'mdt-developer-'));
 const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket,id=0;const pending=new Map(),errors=[];
 const command=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});socket.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const waitFor=async expression=>{for(let i=0;i<400;i++){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,50));}throw Error(`Timed out: ${expression}; page=${await evaluate('document.body.innerText.slice(-1800)')}; errors=${JSON.stringify(errors)}`);};
 const click=async selector=>{await waitFor(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 const action=async label=>{await waitFor(`[...document.querySelectorAll('#controls button')].some(b=>b.textContent.startsWith(${JSON.stringify(label)})&&!b.disabled)`);await evaluate(`[...document.querySelectorAll('#controls button')].find(b=>b.textContent.startsWith(${JSON.stringify(label)})).click()`);};
 const step=title=>waitFor(`document.querySelector('#step-title')?.textContent===${JSON.stringify(title)}&&!document.querySelector('#select-component').disabled`);
 try{
  let port;for(let i=0;i<150;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(done=>setTimeout(done,100));}}assert(port,'Chrome did not start');
  const page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');socket=new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage=event=>{const message=JSON.parse(String(event.data)),waiting=pending.get(message.id);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(waiting){pending.delete(message.id);message.error?waiting.fail(Error(message.error.message)):waiting.ok(message.result);}};
  await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});await command('Runtime.enable');await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('mdt.auth.access-token','learner');sessionStorage.setItem('mdt.auth.organization-id',${JSON.stringify(organizationId)});
   window.__requests=[];window.__responses=[];const actualFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const req=new Request(...args),recorded=req.clone();const response=await actualFetch(req);if(req.url.includes('/actions')){window.__requests.push(await recorded.json());if(window.__loseResponse){window.__loseResponse=false;throw new TypeError('Injected lost response after commit');}}if(response.headers.get('content-type')?.includes('json'))window.__responses.push({url:req.url,body:await response.clone().json()});return response;};`});
  await command('Page.navigate',{url:base+'/developer/starter'});
  await waitFor('document.querySelector("#course-list button")');await click('#select-organization');await click('#course-list button');await waitFor('document.querySelector("#activities button")');await click('#activities button');
  await step('Identify the cycler handle');await waitFor('/3D model ready/.test(document.querySelector("#viewer-status").textContent)');
  assert.match(await evaluate('document.querySelector("#briefing").textContent'),/No credential is issued/);
  // Keyboard activation exercises the equivalent input path without a canvas dependency.
  await command('Page.bringToFront');await evaluate('document.querySelector("#select-component").focus()');assert.equal(await evaluate('document.activeElement.id'),'select-component');await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await step('Identify the upper cycler door');
  await evaluate('window.__loseResponse=true');await click('#hint');await waitFor('!document.querySelector("#retry").hidden&&!document.querySelector("#retry").disabled');assert.equal(await evaluate('document.querySelector("#select-component").disabled'),true);
  await click('#retry');await waitFor('document.querySelector("#retry").hidden&&!document.querySelector("#hint").disabled');assert.equal(await evaluate('window.__requests.at(-1).clientActionId===window.__requests.at(-2).clientActionId'),true);
  const firstHint=await evaluate('document.querySelector("#feedback").textContent');await click('#hint');await waitFor(`document.querySelector('#feedback').textContent!==${JSON.stringify(firstHint)}&&!document.querySelector('#hint').disabled`);
  await action('Open');await waitFor('/Lift the cycler door handle/i.test(document.querySelector("#feedback").textContent)&&!document.querySelector("#select-component").disabled');
  await click('#select-component');await step('Raise the cycler handle');await action('Lift');await step('Open the upper cycler door');await action('Open');await step('Inspect the modeled opening');
  await evaluate('document.querySelector("#components").value="nxstage-cycler-handle";document.querySelector("#components").dispatchEvent(new Event("change"))');await action('Lower');await waitFor('/Close the cycler door/i.test(document.querySelector("#feedback").textContent)&&!document.querySelector("#inspect").disabled');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await command('Emulation.setTouchEmulationEnabled',{enabled:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Mobile starter overflows');
  const beforeFocus=await evaluate('window.__requests.length');await click('#focus');await click('#reset-view');assert.equal(await evaluate('window.__requests.length'),beforeFocus,'Camera controls must not submit a training action');
  await mkdir('output/developer-kit/evidence',{recursive:true});
  await evaluate('document.querySelector("#training-canvas").scrollIntoView({block:"start"})');
  await writeFile('output/developer-kit/evidence/mobile-opening.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('#inspect');await step('Return the upper door to its closed position');await action('Close');await step('Return the handle to its starting position');await action('Lower');await waitFor('!document.querySelector("#debrief").hidden&&document.querySelector("#step-title").textContent==="Exercise complete"');
  assert.match(await evaluate('document.querySelector("#debrief-summary").textContent'),/COMPLETED. 2 hints used; 2 rejected task attempts/);assert.equal(await evaluate('document.querySelectorAll("#debrief-steps li").length'),7);
  await click('#resume');assert.equal(await evaluate('document.querySelector("#select-component").disabled'),true);
  await expire();await click('#resume');await waitFor('window.__responses.some(r=>r.body?.status==="expired_session")');assert.equal(await evaluate('document.querySelector("#select-component").disabled'),true);await click('#debrief-button');
  // Exercise the standalone facade independently of starter DOM, using the actual returned asset/state.
  await evaluate(`(async()=>{const {mountTrainingViewer}=await import('/developer/training-viewer.js');const asset=window.__responses.find(r=>r.body?.fallbackManifest).body;const launch=window.__responses.find(r=>r.body?.sessionId===${JSON.stringify(sessionId)}&&r.body.state).body;const bytes=new Uint8Array(await(await fetch(asset.modelUrl,{headers:{authorization:'Bearer learner','x-organization-id':${JSON.stringify(organizationId)}}})).arrayBuffer());const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;document.body.append(canvas);const viewer=mountTrainingViewer({canvas,onAction:()=>{}});const input={manifest:asset.fallbackManifest,modelBytes:bytes,state:launch.state};const a=viewer.load(input),b=viewer.load(input);const settled=await Promise.allSettled([a,b]);if(settled[0].status!=='rejected'||settled[1].status!=='fulfilled')throw Error('Superseded viewer load was not fenced');viewer.resetView();viewer.applyState(launch.state);viewer.focusComponent(asset.fallbackManifest.components.at(-1).componentId);viewer.dispose();viewer.dispose();let refused=false;try{await viewer.load(input);}catch{refused=true;}if(!refused)throw Error('Disposed viewer loaded');canvas.remove();})()`);
  await click('#signout');assert.equal(await evaluate('document.querySelector("#activity").hidden&&document.querySelector("#debrief").hidden&&!document.querySelector("#course-list").textContent'),true);
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile('output/developer-kit/evidence/browser.json',JSON.stringify({kind:'local-chromium-regression',identity:'synthetic test principal; Microsoft login not exercised',database:'PostgreSQL fixture',model:'real release-bound NxStage GLB',passed:true,physicalDeviceAcceptance:false,checks:['same-origin hosted routes','organization selection','enrollment launch','keyboard actions','seven steps','lost response stable retry','progressive hints','two mechanical mistakes','private bytes','debrief','expiry','mobile layout','viewer supersession/disposal','sign-out cleanup']},null,2)+'\n');
  console.log('Developer starter Chromium passed: real PostgreSQL/API/GLB on the hosted route layout, full familiarization, retry, debrief, keyboard/mobile, expiry, independent viewer lifecycle and sign-out.');
 }finally{socket?.close();chrome.kill();}
}
