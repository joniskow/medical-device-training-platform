import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const files = new Map([
  ['/learner/model', ['apps/web/dist/model.html', 'text/html']],
  ['/learner/model-player.js', ['apps/web/dist/model-player.js', 'text/javascript']],
  ['/learner/model-manifest.json', ['fixtures/aurora-training/model-manifest.json', 'application/json']],
  ['/learner/model/aurora-infusion-controller.glb', ['fixtures/aurora-training/aurora-training.glb', 'model/gltf-binary']]
]);
let modelAvailable = true;
let forceSlow = false;
let forceVisualPreview = false;
let useSystemOne = false;
let boundMode = false;
let failNextBoundAction = false;
let rejectNextBoundMovement = false;
let boundDelayMs = 300;
let boundResumeDelayMs = 0;
let failNextBoundResume = false;
const boundManifest = JSON.parse(await readFile('fixtures/aurora-training/model-manifest.json', 'utf8'));
const boundDial = boundManifest.components.find(component => component.componentId === 'AIC-C04');
boundDial.permittedTransforms.rotationY = { min: -2, max: 2, step: 0.05, snap: 0.5 };
boundDial.interactionTargets[0].turnMinRadians = -2;
boundDial.interactionTargets[0].turnMaxRadians = 2;
const boundState = { releaseBindingId: boundManifest.releaseBindingId, modelVersionId: boundManifest.modelVersionId, sequence: 0, nextSequence: 1, transforms: Object.fromEntries(boundManifest.components.map(component => [component.componentId, { rotationY: 0, translationX: 0 }])), scorePoints: 0, completed: false, allowedActions: ['select_component', 'transform_component', 'activate_target'] };
const boundRequests = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (boundMode && path.startsWith('/api/v1/releases/')) {
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ releaseId: 'release-test', releaseHash: 'a'.repeat(64), modelVersionId: boundManifest.modelVersionId, releaseBindingId: boundManifest.releaseBindingId, variantId: 'full', manifestHash: boundManifest.sourceHash, manifestUrl: '/learner/model-manifest.json', modelUrl: '/learner/model/aurora-infusion-controller.glb', fallbackManifest: boundManifest }));
  }
  if (boundMode && path === '/api/v1/model-sessions/session-test' && req.method === 'GET') {
    if (boundResumeDelayMs) await new Promise(wait => setTimeout(wait, boundResumeDelayMs));
    if (failNextBoundResume) { failNextBoundResume = false; return res.writeHead(503).end(); }
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'accepted', nextSequence: boundState.nextSequence, state: boundState, feedback: 'Session ready.' }));
  }
  if (boundMode && path === '/api/v1/model-sessions/session-test/actions' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const action = JSON.parse(body);
    boundRequests.push(action);
    if (failNextBoundAction) { failNextBoundAction = false; return res.writeHead(503).end(); }
    await new Promise(wait => setTimeout(wait, boundDelayMs));
    if (action.expectedSequence !== boundState.nextSequence) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'stale_sequence', clientActionId: action.clientActionId, nextSequence: boundState.nextSequence, feedback: 'Stale action.' }));
    if (rejectNextBoundMovement && action.type === 'transform_component') {
      rejectNextBoundMovement = false;
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'invalid_precondition', clientActionId: action.clientActionId, nextSequence: boundState.nextSequence, state: boundState, feedback: 'Movement not allowed.' }));
    }
    if (action.transform) Object.assign(boundState.transforms[action.componentId], action.transform);
    boundState.selectedComponentId = action.componentId;
    boundState.sequence += 1;
    boundState.nextSequence += 1;
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'accepted', clientActionId: action.clientActionId, nextSequence: boundState.nextSequence, state: boundState, feedback: 'Accepted.' }));
  }
  if (!modelAvailable && path.endsWith('.glb')) return res.writeHead(404).end();
  if (useSystemOne && path === '/learner/model-manifest.json') {
    const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8'));
    manifest.components.find(component => component.componentId === 'nxstage-cycler-handle').permittedTransforms.rotationY.snap = Math.PI / 12;
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest));
  }
  if (!useSystemOne && path === '/learner/model-manifest.json') {
    const manifest = boundMode ? structuredClone(boundManifest) : JSON.parse(await readFile('fixtures/aurora-training/model-manifest.json', 'utf8'));
    if (forceSlow) manifest.performanceBudget = { ...manifest.performanceBudget, minimumFps: 10000 };
    if (forceVisualPreview) {
      manifest.fidelity = { ...manifest.fidelity, status: 'VISUAL_RECONSTRUCTION' };
      const sensor = manifest.components.find(component => component.componentId === 'AIC-C03');
      sensor.interactionCapabilities.push('translate');
      sensor.permittedTransforms = { translationX: { min: 0, max: 0.2, step: 0.2 } };
    }
    const dial = manifest.components.find(component => component.componentId === 'AIC-C04');
    dial.permittedTransforms.rotationY = { min: -2, max: 2, step: 0.05, snap: 0.5 };
    dial.interactionTargets[0].turnMinRadians = -2;
    dial.interactionTargets[0].turnMaxRadians = 2;
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest));
  }
  const item = files.get(path);
  if (!item) return res.writeHead(404).end();
  try {
    res.setHeader('content-type', item[1]);
    if (path === '/learner/model-player.js') {
      const source = await readFile(item[0], 'utf8');
      const marker = '\n    });\n  } catch (error) {\n    fallback.hidden';
      assert(source.includes(marker), 'The learner runtime test hook must be installed');
      return res.end(source.replace(marker, '\n    });\n    window.__testRuntime = runtime;\n    window.__testDialPoint = () => { const scene = EngineStore.LastCreatedScene, mesh = scene.meshes.find(m => m.metadata?.interactionTargetId === "AIC-C04-FLOW-DIAL"), engine = scene.getEngine(), rect = canvas.getBoundingClientRect(); mesh.computeWorldMatrix(true); const p = Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld, Matrix.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())); const x = rect.left + p.x * rect.width / engine.getRenderWidth(), y = rect.top + p.y * rect.height / engine.getRenderHeight(), picked = scene.pick(x-rect.left,y-rect.top); return { x, y, picked: picked?.pickedMesh?.name, target: picked?.pickedMesh?.metadata?.interactionTargetId, phase: runtime.getState().phase }; };\n    window.__testCoverAngle = () => EngineStore.LastCreatedScene.getTransformNodeByName("Safety Cover").rotation.y;\n  } catch (error) {\n    fallback.hidden').replace('function renderActions() {', 'window.__testSubmit = submit;\nwindow.__testRenderState = renderState;\nfunction renderActions() {'));
    }
    res.end(await readFile(item[0]));
  }
  catch { res.writeHead(500).end(); }
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const profile = await mkdtemp(resolve(tmpdir(), 'model-named-controls-'));
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/learner/model?preview=1`], { windowsHide: true, stdio: 'ignore' });
let socket;
const pending = new Map();
let id = 0;
const errors = [];
const command = (method, params = {}) => new Promise((resolveCommand, reject) => { const key = ++id; pending.set(key, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(wait => setTimeout(wait, 100)); }
  }
  assert(port, 'Chrome did not start');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = event => { const message = JSON.parse(String(event.data)); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.error ? callback.reject(Error(message.error.message)) : callback.resolve(message.result); } };
  await new Promise((ready, reject) => { socket.onopen = ready; socket.onerror = reject; });
  await command('Runtime.enable');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(document.querySelector("[data-component-id=AIC-C04]"))')) break;
    await new Promise(wait => setTimeout(wait, 100));
  }
  assert(await evaluate('Boolean(document.querySelector("[data-component-id=AIC-C04]"))'), JSON.stringify(errors));
  const hoverFeedback=await evaluate('(()=>{const state=window.__testRuntime.getState();window.__testRenderState({...state,selectedComponentId:undefined,focusedInteractionTargetId:undefined,hoveredInteractionTargetId:"AIC-C01-PRIME",hoveredInteractionTargetName:"Prime button"});const result={status:document.querySelector("#model-status").textContent,cursor:document.querySelector("#model-canvas").style.cursor};window.__testRenderState({...state,selectedComponentId:undefined,focusedInteractionTargetId:undefined,hoveredInteractionTargetId:undefined});result.after=document.querySelector("#model-status").textContent;result.cursorAfter=document.querySelector("#model-canvas").style.cursor;return result})()');
  assert.match(hoverFeedback.status,/Prime button/,'Hovering a control must identify it');assert.equal(hoverFeedback.cursor,'pointer','The pointer must indicate an interactive control');assert.doesNotMatch(hoverFeedback.after,/Prime button/,'Leaving the control must clear its hover label');assert.equal(hoverFeedback.cursorAfter,'','Leaving the control must restore the canvas cursor');
  await evaluate('window.__testSubmit({type:"activate_target",componentId:"AIC-C01",targetId:"not-a-control",clientActionId:"invalid-preview-target"})');
  assert.match(await evaluate('document.querySelector("#action-log").textContent'),/^invalid_precondition:.*not part of this model component/,'The preview must reject unknown controls');
  await evaluate('document.querySelector("#model-canvas").focus()');
  for (let attempt = 0; attempt < 30; attempt++) {
    await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    if (await evaluate('window.__testRuntime?.getState().focusedInteractionTargetId==="AIC-C04-FLOW-DIAL"')) break;
  }
  assert.equal(await evaluate('window.__testRuntime?.getState().focusedInteractionTargetId'), 'AIC-C04-FLOW-DIAL', 'The dial must be reachable by keyboard');
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Turn Flow dial right")'), 'Named controls must follow the keyboard-focused component');
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Turn Flow dial right")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Turn Flow dial left")'), 'Both dial directions must be available');
  assert(!(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open safety cover")')), 'A dial must not be mislabeled as a safety cover');
  await evaluate('window.previousButton=[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Turn Flow dial right");window.previousButton.focus();document.querySelector("#action-log").textContent="Waiting for dial action"');
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#action-log").textContent')).startsWith('accepted:')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#action-log").textContent'), /^accepted:/);
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Flow dial position updated/, 'The accepted snap action must actually change the dial position');
  assert(!(await evaluate('document.activeElement===window.previousButton')), 'The accepted response must have updated the control list');
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Turn Flow dial right', 'The named action must retain keyboard focus after the response');
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open Safety cover latch")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('window.doorLogs=[];new MutationObserver(()=>window.doorLogs.push(document.querySelector("#action-log").textContent)).observe(document.querySelector("#action-log"),{childList:true,subtree:true,characterData:true});[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Safety cover latch").click()');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Holding Safety cover latch/, 'A named door action must use the visible model interaction');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Close Safety cover latch")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Close Safety cover latch")'), 'The named door action must reflect the accepted state');
  assert(!(await evaluate('window.doorLogs.some(text=>text.includes("select_component"))')), 'A named door action must not submit an extra selection');
  assert.equal(await evaluate('window.doorLogs.filter(text=>text.startsWith("accepted:")).length'), 1, 'A named door action must be accepted exactly once');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('/Safety cover latch is open/.test(document.querySelector("#model-status").textContent)')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Safety cover latch is open/, 'Accepted feedback must report the actual door position');
  await evaluate('new Promise(resolve=>setTimeout(resolve,1400))');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Safety cover latch is open/, 'Performance sampling must not erase the action feedback');
  await evaluate('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Close Safety cover latch").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open Safety cover latch")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open Safety cover latch")'), 'The named door action must close the door');
  await evaluate('document.querySelector("[data-component-id=AIC-C01]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Press Prime button")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Press Prime button").focus()');
  await evaluate('document.querySelector("#action-log").textContent="Waiting for press action";window.pressLogs=[];new MutationObserver(()=>window.pressLogs.push(document.querySelector("#action-log").textContent)).observe(document.querySelector("#action-log"),{childList:true,subtree:true,characterData:true})');
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Holding Prime button/, 'A named press must visibly depress the model control before submitting');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('document.activeElement?.textContent==="Press Prime button" && document.querySelector("#action-log").textContent.startsWith("accepted:")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(await evaluate('document.activeElement?.textContent'), 'Press Prime button', 'The named press must retain keyboard focus');
  assert.match(await evaluate('document.querySelector("#action-log").textContent'), /^accepted:/, 'The named press must be accepted');
  assert(!(await evaluate('window.pressLogs.some(text=>text.includes("select_component"))')), 'A named press must not submit an extra selection action');
  await evaluate('window.burstLogs=[];new MutationObserver(()=>window.burstLogs.push(document.querySelector("#action-log").textContent)).observe(document.querySelector("#action-log"),{childList:true,subtree:true,characterData:true});const button=[...document.querySelectorAll("#action-controls button")].find(item=>item.textContent==="Press Prime button");button.click();button.click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.burstLogs.filter(text=>text.startsWith("accepted:")).length===2')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(await evaluate('window.burstLogs.filter(text=>text.startsWith("accepted:")).length'), 2, 'Two rapid named presses must each be accepted');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  forceVisualPreview = true;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?preview=1` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(window.__testRuntime && window.__testSubmit)')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('Boolean(window.__testRuntime && window.__testSubmit)'),'The visual-only preview must load');
  await evaluate('window.__testSubmit({type:"transform_component",componentId:"AIC-C02",transform:{rotationY:Math.PI/2},clientActionId:"visual-cover"})');
  await evaluate('window.__testSubmit({type:"transform_component",componentId:"AIC-C03",transform:{translationX:.2},clientActionId:"visual-sensor"})');
  assert.equal(await evaluate('document.querySelector("#score").textContent'),'0','A visual reconstruction must not award fixture-specific scores');
  assert.doesNotMatch(await evaluate('document.querySelector("#completion").textContent'),/completed/i,'A visual reconstruction must not claim procedure completion');
  await evaluate('window.__testSubmit({type:"activate_target",componentId:"AIC-C01",targetId:"AIC-C01-PRIME",clientActionId:"visual-button"},"AIC-C01-PRIME")');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'),/settings are not simulated/i,'A visual button press must explain that device settings are not simulated');
  forceVisualPreview = false;
  forceSlow = true;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?preview=1` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="REDUCED_COMPLEXITY" && Boolean(document.querySelector("[data-component-id=AIC-C01]"))')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(await evaluate('window.__testRuntime?.getState().phase'),'REDUCED_COMPLEXITY','The slow-device check must exercise the reduced frame-rate state');
  assert.equal(await evaluate('document.querySelector("#model-canvas").hidden'),false,'A slow but working 3D model must remain available');
  await evaluate('document.querySelector("[data-component-id=AIC-C01]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Press Prime button")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  const slowPress=await evaluate('(()=>{[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Press Prime button").click();return window.__testRuntime.getState().pressedInteractionTargetId})()');
  assert.equal(slowPress,'AIC-C01-PRIME','A named button must still visibly depress on a slow device');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'),/Holding Prime button/,'The performance notice must not hide feedback for the held button');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!window.__testRuntime.getState().pressedInteractionTargetId')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('(()=>{window.__loseContext=document.querySelector("#model-canvas").getContext("webgl2").getExtension("WEBGL_lose_context");if(!window.__loseContext)return false;window.__loseContext.loseContext();return true})()'),'The browser must support graphics-loss testing');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.__testRuntime.getState().phase==="CONTEXT_LOST"')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(await evaluate('window.__testRuntime.getState().phase'),'CONTEXT_LOST');
  assert(await evaluate('document.querySelector("#model-canvas").hidden && getComputedStyle(document.querySelector("#model-canvas")).display==="none"'),'The unavailable 3D canvas must be hidden');
  await evaluate('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Press Prime button").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('/Prime button pressed/.test(document.querySelector("#model-status").textContent)')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#model-status").textContent'),/Prime button pressed/,'The named control must remain usable while graphics are lost');
  await evaluate('window.__loseContext.restoreContext()');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime.getState().phase!=="CONTEXT_LOST"')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.notEqual(await evaluate('window.__testRuntime.getState().phase'),'CONTEXT_LOST','The graphics context must recover');
  assert(await evaluate('!document.querySelector("#model-canvas").hidden && getComputedStyle(document.querySelector("#model-canvas")).display!=="none"'),'The 3D canvas must return after recovery');
  const recoveredPress=await evaluate('(()=>{[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Press Prime button").click();return window.__testRuntime.getState().pressedInteractionTargetId})()');
  assert.equal(recoveredPress,'AIC-C01-PRIME','Named controls must resume physical feedback after graphics recovery');
  forceSlow = false;
  modelAvailable = false;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?preview=1` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(document.querySelector("[data-component-id=AIC-C04]"))')) break;
    await new Promise(wait => setTimeout(wait, 100));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Turn Flow dial right")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("#action-log").textContent="Waiting for fallback dial action";[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Turn Flow dial right").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#action-log").textContent')).startsWith('accepted:')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#action-log").textContent'), /^accepted:/, 'The named dial action must work without the 3D asset');
  useSystemOne = true;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?preview=1` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(document.querySelector("[data-component-id=nxstage-cycler-door]"))')) break;
    await new Promise(wait => setTimeout(wait, 100));
  }
  const selectControl = async (componentId, label) => {
    await evaluate(`document.querySelector("#action-log").textContent="Waiting for selection";document.querySelector('[data-component-id="${componentId}"]').click()`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`document.querySelector("#action-log").textContent.startsWith("accepted:") && [...document.querySelectorAll("#action-controls button")].some(button=>button.textContent===${JSON.stringify(label)})`)) return;
      await new Promise(wait => setTimeout(wait, 50));
    }
    throw new Error(`Missing named control: ${label}`);
  };
  const clickControl = async (label, accepted = true) => {
    await evaluate(`document.querySelector("#action-log").textContent="Waiting for movement";[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    if (!accepted) return;
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await evaluate('document.querySelector("#action-log").textContent')).startsWith('accepted:')) return;
      await new Promise(wait => setTimeout(wait, 50));
    }
    throw new Error(`Movement was not accepted: ${label}`);
  };
  await selectControl('nxstage-cycler-door', 'Open Upper cycler door');
  await clickControl('Open Upper cycler door', false);
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Lift the cycler door handle/, 'Opening the door must explain the handle interlock');
  assert.equal(await evaluate('document.querySelector("#action-log").textContent'), 'Waiting for movement', 'Blocked opening must not submit an action');
  await selectControl('nxstage-cycler-handle', 'Lift Cycler door handle');
  await clickControl('Lift Cycler door handle');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Cycler door handle is raised/, 'Accepted feedback must report the raised handle');
  await selectControl('nxstage-cycler-door', 'Open Upper cycler door');
  await clickControl('Open Upper cycler door');
  await evaluate('window.__testSubmit({type:"transform_component",componentId:"nxstage-cycler-handle",transform:{rotationY:-Math.PI/4},clientActionId:"partial-handle-interlock"},"NX-C04-CYCLER-HANDLE")');
  assert.match(await evaluate('document.querySelector("#action-log").textContent'),/^invalid_precondition:.*Close the cycler door/,'A partly lowered handle must explain the open-door interlock');
  await selectControl('nxstage-cycler-handle', 'Lower Cycler door handle');
  await clickControl('Lower Cycler door handle', false);
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Close the cycler door/, 'Lowering the handle must explain the door interlock');
  assert.equal(await evaluate('document.querySelector("#action-log").textContent'), 'Waiting for movement', 'Blocked lowering must not submit an action');
  await evaluate('document.querySelector("#action-log").textContent="Waiting for reset";[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Reset component").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#action-log").textContent')).startsWith('invalid_precondition:')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#action-log").textContent'), /^invalid_precondition:.*Close the cycler door/, 'Reset must not bypass the handle interlock');
  await selectControl('nxstage-cycler-door', 'Close Upper cycler door');
  await clickControl('Close Upper cycler door');
  await selectControl('nxstage-cycler-handle', 'Lower Cycler door handle');
  await clickControl('Lower Cycler door handle');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /Cycler door handle is lowered/, 'Accepted feedback must report the lowered handle');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Lift Cycler door handle")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Lift Cycler door handle")'), 'The handle must lower after the door closes');
  useSystemOne = false;
  boundMode = true;
  boundResumeDelayMs = 1000;
  await evaluate('sessionStorage.setItem("mdt.auth.access-token","test");sessionStorage.setItem("mdt.auth.organization-id","org-test")');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(document.querySelector("[data-component-id=AIC-C04]"))')) break;
    await new Promise(wait => setTimeout(wait, 20));
  }
  assert.equal(await evaluate('document.querySelector("[data-component-id=AIC-C04]")?.disabled'), true, 'Components must be disabled while the session is restoring');
  assert.equal(await evaluate('document.querySelector("#model-canvas").tabIndex'), -1, 'The model must not accept gestures while the session is restoring');
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  assert.equal(boundRequests.length, 0, 'Restoring a session must not send a premature selection');
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#allowed-actions")?.textContent ?? ""')).includes('transform_component')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Control Panel: Prime button")'), 'An allowed button action must be available even when another action appears first');
  assert.equal(await evaluate('document.querySelector("[data-component-id=AIC-C04]").disabled'), false, 'Components must be enabled after session restoration');
  boundResumeDelayMs = 0;
  failNextBoundResume = true;
  await evaluate('document.querySelector("#resume-session").click()');
  for (let attempt = 0; attempt < 100; attempt++) { if (!failNextBoundResume && await evaluate('!document.querySelector("#resume-session").disabled')) break; await new Promise(wait => setTimeout(wait, 25)); }
  assert.equal(await evaluate('document.querySelector("[data-component-id=AIC-C04]").disabled'), true, 'A failed restore must leave interactions disabled');
  assert.equal(await evaluate('document.querySelector("#action-controls").inert'), true, 'A failed restore must block named actions');
  await evaluate('document.querySelector("#resume-session").click()');
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate('!document.querySelector("#resume-session").disabled && !document.querySelector("[data-component-id=AIC-C04]").disabled')) break; await new Promise(wait => setTimeout(wait, 25)); }
  assert.equal(await evaluate('document.querySelector("#action-controls").inert'), false, 'A successful retry must restore named actions');
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  await evaluate('(()=>{const input=document.querySelector("#action-controls input");input.value="partially entered instruction";input.focus();input.setSelectionRange(9,9)})()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.selectedComponentId === 'AIC-C04') break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await new Promise(wait => setTimeout(wait, 150));
  const draft = await evaluate('(()=>{const input=document.querySelector("#action-controls input");return {value:input.value,focused:document.activeElement===input,caret:input.selectionStart}})()');
  assert.deepEqual(draft,{value:'partially entered instruction',focused:true,caret:9},'A session update must preserve an unfinished procedure entry and its caret');
  await evaluate('(()=>{const button=[...document.querySelectorAll("#action-controls button")].find(item=>item.textContent==="Turn Flow dial right");button.click();button.click()})()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundRequests.filter(action=>action.type==='transform_component').length === 2 && boundState.sequence === 3) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.deepEqual(boundRequests.filter(action=>action.type==='transform_component').map(action=>action.transform.rotationY), [0.5, 1], 'Rapid named turns must each advance the confirmed setting');
  assert.equal(boundState.transforms['AIC-C04'].rotationY, 1, 'Both dial turns must reach the session state');
  await evaluate('const button=[...document.querySelectorAll("#action-controls button")].find(item=>item.textContent==="Turn Flow dial right");button.click();button.click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.sequence === 5) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(boundState.transforms['AIC-C04'].rotationY, 2, 'The dial must reach its upper setting');
  await evaluate('const buttons=[...document.querySelectorAll("#action-controls button")];buttons.find(item=>item.textContent==="Turn Flow dial left").click();buttons.find(item=>item.textContent==="Turn Flow dial right").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.sequence === 7) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.deepEqual(boundRequests.filter(action=>action.type==='transform_component').slice(-2).map(action=>action.transform.rotationY), [1.5, 2], 'A queued reversal at the limit must use each newly confirmed setting');
  modelAvailable = true;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(window.__testRuntime && window.__testCoverAngle && document.querySelector("#allowed-actions")?.textContent.includes("transform_component"))')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('Boolean(window.__testRuntime && window.__testCoverAngle)'),'The queued-door check requires a 3D model');
  boundDelayMs = 800;
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click();document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100 && boundState.sequence < 1; attempt++) await new Promise(wait => setTimeout(wait, 30));
  assert.equal(boundState.sequence, 1, 'The first selection must be confirmed while the second is pending');
  for (let attempt = 0; attempt < 100 && boundRequests.length < 2; attempt++) await new Promise(wait => setTimeout(wait, 20));
  assert.equal(boundRequests.length, 2, 'The second request must be in flight after the first confirmation was applied');
  assert.equal(await evaluate('window.__testRuntime.getState().selectedComponentId'), 'AIC-C04', 'An older confirmation must not replace the latest visible selection');
  assert.equal(await evaluate('document.querySelector("[data-component-id=AIC-C04]").getAttribute("aria-current")'), 'true', 'The component list must retain the latest selection');
  for (let attempt = 0; attempt < 100 && boundState.sequence < 2; attempt++) await new Promise(wait => setTimeout(wait, 30));
  assert.equal(boundState.selectedComponentId, 'AIC-C04', 'The latest selection must still be confirmed by the session');
  boundDelayMs = 300;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  boundRequests.length = 0;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(window.__testRuntime && window.__testCoverAngle && document.querySelector("#allowed-actions")?.textContent.includes("transform_component"))')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click();[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Safety cover latch").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('/Safety cover latch is open/.test(document.querySelector("#model-status").textContent)')) break;
    await new Promise(wait => setTimeout(wait, 20));
  }
  const queuedDoorAngle=await evaluate('window.__testCoverAngle()');
  assert(queuedDoorAngle<Math.PI/2-.1,`A queued named door movement must animate after confirmation, not jump to the endpoint: ${queuedDoorAngle}`);
  await new Promise(wait => setTimeout(wait, 500));
  assert(Math.abs((await evaluate('window.__testCoverAngle()'))-Math.PI/2)<1e-5,'The confirmed door animation must reach its target');
  assert.deepEqual(boundRequests.map(action=>action.type),['select_component','transform_component'],'The queued named door must be submitted once after selection');
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(window.__testRuntime && window.__testCoverAngle && document.querySelector("#allowed-actions")?.textContent.includes("transform_component"))')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('Boolean(window.__testRuntime && window.__testCoverAngle)'),'The rejected-door check requires a 3D model');
  rejectNextBoundMovement = true;
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click();[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Safety cover latch").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#action-log").textContent')).startsWith('invalid_precondition:')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#action-log").textContent'),/^invalid_precondition:/,'The rejected named movement must be reported');
  assert.equal(await evaluate('window.__testCoverAngle()'),0,'A rejected named movement must not animate the door open');
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('Boolean(window.__testRuntime && window.__testDialPoint)')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('Boolean(window.__testRuntime && window.__testDialPoint)'),`The direct-dial check requires a 3D model: ${await evaluate('document.querySelector("#fallback")?.textContent')}`);
  await evaluate('document.querySelector("#model-canvas").scrollIntoView({block:"center"})');
  const dialPoint=await evaluate('window.__testDialPoint()');
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:dialPoint.x,y:dialPoint.y});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:dialPoint.x,y:dialPoint.y,button:'left',buttons:1,clickCount:1});
  assert.equal(await evaluate('window.__testRuntime.getState().pressedInteractionTargetId'),'AIC-C04-FLOW-DIAL',`A direct mouse drag must grab the dial: ${JSON.stringify(dialPoint)}`);
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:dialPoint.x,y:dialPoint.y-50,button:'left',buttons:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:dialPoint.x,y:dialPoint.y-50,button:'left',buttons:0,clickCount:1});
  for (let attempt = 0; attempt < 100 && boundState.sequence < 1; attempt++) await new Promise(wait => setTimeout(wait, 50));
  assert.deepEqual(boundRequests.filter(action=>action.type==='transform_component').map(action=>action.transform.rotationY),[.5],'A direct dial drag must submit the released, snapped position once');
  assert.equal(boundState.transforms['AIC-C04'].rotationY,.5,'The session must confirm the dial position');
  const cancelPoint=await evaluate('window.__testDialPoint()');
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...cancelPoint,id:73}]});
  assert.equal(await evaluate('window.__testRuntime.getState().pressedInteractionTargetId'),'AIC-C04-FLOW-DIAL','The touch-cancel check must actually grab the dial');
  await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cancelPoint.x,y:cancelPoint.y+45,id:73}]});
  assert.notEqual(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'),.5,'The dial must move before the touch is canceled');
  await command('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await command('Emulation.setTouchEmulationEnabled',{enabled:false});
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'),.5,'Canceling a direct touch must restore the confirmed dial position');
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length,1,'A canceled touch must not submit another dial movement');
  const blurDialPoint=await evaluate('window.__testDialPoint()');
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...blurDialPoint});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...blurDialPoint,button:'left',buttons:1,clickCount:1});
  assert.equal(await evaluate('window.__testRuntime.getState().pressedInteractionTargetId'),'AIC-C04-FLOW-DIAL','The focus-interruption check must grab the dial');
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:blurDialPoint.x,y:blurDialPoint.y+45,button:'left',buttons:1});
  assert.notEqual(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'),.5,'The dial must move before focus changes');
  await evaluate('document.querySelector("#reset-view").focus()');
  assert.equal(await evaluate('document.activeElement?.id'),'reset-view','Focus must leave the canvas during the interrupted dial drag');
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:blurDialPoint.x,y:blurDialPoint.y+45,button:'left',buttons:0,clickCount:1});
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'),.5,'The interrupted dial must return to its confirmed position');
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length,1,'An interrupted dial drag must not submit a movement');
  modelAvailable = true;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('window.__testRuntime?.getState().phase==="READY"'), 'The visual rollback check requires the 3D runtime');
  boundDelayMs = 1000;
  await evaluate('document.querySelector("[data-component-id=AIC-C01]").click();const canvas=document.querySelector("#model-canvas");canvas.focus();for(let i=0;i<30;i++){canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));if(window.__testRuntime.getState().focusedInteractionTargetId==="AIC-C04-FLOW-DIAL")break;}');
  assert.equal(await evaluate('window.__testRuntime.getState().focusedInteractionTargetId'), 'AIC-C04-FLOW-DIAL');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.selectedComponentId === 'AIC-C01' && (await evaluate('document.querySelector("#action-log").textContent')).startsWith('accepted:')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Turn Flow dial right")'), 'A delayed selection response must not replace the currently focused dial controls');
  assert.equal(await evaluate('document.querySelector("[data-component-id=AIC-C04]").getAttribute("aria-current")'), 'true', 'The focused component must remain highlighted');
  assert.equal(boundState.selectedComponentId, 'AIC-C01', 'The session selection must remain authoritative');
  boundDelayMs = 300;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.selectedComponentId === 'AIC-C04') break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1);window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1)');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.sequence === 2 && boundRequests.filter(action=>action.type==='transform_component').length === 2) break;
    await new Promise(wait => setTimeout(wait, 20));
  }
  assert.equal(boundState.sequence, 2, 'The first dial turn must be confirmed while the second is pending');
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'), 1, 'The visible dial must not jump back between queued confirmations');
  for (let attempt = 0; attempt < 100 && boundState.sequence < 3; attempt++) await new Promise(wait => setTimeout(wait, 50));
  assert.equal(boundState.transforms['AIC-C04'].rotationY, 1, 'Both visual dial turns must be confirmed');
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100 && boundState.selectedComponentId !== 'AIC-C04'; attempt++) await new Promise(wait => setTimeout(wait, 50));
  rejectNextBoundMovement = true;
  await evaluate('window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1);window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1)');
  await new Promise(wait => setTimeout(wait, 1000));
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length, 1, 'A movement based on a rejected visual movement must not be sent');
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C04"].rotationY'), 0, 'A rejected movement and its dependent movement must return to confirmed position');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /not sent/i, 'The learner must be told the dependent movement was not sent');
  boundRequests.length = 0;
  rejectNextBoundMovement = true;
  await evaluate('window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1);window.__testRuntime.activateInteractionTarget("AIC-C02-LATCH")');
  for (let attempt = 0; attempt < 100 && boundState.transforms['AIC-C02'].rotationY === 0; attempt++) await new Promise(wait => setTimeout(wait, 50));
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length, 2, 'An unrelated movement must remain eligible after a rejection');
  assert.equal(boundState.transforms['AIC-C02'].rotationY, Math.PI/2, 'The unrelated door action must still be accepted');
  const dependencyTarget = boundManifest.components.find(component=>component.componentId==='AIC-C02').interactionTargets[0];
  dependencyTarget.openRequires = { componentId:'AIC-C04', transform:'rotationY', value:0.5, message:'Turn the dial first.' };
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100 && boundState.selectedComponentId !== 'AIC-C04'; attempt++) await new Promise(wait => setTimeout(wait, 50));
  rejectNextBoundMovement = true;
  await evaluate('window.__testRuntime.activateInteractionTarget("AIC-C04-FLOW-DIAL",1);window.__testRuntime.activateInteractionTarget("AIC-C02-LATCH")');
  await new Promise(wait => setTimeout(wait, 1100));
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length, 1, 'A door movement depending on a rejected prerequisite must not be sent');
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C02"].rotationY'), 0, 'A dependent door must return to the confirmed closed position');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /not sent/i);
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  boundDelayMs = 30;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C04]").click()');
  for (let attempt = 0; attempt < 100 && boundState.selectedComponentId !== 'AIC-C04'; attempt++) await new Promise(wait => setTimeout(wait, 50));
  await evaluate('window.__originalRaf=window.requestAnimationFrame;window.__heldFrames=[];window.requestAnimationFrame=callback=>{window.__heldFrames.push(callback);return 987654321+window.__heldFrames.length};[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Turn Flow dial right").click();document.querySelector("[data-component-id=AIC-C02]").click();[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Safety cover latch").click()');
  await new Promise(wait => setTimeout(wait, 700));
  assert.deepEqual(boundRequests.filter(action=>action.type==='transform_component').map(action=>action.componentId),['AIC-C04'],'A queued door action must wait for the dependency to finish moving visibly');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'),/wait.*finish moving/i,'The learner must be told that the prerequisite is still moving');
  await evaluate('window.requestAnimationFrame=window.__originalRaf;for(const callback of window.__heldFrames)window.__originalRaf(callback)');
  boundDelayMs = 300;
  delete dependencyTarget.openRequires;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('window.__testRuntime?.getState().phase==="READY" && document.querySelector("#allowed-actions")?.textContent.includes("transform_component")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (boundState.selectedComponentId === 'AIC-C02' && await evaluate('document.querySelector("#action-log").textContent.startsWith("accepted:") && [...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Open Safety cover latch")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(boundState.selectedComponentId, 'AIC-C02', 'The door selection must be confirmed before failing the hint request');
  failNextBoundAction = true;
  await evaluate('document.querySelector("#hint").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!document.querySelector("#retry-action").hidden')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  const retryControls = await evaluate('({buttons:[...document.querySelectorAll("#action-controls button")].map(button=>button.textContent),selected:window.__testRuntime.getState().selectedComponentId,status:document.querySelector("#model-status").textContent,retryHidden:document.querySelector("#retry-action").hidden})');
  assert(retryControls.buttons.includes('Open Safety cover latch'), `The selected door control must remain available after an unsent hint: ${JSON.stringify(retryControls)}`);
  await evaluate('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Open Safety cover latch").click()');
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await evaluate('document.querySelector("#model-status").textContent')).includes('This action was not sent')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.match(await evaluate('document.querySelector("#model-status").textContent'), /This action was not sent/);
  assert.equal(await evaluate('window.__testRuntime.getState().transforms["AIC-C02"].rotationY'), 0, 'An unsent door action must return to the confirmed position');
  assert.equal(boundRequests.filter(action=>action.type==='transform_component').length, 0, 'An unsent door action must not reach the session');
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate('["READY","REDUCED_COMPLEXITY"].includes(window.__testRuntime?.getState().phase) && [...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Control Panel: Prime button")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert(await evaluate('["READY","REDUCED_COMPLEXITY"].includes(window.__testRuntime?.getState().phase) && [...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Control Panel: Prime button")'),'The bound 3D review and named button must be ready');
  const namedPressState = await evaluate('(()=>{const button=[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Control Panel: Prime button");button.focus();button.click();button.click();return window.__testRuntime.getState().pressedInteractionTargetId})()');
  assert.equal(namedPressState,'AIC-C01-PRIME','A named procedure button must visibly press the corresponding 3D control');
  for (let attempt = 0; attempt < 100 && boundState.sequence < 2; attempt++) await new Promise(wait => setTimeout(wait, 50));
  assert.deepEqual(boundRequests.map(action=>action.targetId),['AIC-C01-PRIME','AIC-C01-PRIME'],'Both named presses must reach the session in order');
  await new Promise(wait => setTimeout(wait, 150));
  assert.equal(await evaluate('document.activeElement?.textContent'),'Control Panel: Prime button','The procedure control must retain focus after session updates');
  await evaluate('document.querySelector("[data-component-id=AIC-C02]").click()');
  await evaluate('window.__testSubmit({type:"transform_component",componentId:"AIC-C02",transform:{rotationY:Math.PI/6},clientActionId:"partial-door-test"},"AIC-C02-LATCH")');
  assert.match(await evaluate('document.querySelector("#model-status").textContent'),/Safety cover latch is partially open/,'Confirmed feedback must distinguish a partial door position');
  assert(await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Close Safety cover latch")'),'A partially open door must offer a close action');
  modelAvailable = false;
  boundState.sequence = 0;
  boundState.nextSequence = 1;
  boundState.selectedComponentId = undefined;
  for (const position of Object.values(boundState.transforms)) { position.rotationY = 0; position.translationX = 0; }
  boundRequests.length = 0;
  await evaluate('for(const key of Object.keys(sessionStorage))if(key.startsWith("mdt.model-action.session-test."))sessionStorage.removeItem(key)');
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/learner/model?sessionId=session-test&releaseId=release-test&modelVersionId=${encodeURIComponent(boundManifest.modelVersionId)}` });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('[...document.querySelectorAll("#action-controls button")].some(button=>button.textContent==="Control Panel: Prime button")')) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  await evaluate('[...document.querySelectorAll("#action-controls button")].find(button=>button.textContent==="Control Panel: Prime button").focus()');
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  for (let attempt = 0; attempt < 100 && boundState.sequence < 1; attempt++) await new Promise(wait => setTimeout(wait, 50));
  assert.deepEqual(boundRequests.map(action=>[action.type,action.targetId]), [['activate_target','AIC-C01-PRIME']], 'The allowed button must send its target exactly once without the 3D asset');
  console.log('Learner named controls passed: keyboard dial, accepted state, focus, and door toggle.');
} finally {
  socket?.close();
  browser.kill();
  if (browser.exitCode === null) await new Promise(done => browser.once('close', done));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
