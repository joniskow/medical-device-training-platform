import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { approveOpenMontageRenderArtifact, createOpenMontageSceneManifest } from '../packages/contracts/dist/openmontage-brief.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

const artifactPath = resolve(argument('--artifact'));
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
const videoBytes = await readFile(resolve(argument('--video')));
const videoHash = createHash('sha256').update(videoBytes).digest('hex');
if (videoHash !== artifact.video?.sourceHash || videoBytes.length !== artifact.video?.byteLength) throw new Error('OPENMONTAGE_VIDEO_ARTIFACT_MISMATCH');
const approvedArtifact = approveOpenMontageRenderArtifact(artifact, argument('--reviewer-id'), argument('--review-ref'));
const scene = JSON.parse(await readFile(resolve(argument('--scene-manifest')), 'utf8'));
const approvedScene = createOpenMontageSceneManifest(scene, approvedArtifact);
const artifactOutput = resolve(argument('--approved-artifact'));
const sceneOutput = resolve(argument('--scene-output'));
await writeFile(artifactOutput, `${JSON.stringify(approvedArtifact, null, 2)}\n`, 'utf8');
await writeFile(sceneOutput, `${JSON.stringify(approvedScene, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ artifactOutput, sceneOutput, status: approvedArtifact.status, reviewerId: approvedArtifact.review?.reviewerId, reviewRef: approvedArtifact.review?.reviewRef }));
