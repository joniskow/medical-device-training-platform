import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';

const server = createJobStatusHttpServer({ staticRoot:'apps/web/dist', statusService:{get:async()=>null,retry:async()=>null}, authenticator:{authenticate:async()=>null} });
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(),'nxstage-native-preview-'));
const phoneScale = Number(process.env.NXSTAGE_DEVICE_SCALE || 1);
assert(Number.isFinite(phoneScale) && phoneScale > 0, 'The phone pixel ratio must be positive');
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${base}/learner/model?preview=1&model=nxstage-review`],{windowsHide:true,stdio:'ignore'});
let socket, id=0; const pending=new Map(), errors=[];
const command=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});socket.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const waitFor=async expression=>{for(let i=0;i<250;i++){if(await evaluate(expression))return;await new Promise(done=>setTimeout(done,50));}throw Error(`Timed out: ${expression}; status=${await evaluate('document.querySelector("#model-status")?.textContent')}; errors=${JSON.stringify(errors)}`);};
try {
 const [modelResponse,manifestResponse]=await Promise.all([fetch(`${base}/learner/model/nxstage-review.glb`),fetch(`${base}/learner/nxstage-review-manifest.json`)]);
 assert.equal(modelResponse.status,200); assert.equal(manifestResponse.status,200);
 const manifest=await manifestResponse.json(), digest=createHash('sha256').update(Buffer.from(await modelResponse.arrayBuffer())).digest('hex');
 assert.equal(digest,manifest.sourceHash); assert.equal(manifest.modelVersionId,'preview:nxstage-rear-outlet-depth-study-v1');
 let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(done=>setTimeout(done,100));}}
 assert(port,'Chrome did not start');
 const page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page');
 socket=new WebSocket(page.webSocketDebuggerUrl);socket.onmessage=event=>{const message=JSON.parse(String(event.data)),waiting=pending.get(message.id);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(waiting){pending.delete(message.id);message.error?waiting.fail(Error(message.error.message)):waiting.ok(message.result);}};
 await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});await command('Runtime.enable');
 await waitFor('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]")) && /READY|REDUCED_COMPLEXITY/.test(document.querySelector("#runtime-state").textContent)');
 await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await new Promise(done=>setTimeout(done,2000));
 await mkdir('output/nxstage-native-preview',{recursive:true});
 const screenshot=(await command('Page.captureScreenshot',{format:'png'})).data;
 await writeFile('output/nxstage-native-preview/native-preview.png',Buffer.from(screenshot,'base64'));
 const countVisible=async data=>evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(data)}),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const r=document.querySelector('#model-canvas').getBoundingClientRect(),sx=bitmap.width/innerWidth,sy=bitmap.height/innerHeight;const p=ctx.getImageData(Math.round(r.left*sx),Math.round(r.top*sy),Math.round(r.width*sx),Math.round(r.height*sy)).data;let n=0;for(let i=0;i<p.length;i+=64){if(Math.abs(p[i]-9)+Math.abs(p[i+1]-23)+Math.abs(p[i+2]-28)>30)n++;}return n})()`);
 const visiblePixels=await countVisible(screenshot);
 assert(visiblePixels>100,`The model canvas must contain visible rendered geometry, found ${visiblePixels} non-background samples`);
 await evaluate('document.querySelector("#reset-view").click()');
 await new Promise(done=>setTimeout(done,500));
 assert(await countVisible((await command('Page.captureScreenshot',{format:'png'})).data)>100,'Reset must keep the model visible');
 assert.match(await evaluate('document.querySelector("#title").textContent'),/NxStage.*visual review/i);
 assert.match(await evaluate('document.querySelector("#model-notice").textContent'),/cartridge chamber is simplified/i);
 assert.equal(await evaluate('document.querySelector("#score").parentElement.hidden'),true);
 await evaluate('document.querySelector("[data-component-id=nxstage-control-panel]").click()');
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Press Add Fluid")');
 await evaluate('[...document.querySelectorAll("#action-controls button")].find(b=>b.textContent==="Press Add Fluid").click()');
 await waitFor('/Add Fluid pressed/.test(document.querySelector("#model-status").textContent)');
 await evaluate('document.querySelector("[data-component-id=nxstage-cycler-handle]").click()');
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Lift Cycler door handle")');
 await evaluate('[...document.querySelectorAll("#action-controls button")].find(b=>b.textContent==="Lift Cycler door handle").click()');
 await waitFor('/Cycler door handle is raised/.test(document.querySelector("#model-status").textContent)');
 await evaluate(`localStorage.setItem('aurora-training-demo-v4',JSON.stringify({view:'creator',creatorStep:'model',sourceStage:'model',sourceKind:'photos',sourceFiles:['sample'],sourceFileName:'Sample',sourceProgress:100,demoSource:true,pipelinePhase:'APPROVED',candidateTriangles:502001,modules:[{title:'Orientation',type:'Reading',minutes:8,description:'Review',completed:false}]}))`);
 await command('Page.navigate',{url:`${base}/demo`});
 await waitFor('Boolean(document.querySelector("a[href*=nxstage-review]"))');
 assert.equal(await evaluate('document.querySelector("a[href*=nxstage-review]").textContent'),'Explore the interactive visual review');
 await evaluate('[...document.querySelectorAll("a")].find(a=>a.textContent==="View the updated model in the demo").click()');
 await waitFor('Boolean(document.querySelector("#demo-model-canvas")) && /Ready|reduced-complexity/i.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 assert.match(await evaluate('document.querySelector(".visual-review-notice").textContent'),/cartridge chamber is simplified/i);
 assert(await evaluate('Boolean(document.querySelector("[data-target-id=NX-C01-ADD-FLUID]"))'),'The corrected model must expose Add Fluid in the demo');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-target-id=NX-C01-FLOW]"))'),false,'The demo review must not expose the old false control');
 await evaluate(`(()=>{const state=JSON.parse(localStorage.getItem('aurora-training-demo-v4'));state.creatorStep='content';state.sourceStage='content';state.backgroundMode='LOCKED_INTERACTIVE';state.backgroundStatus='IDLE';state.backgroundPreviewUrl='';localStorage.setItem('aurora-training-demo-v4',JSON.stringify(state));})()`);
 await command('Page.navigate',{url:`${base}/demo?model=nxstage-review`});
 await waitFor('/Scene ready/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 assert.equal(await evaluate('document.querySelector(".training-scene").dataset.sceneManifest'),'/model/nxstage-review-scene.json');
 await waitFor('document.querySelector("#training-video")?.readyState >= 2');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#training-video")).opacity'),'1','The matched photo-backed video must be visible');
 assert.equal(await evaluate('document.querySelector(".focus-content-copy h3").textContent'),'Interactive visual review');
 assert.equal(await evaluate('Boolean(document.querySelector(".generated-video .video-controls, .generated-video .video-topline .mono"))'),false,'The review must not display a fabricated lesson duration or progress');
 assert.match(await evaluate('document.querySelector("#background-narration")?.value ?? document.querySelector("textarea[data-field=narrationText]")?.value ?? [...document.querySelectorAll("textarea")].map(e=>e.value).join(" ")'),/System One control panel/);
 await evaluate('document.querySelector(".training-scene").scrollIntoView({block:"center"})');
 await mkdir('output/nxstage-native-preview',{recursive:true});
 await writeFile('output/nxstage-native-preview/demo-review-scene.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate('document.querySelector("[data-action=toggle-scene-interaction]").click()');
 await waitFor('Boolean(document.querySelector("[data-target-id=NX-C01-ADD-FLUID]"))');
 assert.equal(await evaluate('document.querySelector("[data-action=toggle-review-explore]").hidden'),false);
 await evaluate('document.querySelector("[data-action=toggle-review-explore]").click()');
 assert.equal(await evaluate('document.querySelector(".training-scene").classList.contains("review-explore")'),true);
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#training-video")).visibility'),'hidden');
 assert.equal(await evaluate('document.querySelector(".scene-review-views").hidden'),false);
 await evaluate('document.querySelector(".scene-review-views").open=true;document.querySelector("[data-review-group=NX-C01-ADD-FLUID]").click()');
 await new Promise(done=>setTimeout(done,400));
 const sceneRect=await evaluate('(()=>{const r=document.querySelector("#demo-scene-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
 let sceneControl;
 for(const y of [.5,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8]){
  const point={x:sceneRect.x+x*sceneRect.width,y:sceneRect.y+y*sceneRect.height};
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  if((await evaluate('document.querySelector("#demo-model-status").textContent')).includes('Over Volume Toggle')){sceneControl=point;break;}
 }if(sceneControl)break;}
 assert(sceneControl,'The focused model control must be directly reachable in the demo');
 await command('Input.dispatchMouseEvent',{type:'mousePressed',...sceneControl,button:'left',buttons:1,clickCount:1});
 await command('Input.dispatchMouseEvent',{type:'mouseReleased',...sceneControl,button:'left',buttons:0,clickCount:1});
 await waitFor('/Volume Toggle pressed/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await evaluate('document.querySelector("[data-action=toggle-review-explore]").click()');
 assert.equal(await evaluate('document.querySelector(".training-scene").classList.contains("review-explore")'),false);
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#training-video")).visibility'),'visible');
 assert.equal(await evaluate('document.querySelector(".scene-review-views").hidden'),true);
 await evaluate('document.querySelector("[data-target-id=NX-C01-ADD-FLUID]").click()');
 await waitFor('/Add Fluid pressed/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await evaluate('document.querySelector("[data-target-id=FW-C01-UP]").click()');
 await waitFor('/Illustrative warmer bars: 1 of 9/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await evaluate('document.querySelector("[data-target-id=NX-C05-POWER-SWITCH]").click()');
 await waitFor('/Cycler rear power switch is in the on position \\(power not simulated\\)/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 // Exercise the demo's own exploration controls with phone-sized touch input.
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:phoneScale,mobile:true});
 await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await command('Page.navigate',{url:`${base}/demo?model=nxstage-review`});
 await waitFor('/Scene ready/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 assert.equal(await evaluate('window.devicePixelRatio'),phoneScale,'The demo must use the requested phone pixel density');
 const tapDemo=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,250)}})()`);assert(await evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`),`Touch target ${selector} is covered by ${p.hit}`);await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 if(await evaluate('document.querySelector("[data-action=toggle-review-explore]").hidden')){await tapDemo('[data-action=toggle-scene-interaction]');await waitFor('!document.querySelector("[data-action=toggle-review-explore]").hidden');}
 await tapDemo('[data-action=toggle-review-explore]');
 assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'The phone demo must not overflow horizontally');
 assert(await evaluate('document.querySelector(".training-scene").getBoundingClientRect().height >= 320'),'The phone exploration canvas must leave room to interact');
 await tapDemo('.scene-review-views summary');
 await waitFor('document.querySelector(".scene-review-views").open');
 await tapDemo('[data-review-group=NX-C01-ADD-FLUID]');
 await waitFor('/Showing left buttons/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await new Promise(done=>setTimeout(done,500));
 assert.equal(await evaluate('document.querySelector(".focus-card").scrollLeft'),0,'Focusing the model must not shift its surrounding card horizontally');
 assert(await evaluate('(()=>{const card=document.querySelector(".focus-card");return card.scrollWidth <= card.clientWidth + 1})()'),'Phone card content must fit inside the card');
 const phoneLayout=await evaluate(`(()=>{const rect=q=>{const r=document.querySelector(q).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}};return {canvas:rect('#demo-scene-canvas'),exit:rect('.scene-interact'),back:rect('.scene-explore'),status:rect('.scene-status')}})()`);
 assert(phoneLayout.exit.height>=44 && phoneLayout.back.height>=44,'Phone scene actions need touch-sized targets');
 assert(phoneLayout.exit.right<=phoneLayout.back.left,'Phone scene actions must not overlap');
 assert(phoneLayout.exit.bottom<=phoneLayout.canvas.top && phoneLayout.back.bottom<=phoneLayout.canvas.top && phoneLayout.canvas.bottom<=phoneLayout.status.top,'Phone scene actions and status must not cover the model');
 await writeFile('output/nxstage-native-preview/mobile-demo-explore.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const phoneSceneRect=await evaluate('(()=>{const r=document.querySelector("#demo-scene-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
 let phoneSceneControl;
 for(const y of [.5,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8]){
  const point={x:phoneSceneRect.x+x*phoneSceneRect.width,y:phoneSceneRect.y+y*phoneSceneRect.height};
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  if((await evaluate('document.querySelector("#demo-model-status").textContent')).includes('Over Volume Toggle')){phoneSceneControl=point;break;}
 }if(phoneSceneControl)break;}
 assert(phoneSceneControl,`The focused phone demo must expose the Volume Toggle: ${JSON.stringify(await evaluate('(()=>{const s=q=>{const e=document.querySelector(q),r=e.getBoundingClientRect();return {x:r.x,width:r.width,scrollWidth:e.scrollWidth,scrollLeft:e.scrollLeft}};return {scene:s(".training-scene"),card:s(".focus-card"),content:s(".focus-content"),group:s("[data-review-group=NX-C01-ADD-FLUID]"),open:document.querySelector(".scene-review-views").open,status:document.querySelector("#demo-model-status").textContent}})()'))}`);
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[phoneSceneControl]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await waitFor('/Volume Toggle pressed/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 // Pinching during a press must cancel it, then leave the scene's own UI usable.
 await evaluate(`window.__demoPressCount=0;window.__demoPressObserver=new MutationObserver(()=>{if(/Volume Toggle pressed/.test(document.querySelector('#demo-model-status').textContent))window.__demoPressCount++});window.__demoPressObserver.observe(document.querySelector('#demo-model-status'),{childList:true,characterData:true,subtree:true})`);
 const secondDemoTouch={x:phoneSceneRect.x+10,y:phoneSceneRect.y+10};
 const movedDemoTouch={x:phoneSceneControl.x+(secondDemoTouch.x-phoneSceneControl.x)*.2,y:phoneSceneControl.y+(secondDemoTouch.y-phoneSceneControl.y)*.2};
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...phoneSceneControl,id:61}]});
 await waitFor('/Holding Volume Toggle/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...phoneSceneControl,id:61},{...secondDemoTouch,id:62}]});
 await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...movedDemoTouch,id:61},{...secondDemoTouch,id:62}]});
 await waitFor('/Zooming.*Volume Toggle was not pressed/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{...secondDemoTouch,id:62}]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await evaluate('window.__demoPressCount'),0,'A pinch must not activate the held demo control');
 await evaluate('window.__demoPressObserver.disconnect()');
 const touchDemoPart=async (component,label,result)=>{
  await tapDemo(`[data-review-component=${component}]`);
  await waitFor('(document.querySelector("#demo-model-status")?.textContent ?? "").startsWith("Showing ")');
  await new Promise(done=>setTimeout(done,500));
  const r=await evaluate('(()=>{const r=document.querySelector("#demo-scene-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  let target;
  for(const y of [.5,.47,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8,.1,.9]){
   const p={x:r.x+x*r.width,y:r.y+y*r.height};
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
   if((await evaluate('document.querySelector("#demo-model-status").textContent')).includes(`Over ${label} ·`)){target=p;break;}
  }if(target)break;}
  if(!target) await writeFile('output/nxstage-native-preview/mobile-demo-unreachable.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert(target,`${label} must be reachable in the phone demo; status: ${await evaluate('document.querySelector("#demo-model-status").textContent')}`);
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor(`(document.querySelector("#demo-model-status")?.textContent ?? "").includes(${JSON.stringify(result)})`);
 };
 await tapDemo('[data-review-component=pureflow-tub]');
 await waitFor('/Open the cabinet door fully to see the PureFlow tub/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await touchDemoPart('nxstage-cycler-handle','Cycler door handle','Cycler door handle is raised');
 await touchDemoPart('nxstage-cycler-door','Upper cycler door','Upper cycler door is open');
 await touchDemoPart('nxstage-cabinet-door','Lower cabinet door','Lower cabinet door is open');
 await touchDemoPart('pureflow-tub','PureFlow tub','PureFlow tub is pulled out');
 await tapDemo('[data-action=toggle-review-explore]');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#training-video")).visibility'),'visible','Returning on a phone must restore the room');
 // Switching out of interaction and back should preserve positions and interlocks.
 await tapDemo('[data-action=toggle-scene-interaction]');
 await waitFor('document.querySelector("[data-action=toggle-review-explore]").hidden');
 await tapDemo('[data-action=toggle-scene-interaction]');
 await waitFor('!document.querySelector("[data-action=toggle-review-explore]").hidden');
 await tapDemo('[data-action=toggle-review-explore]');
 await tapDemo('.scene-review-views summary');
 await waitFor('document.querySelector(".scene-review-views").open');
 await touchDemoPart('nxstage-cabinet-door','Lower cabinet door','Push the tub in before closing the cabinet door');
 await touchDemoPart('pureflow-tub','PureFlow tub','PureFlow tub is pushed in');
 await touchDemoPart('nxstage-cabinet-door','Lower cabinet door','Lower cabinet door is closed');
 await touchDemoPart('nxstage-cycler-door','Upper cycler door','Upper cycler door is closed');
 await touchDemoPart('nxstage-cycler-handle','Cycler door handle','Cycler door handle is lowered');
 await command('Emulation.setTouchEmulationEnabled',{enabled:false});
 await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{const state=JSON.parse(localStorage.getItem('aurora-training-demo-v4'));state.creatorStep='content';state.sourceStage='content';state.narrationText='Custom narration stays intact.';localStorage.setItem('aurora-training-demo-v4',JSON.stringify(state));})()`);
 await command('Page.navigate',{url:`${base}/demo?model=nxstage-review`});
 await waitFor('Boolean(document.querySelector("#narration-text"))');
 assert.equal(await evaluate('document.querySelector("#narration-text").value'),'Custom narration stays intact.');
 await evaluate(`(()=>{const state=JSON.parse(localStorage.getItem('aurora-training-demo-v4'));state.creatorStep='publish';localStorage.setItem('aurora-training-demo-v4',JSON.stringify(state));})()`);
 await command('Page.navigate',{url:`${base}/demo?model=nxstage-review`});
 await waitFor('document.querySelector(".focus-empty")?.textContent.includes("Visual review only")');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-action=publish]"))'),false,'The visual review must not appear publishable');
 await evaluate(`(()=>{const state=JSON.parse(localStorage.getItem('aurora-training-demo-v4'));state.creatorStep='content';state.sourceStage='content';state.backgroundMode='CINEMATIC';state.backgroundPreviewUrl='';localStorage.setItem('aurora-training-demo-v4',JSON.stringify(state));})()`);
 await command('Page.navigate',{url:`${base}/demo?model=nxstage-review`});
 await waitFor('/Cinematic composite ready/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 assert.equal(await evaluate('document.querySelector(".training-scene").dataset.sceneManifest'),'/model/nxstage-cinematic-scene-manifest.json','The cinematic demo must keep its original scene');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-action=toggle-scene-interaction]"))'),false,'The baked cinematic scene must remain non-interactive');
 await command('Page.navigate',{url:`${base}/learner/model?preview=1&model=nxstage-review`});
 await waitFor('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]"))');
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:phoneScale,mobile:true});
 await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await command('Page.navigate',{url:`${base}/learner/model?preview=1&model=nxstage-review`});
 await waitFor('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]")) && /READY|REDUCED_COMPLEXITY/.test(document.querySelector("#runtime-state").textContent)');
 assert.equal(await evaluate('window.devicePixelRatio'),phoneScale,'The learner preview must use the requested phone pixel density');
 assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'The mobile review must not overflow horizontally');
 await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
 await new Promise(done=>setTimeout(done,1500));
 const mobileScreenshot=(await command('Page.captureScreenshot',{format:'png'})).data;
 await writeFile('output/nxstage-native-preview/mobile-preview.png',Buffer.from(mobileScreenshot,'base64'));
 assert(await countVisible(mobileScreenshot)>100,'The model must be visible at phone size');
 const tap=async selector=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 await tap('[data-view-component=nxstage-control-panel]');
 await waitFor('document.querySelector("[data-component-id=nxstage-control-panel]")?.getAttribute("aria-current")==="true"');
 await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
 await new Promise(done=>setTimeout(done,500));
 await writeFile('output/nxstage-native-preview/mobile-panel.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const canvasRect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
 let addFluidPoint;
 const expectedPoint={x:canvasRect.x+.30*canvasRect.width,y:canvasRect.y+.47*canvasRect.height};
 await command('Input.dispatchMouseEvent',{type:'mouseMoved',...expectedPoint});
 if(await evaluate('/Over Add Fluid/.test(document.querySelector("#model-status").textContent)'))addFluidPoint=expectedPoint;
 for(let y=.12;y<=.88&&!addFluidPoint;y+=.025)for(let x=.10;x<=.90;x+=.025){
  const point={x:canvasRect.x+x*canvasRect.width,y:canvasRect.y+y*canvasRect.height};
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  if(await evaluate('/Over Add Fluid/.test(document.querySelector("#model-status").textContent)')){addFluidPoint=point;break;}
 }
 assert(addFluidPoint,'Add Fluid must be directly reachable in the phone control-panel view');
 await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[addFluidPoint]});
 await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await waitFor('/Add Fluid pressed/.test(document.querySelector("#model-status").textContent)');
 for(const [view,component] of [['nxstage-cycler-handle','nxstage-cycler-handle'],['nxstage-cabinet-door','nxstage-cabinet-door']]){
  await tap(`[data-view-component=${view}]`);
  await waitFor(`document.querySelector("[data-component-id=${component}]")?.getAttribute("aria-current")==="true"`);
 }
 await tap('[data-component-id=nxstage-control-panel]');
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Press Add Fluid")');
 await evaluate('[...document.querySelectorAll("#action-controls button")].find(b=>b.textContent==="Press Add Fluid").id="mobile-add-fluid"');
 await tap('#mobile-add-fluid');
 await waitFor('/Add Fluid pressed/.test(document.querySelector("#model-status").textContent)');
 await tap('#nxstage-magnifier summary');
 for(const [region,label] of [['left','Volume Toggle'],['decrease','Dialysate decrease'],['increase','Dialysate increase'],['right','Mute control']]){
  await tap(`[data-panel-region=${region}]`);
  await new Promise(done=>setTimeout(done,350));
  if(region==='left')await writeFile('output/nxstage-native-preview/mobile-magnified.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const rect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  let target;
  for(const y of [.5,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8]){
   const point={x:rect.x+x*rect.width,y:rect.y+y*rect.height};
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   if((await evaluate('document.querySelector("#model-status").textContent')).includes(`Over ${label}.`)){target=point;break;}
  }if(target)break;}
  assert(target,`${label} must be directly reachable in its magnified group`);
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor(`document.querySelector("#model-status").textContent.includes(${JSON.stringify(label+' pressed')})`);
 }
 await tap('[data-panel-region=lower-arrows]');
 await waitFor('/Open the cabinet door fully to see the lower panel/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await waitFor('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Open Lower cabinet door")');
 await evaluate('[...document.querySelectorAll("#action-controls button")].find(b=>b.textContent==="Open Lower cabinet door").id="mobile-open-cabinet"');
 await tap('#mobile-open-cabinet');
 await waitFor('/Lower cabinet door is open/.test(document.querySelector("#model-status").textContent)');
 await new Promise(done=>setTimeout(done,500));
 for(const [region,labels] of [['lower-arrows',['PureFlow up','PureFlow down']],['lower-actions',['PureFlow GO','PureFlow STOP']]]){
  await tap(`[data-panel-region=${region}]`);
  await new Promise(done=>setTimeout(done,350));
  const rect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  if(region==='lower-actions')await writeFile('output/nxstage-native-preview/mobile-lower-magnified.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  for(const label of labels){
   let target;
   for(const y of [.5,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8,.1,.9]){
    const point={x:rect.x+x*rect.width,y:rect.y+y*rect.height};
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    if((await evaluate('document.querySelector("#model-status").textContent')).includes(`Over ${label}.`)){target=point;break;}
   }if(target)break;}
   assert(target,`${label} must be directly reachable in its magnified group`);
   await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
   await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await waitFor(`document.querySelector("#model-status").textContent.includes(${JSON.stringify(label+' pressed')})`);
  }
 }
 let warmerBefore,warmerLit,warmerAfter;
 const imageDifference=async(a,b)=>evaluate(`(async()=>{const decode=async s=>createImageBitmap(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))],{type:'image/png'}));const [a,b]=await Promise.all([decode(${JSON.stringify(a)}),decode(${JSON.stringify(b)})]);const c=document.createElement('canvas');c.width=a.width;c.height=a.height;const ctx=c.getContext('2d');const r=document.querySelector('#model-canvas').getBoundingClientRect(),sx=a.width/innerWidth,sy=a.height/innerHeight,x=Math.round(r.left*sx),y=Math.round(r.top*sy),w=Math.round(r.width*sx),h=Math.round(r.height*sy);ctx.drawImage(a,0,0);const p=ctx.getImageData(x,y,w,h).data;ctx.drawImage(b,0,0);const q=ctx.getImageData(x,y,w,h).data;let n=0;for(let i=0;i<p.length;i+=4)if(Math.abs(p[i]-q[i])+Math.abs(p[i+1]-q[i+1])+Math.abs(p[i+2]-q[i+2])>30)n++;return n})()`);
 for(const [region,labels] of [['warmer',['Warmer temperature up','Warmer temperature down']],['rear-switch',['Cycler rear power switch']]]){
  await tap(`[data-panel-region=${region}]`);
  await new Promise(done=>setTimeout(done,350));
  if(region==='rear-switch')await writeFile('output/nxstage-native-preview/mobile-rear-switch.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  if(region==='warmer'){warmerBefore=(await command('Page.captureScreenshot',{format:'png'})).data;await writeFile('output/nxstage-native-preview/mobile-warmer.png',Buffer.from(warmerBefore,'base64'));}
  const rect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  for(const label of labels){
   let target;
   for(const y of [.5,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8,.1,.9]){
    const point={x:rect.x+x*rect.width,y:rect.y+y*rect.height};
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    if((await evaluate('document.querySelector("#model-status").textContent')).includes(`Over ${label}.`)){target=point;break;}
   }if(target)break;}
   assert(target,`${label} must be directly reachable in its magnified view`);
   if(region==='warmer' && label.endsWith('up')){
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
    await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    assert.equal(await evaluate('document.querySelector("#nxstage-warmer-preview-feedback").hidden'),true,'A canceled press must not change the warmer display');
   }
   await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
   await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await waitFor(region==='rear-switch' ? '/Cycler rear power switch is in the on position \\(power not simulated\\)/.test(document.querySelector("#model-status").textContent)' : `document.querySelector("#model-status").textContent.includes(${JSON.stringify(label+' pressed')})`);
   if(region==='warmer'){
    const level=label.endsWith('up')?1:0;
    await waitFor(`document.querySelector("#nxstage-warmer-preview-feedback")?.textContent.includes("${level} of 9")`);
    assert.match(await evaluate('document.querySelector("#nxstage-warmer-preview-feedback").textContent'),/Power, temperature and heating are not simulated/);
    await new Promise(done=>setTimeout(done,200));
    const image=(await command('Page.captureScreenshot',{format:'png'})).data;
    if(level)warmerLit=image;else warmerAfter=image;
   }
   if(region==='rear-switch'){
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitFor('/Cycler rear power switch is in the off position \\(power not simulated\\)/.test(document.querySelector("#model-status").textContent)');
   }
  }
  if(region==='warmer'){
   assert(await imageDifference(warmerBefore,warmerLit)>20,'Increasing must visibly light the illustrative warmer bar');
   assert(await imageDifference(warmerLit,warmerAfter)>20,'Decreasing must visibly clear the illustrative warmer bar');
  }
 }
 const touchSceneTarget=async (label,drag,cancel=false)=>{
  await new Promise(done=>setTimeout(done,400));
  const r=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
  let target;
  for(const y of [.5,.47,.46,.48,.4,.6,.3,.7,.2,.8]){for(const x of [.5,.4,.6,.3,.7,.2,.8,.1,.9]){
   const point={x:r.x+x*r.width,y:r.y+y*r.height};
   await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   if((await evaluate('document.querySelector("#model-status").textContent')).includes(`Over ${label}.`)){target=point;break;}
  }if(target)break;}
  assert(target,`${label} must be reachable after returning from the rear view`);
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[target]});
  if(drag) await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:target.x+drag.x,y:target.y+drag.y}]});
  await command('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
 };
 await tap('[data-view-component=nxstage-cycler-handle]');
 await touchSceneTarget('Cycler door handle');
 await waitFor('/Cycler door handle is raised/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cycler-door]');
 await touchSceneTarget('Upper cycler door');
 await waitFor('/Upper cycler door is open/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cycler-handle]');
 await new Promise(done=>setTimeout(done,400));
 await writeFile('output/nxstage-native-preview/mobile-open-handle.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await touchSceneTarget('Cycler door handle');
 await waitFor('/Close the cycler door before lowering the handle/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cycler-door]');
 await touchSceneTarget('Upper cycler door');
 await waitFor('/Upper cycler door is closed/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cycler-handle]');
 await touchSceneTarget('Cycler door handle');
 await waitFor('/Cycler door handle is lowered/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await new Promise(done=>setTimeout(done,400));
 await writeFile('output/nxstage-native-preview/mobile-open-lower-door.png',Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await touchSceneTarget('Lower cabinet door');
 await waitFor('/Lower cabinet door is closed/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=pureflow-tub]');
 await waitFor('/Open the cabinet door fully to see the PureFlow tub/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await touchSceneTarget('Lower cabinet door');
 await waitFor('/Lower cabinet door is open/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=pureflow-tub]');
 await touchSceneTarget('PureFlow tub',{x:0,y:36});
 await waitFor('/PureFlow tub is partially pulled out/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await touchSceneTarget('Lower cabinet door');
 await waitFor('/Push the tub in before closing the cabinet door/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=pureflow-tub]');
 await touchSceneTarget('PureFlow tub');
 await waitFor('/PureFlow tub is pushed in/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=pureflow-tub]');
 const beforeCanceledTub=await evaluate('document.querySelector("#action-log").textContent');
 await touchSceneTarget('PureFlow tub',{x:0,y:36},true);
 await new Promise(done=>setTimeout(done,500));
 assert.equal(await evaluate('document.querySelector("#action-log").textContent'),beforeCanceledTub,'Canceling a partial tub drag must not submit a movement');
 assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(b=>b.textContent==="Pull out PureFlow tub")'),'A canceled drag must leave the tub pushed in');
 await tap('[data-view-component=pureflow-tub]');
 await touchSceneTarget('PureFlow tub');
 await waitFor('/PureFlow tub is pulled out/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await touchSceneTarget('Lower cabinet door');
 await waitFor('/Push the tub in before closing the cabinet door/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=pureflow-tub]');
 await touchSceneTarget('PureFlow tub');
 await waitFor('/PureFlow tub is pushed in/.test(document.querySelector("#model-status").textContent)');
 await tap('[data-view-component=nxstage-cabinet-door]');
 await touchSceneTarget('Lower cabinet door');
 await waitFor('/Lower cabinet door is closed/.test(document.querySelector("#model-status").textContent)');
 await command('Emulation.setTouchEmulationEnabled',{enabled:false});
 await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 // A newly selected sample photo set opens the corrected visual candidate;
 // existing saved demos above still retain their original route and link.
 await command('Page.navigate',{url:`${base}/demo?source=sample-test`});
 await evaluate('localStorage.removeItem("aurora-training-demo-v4")');
 await command('Page.navigate',{url:`${base}/demo?source=sample-test`});
 await waitFor('Boolean(document.querySelector("[data-action=simulate-upload][data-kind=photos]"))');
 await evaluate('document.querySelector("[data-action=simulate-upload][data-kind=photos]").click()');
 assert.equal(await evaluate('new URL(location.href).searchParams.get("model")'),'nxstage-review','A new sample must select the corrected visual model');
 assert.equal(await evaluate('new URL(location.href).searchParams.get("source")'),'sample-test','Selecting the visual model must preserve other URL parameters');
 await waitFor('JSON.parse(localStorage.getItem("aurora-training-demo-v4")).sourceProgress === 100');
 await evaluate('document.querySelector("[data-action=creator-next]").click()');
 await waitFor('Boolean(document.querySelector("[data-action=approve-demo-candidate]"))');
 assert.match(await evaluate('document.querySelector("[data-action=approve-demo-candidate]").textContent'),/Open visual review/);
 assert.match(await evaluate('document.querySelector(".pipeline-review-card").textContent'),/unmeasured visual reconstruction/i);
 assert.doesNotMatch(await evaluate('document.querySelector(".pipeline-review-card").textContent'),/0\.54 mm|502,001/,'The visual model must not inherit the older candidate measurements');
 await evaluate('document.querySelector("[data-action=approve-demo-candidate]").click()');
 await waitFor('Boolean(document.querySelector("#demo-model-canvas")) && /Ready|reduced-complexity/i.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
 await waitFor('Boolean(document.querySelector("[data-target-id=NX-C01-ADD-FLUID]"))');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-target-id=NX-C01-FLOW]"))'),false,'A new sample must not use the old printed-picture control');
 assert.match(await evaluate('JSON.parse(localStorage.getItem("aurora-training-demo-v4")).narrationText'),/visual review/i,'The default narration must describe the visual sample');
 await command('Page.reload');
 await waitFor('Boolean(document.querySelector("[data-target-id=NX-C01-ADD-FLUID]"))');
 assert.match(await evaluate('document.body.textContent'),/Visual review: dimensions and hidden geometry are estimates/i,'The sample must remain marked as a visual review after reload');
 await evaluate('(()=>{const s=JSON.parse(localStorage.getItem("aurora-training-demo-v4"));s.creatorStep="publish";localStorage.setItem("aurora-training-demo-v4",JSON.stringify(s))})()');
 await command('Page.reload');
 await waitFor('document.querySelector(".focus-empty")?.textContent.includes("Visual review only")');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-action=publish]"))'),false,'The sample visual review must remain unpublishable');
 await command('Page.navigate',{url:`${base}/learner/model?preview=1`});
 await waitFor('Boolean(document.querySelector("[data-component-id=AIC-C01]"))');
 assert.match(await evaluate('document.querySelector("#title").textContent'),/AIC-001/);
 await command('Page.navigate',{url:`${base}/learner/model?model=nxstage-review&sessionId=session-test&releaseId=release-test&modelVersionId=version-test`});
 await waitFor('/AUTHENTICATION_REQUIRED/.test(document.querySelector("#fallback")?.textContent ?? "")');
 assert.match(await evaluate('document.querySelector("#title").textContent'),/AIC-001/,'A bound session must not switch to the visual review');
 assert.equal(await evaluate('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]"))'),false);
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('Native NxStage preview: creator link, desktop and phone rendering, touch controls, default preview and session isolation verified.');
} finally {socket?.close();browser.kill();if(browser.exitCode===null)await new Promise(done=>browser.once('close',done));server.closeAllConnections();await new Promise(done=>server.close(done));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
