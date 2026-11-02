import assert from 'node:assert/strict';
import { approveOpenMontageRenderArtifact, createOpenMontageRenderArtifact, createOpenMontageSceneBrief, createOpenMontageSceneManifest, validateOpenMontageRenderArtifact } from '../packages/contracts/dist/openmontage-brief.js';

const scene = {
  schemaVersion: 'training-scene.v1',
  sceneId: 'scene:aurora:priming-overlay:v1',
  video: { assetVersionId: 'assetv:fixture:plate:v1', sourceHash: 'a'.repeat(64), contentType: 'video/mp4', width: 1920, height: 1080, frameRate: 30, durationSeconds: 12 },
  model: { modelVersionId: 'modelv:aurora:v1', sourceHash: 'b'.repeat(64), translationMeters: [0, 0, 0], rotationRadians: [0, 0, 0], scale: 1 },
  camera: { projection: 'perspective', focalLengthPixels: 1400, principalPointPixels: [960, 540] },
  render: { opacity: 1, receiveShadows: true, castShadows: true }
};
const brief = createOpenMontageSceneBrief(scene, 'Create a calm clinical background.', 'c'.repeat(64));
const artifact = createOpenMontageRenderArtifact(brief, { assetVersionId: 'assetv:openmontage:plate:v1', sourceHash: 'd'.repeat(64), contentType: 'video/mp4', width: 1920, height: 1080, frameRate: 30, durationSeconds: 12, byteLength: 123456 });
assert.equal(artifact.status, 'REVIEW_REQUIRED');
assert.throws(() => createOpenMontageSceneManifest(scene, artifact), /OPENMONTAGE_SCENE_BRIEF_INVALID/);
const approved = approveOpenMontageRenderArtifact(artifact, 'reviewer-1', 'review:openmontage:1');
assert.equal(validateOpenMontageRenderArtifact(approved).status, 'APPROVED');
const promoted = createOpenMontageSceneManifest(scene, approved);
assert.equal(promoted.video.assetVersionId, 'assetv:openmontage:plate:v1');
assert.equal(promoted.video.sourceHash, 'd'.repeat(64));
assert.equal(promoted.production?.pipeline, 'OPENMONTAGE');
assert.equal(promoted.production?.reviewRef, 'review:openmontage:1');
const altered = structuredClone(approved);
altered.brief.modelSourceHash = 'e'.repeat(64);
assert.throws(() => createOpenMontageSceneManifest(scene, altered), /OPENMONTAGE_SCENE_BRIEF_INVALID/);
console.log('OpenMontage render handoff passed: output bytes are hashed, review is mandatory, and only an approved artifact can promote a scene manifest.');
