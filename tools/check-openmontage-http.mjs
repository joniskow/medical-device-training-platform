import assert from 'node:assert/strict';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';

const manifest = { schemaVersion: 'training-scene.v1', sceneId: 'scene:nxstage-office', video: { assetVersionId: 'video:1', sourceHash: 'a'.repeat(64), contentType: 'video/mp4', width: 960, height: 540, frameRate: 30, durationSeconds: 3 }, model: { modelVersionId: 'model:nxstage', sourceHash: 'b'.repeat(64), translationMeters: [0, 0, 0], rotationRadians: [0, 0, 0], scale: 1 }, camera: { projection: 'perspective', focalLengthPixels: 600, principalPointPixels: [480, 270] }, render: { opacity: 1, receiveShadows: false, castShadows: false }, interaction: { mode: 'INTERACTIVE_OVERLAY', equivalentPath: 'TEXT_KEYBOARD', cues: [{ startSeconds: 0, endSeconds: 3, targetId: 'NX-C01-FLOW', allowedActions: ['activate_target'], label: 'Press flow' }] } };
const brief = { schemaVersion: 'openmontage-scene-brief.v1', sceneId: manifest.sceneId, sourceScene: { videoAssetVersionId: 'video:1', videoSourceHash: 'a'.repeat(64), modelVersionId: 'model:nxstage', modelSourceHash: 'b'.repeat(64) }, foreground: { modelVersionId: 'model:nxstage', sourceHash: 'b'.repeat(64), mode: 'MODEL_LOCKED_OVERLAY', preserveGeometry: true }, background: { prompt: 'A calm doctors office', width: 960, height: 540, frameRate: 30, durationSeconds: 3, preserveCameraComposition: true, avoidOcclusion: true, noDeviceReplacement: true }, provenance: { requestedPipeline: 'OPENMONTAGE', promptHash: 'c'.repeat(64), sourceRefs: ['video:1', manifest.sceneId], rightsReview: 'REQUIRED' } };
const artifact = { schemaVersion: 'openmontage-render-artifact.v1', brief: { sceneId: manifest.sceneId, modelVersionId: 'model:nxstage', modelSourceHash: 'b'.repeat(64), promptHash: 'c'.repeat(64) }, video: { assetVersionId: 'video:2', sourceHash: 'd'.repeat(64), contentType: 'video/mp4', width: 960, height: 540, frameRate: 30, durationSeconds: 3, byteLength: 123 }, status: 'REVIEW_REQUIRED' };
const approved = { ...artifact, status: 'APPROVED', review: { reviewerId: 'reviewer', reviewRef: 'review:1' } };
const calls = [];
const generationCalls = [];
const service = {
  async createBrief(tenant, input) { calls.push(['brief', tenant.organizationId, input.idempotencyKey]); return { briefId: 'brief:1', brief }; },
  async ingestRender(tenant, input) { calls.push(['ingest', tenant.organizationId, input.briefId]); return { artifactId: 'artifact:1', artifact }; },
  async getArtifact() { return { artifactId: 'artifact:1', artifact }; },
  async approveRender(tenant, input) { calls.push(['approve', tenant.organizationId, input.artifactId]); return { artifactId: 'artifact:1', artifact: approved, sceneManifest: manifest }; },
  async getApprovedScene() { return { sceneManifest: manifest, videoUrl: '/api/v1/openmontage/scenes/scene%3Anxstage-office/video' }; },
  async video() { return { bytes: Buffer.from('video'), contentType: 'video/mp4' }; }
};
const server = createJobStatusHttpServer({
  openMontageSceneService: service,
  openMontageGenerationService: {
    async create(tenant, input) { generationCalls.push(['create', tenant.organizationId, input.mode ?? 'LOCKED_INTERACTIVE', input.narrationText]); return { generationId: 'openmontage-generation:test', jobId: 'job_openmontage_test', briefId: 'brief:1', brief }; },
    async get() { return { generationId: 'openmontage-generation:test', jobId: 'job_openmontage_test', briefId: 'brief:1', mode: 'LOCKED_INTERACTIVE', promptHash: 'c'.repeat(64), state: 'SUCCEEDED', outcome: { adapter: 'openmontage', adapterVersion: 'test', status: 'REVIEW_REQUIRED', details: { narration: { contentType: 'audio/mpeg', durationSeconds: 3, provider: 'azure-speech' } } }, narration: { audioUrl: '/api/v1/openmontage/generations/openmontage-generation%3Atest/narration', contentType: 'audio/mpeg', durationSeconds: 3, provider: 'azure-speech' } }; },
    async preview() { return { bytes: Buffer.from('draft-video'), contentType: 'video/mp4' }; },
    async narration() { return { bytes: Buffer.from('draft-audio'), contentType: 'audio/mpeg' }; }
  },
  statusService: { get: async () => null, retry: async () => null },
  authenticator: { authenticate: async request => ({ subject: request.headers.authorization === 'Bearer reviewer' ? 'reviewer' : request.headers.authorization === 'Bearer learner' ? 'learner' : 'author', roles: [] }) },
  organizationContextResolver: { resolveActiveOrganizations: async () => ['org_fixture'], resolveOrganizationRoles: async subject => subject === 'reviewer' ? ['reviewer'] : subject === 'learner' ? ['learner'] : ['author'] }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { ...(options.headers ?? {}), authorization: options.headers?.authorization ?? 'Bearer author', 'content-type': 'application/json' } });
  const briefResponse = await request('/api/v1/openmontage/briefs', { method: 'POST', headers: { 'idempotency-key': 'brief-key' }, body: JSON.stringify({ sceneManifest: manifest, prompt: 'A calm doctors office' }) });
  assert.equal(briefResponse.status, 201);
  const renderResponse = await request('/api/v1/openmontage/artifacts', { method: 'POST', headers: { 'idempotency-key': 'render-key' }, body: JSON.stringify({ sceneId: manifest.sceneId, briefId: 'brief:1', video: artifact.video }) });
  assert.equal(renderResponse.status, 201);
  const blocked = await request('/api/v1/openmontage/artifacts/artifact:1/approve', { method: 'POST', headers: { authorization: 'Bearer learner', 'idempotency-key': 'review-key' }, body: JSON.stringify({ reviewRef: 'review:1' }) });
  assert.equal(blocked.status, 403);
  const approval = await request('/api/v1/openmontage/artifacts/artifact:1/approve', { method: 'POST', headers: { authorization: 'Bearer reviewer', 'idempotency-key': 'review-key' }, body: JSON.stringify({ reviewRef: 'review:1' }) });
  assert.equal(approval.status, 200);
  const reviewerSpoof = await request('/api/v1/openmontage/artifacts/artifact:1/approve', { method: 'POST', headers: { authorization: 'Bearer reviewer', 'idempotency-key': 'review-key-2' }, body: JSON.stringify({ reviewRef: 'review:2', reviewerId: 'spoofed-user' }) });
  assert.equal(reviewerSpoof.status, 422, 'reviewer identity must come from the authenticated principal');
  const scene = await request('/api/v1/openmontage/scenes/scene%3Anxstage-office');
  assert.equal(scene.status, 200);
  const video = await request('/api/v1/openmontage/scenes/scene%3Anxstage-office/video');
  assert.equal(video.status, 200); assert.equal(video.headers.get('content-type'), 'video/mp4'); assert.equal(Buffer.from(await video.arrayBuffer()).toString(), 'video');
  const generationResponse = await request('/api/v1/openmontage/generations', { method: 'POST', headers: { 'idempotency-key': 'generation-key' }, body: JSON.stringify({ sceneManifest: manifest, prompt: 'A calm doctors office', mode: 'LOCKED_INTERACTIVE', narrationText: 'Simulation-only training.' }) });
  assert.equal(generationResponse.status, 202);
  const generation = await request('/api/v1/openmontage/generations/openmontage-generation%3Atest');
  assert.equal(generation.status, 200);
  assert.equal((await generation.json()).narration.provider, 'azure-speech');
  const generationPreview = await request('/api/v1/openmontage/generations/openmontage-generation%3Atest/preview');
  assert.equal(generationPreview.status, 200); assert.equal(Buffer.from(await generationPreview.arrayBuffer()).toString(), 'draft-video');
  const generationNarration = await request('/api/v1/openmontage/generations/openmontage-generation%3Atest/narration');
  assert.equal(generationNarration.status, 200); assert.equal(generationNarration.headers.get('content-type'), 'audio/mpeg'); assert.equal(Buffer.from(await generationNarration.arrayBuffer()).toString(), 'draft-audio');
  assert.deepEqual(calls, [['brief', 'org_fixture', 'brief-key'], ['ingest', 'org_fixture', 'brief:1'], ['approve', 'org_fixture', 'artifact:1']]);
  assert.deepEqual(generationCalls, [['create', 'org_fixture', 'LOCKED_INTERACTIVE', 'Simulation-only training.']]);
  console.log('OpenMontage HTTP passed: author brief, render ingestion, reviewer gate, approved scene lookup, and video delivery are tenant-scoped and role-checked.');
} finally { await new Promise(resolve => server.close(resolve)); }
