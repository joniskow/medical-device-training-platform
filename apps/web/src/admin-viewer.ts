import {ArcRotateCamera, Color3, Color4, Engine, HemisphericLight, Scene, SceneLoader, Vector3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export async function mountSceneViewer(canvas: HTMLCanvasElement, url: string) {
  const engine = new Engine(canvas, true, {alpha: true, preserveDrawingBuffer: false});
  const scene = new Scene(engine); scene.clearColor = new Color4(0, 0, 0, 0);
  const camera = new ArcRotateCamera('camera', Math.PI / 2, 1.25, 5, Vector3.Zero(), scene);
  camera.attachControl(canvas, true); camera.wheelPrecision = 35; camera.minZ = .001;
  const light = new HemisphericLight('light', new Vector3(.3, 1, -.5), scene); light.intensity = 1.5; light.groundColor = new Color3(.55, .6, .65);
  const resize = () => engine.resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); window.addEventListener('resize', resize);
  const dispose = () => { observer.disconnect(); window.removeEventListener('resize', resize); scene.dispose(); engine.dispose(); };
  try {
    const result = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, '.glb');
    const meshes = result.meshes.filter(mesh => mesh.getTotalVertices() > 0);
    if (!meshes.length) throw Error('The candidate contains no visible mesh. Open the build quality report.');
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) { mesh.computeWorldMatrix(true); const bounds = mesh.getBoundingInfo().boundingBox; min = Vector3.Minimize(min, bounds.minimumWorld); max = Vector3.Maximize(max, bounds.maximumWorld); }
    const target = min.add(max).scale(.5), diagonal = max.subtract(min).length(); if (!Number.isFinite(diagonal) || diagonal <= 0) throw Error('The model bounds are invalid.');
    const radius = diagonal * 1.5; const reset = () => { camera.setTarget(target); camera.alpha = Math.PI / 2; camera.beta = 1.25; camera.radius = radius; };
    camera.lowerRadiusLimit = diagonal * .15; camera.upperRadiusLimit = diagonal * 6; camera.maxZ = diagonal * 100; reset();
    engine.runRenderLoop(() => scene.render()); resize();
    return {dispose, reset, rotate(delta: number) { camera.alpha += delta; }, zoom(factor: number) { camera.radius = Math.max(camera.lowerRadiusLimit!, Math.min(camera.upperRadiusLimit!, camera.radius * factor)); }};
  } catch (error) { dispose(); throw error; }
}
