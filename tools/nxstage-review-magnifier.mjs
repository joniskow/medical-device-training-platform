// Shared review-only camera framing for photographed panel controls.
// The targets remain the actual meshes; this does not expand or remap hits.
export const panelMagnifierSource = `
const nxstagePanelRegions = {
  left: ["NX-C01-ADD-FLUID", "NX-C01-VOLUME-TOGGLE", "NX-C01-TREATMENT"],
  decrease: ["NX-C01-ROW1-DOWN", "NX-C01-ROW2-DOWN", "NX-C01-ROW3-DOWN"],
  increase: ["NX-C01-ROW1-UP", "NX-C01-ROW2-UP", "NX-C01-ROW3-UP"],
  right: ["NX-C01-STOP", "NX-C01-MUTE"],
  "lower-arrows": ["PF-C01-UP", "PF-C01-DOWN"],
  "lower-actions": ["PF-C01-GO", "PF-C01-STOP"]
};
function magnifyNxstagePanel(region, canvas) {
  const scene = EngineStore.LastCreatedScene, camera = scene?.activeCamera;
  const ids = nxstagePanelRegions[region];
  const meshes = scene?.meshes.filter(mesh => ids?.includes(mesh.metadata?.interactionTargetId));
  if (!camera || !meshes?.length) return false;
  camera.alpha = Math.PI / 2; camera.beta = 1.4;
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
  }
  const center = min.add(max).scale(.5), engine = scene.getEngine();
  const aspect = Math.max(engine.getRenderWidth() / Math.max(engine.getRenderHeight(), 1), .1);
  const tangentY = Math.tan(camera.fov / 2), tangentX = tangentY * aspect, view = camera.getViewMatrix(true);
  let distance = camera.minZ;
  for (const x of [min.x,max.x]) for (const y of [min.y,max.y]) for (const z of [min.z,max.z]) {
    const point = Vector3.TransformNormal(new Vector3(x,y,z).subtract(center), view);
    distance = Math.max(distance, Math.abs(point.x)/tangentX-point.z, Math.abs(point.y)/tangentY-point.z);
  }
  camera.setTarget(center, false, false, true);
  camera.radius = Math.min(camera.upperRadiusLimit ?? Infinity, Math.max(camera.lowerRadiusLimit ?? 0, distance * 1.35));
  camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = 0; camera.inertialPanningY = 0;
  // Center the canvas so sticky page headers do not cover magnified targets.
  canvas.scrollIntoView({block:"center", behavior:"instant"});
  // Picking uses the camera immediately; render the new view before a user
  // can interact with pixels from the previous camera position.
  scene.render();
  return true;
}
`;
