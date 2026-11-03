export const warmerDemo = `
let warmerDemoLevel = 0;
let warmerDemoMaterials;
let warmerDemoScene;
function updateWarmerDemo(targetId) {
  const scene = EngineStore.LastCreatedScene;
  if (!scene) return;
  if (scene !== warmerDemoScene) { warmerDemoScene = scene; warmerDemoLevel = 0; warmerDemoMaterials = undefined; }
  const bars = Array.from({length: 9}, (_, index) => scene.meshes.find(mesh => mesh.name === "Warmer setting indicator " + (index + 1)));
  if (bars.some(bar => !bar?.material)) return;
  if (!warmerDemoMaterials) warmerDemoMaterials = bars.map((bar, index) => {
    const material = bar.material.clone("warm-demo-" + index);
    bar.material = material;
    return material;
  });
  warmerDemoLevel = Math.max(0, Math.min(bars.length, warmerDemoLevel + (targetId === "FW-C01-UP" ? 1 : -1)));
  warmerDemoMaterials.forEach((material, index) => { material.emissiveColor = index < warmerDemoLevel ? new Color3(.04, .48, .10) : new Color3(0, 0, 0); });
  const feedback = document.querySelector("#warmer-demo-feedback");
  if (feedback) { feedback.hidden = false; feedback.textContent = " Warmer bars are illustrative only; power, temperature and heating are not simulated."; }
}
`;
