import assert from 'node:assert/strict';
import { validateTrainingSceneManifest } from '../packages/contracts/dist/scene-manifest.js';

const valid = {
  schemaVersion: 'training-scene.v1',
  sceneId: 'scene:aurora:intro:v1',
  video: {
    assetVersionId: 'assetv:plate:v1',
    sourceHash: 'a'.repeat(64),
    contentType: 'video/mp4',
    width: 1920,
    height: 1080,
    frameRate: 30,
    durationSeconds: 12,
  },
  model: {
    modelVersionId: 'modelv:aurora:v1',
    sourceHash: 'b'.repeat(64),
    translationMeters: [0, 0, 0],
    rotationRadians: [0, 0, 0],
    scale: 1,
  },
  camera: {
    projection: 'perspective',
    focalLengthPixels: 1420,
    principalPointPixels: [960, 540],
    distortion: { radial: [0.01, -0.002, 0], tangential: [0, 0] },
  },
  render: { opacity: 1, receiveShadows: true, castShadows: true },
  interaction: {
    mode: 'INTERACTIVE_OVERLAY',
    equivalentPath: 'TEXT_KEYBOARD',
    cues: [{ startSeconds: 1, endSeconds: 5, componentId: 'AIC-C01', targetId: 'AIC-C01-PRIME', allowedActions: ['activate_target'], label: 'Press Prime' }],
  },
  production: { pipeline: 'MANUAL', sourceRefs: ['assetv:fixture:aic-priming-demo:v1'], rightsReview: 'APPROVED' },
};

assert.deepEqual(validateTrainingSceneManifest(valid), valid);

for (const [name, mutate] of [
  ['rejects video URLs', (value) => { value.video.url = 'https://example.test/video.mp4'; }],
  ['rejects an invalid hash', (value) => { value.model.sourceHash = 'not-a-hash'; }],
  ['rejects an impossible principal point', (value) => { value.camera.principalPointPixels = [2000, 540]; }],
  ['rejects a non-positive scale', (value) => { value.model.scale = 0; }],
  ['rejects an interaction cue outside the video', (value) => { value.interaction.cues[0].endSeconds = 13; }],
  ['rejects unapproved production rights', (value) => { value.production.rightsReview = 'PENDING'; }],
]) {
  const candidate = structuredClone(valid);
  mutate(candidate);
  assert.throws(() => validateTrainingSceneManifest(candidate), /TRAINING_SCENE_MANIFEST_INVALID/);
  console.log(`${name}: passed`);
}

console.log('Training scene manifest contract passed: source-bound video/model assets, calibrated camera data, bounded placement, and render policy are validated without accepting browser URLs.');
