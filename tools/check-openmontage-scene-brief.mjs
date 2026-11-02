import assert from 'node:assert/strict';
import { createOpenMontageSceneBrief, validateOpenMontageSceneBrief } from '../packages/contracts/dist/openmontage-brief.js';

const scene = {
  schemaVersion: 'training-scene.v1',
  sceneId: 'scene:aurora:priming-overlay:v1',
  video: { assetVersionId: 'assetv:fixture:plate:v1', sourceHash: 'a'.repeat(64), contentType: 'video/mp4', width: 1920, height: 1080, frameRate: 30, durationSeconds: 12 },
  model: { modelVersionId: 'modelv:aurora:v1', sourceHash: 'b'.repeat(64), translationMeters: [0, 0, 0], rotationRadians: [0, 0, 0], scale: 1 },
  camera: { projection: 'perspective', focalLengthPixels: 1400, principalPointPixels: [960, 540] },
  render: { opacity: 1, receiveShadows: true, castShadows: true }
};
const brief = createOpenMontageSceneBrief(scene, 'Create a quiet clinical training-room background with soft neutral light. Keep the device foreground unobstructed.', 'c'.repeat(64));
assert.equal(validateOpenMontageSceneBrief(brief).schemaVersion, 'openmontage-scene-brief.v1');
assert.equal(brief.foreground.sourceHash, scene.model.sourceHash);
assert.equal(brief.background.width, scene.video.width);
assert.equal(brief.background.noDeviceReplacement, true);

const altered = structuredClone(brief);
altered.foreground.sourceHash = 'd'.repeat(64);
assert.throws(() => validateOpenMontageSceneBrief(altered), /OPENMONTAGE_SCENE_BRIEF_INVALID/);

console.log('OpenMontage scene brief contract passed: foreground geometry is locked, background generation is bounded, and provenance is required.');
