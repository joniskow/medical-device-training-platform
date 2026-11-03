import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const profile=await mkdtemp(resolve(tmpdir(),'nxstage-review-'));
const previewPort=Number(process.env.NXSTAGE_REVIEW_PORT||4215);
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,`http://127.0.0.1:${previewPort}/learner/model?preview=1&test=1`],{windowsHide:true,stdio:'ignore'});
let socket,id=0;const pending=new Map(),errors=[];
const command=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const waitFor=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error(`Timed out: ${expression}; status=${await evaluate('document.querySelector("#model-status")?.textContent')}; log=${await evaluate('document.querySelector("#action-log")?.textContent')}; fallback=${await evaluate('document.querySelector("#fallback")?.textContent')}; controls=${await evaluate('[...document.querySelectorAll("#action-controls button")].map(b=>b.textContent).join(" | ")')}; errors=${JSON.stringify(errors)}`);};
const findControl=async(label,area)=>{const rect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height}})()');for(let y=area.y0;y<=area.y1;y+=.02)for(let x=area.x0;x<=area.x1;x+=.02){const point={x:rect.x+x*rect.width,y:rect.y+y*rect.height};await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});const feedback=await evaluate('({text:document.querySelector("#model-status").textContent,cursor:document.querySelector("#model-canvas").style.cursor})');if(feedback.cursor==='pointer'&&(feedback.text.includes(`Over ${label}`)||feedback.text.includes(`Keyboard focus on ${label}`)))return point;}throw Error(`Could not find ${label} in the visible model`);};
try{
 let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert(port,'Chrome did not start');const page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');socket=new WebSocket(page.webSocketDebuggerUrl);socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await waitFor('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]"))');
 await waitFor('/READY|REDUCED_COMPLEXITY/.test(document.querySelector("#runtime-state").textContent)');
 assert(await evaluate('window.__reviewRearPanel()'),'The rear panel must be present');
 await new Promise(resolve=>setTimeout(resolve,400));
 await evaluate('document.querySelector("#focus-rear-switch").click()');
 await waitFor('window.__rearSwitchState && window.__rearSwitchState() === 0');
 await new Promise(resolve=>setTimeout(resolve,400));
 const point=await evaluate('window.__reviewTargetPoint("NX-C05-POWER-SWITCH")');assert(point);
 const offTilt=await evaluate('window.__rearSwitchTilt()');assert(Math.abs(offTilt)>.003, `The initial rocker should rest tilted: ${offTilt}`);
 const center=()=>evaluate('window.__reviewTargetPoint("NX-C05-POWER-SWITCH")');
 await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:42}]});
 await waitFor('/Holding Cycler rear power switch/.test(document.querySelector("#model-status").textContent)');
 await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(await evaluate('window.__rearSwitchState()'),0,'A cancelled touch must not change the rocker');
 const tapStart=await center();
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...tapStart,id:43}]});
 await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tapStart.x+8,y:tapStart.y,id:43}]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await waitFor('Math.abs(window.__rearSwitchState()+.24)<1e-5');
 await new Promise(resolve=>setTimeout(resolve,450));
 const onTilt=await evaluate('window.__rearSwitchTilt()');assert(offTilt*onTilt<0, `The two rocker positions should tilt in opposite directions: ${offTilt}, ${onTilt}`);
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Set off Cycler rear power switch")');
 await new Promise(resolve=>setTimeout(resolve,450));
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...await center(),id:44}]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await waitFor('window.__rearSwitchState() === 0');
 await command('Emulation.setTouchEmulationEnabled',{enabled:false});
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Set on Cycler rear power switch")');
 await evaluate('[...document.querySelectorAll("#action-controls button")].find(b=>b.textContent==="Set on Cycler rear power switch").focus()');
 await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
 await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await waitFor('Math.abs(window.__rearSwitchState()+.24)<1e-5');
 await evaluate('window.__restoreRearSwitch(0, 1000)');
 const restoredOff=await evaluate('window.__rearSwitchTilt()');
 await evaluate('window.__restoreRearSwitch(-.24, 1001)');
 const restoredOn=await evaluate('window.__rearSwitchTilt()');
 assert(restoredOff*restoredOn<0, `Restoring state must preserve the physical hinge orientation: ${restoredOff}, ${restoredOn}`);
 await evaluate('document.querySelector("#focus-panel").click()');
 await new Promise(resolve=>setTimeout(resolve,400));
 const frontPoint=await evaluate('window.__reviewTargetPoint("NX-C01-ADD-FLUID")');
 const frontHits=await evaluate(`window.__reviewHits(${frontPoint.x},${frontPoint.y})`);
 assert.equal(frontHits[0]?.target,'NX-C01-ADD-FLUID',`Focusing the front panel from the rear must expose its controls: ${JSON.stringify(frontHits)}`);
 await evaluate('window.__reviewRearPanel();document.querySelector("#focus-warmer").click()');
 await new Promise(resolve=>setTimeout(resolve,400));
 const warmerPoint=await evaluate('window.__reviewTargetPoint("FW-C01-UP")');
 const warmerHits=await evaluate(`window.__reviewHits(${warmerPoint.x},${warmerPoint.y})`);
 assert.equal(warmerHits[0]?.target,'FW-C01-UP',`Focusing the warmer from the rear must expose its controls: ${JSON.stringify(warmerHits)}`);
 if(process.env.NXSTAGE_REAR_PANEL_SCREENSHOT){
  assert(await evaluate('window.__reviewRearPanel()'),'The rear panel must be present');
  await new Promise(resolve=>setTimeout(resolve,400));
  const rear=await command('Page.captureScreenshot',{format:'png'});
  await writeFile(process.env.NXSTAGE_REAR_PANEL_SCREENSHOT,Buffer.from(rear.data,'base64'));
 }
 if(process.env.NXSTAGE_REAR_ACCESSORY_SCREENSHOT){
  assert(await evaluate('window.__reviewRearAccessory()'),'The rear canister must be present');
  await new Promise(resolve=>setTimeout(resolve,400));
  const rear=await command('Page.captureScreenshot',{format:'png'});
  await writeFile(process.env.NXSTAGE_REAR_ACCESSORY_SCREENSHOT,Buffer.from(rear.data,'base64'));
 }
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('Rear rocker: cancelled touch, touch wobble, touch on/off, keyboard activation and restored hinge positions passed.');
}finally{socket?.close();browser.kill();if(browser.exitCode===null)await new Promise(r=>browser.once('close',r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
