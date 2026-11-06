import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

// Export the actual locally served review into an isolated, portable folder.
// No shared fixture, app build, release or source photograph is modified.
const port = Number(process.env.NXSTAGE_OFFICE_REVIEW_PORT ?? 4216);
const output = resolve(process.env.NXSTAGE_PACKAGE_FOLDER ?? 'output/nxstage-interaction-review/portable-office');
const modelFolder = resolve(process.env.NXSTAGE_OFFICE_REVIEW_FOLDER ?? 'fixtures/nxstage-system-one-interaction-review');
const testPackage = process.env.NXSTAGE_PACKAGE_TEST === '1';
const routes = [
  ['/demo?review=1', 'demo-review.html'], ['/demo', 'demo.html'], ['/demo.js', 'demo.js'], ['/demo.css', 'demo.css'],
  ['/model/nxstage-system-one.glb', 'model/nxstage-system-one.glb'],
  ['/model/nxstage-system-one-manifest.json', 'model/nxstage-system-one-manifest.json'],
  ['/model/nxstage-training-scene-manifest.json', 'model/nxstage-training-scene-manifest.json'],
  ['/demo-assets/nxstage-clinical-photo-v4.png', 'demo-assets/nxstage-clinical-photo-v4.png'],
  ['/demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4', 'demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4'],
  ['/demo-assets/nxstage-interactive-exam-room.png', 'demo-assets/nxstage-interactive-exam-room.png'],
  ['/demo-assets/nxstage-system-one-preview.png', 'demo-assets/nxstage-system-one-preview.png']
];
const entries = await Promise.all(routes.map(async ([url, path]) => {
  const response = await fetch(`http://127.0.0.1:${port}${url}`);
  assert.equal(response.status, 200, `Cannot export ${url}: HTTP ${response.status}`);
  return [path, Buffer.from(await response.arrayBuffer())];
}));
const files = new Map(entries), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const [path, bytes] of entries) if (path.endsWith('.png')) assert(bytes.subarray(0, 8).equals(pngSignature), `Invalid PNG returned for ${path}`);
const manifest = JSON.parse(files.get('model/nxstage-system-one-manifest.json'));
const scene = JSON.parse(files.get('model/nxstage-training-scene-manifest.json'));
const modelHash = hash(files.get('model/nxstage-system-one.glb'));
assert.equal(modelHash, manifest.sourceHash, 'Served model and manifest differ');
assert.equal(modelHash, scene.model.sourceHash, 'Served model and scene differ');
assert.equal(scene.model.modelVersionId, manifest.modelVersionId, 'Served scene uses a different model version');
assert.equal(hash(files.get('demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4')), scene.video.sourceHash, 'Served walkthrough differs from the scene');
assert.equal(modelHash, hash(await readFile(resolve(modelFolder, 'nxstage-system-one.glb'))), 'Running preview does not match the selected model folder; restart it before exporting');
const script = files.get('demo.js').toString('utf8');
assert(script.includes('data-review-focus-handle') && script.includes('review-explore'), 'Running preview lacks the current review controls');
assert(script.includes('addReviewHandleFocus(canvas,runtime)') && script.includes('addReviewHandleFocus(canvas,demoModelRuntime)'), 'Running preview lacks the corrected handle initialization paths; restart it before exporting');
assert(script.includes('magnifyNxstagePanel') && script.includes('data-review-panel-magnifier') && script.includes('lastInteractionFeedback'), 'Running preview lacks the current magnifier or touch feedback; restart it before exporting');
assert(script.includes('preserveImportedRoot: true') && script.includes('data-review-panel-region=lower-actions'), 'Running preview lacks the corrected orientation or lower-panel close-ups; restart it before exporting');
assert(testPackage || !script.includes('window.__officeReviewRuntime'), 'A test-enabled preview cannot be exported as a portable package');
const targets = new Set(manifest.components.flatMap(c => (c.interactionTargets ?? []).map(t => `${c.componentId}:${t.targetId}`)));
for (const cue of scene.interaction?.cues ?? []) assert(targets.has(`${cue.componentId}:${cue.targetId}`), 'Scene contains an unknown interaction target');
for (const [path, bytes] of entries) { await mkdir(dirname(resolve(output, path)), {recursive:true}); await writeFile(resolve(output, path), bytes); }
await copyFile('tools/serve-nxstage-portable-review.mjs', resolve(output, 'server.mjs'));
const integrity = Object.fromEntries(entries.map(([path, bytes]) => [path, hash(bytes)]));
await writeFile(resolve(output, 'package-integrity.json'), `${JSON.stringify({reviewOnly:true, modelVersionId:manifest.modelVersionId, modelHash, sha256:integrity}, null, 2)}\n`);
await writeFile(resolve(output, 'README.txt'), 'NxStage interactive visual review — not a clinical or production release.\nRun: node server.mjs\nOpen: http://127.0.0.1:4217/\nIf that port is in use, set NXSTAGE_PORTABLE_PORT before starting the server.\nThis review uses estimated geometry and does not simulate treatment, fluid operation or electrical power.\n');
console.log(`Portable review staged at ${output}; model ${modelHash}; ${entries.length} files verified.`);
