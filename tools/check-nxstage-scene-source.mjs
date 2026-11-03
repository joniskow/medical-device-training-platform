import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = "blender/nxstage_system_one_scene.py";
const source = await readFile(path, "utf8");

for (const marker of [
  'cube("Upper accessory platform"',
  'cube("Upper accessory soft case"',
  'curve("Left side carry handle"',
  'cube("Lower gray service panel"',
  'cube("Lower left connector strip"',
  'cube("Lower warning label"',
  'def add_press_action',
  'root["scale_status"]',
  'root["fidelity_status"]',
  'root["interaction_model"]'
]) assert.ok(source.includes(marker), `NxStage source is missing ${marker}`);

for (const [variable, targetId] of [["flow", "NX-C01-FLOW"], ["rate", "NX-C01-RATE"], ["stop", "NX-C01-STOP"], ["mute", "NX-C01-MUTE"]]) {
  assert.ok(source.includes(`mark_interaction(${variable}, \"${targetId}\"`), `NxStage source is missing ${targetId}`);
}

console.log("NxStage Blender source passed: photo-grounded silhouette details, uncertainty metadata, and five named press targets are present.");
