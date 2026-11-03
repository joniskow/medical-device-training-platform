import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../apps/web/src/demo.ts', import.meta.url), 'utf8');

for (const marker of [
  "type PipelinePhase = 'IDLE' | 'QUEUED' | 'RUNNING' | 'REVIEW_REQUIRED' | 'APPROVED' | 'CONTENT_READY';",
  'Service Bus job queued',
  'REVIEW_REQUIRED',
  'approve-demo-candidate',
  '502,001',
]) {
  assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `demo is missing pipeline marker: ${marker}`);
}

assert.match(source, /pipelinePhase === 'APPROVED'/, 'Babylon model must be gated by reviewer approval');
assert.match(source, /pipelinePhase !== 'APPROVED'/, 'unapproved candidates must remain in the review state');
assert.match(source, /renderBackgroundReviewArtifacts/, 'Authoring UI must expose separate clean-plate, model-overlay, and final-composite review artifacts');
assert.match(source, /nxstage-photo-video-composite-review\.png/, 'Locked-interactive review must bind the current browser composite evidence');
assert.match(source, /nxstage-hallway-to-room-composite\.mp4/, 'Cinematic review must bind the baked composite video');
console.log('Demo pipeline contract passed: queued worker stages, review-required candidate state, approval gate, and measured candidate metadata are represented.');
