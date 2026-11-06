import { Color3, EngineStore, PBRMaterial, StandardMaterial, type Scene } from "@babylonjs/core";

// These bars are an illustrative visual response, not a temperature model.
let previewScene: Scene | undefined;
let level = 0;
let materials: Array<PBRMaterial | StandardMaterial> | undefined;

export function updateNxstageWarmerPreview(targetId: string): number | undefined {
  if (targetId !== "FW-C01-UP" && targetId !== "FW-C01-DOWN") return undefined;
  const scene = EngineStore.LastCreatedScene;
  if (!scene) return undefined;
  if (scene !== previewScene) { previewScene = scene; level = 0; materials = undefined; }
  if (!materials) {
    const bars = Array.from({ length: 9 }, (_, index) => scene.meshes.find(mesh => mesh.name === `Warmer setting indicator ${index + 1}`));
    if (bars.some(bar => !bar?.material)) return undefined;
    const clones = bars.map((bar, index) => bar!.material!.clone(`warmer-preview-${index}`));
    if (clones.some(material => !(material instanceof PBRMaterial) && !(material instanceof StandardMaterial))) {
      for (const material of clones) material?.dispose();
      return undefined;
    }
    materials = clones as Array<PBRMaterial | StandardMaterial>;
    bars.forEach((bar, index) => { bar!.material = materials![index]; });
  }
  level = Math.max(0, Math.min(materials.length, level + (targetId === "FW-C01-UP" ? 1 : -1)));
  materials.forEach((material, index) => { material.emissiveColor = index < level ? new Color3(0.04, 0.48, 0.10) : Color3.Black(); });
  return level;
}
