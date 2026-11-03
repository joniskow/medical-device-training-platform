import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const manifest = JSON.parse(await readFile('fixtures/nxstage-system-one/model-manifest.json', 'utf8'));
const scene = JSON.parse(await readFile('apps/web/src/model/nxstage-training-scene-manifest.json', 'utf8'));
const officeBackgroundVideoPath = 'fixtures/nxstage-system-one/nxstage-hallway-to-room-background-openmontage.mp4';
const officeBackgroundPhotoPath = 'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png';
const usePhoto = process.env.OFFICE_DEMO_BACKGROUND === 'photo';
const runtime = await build({
  stdin: { contents: `import { createBabylonModelRuntime } from './src/babylon-model-runtime.ts'; export { createBabylonModelRuntime };`, resolveDir: resolve('apps/web'), sourcefile: 'office-demo.ts' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  legalComments: 'none',
});
const runtimeJs = runtime.outputFiles[0].contents;
const pageJs = `import { createBabylonModelRuntime } from '/runtime.js';
const status = document.querySelector('#status');
const canvas = document.querySelector('#model');
const manifest = ${JSON.stringify(manifest)};
const scene = ${JSON.stringify(scene)};
const runtime = await createBabylonModelRuntime({
  canvas,
  manifest,
  modelUrl: '/model.glb',
  transparentBackground: true,
  interactiveCamera: true,
  camera: scene.camera.orbit,
  lighting: { direction: scene.camera.lightDirection, exposure: ${usePhoto ? '.70' : '0'}, whiteBalanceKelvin: ${usePhoto ? '5400' : '5200'} },
  modelTransform: scene.model,
  contactShadow: scene.render.contactShadow,
  onStateChange: (state) => { status.textContent = state.phase === 'READY' ? 'Ready · OpenMontage background + interactive NxStage GLB.' : state.phase === 'LOADING' ? 'Loading OpenMontage background + approved NxStage model…' : state.phase; },
  onInteractionTargetActivated: ({ targetId }) => { status.textContent = targetId + ' activated · local press feedback completed.'; },
});
document.querySelectorAll('[data-component]').forEach((button) => button.addEventListener('click', () => { runtime.selectComponent(button.dataset.component, 'COMPONENT_LIST'); status.textContent = 'Selected ' + button.textContent + ' · click the matching control on the model.'; }));
`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NxStage System One · Doctor’s office demo</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#173d3d;background:#eef3ed}*{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:auto;padding:28px 32px 42px}.top{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:18px}.eyebrow{margin:0 0 8px;color:#287168;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.top h1{margin:0;font-size:32px;line-height:1.05}.top p{margin:8px 0 0;color:#5e7772}.badge{padding:8px 11px;border-radius:999px;background:#d9f470;color:#245149;font-size:11px;font-weight:800}.scene{position:relative;overflow:hidden;aspect-ratio:16/9;min-height:560px;border-radius:18px;background:#d7ded8;box-shadow:0 20px 50px #25565020}.scene:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,#ffffff1c,transparent 25% 76%,#244e4612);z-index:1}.scene-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}.scene-video::-webkit-media-controls{display:none!important}#model{position:absolute;inset:0;width:100%;height:100%;z-index:2;display:block;touch-action:none}.label{position:absolute;z-index:4;left:18px;bottom:18px;padding:8px 11px;border-radius:999px;background:#082629cc;color:#e3f4e9;font-size:12px;font-weight:800}.status{position:absolute;z-index:4;left:18px;top:18px;padding:8px 11px;border-radius:999px;background:#082629cc;color:#e3f4e9;font-size:12px}.controls{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.controls button{border:1px solid #b9d2c8;border-radius:999px;padding:10px 14px;background:#fff;color:#245b57;font-weight:800;cursor:pointer}.controls button:hover{background:#dff1e7}.note{margin-top:15px;color:#607770;font-size:12px}.note strong{color:#285c57}@media(max-width:700px){.shell{padding:18px}.top{display:block}.badge{display:inline-block;margin-top:15px}.scene{min-height:360px}}
</style>
</head>
<body>
<main class="shell">
<header class="top"><div><p class="eyebrow">Interactive training scene · local preview</p><h1>NxStage System One in a doctor’s office</h1><p>The approved photo-grounded model is composited over an OpenMontage-generated office video plate.</p></div><span class="badge">REVIEW REQUIRED · UNMEASURED SCALE</span></header>
<section class="scene" aria-label="NxStage System One in a doctor’s office"><video class="scene-video" autoplay muted loop playsinline preload="auto" poster="/openmontage-office-poster.png" aria-hidden="true"><source src="/openmontage-office.mp4" type="video/mp4"></video><canvas id="model" aria-label="Interactive NxStage System One 3D model"></canvas><span class="status" id="status">Loading OpenMontage background + approved NxStage model…</span><span class="label">OpenMontage background · 3s ambient office plate</span></section>
<div class="controls"><button data-component="nxstage-control-panel">Select control panel</button><button data-component="nxstage-main-body">Select main body</button><button data-component="nxstage-base">Select base</button></div>
<p class="note"><strong>Try it:</strong> drag the model to orbit, use the wheel to zoom, then click one of the four front-panel controls. The background is generated as a separate OpenMontage video layer, so the real GLB interaction targets remain stable above it.</p>
</main>
<script type="module" src="/page.js"></script>
</body>
</html>`;
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/runtime.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(runtimeJs); return; }
  if (path === '/page.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(pageJs); return; }
  if (path === '/openmontage-office.mp4') { response.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }); response.end(await readFile(officeBackgroundVideoPath)); return; }
  if (path === '/openmontage-office-photo.png') { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); response.end(await readFile(officeBackgroundPhotoPath)); return; }
  if (path === '/openmontage-office-poster.png') { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); response.end(await readFile('output/openmontage/nxstage-doctors-office-source.png')); return; }
  if (path === '/model.glb') { response.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); response.end(await readFile('fixtures/nxstage-system-one/nxstage-system-one.glb')); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); const renderedHtml = usePhoto ? html.replace('<video class="scene-video" autoplay muted loop playsinline preload="auto" poster="/openmontage-office-poster.png" aria-hidden="true"><source src="/openmontage-office.mp4" type="video/mp4"></video>', '<img class="scene-video" src="/openmontage-office-photo.png" alt="Photographic clinical room background plate" aria-hidden="true">').replace('OpenMontage background · 3s ambient office plate', 'Photographic clinical room · preview only').replace('REVIEW REQUIRED · UNMEASURED SCALE', 'PHOTO PLATE · REVIEW REQUIRED') : html.replace('autoplay muted loop playsinline', 'autoplay muted playsinline').replace('OpenMontage background · 3s ambient office plate', 'OpenMontage background · hallway-to-exam-room walkthrough').replace('</body>', '<script>const walkthroughVideo=document.querySelector(".scene-video"),interactiveModel=document.querySelector("#model");if(walkthroughVideo&&interactiveModel){const syncModel=()=>{const revealAt=Math.min(5.2,Math.max(0,(walkthroughVideo.duration||6)*0.78));const visible=walkthroughVideo.ended||walkthroughVideo.currentTime>=revealAt;interactiveModel.style.opacity=visible?"1":"0";interactiveModel.style.pointerEvents=visible?"auto":"none";};interactiveModel.style.opacity="0";walkthroughVideo.addEventListener("timeupdate",syncModel);walkthroughVideo.addEventListener("ended",syncModel);walkthroughVideo.addEventListener("loadedmetadata",syncModel);syncModel();setInterval(syncModel,100);}</script></body>'); response.end(renderedHtml);
});
const port = Number(process.env.OFFICE_DEMO_PORT ?? 55671);
await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
console.log(`OFFICE_DEMO_URL=http://127.0.0.1:${port}/`);
process.stdin.resume();
