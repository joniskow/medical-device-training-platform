import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modelManifest = JSON.parse(await readFile('fixtures/nxstage-system-one/model-manifest.json', 'utf8'));
const interactiveManifest = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8'));
const cinematicSourceManifest = JSON.parse(await readFile('fixtures/nxstage-system-one/nxstage-cinematic-source-manifest.json', 'utf8'));
const trainingSceneManifest = JSON.parse(await readFile('apps/web/src/model/nxstage-training-scene-manifest.json', 'utf8'));
const cinematicSceneManifest = JSON.parse(await readFile('apps/web/src/model/nxstage-cinematic-scene-manifest.json', 'utf8'));
const interactiveGlb = await readFile('fixtures/nxstage-system-one-interactive/nxstage-system-one.glb');
const cinematicGlb = await readFile('fixtures/nxstage-system-one/nxstage-system-one.glb');
const tracking = JSON.parse(await readFile('output/openmontage/nxstage-hallway-to-room-composite-tracking.json', 'utf8'));
const cleanPlate = await readFile('output/openmontage/nxstage-hallway-to-room-background.mp4');
const composite = await readFile('output/openmontage/nxstage-hallway-to-room-composite.mp4');
const photoPlate = await readFile('fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png');
const photoComposite = await readFile('output/nxstage-system-one/photo-composite-browser.png');
const compositeHash = hash(composite);
const [trackingFile, compositeFile] = await Promise.all([
  stat('output/openmontage/nxstage-hallway-to-room-composite-tracking.json'),
  stat('output/openmontage/nxstage-hallway-to-room-composite.mp4')
]);
const frameFiles = (await readdir('output/openmontage/composite')).filter(name => /^frame-\d{4}\.png$/i.test(name)).sort();
assert.equal(frameFiles.length, tracking.frameRate * tracking.durationSeconds, 'Composite frame sequence must cover the complete locked cinematic duration');
const sampledNames = [frameFiles[0], frameFiles[Math.floor(frameFiles.length / 2)], frameFiles.at(-1)];
const sampledFrames = await Promise.all(sampledNames.map(name => readFile(`output/openmontage/composite/${name}`)));
const cleanSampledFrames = await Promise.all(sampledNames.map(name => readFile(`output/openmontage/background/${name}`)));
for (const bytes of sampledFrames) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Composite frame must be a PNG');
  assert.equal(bytes.readUInt32BE(16), tracking.resolution[0], 'Composite frame width must match tracking');
  assert.equal(bytes.readUInt32BE(20), tracking.resolution[1], 'Composite frame height must match tracking');
}
assert(new Set(sampledFrames.map(hash)).size > 1, 'Composite frame sequence must contain temporal motion rather than a repeated still');
assert.ok(cleanPlate.length > 12, 'cinematic clean plate must exist');
assert(cleanSampledFrames.some((cleanFrame, index) => hash(cleanFrame) !== hash(sampledFrames[index])), 'Baked composite frames must differ from the matching clean-plate frames');
assert.equal(tracking.schemaVersion, 'openmontage-cinematic-tracking.v1');
assert.equal(tracking.status, 'PASS');
assert.equal(tracking.cameraLockedToRenderedPlate, true);
assert.equal(tracking.foregroundModelSourceHash, modelManifest.sourceHash);
assert.equal(hash(interactiveGlb), interactiveManifest.sourceHash, 'Interactive GLB must match its manifest');
assert.equal(hash(cinematicGlb), modelManifest.sourceHash, 'Cinematic GLB must match its manifest');
assert.equal(interactiveManifest.sourceHash, modelManifest.sourceHash, 'Interactive and cinematic modes must share one model lineage');
assert.equal(cinematicSourceManifest.sourceHash, modelManifest.sourceHash, 'Packaged cinematic source manifest must match the cinematic GLB');
assert.equal(trainingSceneManifest.model.sourceHash, interactiveManifest.sourceHash, 'Interactive scene binding must match the interactive GLB');
assert.equal(trainingSceneManifest.production.modelRevision, interactiveManifest.sourceHash, 'Interactive scene revision must match the interactive GLB');
assert.equal(cinematicSceneManifest.model.sourceHash, modelManifest.sourceHash, 'Cinematic scene binding must match the cinematic GLB');
assert.equal(cinematicSceneManifest.production.modelRevision, modelManifest.sourceHash, 'Cinematic scene revision must match the cinematic GLB');
assert.equal(cinematicSceneManifest.video.sourceHash, compositeHash, 'Cinematic scene binding must match the encoded composite video');
assert(compositeFile.mtimeMs >= trackingFile.mtimeMs, 'The composite video predates its tracking record; encode the newly rendered frames before accepting this revision');
assert.equal(tracking.reprojectionErrorPixels, 0);
assert.deepEqual(tracking.resolution, [960, 540]);
assert.equal(tracking.frameRate, 24);
assert.equal(tracking.durationSeconds, 6);
if (tracking.method === 'photo-plate-calibrated-digital-reprojection') {
  assert.equal(tracking.cleanPlateSourceHash, hash(photoPlate), 'Photo-backed cinematic clean plate must retain its source hash');
  assert.equal(tracking.foregroundCompositeSourceHash, hash(photoComposite), 'Photo-backed cinematic foreground must come from the validated composite');
  assert.equal(tracking.cameraMotion, 'synchronized digital zoom over a calibrated still plate');
}
console.log(`NxStage cinematic compositor passed: clean=${hash(cleanPlate).slice(0, 12)} composite=${hash(composite).slice(0, 12)} frames=${frameFiles.length} tracking=PASS.`);
