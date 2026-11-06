import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

await mkdir('output/nxstage-interaction-review-office', {recursive:true});
const profile = await mkdtemp(resolve(tmpdir(), 'nxstage-office-review-'));
const reviewPort = Number(process.env.NXSTAGE_OFFICE_REVIEW_PORT ?? 4216);
const browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,1000', `http://127.0.0.1:${reviewPort}/demo?review=1`], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), errors = [];
const command = (method, params = {}) => new Promise((resolveCommand, reject) => { const id = ++sequence; pending.set(id, { resolve: resolveCommand, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
const waitFor = async expression => { for (let i = 0; i < 240; i++) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } throw Error(`Timed out: ${expression}; status=${await evaluate('document.querySelector("#demo-model-status")?.textContent')}; errors=${JSON.stringify(errors)}`); };
try {
  const base = `http://127.0.0.1:${reviewPort}`;
  const [modelResponse, manifestResponse, sceneResponse] = await Promise.all(['/model/nxstage-system-one.glb', '/model/nxstage-system-one-manifest.json', '/model/nxstage-training-scene-manifest.json'].map(path => fetch(base + path)));
  assert.equal(modelResponse.headers.get('content-encoding'), 'gzip', 'The office review should use lossless compression when supported');
  const modelHash = createHash('sha256').update(Buffer.from(await modelResponse.arrayBuffer())).digest('hex');
  const modelManifest = await manifestResponse.json(), sceneManifest = await sceneResponse.json();
  assert.equal(modelHash, modelManifest.sourceHash, 'The office must serve the candidate model bound by its manifest');
  assert.equal(modelHash, sceneManifest.model.sourceHash, 'The office scene must bind the same candidate');
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 100)); } }
  assert(port, 'Chrome did not start');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(item => item.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = event => { const message = JSON.parse(String(event.data)), waiter = pending.get(message.id); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); } };
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  await command('Runtime.enable');
  await waitFor('/Scene ready/.test(document.querySelector("#demo-model-status")?.textContent ?? "")');
  assert.match(await evaluate('document.querySelector("#demo-scene-canvas").getAttribute("aria-label")'), /arrow keys.*Enter or Space.*Escape/i);
  assert.match(await evaluate('document.querySelector("#demo-scene-canvas").getAttribute("aria-label")'), /Shift.*door or tub in increments/i, 'The keyboard movement shortcut must be discoverable to screen readers');
  await evaluate('document.querySelector("[data-action=toggle-scene-interaction]").click()');
  await waitFor('Boolean(window.__officeReviewRuntime)');
    await evaluate('document.querySelector("#demo-scene-canvas").focus()');
    for (let i = 0; i < 30 && await evaluate('window.__officeReviewRuntime.getState().focusedInteractionTargetId') !== 'NX-C01-ADD-FLUID'; i++) {
      await command('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
      await command('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    }
    assert.equal(await evaluate('window.__officeReviewRuntime.getState().focusedInteractionTargetId'), 'NX-C01-ADD-FLUID', 'Keyboard navigation must reach the Add Fluid control');
    await waitFor('/Keyboard focus on Add Fluid/.test(document.querySelector("#demo-model-status").textContent)');
    await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor('/Holding Add Fluid/.test(document.querySelector("#demo-model-status").textContent)');
    await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor('/Add Fluid pressed/.test(document.querySelector("#demo-model-status").textContent)');
    await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate('window.__officeReviewRuntime.getState().pressedInteractionTargetId ?? null'), null, 'Escape must release the control without leaving it held');
    assert(!/Add Fluid pressed/.test(await evaluate('document.querySelector("#demo-model-status").textContent')), 'Cancelling a keyboard press must not report an activation');
    const focusTarget = async target => {
      for (let i = 0; i < 40 && await evaluate('window.__officeReviewRuntime.getState().focusedInteractionTargetId') !== target; i++) {
        await command('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await command('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
      }
      assert.equal(await evaluate('window.__officeReviewRuntime.getState().focusedInteractionTargetId'), target);
    };
    const shiftKey = async (key, code, keyCode) => {
      await command('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,modifiers:8});
      await command('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,modifiers:8});
    };
    await focusTarget('NX-C02-CABINET-DOOR');
    await waitFor('/move gradually/.test(document.querySelector("#demo-model-status").textContent)');
    await shiftKey('ArrowUp','ArrowUp',38);
    const door = await evaluate('window.__officeReviewRuntime.getState().transforms["nxstage-cabinet-door"].rotationY');
    assert(door < 0 && door > -Math.PI/2, `One keyboard step must move the door partially: ${door}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
    await focusTarget('PF-C02-TUB');
    await shiftKey('ArrowUp','ArrowUp',38);
    await waitFor('/Open the cabinet door fully/.test(document.querySelector("#demo-model-status").textContent)');
    assert.equal(await evaluate('window.__officeReviewRuntime.getState().transforms["pureflow-tub"].translationX'), 0, 'The tub must remain in until the door is fully open');
    await focusTarget('NX-C02-CABINET-DOOR');
    await shiftKey('ArrowDown','ArrowDown',40);
    assert(Math.abs(await evaluate('window.__officeReviewRuntime.getState().transforms["nxstage-cabinet-door"].rotationY')) < 1e-8, 'The reverse keyboard step must close the door');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Office keyboard: selection, activation, cancellation, partial door movement and tub interlock verified.');
} finally {
  socket?.close(); browser.kill();
  if (browser.exitCode === null) await new Promise(resolveClose => browser.once('close', resolveClose));
  for (let i = 0; i < 20; i++) { try { await rm(profile, { recursive: true, force: true }); break; } catch (error) { if (error.code !== 'EBUSY' || i === 19) throw error; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } }
}
