import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpenMontageRenderArtifact, validateOpenMontageSceneBrief } from '../packages/contracts/dist/openmontage-brief.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}
function numberArgument(name) {
  const value = Number(argument(name));
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`);
  return value;
}

const brief = validateOpenMontageSceneBrief(JSON.parse(await readFile(resolve(argument('--brief')), 'utf8')));
const videoPath = resolve(argument('--video'));
const videoBytes = await readFile(videoPath);
const extension = videoPath.toLowerCase().split('.').pop();
const contentType = extension === 'webm' ? 'video/webm' : extension === 'mp4' ? 'video/mp4' : undefined;
if (!contentType) throw new Error('The OpenMontage render must be an .mp4 or .webm file.');
if (contentType === 'video/mp4' && (videoBytes.length < 12 || videoBytes.subarray(4, 8).toString('ascii') !== 'ftyp')) throw new Error('The MP4 render container signature is invalid.');
if (contentType === 'video/webm' && (videoBytes.length < 4 || videoBytes.readUInt32BE(0) !== 0x1a45dfa3)) throw new Error('The WebM render container signature is invalid.');
const assetVersionId = argument('--asset-version-id');
const artifact = createOpenMontageRenderArtifact(brief, {
  assetVersionId,
  sourceHash: createHash('sha256').update(videoBytes).digest('hex'),
  contentType,
  width: numberArgument('--width'),
  height: numberArgument('--height'),
  frameRate: numberArgument('--frame-rate'),
  durationSeconds: numberArgument('--duration-seconds'),
  byteLength: videoBytes.length
});
const outputPath = resolve(argument('--output'));
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, status: artifact.status, assetVersionId, sourceHash: artifact.video.sourceHash, byteLength: artifact.video.byteLength }));
