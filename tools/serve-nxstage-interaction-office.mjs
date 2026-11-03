import { warmerDemo } from './nxstage-review-warmer.mjs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { validateTrainingSceneManifest } from '../packages/contracts/dist/scene-manifest.js';
import { validateBrowserModelManifest } from '../packages/model-runtime/dist/browser.js';

// Review-only overlay for the ordinary local demo. It never writes the shared
// model, scene, release, or the separately rendered cinematic foreground.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(root, 'fixtures/nxstage-system-one-interaction-review');
const modelFolder = folder;
const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const bundle = await build({entryPoints:[resolve(root,'apps/web/src/demo.ts')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,legalComments:'none'});
const demoSource = bundle.outputFiles[0].text;
const modelBytes = await readFile(`${modelFolder}/nxstage-system-one.glb`);
const compressedModel = gzipSync(modelBytes);
const manifestBytes = await readFile(`${modelFolder}/model-manifest.json`);
const sceneBytes = await readFile(`${folder}/office-scene-review.json`);
const model = validateBrowserModelManifest(JSON.parse(manifestBytes));
const scene = validateTrainingSceneManifest(JSON.parse(sceneBytes));
const modelHash = createHash('sha256').update(modelBytes).digest('hex');
assert.equal(model.sourceHash, modelHash, 'Review model manifest must match GLB bytes');
assert.equal(scene.model.sourceHash, modelHash, 'Review scene must match GLB bytes');
assert.equal(scene.model.modelVersionId, model.modelVersionId);
assert.equal(scene.video.sourceHash, createHash('sha256').update(await readFile(resolve(root,'fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4'))).digest('hex'), 'Review scene must match its background video');
for (const cue of scene.interaction?.cues ?? []) {
  const component = model.components.find(item => item.componentId === cue.componentId);
  assert(component?.interactionTargets?.some(target => target.targetId === cue.targetId), `Unknown review cue ${cue.targetId}`);
}
const paths = new Map([
  ['/model/nxstage-system-one.glb', [modelBytes, 'model/gltf-binary']],
  ['/model/nxstage-system-one-manifest.json', [manifestBytes, 'application/json; charset=utf-8']],
  ['/model/nxstage-training-scene-manifest.json', [sceneBytes, 'application/json; charset=utf-8']],
]);
const initialState = {
  view: 'creator', creatorStep: 'content', sourceStage: 'content', sourceKind: 'photos',
  sourceFiles: ['System One photos'], sourceFileName: 'System One photos', sourceProgress: 100,
  pipelinePhase: 'APPROVED', pipelineJobId: 'job:interaction-review', pipelineAttempt: 1,
  candidateTriangles: model.triangleCount, reviewRationale: '', demoSource: true, videoPlaying: false,
  sceneInteractive: false, answer: 'idle', published: false, learnerProgress: 33,
  narrationText: 'Explore the System One control panel, cycler handle and doors, and PureFlow cabinet in this visual review. Controls provide local movement feedback; treatment settings, fluid operation and the cartridge chamber are not simulated.',
  currentLesson: 0, selectedModule: null, editingModule: null,
  backgroundMode: 'LOCKED_INTERACTIVE', backgroundStatus: 'REVIEW_REQUIRED', backgroundApproved: false,
  backgroundGenerationId: 'gen:interaction-review', backgroundJobId: 'job:interaction-review-background',
  backgroundProgress: 100, backgroundPreviewUrl: '/demo-assets/nxstage-clinical-photo-v4.png',
  modules: [{ title: 'Orientation', type: 'Reading', minutes: 8, description: 'Orientation', completed: true }, { title: 'Flow path', type: 'Interactive lesson', minutes: 12, description: 'Flow path', completed: false }, { title: 'Checklist', type: 'Knowledge check', minutes: 10, description: 'Checklist', completed: false }],
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const replacement = paths.get(url.pathname);
    if (replacement) {
      const acceptsGzip = url.pathname === '/model/nxstage-system-one.glb' && (request.headers['accept-encoding'] ?? '').split(',').some(part => { const [encoding, ...params] = part.trim().toLowerCase().split(';'); const quality = params.find(param => param.trim().startsWith('q=')); return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0); });
      response.writeHead(200, { 'content-type': replacement[1], 'cache-control': 'no-store', ...(url.pathname === '/model/nxstage-system-one.glb' ? { vary: 'Accept-Encoding' } : {}), ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}) });
      response.end(acceptsGzip ? compressedModel : replacement[0]); return;
    }
    if (url.pathname === '/demo.js') {
      const source = demoSource;
      const actionMarker = '    }, onInteractionTargetActivated: ({ targetId, targetName, interactionType, transform }) => {';
      assert.equal(source.split(actionMarker).length, 2, 'Warmer feedback must bind exactly one interaction callback');
      let script = (warmerDemo + source).replace(actionMarker, actionMarker + '\n      if (generation === demoModelGeneration && interactionType === "press" && (targetId === "FW-C01-UP" || targetId === "FW-C01-DOWN")) updateWarmerDemo(targetId);');
      const resetMarker = 'reset.addEventListener("click", () => {\n      runtime.resetView();';
      assert.equal(script.split(resetMarker).length, 2, 'Review reset must bind exactly one view control');
      script = script.replace(resetMarker, resetMarker + '\n      if (app.querySelector(".training-scene.review-explore")) runtime.fitModel();');
      // The shared demo's old thumbnail artifacts refer to a different model.
      const artifactMarker = 'function renderBackgroundReviewArtifacts() {';
      assert.equal(script.split(artifactMarker).length, 2, 'Review artifacts must bind exactly once');
      script = script.replace(artifactMarker, artifactMarker + ' return "";');
      const positionMarker = 'const position = target?.openVerb === "Lift" ?';
      assert.equal(script.split(positionMarker).length, 2, 'Switch position feedback must bind exactly once');
      script = script.replace(positionMarker, 'const position = target?.openVerb === "Set on" ? (target.isOpen ? "in the on position (power not simulated)" : "in the off position (power not simulated)") : target?.openVerb === "Lift" ?');
      const canvasMarker = '</canvas><span class="video-caption">';
      assert.equal(script.split(canvasMarker).length, 2, 'Review enlargement control must bind exactly one scene template');
      script = script.replace(canvasMarker, '</canvas><button type="button" class="review-enlarge" data-review-enlarge aria-label="Enlarge scene">Enlarge scene</button><button type="button" class="review-zoom" data-review-zoom aria-pressed="false">Close view</button><button type="button" class="review-explore-button" data-review-explore aria-pressed="false" hidden>Explore model</button><span class="video-caption">');
      const runtimeMarker = '    runtimeForControls = runtime;';
      assert.equal(script.split(runtimeMarker).length, 2, 'Explore mode must bind exactly one runtime');
      script = script.replace(runtimeMarker, runtimeMarker + '\n    if (composite) { const button=app.querySelector("[data-review-explore]"); const scene=canvas.closest(".training-scene"); if(button && scene){ const setExploring = exploring => { runtime.setCameraInteractive(exploring); if(exploring)runtime.fitModel(); else runtime.resetView(); scene.classList.toggle("review-explore",exploring); button.setAttribute("aria-pressed",String(exploring)); button.textContent=exploring ? "Return to office" : "Explore model"; }; button.hidden=!state.sceneInteractive; button.addEventListener("click", () => { const exploring=button.getAttribute("aria-pressed")!=="true"; setExploring(exploring); if(status)status.textContent=exploring ? "Explore the model: drag to rotate and use the wheel or pinch to zoom." : "Office view restored."; }); app.querySelector("[data-action=toggle-scene-interaction]")?.addEventListener("click", () => { button.hidden=!state.sceneInteractive; if(!state.sceneInteractive && button.getAttribute("aria-pressed")==="true")setExploring(false); }); } }');
      if (process.env.OFFICE_REVIEW_TEST === '1') {
        const marker = '    runtimeForControls = runtime;';
        assert.equal(script.split(marker).length, 2, 'Test hook must match exactly one runtime initialization');
        script = script.replace(marker, marker + '\n    window.__officeReviewRuntime = runtime; window.__officeCamera = () => {const c=EngineStore.LastCreatedScene.activeCamera;return {alpha:c.alpha,beta:c.beta,radius:c.radius,target:c.target.asArray()};}; window.__officeWarmerLights = () => Array.from({length: 9}, (_, index) => EngineStore.LastCreatedScene.meshes.find(mesh => mesh.name === "Warmer setting indicator " + (index + 1))?.material?.emissiveColor?.g ?? 0); window.__officeTargetPoint = id => { const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(item=>item.metadata?.interactionTargetId===id),canvas=document.querySelector("#demo-scene-canvas"),rect=canvas.getBoundingClientRect(),engine=scene.getEngine(); if (!mesh) return null; mesh.computeWorldMatrix(true); const p=Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld, Matrix.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight())); return {x:rect.left+p.x*rect.width/engine.getRenderWidth(),y:rect.top+p.y*rect.height/engine.getRenderHeight()}; };');
        script = script.replace(marker, marker + '\n    window.__officeTubMotion = () => {const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(m=>m.name==="PureFlow tub front"),root=scene.getTransformNodeByName("PureFlow tub travel axis"),rect=canvas.getBoundingClientRect(),engine=scene.getEngine(),view=scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());if(!mesh||!root)return null;mesh.computeWorldMatrix(true);root.parent?.computeWorldMatrix(true);const center=mesh.getBoundingInfo().boundingBox.centerWorld,travel=Vector3.TransformNormal(new Vector3(2.1,0,0),root.parent?.getWorldMatrix()??Matrix.Identity()),a=Vector3.Project(center,Matrix.Identity(),scene.getTransformMatrix(),view),b=Vector3.Project(center.add(travel),Matrix.Identity(),scene.getTransformMatrix(),view);return {point:{x:rect.left+a.x*rect.width/engine.getRenderWidth(),y:rect.top+a.y*rect.height/engine.getRenderHeight()},delta:{x:(b.x-a.x)*rect.width/engine.getRenderWidth(),y:(b.y-a.y)*rect.height/engine.getRenderHeight()}};};');
      }
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(script);
      return;
    }
    if (url.pathname === '/demo') {
      const html = await readFile(resolve(root, 'apps/web/src/demo.html'), 'utf8');
      assert(html.includes('<div id="app"></div>') && html.includes('<script type="module"') && html.includes('</head>'), 'The review page cannot safely adapt the current demo HTML');
      const bootstrap = url.searchParams.has('review') ? `<script>localStorage.setItem('aurora-training-demo-v4', ${JSON.stringify(JSON.stringify(initialState))}); history.replaceState(null, '', '/demo');</script>` : '';
      const notice = '<p role="note" style="margin:0;padding:12px 20px;background:#fff4d9;color:#463617;font:14px system-ui">Interactive review: dimensions and hidden geometry are estimates. The upper cartridge chamber is simplified, and device operation is not simulated. Switch positions are approximate and warmer bars are illustrative; power, temperature and heating are not simulated. <a href="#demo-scene-canvas">Jump to the model</a></p>';
      const enlargement = `<style>
.training-scene.photo-ready .training-scene-video { opacity:1; }
.review-enlarge { position:absolute; z-index:4; right:10px; top:10px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-enlarge:focus-visible, .review-zoom:focus-visible { outline:3px solid #ffd76c; outline-offset:2px; }
.review-zoom { position:absolute; z-index:4; right:10px; top:52px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-explore-button { position:absolute; z-index:4; right:10px; top:94px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-explore-button:focus-visible { outline:3px solid #ffd76c; outline-offset:2px; }
.training-scene.review-explore { background:#0b1b20; }
.training-scene.review-explore .training-scene-video, .training-scene.review-explore .doctors-office-backdrop { visibility:hidden; }
.training-scene.review-close .training-scene-model, .training-scene.review-close .training-scene-video, .training-scene.review-close .doctors-office-backdrop { inset:auto; left:-35%; top:-35%; width:170%; height:170%; }

.generated-video:fullscreen { box-sizing:border-box; overflow:auto; padding:16px; background:#eaf1ee; }
.generated-video:fullscreen .training-scene { width:min(100%, 1200px, calc((100vh - 12rem) * 16 / 9)); min-height:0; margin:10px auto; }
.generated-video:fullscreen .scene-named-controls { max-width:70rem; margin:0 auto; }
@media (max-width:700px) {
  .focus-body, .focus-content, .generated-video, .scene-named-controls { min-width:0; }
  .focus-content { grid-template-columns:minmax(0,1fr); }
  .background-generation-controls .edit-field { min-width:0; }
  .named-model-control-list button { max-width:100%; }
  .training-scene { min-height:340px; aspect-ratio:auto; }
  .training-scene-model, .training-scene-video, .doctors-office-backdrop { top:130px; height:calc(100% - 130px); }
}
</style><script>
document.addEventListener('load', event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.id === 'training-photo' && image.naturalWidth > 0) image.closest('.training-scene')?.classList.add('photo-ready');
}, true);
document.addEventListener('click', async event => {
  const zoom = event.target.closest('[data-review-zoom]');
  if (zoom) {
    const scene = zoom.closest('.training-scene');
    const close = scene.classList.toggle('review-close');
    zoom.textContent = close ? 'Return to scene' : 'Close view';
    zoom.setAttribute('aria-pressed', String(close));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return;
  }
  const button = event.target.closest('[data-review-enlarge]');
  if (!button) return;
  const container = button.closest('.generated-video');
  try { if (document.fullscreenElement === container) await document.exitFullscreen(); else if (!document.fullscreenElement) await container.requestFullscreen(); }
  catch { button.textContent = 'Full screen unavailable'; button.setAttribute('aria-label', 'Full screen unavailable in this browser'); }
});
document.addEventListener('fullscreenchange', () => {
  document.querySelectorAll('[data-review-enlarge]').forEach(button => { const expanded = document.fullscreenElement === button.closest('.generated-video'); button.textContent = expanded ? 'Exit full screen' : 'Enlarge scene'; button.setAttribute('aria-label', button.textContent); button.setAttribute('aria-pressed', String(expanded)); });
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
});
</script>`;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html.replace('</head>', `${enlargement}</head>`).replace('<div id="app"></div>', `${notice}<div id="app"></div>`).replace('<script type="module"', `${bootstrap}<script type="module"`));
      return;
    }
    if (url.pathname === '/') { response.writeHead(302, {location:'/demo?review=1', 'cache-control':'no-store'}); response.end(); return; }
    const assets = new Map([
      ['/demo.css', [resolve(root,'apps/web/src/demo.css'), 'text/css; charset=utf-8']],
      ['/demo-assets/nxstage-clinical-photo-v4.png', [resolve(root,'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png'), 'image/png']],
      ['/demo-assets/nxstage-office-background-photo-openmontage.mp4', [resolve(root,'fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4'), 'video/mp4']],
      ['/demo-assets/nxstage-system-one-preview.png', [resolve(folder,'panel-review.png'), 'image/png']],
    ]);
    const asset = assets.get(url.pathname);
    if (asset) { response.writeHead(200, {'content-type':asset[1], 'cache-control':'no-store'}); response.end(await readFile(asset[0])); return; }
    response.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); response.end('Not found');
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Unable to load the review.');
    console.error(error);
  }
});
const port = Number(process.env.NXSTAGE_OFFICE_REVIEW_PORT ?? 4216);
server.listen(port, '127.0.0.1', () => console.log(`Office interaction review: http://127.0.0.1:${port}/demo?review=1`));
