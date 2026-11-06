import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

await mkdir('output/nxstage-interaction-review', {recursive:true});
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-mobile-'));
const deviceScaleFactor = Number(process.env.NXSTAGE_DEVICE_SCALE || 3);
assert(Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0, 'The device scale factor must be positive');
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), errors = [];
const command = (method, params = {}) => new Promise((resolveCommand, reject) => { const id = ++sequence; pending.set(id, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
const waitFor = async expression => { for (let i = 0; i < 240; i++) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } throw Error(`Timed out: ${expression}; status=${await evaluate('document.querySelector("#model-status")?.textContent')}; action=${await evaluate('document.querySelector("#action-log")?.textContent')}; errors=${JSON.stringify(errors)}`); };
const tap = async expression => {
  await evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`);
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  const point = await evaluate(`(()=>{const element=${expression};if(!element)throw Error('Touch target missing');const r=element.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==element&&!element.contains(hit))throw Error('Touch target is covered: '+element.outerHTML+' by '+hit?.outerHTML);return {x,y};})()`);
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 100)); } }
  assert(port, 'Chrome did not start');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = event => { const message = JSON.parse(String(event.data)), waiter = pending.get(message.id); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); } };
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor, mobile: true });
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const previewPort = Number(process.env.NXSTAGE_REVIEW_PORT || 4215);
  await command('Page.navigate', { url: `http://127.0.0.1:${previewPort}/learner/model?preview=1&test=1` });
  await waitFor('Boolean(document.querySelector("[data-component-id=nxstage-control-panel]"))');
  await waitFor('/READY|REDUCED_COMPLEXITY/.test(document.querySelector("#runtime-state").textContent)');
  assert.equal(await evaluate('window.devicePixelRatio'), deviceScaleFactor, 'The browser must use the requested pixel density');
  await new Promise(resolveWait => setTimeout(resolveWait, 400));
  if (process.env.NXSTAGE_EXPECT_RENDER_SCALE) {
    const expected = Number(process.env.NXSTAGE_EXPECT_RENDER_SCALE);
    if (expected === 1 && deviceScaleFactor > 1) await new Promise(resolveWait => setTimeout(resolveWait, 1500));
    const actual = await evaluate('(()=>{const c=document.querySelector("#model-canvas");return c.width/c.clientWidth})()');
    assert(Math.abs(actual - expected) < .03, `The model must render at the requested density: ${actual} vs ${expected}`);
    if (expected > 1) {
      await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate('window.devicePixelRatio'), 1, 'The display density must actually change before checking the canvas');
      await waitFor('Math.abs(document.querySelector("#model-canvas").width / document.querySelector("#model-canvas").clientWidth - 1) < .03');
      await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor, mobile: true });
      await waitFor(`Math.abs(document.querySelector("#model-canvas").width / document.querySelector("#model-canvas").clientWidth - ${expected}) < .03`);
    }
  }
  const fittedBounds = await evaluate('window.__reviewProjectedBounds()');
  assert(fittedBounds.left >= -.01 && fittedBounds.right <= 1.01 && fittedBounds.top >= -.01 && fittedBounds.bottom <= 1.01, `The complete model must fit on a phone: ${JSON.stringify(fittedBounds)}`);
  assert.equal(await evaluate('matchMedia("(pointer: coarse)").matches'), true, 'The test must exercise the mobile asset path');
  assert.match(await evaluate('document.body.textContent'), /upper cartridge chamber is simplified.*does not contain a usable cartridge/i, 'The review must identify the simplified upper chamber');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'The preview must fit a phone viewport');
  await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor, mobile: true });
  await new Promise(resolveWait=>setTimeout(resolveWait,300));
  await tap('document.querySelector("#focus-warmer")');
  await new Promise(resolveWait=>setTimeout(resolveWait,250));
  const warmerPoint=await evaluate('window.__reviewTargetPoint("FW-C01-UP")');
  assert(warmerPoint && warmerPoint.x>=0 && warmerPoint.x<320 && warmerPoint.y>=0 && warmerPoint.y<568, `The focused warmer must be on screen: ${JSON.stringify(warmerPoint)}`);
  assert.equal(await evaluate(`document.elementFromPoint(${warmerPoint.x},${warmerPoint.y})?.id`), 'model-canvas', 'The focused warmer must not be covered by page controls');
  assert.equal((await evaluate(`window.__reviewHits(${warmerPoint.x},${warmerPoint.y})`))[0]?.target, 'FW-C01-UP', 'The visible warmer button must be reachable after focusing');
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...warmerPoint,id:15}]});
  await waitFor('/Holding Warmer temperature up/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor('/Warmer temperature up pressed/.test(document.querySelector("#model-status").textContent)');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor, mobile: true });
  await new Promise(resolveWait=>setTimeout(resolveWait,300));
  await tap('document.querySelector("#focus-handle")');
  await waitFor('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Lift Cycler door handle")');
  assert.equal(await evaluate('document.querySelector("[data-component-id=nxstage-cycler-handle]").getAttribute("aria-current")'), 'true', 'The handle shortcut must select the handle on a phone');
  await new Promise(resolveWait=>setTimeout(resolveWait,250));
  const handlePoint=await evaluate('window.__reviewHandlePoint()');
  assert(handlePoint && handlePoint.x>=0 && handlePoint.x<390 && handlePoint.y>=0 && handlePoint.y<844,`The handle must be reachable on a phone: ${JSON.stringify(handlePoint)}`);
  assert.equal(await evaluate(`document.elementFromPoint(${handlePoint.x},${handlePoint.y})?.id`), 'model-canvas', 'The focused handle must not be covered by page controls');
  assert.equal((await evaluate(`window.__reviewHits(${handlePoint.x},${handlePoint.y})`))[0]?.target,'NX-C04-CYCLER-HANDLE','The visible bar must pick the handle');
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...handlePoint,id:16}]});
  await waitFor('/Holding Cycler door handle/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor('/Cycler door handle is raised/.test(document.querySelector("#model-status").textContent)');
  await new Promise(resolveWait=>setTimeout(resolveWait,600));
  const handleBounds=await evaluate('window.__reviewComponentBounds("nxstage-cycler-handle")');
  assert(handleBounds && handleBounds.left>=0 && handleBounds.right<=1 && handleBounds.top>=0 && handleBounds.bottom<=1,`The raised handle must remain visible on a phone: ${JSON.stringify(handleBounds)}`);
  await tap('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Lower Cycler door handle")');
  await waitFor('/Cycler door handle is lowered/.test(document.querySelector("#model-status").textContent)');
  await tap('document.querySelector("#focus-pureflow")');
  await waitFor('document.querySelector("#lower-panel-guidance") && !document.querySelector("#lower-panel-guidance").hidden');
  assert.match(await evaluate('document.querySelector("#lower-panel-guidance").textContent'), /cabinet door may obscure/i);
  await tap('document.querySelector("#reset-view")');
  await tap('document.querySelector("[data-component-id=pureflow-tub]")');
  await waitFor('document.querySelector("[data-component-id=pureflow-tub]").getAttribute("aria-current") === "true"');
  await tap('document.querySelector("#focus-component")');
  await waitFor('/Open the cabinet door fully to see the PureFlow tub/.test(document.querySelector("#model-status").textContent)');
  assert.equal(await evaluate('document.querySelector("[data-component-id=pureflow-tub]").getAttribute("aria-current")'), 'true', 'A hidden tub must remain selected so its controls are available');
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  const closedTubImage = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile('output/nxstage-interaction-review/mobile-closed-tub-focus.png', Buffer.from(closedTubImage.data, 'base64'));
  await tap('document.querySelector("#reset-view")');
  await tap('document.querySelector("[data-component-id=nxstage-control-panel]")');
  await waitFor('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Press Add Fluid")');
  await tap('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Press Add Fluid")');
  await waitFor('/Add Fluid pressed/.test(document.querySelector("#model-status").textContent)');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /settings are not simulated/i);
  const logBeforeFocus = await evaluate('document.querySelector("#action-log").textContent');
  await tap('document.querySelector("#focus-component")');
  await waitFor('/Focused NxStage control panel/.test(document.querySelector("#model-status").textContent)');
  assert.equal(await evaluate('document.querySelector("#action-log").textContent'), logBeforeFocus, 'Focusing the selected part must not submit another selection');
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  for (const [label,x,y] of [['L/hr picture',1275,320],['ultrafiltration picture',1280,495],['blood-flow picture',1318,690]]) {
    const picture=await evaluate(`window.__reviewFasciaPoint(${x}/1600,${y}/920)`);
    assert(picture && picture.x>=0 && picture.x<390 && picture.y>=0 && picture.y<844,`${label} must be visible on the phone`);
    assert.equal((await evaluate(`window.__reviewHits(${picture.x},${picture.y})`))[0]?.name,'Photo-derived control fascia',`${label} must be printed artwork`);
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...picture,id:49}]});
    assert.doesNotMatch(await evaluate('document.querySelector("#model-status").textContent'),/Holding /,`${label} must not press a control`);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  let target = await evaluate('window.__reviewTargetPoint("NX-C01-ADD-FLUID")');
  assert(target && target.x >= 0 && target.x < 390 && target.y >= 0 && target.y < 844, `The 3D button must fit on screen: ${JSON.stringify(target)}`);
  await evaluate('window.__confirmedTouchActions=0;new MutationObserver(()=>{if(document.querySelector("#action-log").textContent.startsWith("accepted:"))window.__confirmedTouchActions++}).observe(document.querySelector("#action-log"),{childList:true,characterData:true,subtree:true})');
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...target, id: 7 }] });
  await waitFor('/Holding Add Fluid/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await waitFor('!/Holding Add Fluid/.test(document.querySelector("#model-status").textContent)');
  assert.equal(await evaluate('window.__confirmedTouchActions'), 0, 'A canceled direct touch must not activate the control');
  // Starting a pinch while a button is depressed must release it without
  // producing a press, and the button must remain usable afterward.
  const restPosition = await evaluate('window.__reviewTargetPosition("NX-C01-ADD-FLUID")');
  const pinchSecond = await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.left+15,y:r.top+15}})()');
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...target, id: 71 }] });
  await waitFor('/Holding Add Fluid/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...target, id: 71 }, { ...pinchSecond, id: 72 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 18, y: target.y + 12, id: 71 }, { x: pinchSecond.x - 5, y: pinchSecond.y - 5, id: 72 }] });
  await waitFor('/Zooming.*Add Fluid was not pressed/i.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: pinchSecond.x - 5, y: pinchSecond.y - 5, id: 72 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await evaluate('window.__confirmedTouchActions'), 0, 'Pinching must not activate the held button');
  assert.deepEqual(await evaluate('window.__reviewTargetPosition("NX-C01-ADD-FLUID")'), restPosition, 'The canceled button must return to its resting position');
  await tap('document.querySelector("#focus-component")');
  await waitFor('/Focused NxStage control panel/.test(document.querySelector("#model-status").textContent)');
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  target = await evaluate('window.__reviewTargetPoint("NX-C01-ADD-FLUID")');
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...target, id: 8 }] });
  await waitFor('/Holding Add Fluid/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor('window.__confirmedTouchActions === 1');
  const touchTargetSizes={};
  for (const [id,label] of [
    ['NX-C01-ADD-FLUID','Add Fluid'], ['NX-C01-VOLUME-TOGGLE','Volume Toggle'], ['NX-C01-TREATMENT','Treatment'],
    ['NX-C01-ROW1-DOWN','Dialysate decrease'], ['NX-C01-ROW1-UP','Dialysate increase'],
    ['NX-C01-ROW2-DOWN','Ultrafiltration decrease'], ['NX-C01-ROW2-UP','Ultrafiltration increase'],
    ['NX-C01-ROW3-DOWN','Blood flow decrease'], ['NX-C01-ROW3-UP','Blood flow increase'],
    ['NX-C01-STOP','Stop control'], ['NX-C01-MUTE','Mute control']
  ]) {
    touchTargetSizes[id]=await evaluate(`window.__reviewTargetSize(${JSON.stringify(id)})`);
    const point=await evaluate(`window.__reviewTargetPoint(${JSON.stringify(id)})`);
    assert(point && point.x>=0 && point.x<390 && point.y>=0 && point.y<844,`${label} must fit on the phone screen`);
    const hits=await evaluate(`window.__reviewHits(${point.x},${point.y})`);
    assert.equal(hits[0]?.target,id,`${label} must be the first visible hit: ${JSON.stringify(hits)}`);
    const before=await evaluate('window.__confirmedTouchActions');
    const resting=await evaluate(`window.__reviewTargetPosition(${JSON.stringify(id)})`);
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:17}]});
    await waitFor(`document.querySelector("#model-status").textContent.includes(${JSON.stringify('Holding '+label)})`);
    assert.notDeepEqual(await evaluate(`window.__reviewTargetPosition(${JSON.stringify(id)})`),resting,`${label} must depress on touch`);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitFor(`window.__confirmedTouchActions===${before+1}`);
    assert.deepEqual(await evaluate(`window.__reviewTargetPosition(${JSON.stringify(id)})`),resting,`${label} must return to rest`);
  }
  await tap('document.querySelector("#panel-magnifier summary")');
  const magnifiedSizes={};
  const regionTargets={
    left:['NX-C01-ADD-FLUID','NX-C01-VOLUME-TOGGLE','NX-C01-TREATMENT'],
    decrease:['NX-C01-ROW1-DOWN','NX-C01-ROW2-DOWN','NX-C01-ROW3-DOWN'],
    increase:['NX-C01-ROW1-UP','NX-C01-ROW2-UP','NX-C01-ROW3-UP'],
    right:['NX-C01-STOP','NX-C01-MUTE']
  };
  for (const [region,id,label] of [
    ['left','NX-C01-VOLUME-TOGGLE','Volume Toggle'],
    ['decrease','NX-C01-ROW2-DOWN','Ultrafiltration decrease'],
    ['increase','NX-C01-ROW2-UP','Ultrafiltration increase'],
    ['right','NX-C01-MUTE','Mute control']
  ]) {
    await tap(`document.querySelector('#panel-magnifier [data-panel-region="${region}"]')`);
    await new Promise(resolveWait=>setTimeout(resolveWait,250));
    const enlarged=await evaluate(`window.__reviewTargetSize(${JSON.stringify(id)})`);
    magnifiedSizes[id]=enlarged;
    if(region==='left') {
      const screenshot=await command('Page.captureScreenshot',{format:'png'});
      await writeFile('output/nxstage-interaction-review/mobile-magnified-panel.png',Buffer.from(screenshot.data,'base64'));
    }
    assert(enlarged.width>touchTargetSizes[id].width*1.5,`${label} must be meaningfully larger: ${JSON.stringify({before:touchTargetSizes[id],enlarged})}`);
    const canvasRect=await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()');
    for(const regionId of regionTargets[region]) {
      const member=await evaluate(`window.__reviewTargetPoint(${JSON.stringify(regionId)})`);
      assert(member && member.x>=canvasRect.left && member.x<canvasRect.right && member.y>=canvasRect.top && member.y<canvasRect.bottom,`${regionId} must be visible in its magnified group`);
      assert.equal((await evaluate(`window.__reviewHits(${member.x},${member.y})`))[0]?.target,regionId,`${regionId} must be directly reachable in its magnified group`);
    }
    const point=await evaluate(`window.__reviewTargetPoint(${JSON.stringify(id)})`);
    assert(point && point.x>=0 && point.x<390 && point.y>=0 && point.y<844,`${label} must remain on the phone screen`);
    const hits=await evaluate(`window.__reviewHits(${point.x},${point.y})`);
    assert.equal(hits[0]?.target,id,`${label} must remain the visible hit when magnified`);
    const before=await evaluate('window.__confirmedTouchActions');
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:18}]});
    await waitFor(`document.querySelector("#model-status").textContent.includes(${JSON.stringify('Holding '+label)})`);
    await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await waitFor(`window.__confirmedTouchActions===${before+1}`);
  }
  await tap('document.querySelector("#focus-panel")');
  await new Promise(resolveWait=>setTimeout(resolveWait,250));
  const restoredSize=await evaluate('window.__reviewTargetSize("NX-C01-VOLUME-TOGGLE")');
  assert(restoredSize.width<magnifiedSizes['NX-C01-VOLUME-TOGGLE'].width*.6,'Focus control panel must return to the full panel view');
  await tap('document.querySelector("[data-component-id=nxstage-cabinet-door]")');
  await tap('document.querySelector(\'#panel-magnifier [data-panel-region="left"]\')');
  await waitFor('document.querySelector("[data-component-id=nxstage-control-panel]").getAttribute("aria-current")==="true"');
  await new Promise(resolveWait=>setTimeout(resolveWait,250));
  assert((await evaluate('window.__reviewTargetSize("NX-C01-VOLUME-TOGGLE")')).width>restoredSize.width*1.5,'Magnification must work after selecting a different part');
  const blockedRadius=await evaluate('window.__reviewCameraRadius()');
  await tap('document.querySelector(\'#panel-magnifier [data-panel-region="lower-arrows"]\')');
  await waitFor('/Open the cabinet door fully/.test(document.querySelector("#model-status").textContent)');
  assert.equal(await evaluate('window.__reviewCameraRadius()'),blockedRadius,'A closed cabinet must block the lower close-up');
  await writeFile('output/nxstage-interaction-review/mobile-front-target-sizes.json',`${JSON.stringify(touchTargetSizes,null,2)}\n`);
  await writeFile('output/nxstage-interaction-review/mobile-magnified-target-sizes.json',`${JSON.stringify(magnifiedSizes,null,2)}\n`);
  await tap('document.querySelector("[data-component-id=nxstage-cabinet-door]")');
  await waitFor('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open Lower cabinet door")');
  await tap('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Lower cabinet door")');
  await waitFor('/Lower cabinet door is open/.test(document.querySelector("#model-status").textContent)');
  await new Promise(resolveWait => setTimeout(resolveWait, 1200));
  await tap('document.querySelector("#focus-pureflow")');
  await waitFor('document.querySelector("#lower-panel-guidance").hidden');
  await new Promise(resolveWait=>setTimeout(resolveWait,250));
  const lowerBase={};
  for(const id of ['PF-C01-UP','PF-C01-DOWN','PF-C01-GO','PF-C01-STOP'])lowerBase[id]=await evaluate(`window.__reviewTargetSize(${JSON.stringify(id)})`);
  for(const [region,members] of [
    ['lower-arrows',[['PF-C01-UP','PureFlow up'],['PF-C01-DOWN','PureFlow down']]],
    ['lower-actions',[['PF-C01-GO','PureFlow GO'],['PF-C01-STOP','PureFlow STOP']]]
  ]) {
    await tap(`document.querySelector('#panel-magnifier [data-panel-region="${region}"]')`);
    await new Promise(resolveWait=>setTimeout(resolveWait,250));
    if(region==='lower-actions') await writeFile('output/nxstage-interaction-review/lower-orientation.json',`${JSON.stringify({go:await evaluate('window.__reviewWorld("PF-C01-GO")'),stop:await evaluate('window.__reviewWorld("PF-C01-STOP")'),angles:await evaluate('window.__reviewCameraAngles()')},null,2)}\n`);
    for(const [id,label] of members) {
      const size=await evaluate(`window.__reviewTargetSize(${JSON.stringify(id)})`);
      assert(size.width>lowerBase[id].width*1.5,`${label} must be larger: ${JSON.stringify({before:lowerBase[id],size})}`);
      const point=await evaluate(`window.__reviewTargetPoint(${JSON.stringify(id)})`);
      assert.equal((await evaluate(`window.__reviewHits(${point.x},${point.y})`))[0]?.target,id,`${label} must be visible in its close-up`);
      const before=await evaluate('window.__confirmedTouchActions');
      await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:19}]});
      await waitFor(`document.querySelector("#model-status").textContent.includes(${JSON.stringify('Holding '+label)})`);
      await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await waitFor(`window.__confirmedTouchActions===${before+1}`);
    }
  }
  await tap('document.querySelector("[data-component-id=pureflow-tub]")');
  await tap('document.querySelector("#focus-component")');
  await waitFor('/Focused PureFlow tub/.test(document.querySelector("#model-status").textContent)');
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  await new Promise(resolveWait => setTimeout(resolveWait, 200));
  let tubPoint = await evaluate('window.__reviewTargetPoint("PF-C02-TUB")');
  assert(tubPoint && tubPoint.x >= 0 && tubPoint.x < 390 && tubPoint.y >= 0 && tubPoint.y < 844, `The tub front must fit the phone screen: ${JSON.stringify(tubPoint)}`);
  let tubTravel = await evaluate(`window.__projectTubMotion(${tubPoint.x},${tubPoint.y})`);
  assert(tubTravel, 'The visible tub must have a projected outward drag direction');
  let distance = Math.hypot(tubTravel.x, tubTravel.y);
  let drag = distance >= 12 ? { x: tubTravel.x * .35, y: tubTravel.y * .35 } : { x: 0, y: 36 };
  const beforePinchLog = await evaluate('document.querySelector("#action-log").textContent');
  await command('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{...tubPoint,id:31}] });
  await waitFor('/Holding PureFlow tub/.test(document.querySelector("#model-status").textContent)');
  const movedTub = {x:tubPoint.x+drag.x,y:tubPoint.y+drag.y};
  await command('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{...movedTub,id:31}] });
  await waitFor('Math.abs(window.__reviewTransform("pureflow-tub").translationX) > .01');
  const second = await evaluate('(()=>{const r=document.querySelector("#model-canvas").getBoundingClientRect();return {x:r.left+10,y:r.top+10}})()');
  const radiusBefore = await evaluate('window.__reviewCameraRadius()');
  await command('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{...movedTub,id:31},{...second,id:32}] });
  await command('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:movedTub.x+18,y:movedTub.y+12,id:31},{x:second.x-5,y:second.y-5,id:32}] });
  await waitFor('/Zooming.*PureFlow tub returned to its previous position/i.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:second.x-5,y:second.y-5,id:32}] });
  await command('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await waitFor('Math.abs(window.__reviewTransform("pureflow-tub").translationX) < .00001');
  const radiusAfter = await evaluate('window.__reviewCameraRadius()');
  const separationBefore = Math.hypot(movedTub.x - second.x, movedTub.y - second.y);
  const separationAfter = Math.hypot(movedTub.x + 23 - second.x, movedTub.y + 17 - second.y);
  assert((radiusAfter - radiusBefore) * (separationAfter - separationBefore) < 0,
    `Pinch zoom must follow finger separation: distance ${separationBefore} -> ${separationAfter}, radius ${radiusBefore} -> ${radiusAfter}`);
  assert.equal(await evaluate('document.querySelector("#action-log").textContent'), beforePinchLog, 'A canceled tub drag must not submit a movement');
  assert.equal(await evaluate('document.querySelector("#focus-component").disabled'), false, 'The tub focus action must remain enabled after pinch');
  await tap('document.querySelector("#focus-component")');
  await waitFor('/Focused PureFlow tub/.test(document.querySelector("#model-status").textContent)');
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  await new Promise(resolveWait => setTimeout(resolveWait, 500));
  tubPoint = await evaluate('window.__reviewTargetPoint("PF-C02-TUB")');
  tubTravel = await evaluate(`window.__projectTubMotion(${tubPoint.x},${tubPoint.y})`);
  assert(tubTravel, 'The tub must remain reachable after canceling a drag');
  distance = Math.hypot(tubTravel.x, tubTravel.y);
  drag = distance >= 12 ? { x: tubTravel.x * .35, y: tubTravel.y * .35 } : { x: 0, y: 36 };
  await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tubPoint, id: 9 }] });
  await waitFor('/Holding PureFlow tub/.test(document.querySelector("#model-status").textContent)');
  await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tubPoint.x + drag.x, y: tubPoint.y + drag.y, id: 9 }] });
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor('/PureFlow tub is partially pulled out/.test(document.querySelector("#model-status").textContent)');
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile('output/nxstage-interaction-review/mobile-review.png', Buffer.from(screenshot.data, 'base64'));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(`Mobile preview Chrome passed at pixel ratio ${deviceScaleFactor}: coarse-pointer asset loading, phone layout, named and direct touches, and direct touch cancellation.`);
} finally {
  socket?.close(); browser.kill();
  if (browser.exitCode === null) await new Promise(resolveClose => browser.once('close', resolveClose));
  for (let i = 0; i < 20; i++) { try { await rm(profile, { recursive: true, force: true }); break; } catch (error) { if (error.code !== 'EBUSY' || i === 19) throw error; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } }
}
