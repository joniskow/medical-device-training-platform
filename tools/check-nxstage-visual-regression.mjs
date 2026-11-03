import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const { PNG } = createRequire(import.meta.url)('../node_modules/.pnpm/pngjs@5.0.0/node_modules/pngjs');

const root = process.cwd();
const platePath = join(root, 'fixtures', 'nxstage-system-one', 'nxstage-clinical-photo-v4.png');
const evidencePath = join(root, 'output', 'nxstage-system-one', 'photo-composite-browser-evidence.json');
const compositePath = join(root, 'output', 'nxstage-system-one', 'photo-composite-browser.png');
const foregroundPath = join(root, 'output', 'nxstage-system-one', 'photo-composite-foreground.png');
const frameDir = join(root, 'output', 'openmontage', 'composite');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readPng = async path => PNG.sync.read(await readFile(path));
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function regionStats(image, [x0, y0, x1, y1]) {
  const left = Math.floor(image.width * x0);
  const top = Math.floor(image.height * y0);
  const right = Math.floor(image.width * x1);
  const bottom = Math.floor(image.height * y1);
  let count = 0;
  let sum = 0;
  let dark = 0;
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
    const offset = (y * image.width + x) * 4;
    const r = image.data[offset];
    const g = image.data[offset + 1];
    const b = image.data[offset + 2];
    const value = luma(r, g, b);
    count += 1;
    sum += value;
    if (value < 0.18 && Math.max(r, g, b) - Math.min(r, g, b) < 26) dark += 1;
  }
  return { count, meanLuma: sum / count, darkRatio: dark / count };
}

function imageMeanLuma(image) {
  return regionStats(image, [0, 0, 1, 1]).meanLuma;
}

const [plate, composite, foreground, evidence] = await Promise.all([
  readPng(platePath),
  readPng(compositePath),
  readPng(foregroundPath),
  readFile(evidencePath, 'utf8').then(JSON.parse),
]);

const plateSafeRegion = regionStats(plate, [0.28, 0.12, 0.72, 0.96]);
assert(plateSafeRegion.darkRatio < 0.02, `Clean plate safe region contains a possible replacement-device silhouette: ${JSON.stringify(plateSafeRegion)}`);
assert(evidence.state.phase === 'READY');
assert(evidence.visual.visiblePixels > 500);
assert(evidence.visual.fringeRatio < 0.42, `Foreground halo/fringe is too large: ${evidence.visual.fringeRatio}`);
const [minX, minY, maxX, maxY] = evidence.visual.alphaBounds;
assert(minX >= 120 && maxX <= evidence.visual.width - 120, `Foreground escaped the model-safe region: ${JSON.stringify(evidence.visual.alphaBounds)}`);
assert(maxY > evidence.visual.height * 0.55, 'Foreground does not reach the grounded lower frame.');

const modelCenter = [
  (evidence.bounds.min[0] + evidence.bounds.max[0]) / 2,
  (evidence.bounds.min[1] + evidence.bounds.max[1]) / 2,
  (evidence.bounds.min[2] + evidence.bounds.max[2]) / 2,
];
const shadowOffset = [evidence.shadowPosition[0] - modelCenter[0], evidence.shadowPosition[2] - modelCenter[2]];
const shadowDistance = Math.hypot(...shadowOffset);
const calibrationDirection = evidence.shadowCalibration.calibratedDirection;
const directionalDot = shadowOffset[0] * calibrationDirection[0] + shadowOffset[1] * calibrationDirection[2];
assert(shadowDistance > 0.08, `Contact shadow is too centered to prove directional grounding: ${JSON.stringify({ modelCenter, shadow: evidence.shadowPosition })}`);
assert(directionalDot > 0.08, `Contact shadow does not follow the calibrated light direction: ${JSON.stringify({ shadowOffset, calibrationDirection })}`);
assert(Math.abs(evidence.shadowPosition[1] - evidence.bounds.min[1]) < 0.02, 'Contact shadow is detached vertically from the model feet.');

const frameNames = (await readdir(frameDir)).filter(name => name.startsWith('frame-') && name.endsWith('.png')).sort();
assert.equal(frameNames.length, 144, 'Cinematic visual regression must cover all 144 frames.');
const frameLumas = [];
for (const name of frameNames) frameLumas.push(imageMeanLuma(await readPng(join(frameDir, name))));
const mean = frameLumas.reduce((sum, value) => sum + value, 0) / frameLumas.length;
const min = Math.min(...frameLumas);
const max = Math.max(...frameLumas);
const temporal = { frameCount: frameNames.length, meanLuma: mean, minLuma: min, maxLuma: max, lumaRange: max - min };
assert(temporal.lumaRange < 0.03, `Cinematic frames show possible exposure flicker: ${JSON.stringify(temporal)}`);

const result = {
  schemaVersion: 'nxstage-visual-regression.v1',
  status: 'PASS',
  activePlate: { path: 'fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png', sha256: hash(await readFile(platePath)), dimensions: [plate.width, plate.height], safeRegion: plateSafeRegion },
  browserComposite: { path: 'output/nxstage-system-one/photo-composite-browser.png', sha256: hash(await readFile(compositePath)), dimensions: [composite.width, composite.height], foreground: { path: 'output/nxstage-system-one/photo-composite-foreground.png', sha256: hash(await readFile(foregroundPath)), dimensions: [foreground.width, foreground.height] } },
  grounding: { modelCenter, shadowPosition: evidence.shadowPosition, shadowOffset, directionalDot, verticalGap: evidence.shadowPosition[1] - evidence.bounds.min[1], fringeRatio: evidence.visual.fringeRatio },
  temporal,
  artifacts: { cleanPlate: 'output/nxstage-system-one/photo-composite-clean-plate.png', modelOverlay: 'output/nxstage-system-one/photo-composite-foreground.png', finalComposite: 'output/nxstage-system-one/photo-composite-browser.png', cinematicFrames: 'output/openmontage/composite/frame-####.png' },
};
await writeFile(join(root, 'output', 'nxstage-system-one', 'nxstage-visual-regression-evidence.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`NxStage visual regression passed: safeDark=${plateSafeRegion.darkRatio.toFixed(4)} fringe=${evidence.visual.fringeRatio.toFixed(4)} shadowOffset=${shadowDistance.toFixed(3)} temporalRange=${temporal.lumaRange.toFixed(4)}.`);
