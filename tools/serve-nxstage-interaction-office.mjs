import { warmerDemo } from './nxstage-review-warmer.mjs';
import { panelMagnifierSource } from './nxstage-review-magnifier.mjs';
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
const folder = resolve(root, process.env.NXSTAGE_OFFICE_REVIEW_FOLDER ?? 'fixtures/nxstage-system-one-interaction-review');
const modelFolder = folder;
const { build } = createRequire(new URL('../apps/web/package.json', import.meta.url))('esbuild');
const bundle = await build({entryPoints:[resolve(root,'apps/web/src/demo.ts')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,legalComments:'none'});
const demoSource = bundle.outputFiles[0].text;
const modelBytes = await readFile(`${modelFolder}/nxstage-system-one.glb`);
const compressedModel = gzipSync(modelBytes);
const manifestBytes = await readFile(`${modelFolder}/model-manifest.json`);
const photorealWalkthroughPath = resolve(root, 'output/generated/nxstage-doctors-office-walkthrough-v3/nxstage-doctors-office-walkthrough-photoreal-v3.mp4');
const photorealWalkthroughBytes = await readFile(photorealWalkthroughPath);
const photorealWalkthroughHash = createHash('sha256').update(photorealWalkthroughBytes).digest('hex');
const sourceScene = JSON.parse(await readFile(`${folder}/office-scene-review.json`, 'utf8'));
const model = validateBrowserModelManifest(JSON.parse(manifestBytes));
const scene = validateTrainingSceneManifest({
  ...sourceScene,
  sceneId: 'scene:nxstage:office-overlay:photoreal-walkthrough',
  video: { ...sourceScene.video, assetVersionId: 'assetv:generated:nxstage-photoreal-walkthrough-v3', sourceHash: photorealWalkthroughHash, frameRate: 24, durationSeconds: 7 },
  interaction: { ...sourceScene.interaction, cues: (sourceScene.interaction?.cues ?? []).map(cue => ({ ...cue, startSeconds: 3.5, endSeconds: 7 })) },
});
const modelHash = createHash('sha256').update(modelBytes).digest('hex');
assert.equal(model.sourceHash, modelHash, 'Review model manifest must match GLB bytes');
assert.equal(scene.model.sourceHash, modelHash, 'Review scene must match GLB bytes');
assert.equal(scene.model.modelVersionId, model.modelVersionId);
assert.equal(scene.video.sourceHash, photorealWalkthroughHash, 'Review scene must match its photoreal walkthrough');
for (const cue of scene.interaction?.cues ?? []) {
  const component = model.components.find(item => item.componentId === cue.componentId);
  assert(component?.interactionTargets?.some(target => target.targetId === cue.targetId), `Unknown review cue ${cue.targetId}`);
}
const paths = new Map([
  ['/model/nxstage-system-one.glb', [modelBytes, 'model/gltf-binary']],
  ['/model/nxstage-system-one-manifest.json', [manifestBytes, 'application/json; charset=utf-8']],
  ['/model/nxstage-training-scene-manifest.json', [Buffer.from(JSON.stringify(scene)), 'application/json; charset=utf-8']],
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
  backgroundProgress: 100, backgroundPreviewUrl: '/demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4',
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
      const actionMarker = '    }, onInteractionTargetActivated: ({ targetId, targetName, componentId, interactionType, moving, transform }) => {';
      assert.equal(source.split(actionMarker).length, 2, 'Warmer feedback must bind exactly one interaction callback');
      let script = (warmerDemo + panelMagnifierSource + source).replace(actionMarker, actionMarker + '\n      if (generation === demoModelGeneration && interactionType === "press" && (targetId === "FW-C01-UP" || targetId === "FW-C01-DOWN")) updateWarmerDemo(targetId);');
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
      const placementMarker = 'modelTransform: sceneBinding?.scene.model,';
      assert.equal(script.split(placementMarker).length, 2, 'Review placement must bind exactly once');
      // Keep selected parts distinguishable without obscuring the photo-based
      // control colors after someone uses a named or keyboard control.
      script = script.replace(placementMarker, placementMarker + ' preserveImportedRoot: true, selectedHighlightOpacity: 0.08,');
      const canvasMarker = '</canvas><span class="video-caption">';
      assert.equal(script.split(canvasMarker).length, 2, 'Review enlargement control must bind exactly one scene template');
      script = script.replace(canvasMarker, '</canvas><button type="button" class="review-enlarge" data-review-enlarge aria-label="Enlarge scene">Enlarge scene</button><button type="button" class="review-zoom" data-review-zoom aria-pressed="false">Close view</button><button type="button" class="review-explore-button" data-review-explore aria-pressed="false" hidden>Explore model</button><span class="video-caption">');
      const runtimeMarker = '    runtimeForControls = runtime;';
      assert.equal(script.split(runtimeMarker).length, 2, 'Explore mode must bind exactly one runtime');
      script = script.replace(runtimeMarker, runtimeMarker + '\n    if (composite) { const button=app.querySelector("[data-review-explore]"); const scene=canvas.closest(".training-scene"); if(button && scene){ const setExploring = exploring => { runtime.setCameraInteractive(exploring); if(exploring)runtime.fitModel(); else runtime.resetView(); scene.classList.toggle("review-explore",exploring); const focus=app.querySelector("[data-review-focus-handle]");if(focus)focus.hidden=!exploring;const magnifier=app.querySelector("[data-review-panel-magnifier]");if(magnifier)magnifier.hidden=!exploring; button.setAttribute("aria-pressed",String(exploring)); button.textContent=exploring ? "Return to office" : "Explore model"; }; button.hidden=!state.sceneInteractive; button.addEventListener("click", () => { const exploring=button.getAttribute("aria-pressed")!=="true"; setExploring(exploring); if(status)status.textContent=exploring ? "Explore the model: drag to rotate and use the wheel or pinch to zoom." : "Office view restored."; }); app.querySelector("[data-action=toggle-scene-interaction]")?.addEventListener("click", () => { button.hidden=!state.sceneInteractive; if(!state.sceneInteractive && button.getAttribute("aria-pressed")==="true")setExploring(false); }); } }');
      const initMarker = 'async function initDemoModel() {';
      assert.equal(script.split(initMarker).length, 2, 'Review handle helper must bind once');
      script = script.replace(initMarker, 'function addReviewHandleFocus(canvas,runtime){const panel=app.querySelector(".scene-named-controls");if(!panel||panel.querySelector("[data-review-focus-handle]"))return;const focus=document.createElement("button");focus.type="button";focus.className="outline-btn";focus.dataset.reviewFocusHandle="";focus.textContent="Focus door handle";focus.hidden=!app.querySelector(".training-scene.review-explore");focus.addEventListener("click",()=>{runtime.frameComponent("nxstage-cycler-handle");const camera=EngineStore.LastCreatedScene?.activeCamera;if(camera)camera.radius=Math.min(camera.upperRadiusLimit??Infinity,camera.radius*1.8);canvas.scrollIntoView({block:"nearest"});const status=app.querySelector("#demo-model-status");if(status)status.textContent="Focused cycler door handle.";});panel.insertBefore(focus,panel.querySelector(".named-model-controls"));const magnifier=document.createElement("details");magnifier.dataset.reviewPanelMagnifier="";magnifier.hidden=focus.hidden;magnifier.innerHTML="<summary>Magnify panel controls</summary><p>Choose a group for a closer 3D view. Use Reset view to return to the full model.</p><div class=review-panel-groups><button class=outline-btn type=button data-review-panel-region=left>Left buttons</button><button class=outline-btn type=button data-review-panel-region=decrease>Decrease arrows</button><button class=outline-btn type=button data-review-panel-region=increase>Increase arrows</button><button class=outline-btn type=button data-review-panel-region=right>Stop and mute</button><button class=outline-btn type=button data-review-panel-region=lower-arrows>Lower panel arrows</button><button class=outline-btn type=button data-review-panel-region=lower-actions>Lower panel GO and STOP</button></div>";magnifier.querySelectorAll("[data-review-panel-region]").forEach(button=>button.addEventListener("click",()=>{if(button.dataset.reviewPanelRegion.startsWith("lower-")){const blocked=runtime.interactionBlockReason("PF-C02-TUB",{translationX:2.1});if(blocked){const status=app.querySelector("#demo-model-status");if(status)status.textContent=blocked;return;}}if(magnifyNxstagePanel(button.dataset.reviewPanelRegion,canvas)){const status=app.querySelector("#demo-model-status");if(status)status.textContent="Magnified "+button.textContent.toLowerCase()+".";}}));panel.insertBefore(magnifier,panel.querySelector(".named-model-controls"));}\n' + initMarker);
      const controlsMarker = '    if (!composite || state.sceneInteractive) addNamedModelControls(canvas, runtime);';
      assert.equal(script.split(controlsMarker).length, 2, 'Review handle focus must bind once during initialization');
      script = script.replace(controlsMarker, controlsMarker + '\n    if (composite && state.sceneInteractive) addReviewHandleFocus(canvas,runtime);');
      const toggleControlsMarker = '        addNamedModelControls(canvas, demoModelRuntime);';
      assert.equal(script.split(toggleControlsMarker).length, 2, 'Review handle focus must bind once when interaction is enabled');
      script = script.replace(toggleControlsMarker, toggleControlsMarker + '\n        addReviewHandleFocus(canvas,demoModelRuntime);');
      if (process.env.OFFICE_REVIEW_TEST === '1') {
        const marker = '    runtimeForControls = runtime;';
        assert.equal(script.split(marker).length, 2, 'Test hook must match exactly one runtime initialization');
        script = script.replace(marker, marker + '\n    window.__officeReviewRuntime = runtime; window.__officeCamera = () => {const c=EngineStore.LastCreatedScene.activeCamera;return {alpha:c.alpha,beta:c.beta,radius:c.radius,target:c.target.asArray()};}; window.__officeWarmerLights = () => Array.from({length: 9}, (_, index) => EngineStore.LastCreatedScene.meshes.find(mesh => mesh.name === "Warmer setting indicator " + (index + 1))?.material?.emissiveColor?.g ?? 0); window.__officeTargetPoint = id => { const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(item=>item.metadata?.interactionTargetId===id),canvas=document.querySelector("#demo-scene-canvas"),rect=canvas.getBoundingClientRect(),engine=scene.getEngine(); if (!mesh) return null; mesh.computeWorldMatrix(true); const p=Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld, Matrix.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight())); return {x:rect.left+p.x*rect.width/engine.getRenderWidth(),y:rect.top+p.y*rect.height/engine.getRenderHeight()}; };');
        script = script.replace(marker, marker + '\n    window.__officeComponentHighlight = id => {const m=EngineStore.LastCreatedScene.meshes.find(item=>item.metadata?.componentId===id && item.renderOverlay);return m?{alpha:m.overlayAlpha,color:m.overlayColor.asArray()}:null;};');
        script = script.replace(marker, marker + '\n    window.__officeRearCabinetView = () => {const s=EngineStore.LastCreatedScene,c=s.activeCamera,m=s.meshes.find(item=>item.name==="Rear gray service cover");if(!m)return false;m.computeWorldMatrix(true);c.alpha=-Math.PI/2;c.beta=Math.PI/2;c.setTarget(m.getBoundingInfo().boundingBox.centerWorld,false,false,true);c.radius=.75;c.inertialAlphaOffset=c.inertialBetaOffset=c.inertialRadiusOffset=c.inertialPanningX=c.inertialPanningY=0;s.render();return true;};');
        script = script.replace(marker, marker + '\n    window.__officeShelfStudy = () => {const s=EngineStore.LastCreatedScene,c=s.activeCamera,m=s.meshes.find(item=>item.name==="Upper white shelf");if(!m)return false;const old={alpha:c.alpha,beta:c.beta,radius:c.radius,target:c.target.clone()};m.computeWorldMatrix(true);const b=m.getBoundingInfo().boundingBox,center=b.centerWorld.clone();center.z=b.maximumWorld.z-.035;center.y=b.maximumWorld.y;c.setTarget(center,false,false,true);c.alpha=Math.PI/2;c.beta=.9;c.radius=.65;c.inertialAlphaOffset=c.inertialBetaOffset=c.inertialRadiusOffset=c.inertialPanningX=c.inertialPanningY=0;s.render();window.__officeRestoreShelfStudy=()=>{c.setTarget(old.target,false,false,true);c.alpha=old.alpha;c.beta=old.beta;c.radius=old.radius;s.render();};return true;};');
        script = script.replace(marker, marker + '\n    window.__officeComponentBounds = id => {const scene=EngineStore.LastCreatedScene,engine=scene.getEngine(),width=engine.getRenderWidth(),height=engine.getRenderHeight(),viewport=scene.activeCamera.viewport.toGlobal(width,height),points=[];for(const mesh of scene.meshes.filter(m=>m.metadata?.componentId===id)){mesh.computeWorldMatrix(true);for(const p of mesh.getBoundingInfo().boundingBox.vectorsWorld){const q=Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),viewport);points.push([q.x/width,q.y/height]);}}return points.length?{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}:null;};');
        script = script.replace(marker, marker + '\n    window.__officeTargetSize = id => {const scene=EngineStore.LastCreatedScene,engine=scene.getEngine(),rect=canvas.getBoundingClientRect(),width=engine.getRenderWidth(),height=engine.getRenderHeight(),viewport=scene.activeCamera.viewport.toGlobal(width,height),points=[];for(const mesh of scene.meshes.filter(m=>m.metadata?.interactionTargetId===id)){mesh.computeWorldMatrix(true);for(const p of mesh.getBoundingInfo().boundingBox.vectorsWorld){const q=Vector3.Project(p,Matrix.Identity(),scene.getTransformMatrix(),viewport);points.push([q.x/width*rect.width,q.y/height*rect.height]);}}return points.length?{width:Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),height:Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))}:null;};');
        script = script.replace(marker, marker + '\n    window.__officeHandlePoint = () => {const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(m=>m.name==="Cycler door pull"),rect=canvas.getBoundingClientRect(),engine=scene.getEngine();if(!mesh)return null;mesh.computeWorldMatrix(true);const p=Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld,Matrix.Identity(),scene.getTransformMatrix(),scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));return {x:rect.left+p.x*rect.width/engine.getRenderWidth(),y:rect.top+p.y*rect.height/engine.getRenderHeight()};};');
        script = script.replace(marker, marker + '\n    window.__officeRegrabReturningHandle = () => {const before=window.__officeHandlePoint(),hit=window.__officeHitAt(before.x,before.y),event=(type,y,buttons)=>canvas.dispatchEvent(new PointerEvent(type,{clientX:before.x,clientY:y,pointerId:871,pointerType:"mouse",button:0,buttons,bubbles:true}));event("pointerdown",before.y,1);const held=runtime.getState().pressedInteractionTargetId,after=window.__officeHandlePoint();event("pointermove",before.y-100,1);const moved=runtime.getState().transforms["nxstage-cycler-handle"].rotationY;event("pointerup",before.y-100,0);return {before,after,hit,held,moved};};');
        script = script.replace(marker, marker + '\n    window.__officeHitAt = (x,y) => {const scene=EngineStore.LastCreatedScene,rect=canvas.getBoundingClientRect(),engine=scene.getEngine(),scale=engine.getHardwareScalingLevel();return scene.pick((x-rect.left)*engine.getRenderWidth()*scale/rect.width,(y-rect.top)*engine.getRenderHeight()*scale/rect.height)?.pickedMesh?.metadata?.interactionTargetId;};');
        script = script.replace(marker, marker + '\n    window.__officePickDiagnostic = (x,y) => {const s=EngineStore.LastCreatedScene,e=s.getEngine(),r=canvas.getBoundingClientRect(),scale=e.getHardwareScalingLevel(),px=(x-r.left)*e.getRenderWidth()*scale/r.width,py=(y-r.top)*e.getRenderHeight()*scale/r.height,p=s.pick(px,py),m=s.meshes.find(item=>item.metadata?.interactionTargetId==="NX-C01-VOLUME-TOGGLE"),v=s.activeCamera.viewport.toGlobal(e.getRenderWidth(),e.getRenderHeight()),world=m.getBoundingInfo().boundingBox.centerWorld,live=Vector3.Project(world,Matrix.Identity(),s.activeCamera.getViewMatrix().multiply(s.activeCamera.getProjectionMatrix()),v);return {px,py,scale,renderWidth:e.getRenderWidth(),renderHeight:e.getRenderHeight(),live:{x:r.left+live.x*r.width/e.getRenderWidth(),y:r.top+live.y*r.height/e.getRenderHeight()},picked:p?.pickedMesh?.name,target:p?.pickedMesh?.metadata?.interactionTargetId,camera:window.__officeCamera()};};');
        script = script.replace(marker, marker + '\n    window.__officeFirstMesh = (x,y) => {const scene=EngineStore.LastCreatedScene,rect=canvas.getBoundingClientRect();return scene.pick(x-rect.left,y-rect.top)?.pickedMesh?.name;};');
        script = script.replace(marker, marker + '\n    window.__officePlaceTestOverlay = (id,gap) => {const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(m=>m.metadata?.interactionTargetId===id);if(!mesh)return false;mesh.computeWorldMatrix(true);const center=mesh.getBoundingInfo().boundingBox.centerWorld,delta=scene.activeCamera.position.subtract(center).normalize().scale(gap),overlay=mesh.clone("__test_overlay",mesh.parent);if(!overlay)return false;overlay.metadata={componentId:mesh.metadata.componentId,decorative:true};overlay.position.addInPlace(Vector3.TransformNormal(delta,Matrix.Invert(mesh.parent?.getWorldMatrix()??Matrix.Identity())));overlay.computeWorldMatrix(true);return true;};window.__officeRemoveTestOverlay = () => EngineStore.LastCreatedScene.meshes.find(m=>m.name==="__test_overlay")?.dispose(false,false);');
        script = script.replace(marker, marker + '\n    window.__officeFindVisibleTarget = id => {const scene=EngineStore.LastCreatedScene,r=canvas.getBoundingClientRect();for(let y=Math.max(0,r.top+4);y<Math.min(innerHeight,r.bottom);y+=8)for(let x=Math.max(0,r.left+4);x<Math.min(innerWidth,r.right);x+=8){if(document.elementFromPoint(x,y)!==canvas)continue;const hit=scene.pick(x-r.left,y-r.top);if(hit?.pickedMesh?.metadata?.interactionTargetId===id)return {x,y};}return null;};');
        script = script.replace(marker, marker + '\n    window.__officeFindVisibleMesh = name => {const s=EngineStore.LastCreatedScene,r=canvas.getBoundingClientRect(),e=s.getEngine(),mesh=s.meshes.find(m=>m.name===name);if(!mesh)return null;mesh.computeWorldMatrix(true);const p=Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld,Matrix.Identity(),s.getTransformMatrix(),s.activeCamera.viewport.toGlobal(e.getRenderWidth(),e.getRenderHeight())),cx=r.left+p.x*r.width/e.getRenderWidth(),cy=r.top+p.y*r.height/e.getRenderHeight();for(let radius=0;radius<Math.max(r.width,r.height);radius+=8)for(let dx=-radius;dx<=radius;dx+=8)for(let dy=-radius;dy<=radius;dy+=8){if(radius && Math.abs(dx)!==radius && Math.abs(dy)!==radius)continue;const x=cx+dx,y=cy+dy;if(x<r.left||x>=r.right||y<r.top||y>=r.bottom||document.elementFromPoint(x,y)!==canvas)continue;if(s.pick(x-r.left,y-r.top)?.pickedMesh?.name===name)return {x,y};}return null;};');
        script = script.replace(marker, marker + '\n    window.__officeFindMeshTriangle = name => {const s=EngineStore.LastCreatedScene,r=canvas.getBoundingClientRect(),e=s.getEngine(),mesh=s.meshes.find(m=>m.name===name);if(!mesh)return null;mesh.computeWorldMatrix(true);const vertices=mesh.getVerticesData("position"),indices=mesh.getIndices(),viewport=s.activeCamera.viewport.toGlobal(e.getRenderWidth(),e.getRenderHeight());for(let i=0;i<indices.length;i+=3){const p=Vector3.Zero();for(let j=0;j<3;j++){const v=indices[i+j]*3;p.addInPlace(new Vector3(vertices[v],vertices[v+1],vertices[v+2]));}p.scaleInPlace(1/3);const world=Vector3.TransformCoordinates(p,mesh.getWorldMatrix()),q=Vector3.Project(world,Matrix.Identity(),s.getTransformMatrix(),viewport),x=r.left+q.x*r.width/e.getRenderWidth(),y=r.top+q.y*r.height/e.getRenderHeight();if(x<r.left||x>=r.right||y<r.top||y>=r.bottom||document.elementFromPoint(x,y)!==canvas)continue;if(s.pick(x-r.left,y-r.top)?.pickedMesh?.name===name)return {x,y};}return null;};');
        script = script.replace(marker, marker + '\n    window.__officeFrameVent = () => {const s=EngineStore.LastCreatedScene,c=s.activeCamera,m=s.meshes.find(item=>item.name==="Cycler arched front vent 09");if(!m)return false;m.computeWorldMatrix(true);c.alpha=Math.PI/2+.25;c.beta=1.4;c.setTarget(m.getBoundingInfo().boundingBox.centerWorld,false,false,true);c.radius=.25;c.inertialAlphaOffset=c.inertialBetaOffset=c.inertialRadiusOffset=c.inertialPanningX=c.inertialPanningY=0;s.render();return true;};');
        script = script.replace(marker, marker + '\n    window.__officeWorld = id => {const scene=EngineStore.LastCreatedScene,m=scene.meshes.find(item=>item.metadata?.interactionTargetId===id);if(!m)return null;m.computeWorldMatrix(true);return {point:m.getBoundingInfo().boundingBox.centerWorld.asArray(),camera:scene.activeCamera.position.asArray(),rightHanded:scene.useRightHandedSystem};};');
        script = script.replace(marker, marker + '\n    window.__officeTubMotion = () => {const scene=EngineStore.LastCreatedScene,mesh=scene.meshes.find(m=>m.name==="PureFlow tub front"),root=scene.getTransformNodeByName("PureFlow tub travel axis"),rect=canvas.getBoundingClientRect(),engine=scene.getEngine(),view=scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight());if(!mesh||!root)return null;mesh.computeWorldMatrix(true);root.parent?.computeWorldMatrix(true);const center=mesh.getBoundingInfo().boundingBox.centerWorld,travel=Vector3.TransformNormal(new Vector3(2.1,0,0),root.parent?.getWorldMatrix()??Matrix.Identity()),a=Vector3.Project(center,Matrix.Identity(),scene.getTransformMatrix(),view),b=Vector3.Project(center.add(travel),Matrix.Identity(),scene.getTransformMatrix(),view);return {point:{x:rect.left+a.x*rect.width/engine.getRenderWidth(),y:rect.top+a.y*rect.height/engine.getRenderHeight()},delta:{x:(b.x-a.x)*rect.width/engine.getRenderWidth(),y:(b.y-a.y)*rect.height/engine.getRenderHeight()}};};');
        script = script.replace(marker, marker + '\n    window.__officeFrameDoorOblique = () => {const s=EngineStore.LastCreatedScene,c=s.activeCamera,m=s.meshes.find(item=>item.name==="Cycler door front shell");m.computeWorldMatrix(true);c.alpha=Math.PI/2+.8;c.beta=1.25;c.setTarget(m.getBoundingInfo().boundingBox.centerWorld,false,false,true);c.radius=.45;c.inertialAlphaOffset=c.inertialBetaOffset=c.inertialRadiusOffset=c.inertialPanningX=c.inertialPanningY=0;s.render();canvas.scrollIntoView({block:"center"});}; window.__officeDoorMotion = point => {const s=EngineStore.LastCreatedScene,e=s.getEngine(),r=canvas.getBoundingClientRect(),root=s.getTransformNodeByName("Cycler door assembly"),hit=s.pick(point.x-r.left,point.y-r.top),view=s.activeCamera.viewport.toGlobal(e.getRenderWidth(),e.getRenderHeight());if(!root||!hit?.pickedPoint)return null;root.parent?.computeWorldMatrix(true);const d=Vector3.TransformNormal(new Vector3(DOOR_TRAVEL,0,0),root.parent?.getWorldMatrix()??Matrix.Identity()),a=Vector3.Project(hit.pickedPoint,Matrix.Identity(),s.getTransformMatrix(),view),b=Vector3.Project(hit.pickedPoint.add(d),Matrix.Identity(),s.getTransformMatrix(),view);return {x:(b.x-a.x)*r.width/e.getRenderWidth(),y:(b.y-a.y)*r.height/e.getRenderHeight()};};');
        const doorTravel = model.components.find(component => component.componentId === 'nxstage-cycler-door').interactionTargets.find(target => target.targetId === 'NX-C03-CYCLER-DOOR').openTranslationMeters;
        script = script.replace('DOOR_TRAVEL', String(doorTravel));
        const tubTravel = model.components.find(component => component.componentId === 'pureflow-tub').interactionTargets.find(target => target.targetId === 'PF-C02-TUB').openTranslationMeters;
        script = script.replace('new Vector3(2.1,0,0)', `new Vector3(${tubTravel},0,0)`);
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
.training-scene .scene-status { max-width:calc(100% - 145px); border-radius:8px; overflow-wrap:anywhere; pointer-events:none; }
.training-scene.interactive .scene-playback { display:none; }
.training-scene.room-reveal:not(.interactive) .scene-playback { left:10px; top:auto; bottom:38px; transform:none; }
.review-enlarge { position:absolute; z-index:4; right:10px; top:10px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-enlarge:focus-visible, .review-zoom:focus-visible { outline:3px solid #ffd76c; outline-offset:2px; }
.review-zoom { position:absolute; z-index:4; right:10px; top:52px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-explore-button { position:absolute; z-index:4; right:10px; top:94px; padding:8px 12px; border:1px solid white; border-radius:5px; background:#12343e; color:white; cursor:pointer; font:600 13px system-ui; }
.review-explore-button:focus-visible { outline:3px solid #ffd76c; outline-offset:2px; }\n.review-panel-groups { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0; }\n.review-panel-groups button { min-height:44px; padding:8px 12px; }
.training-scene.review-explore { background:#0b1b20; }
.training-scene.review-explore .training-scene-video, .training-scene.review-explore .training-room-photo, .training-scene.review-explore .doctors-office-backdrop { visibility:hidden; }
.training-scene.review-close .training-scene-model, .training-scene.review-close .training-scene-video, .training-scene.review-close .training-room-photo, .training-scene.review-close .doctors-office-backdrop { inset:auto; left:-35%; top:-35%; width:170%; height:170%; }

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
      ['/demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4', [photorealWalkthroughPath, 'video/mp4']],
      ['/demo-assets/nxstage-interactive-exam-room.png', [resolve(root,'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png'), 'image/png']],
      ['/demo-assets/nxstage-system-one-preview.png', [resolve(folder,'panel-review.png'), 'image/png']],
    ]);
    const asset = assets.get(url.pathname);
    if (asset) {
      let bytes;
      try { bytes = await readFile(asset[0]); }
      catch (error) {
        if (url.pathname !== '/demo-assets/nxstage-system-one-preview.png' || error.code !== 'ENOENT') throw error;
        bytes = await readFile(resolve(folder, 'office-close-review.png'));
      }
      response.writeHead(200, {'content-type':asset[1], 'cache-control':'no-store'}); response.end(bytes); return;
    }
    response.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); response.end('Not found');
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Unable to load the review.');
    console.error(error);
  }
});
const port = Number(process.env.NXSTAGE_OFFICE_REVIEW_PORT ?? 4216);
server.listen(port, '127.0.0.1', () => console.log(`Office interaction review: http://127.0.0.1:${port}/demo?review=1`));
