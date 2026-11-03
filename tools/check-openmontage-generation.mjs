import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createOpenMontageProvider } from '../apps/worker/dist/openmontage-provider.js';
import { processOpenMontageGenerationJob } from '../apps/worker/dist/openmontage-generation-job.js';
import { createSpeechProvider } from '../apps/worker/dist/speech-provider.js';
import { createOpenMontageGenerationService } from '../apps/api/dist/openmontage-generation-service.js';
import { composeImageGenerationPrompt } from '../packages/contracts/dist/index.js';

const provider = createOpenMontageProvider({ mode: 'deterministic' });
const modelSourceHash = JSON.parse(await readFile('fixtures/nxstage-system-one-interactive/model-manifest.json', 'utf8')).sourceHash;
const result = await provider.generate({
  generationId: 'openmontage-generation:test',
  prompt: composeImageGenerationPrompt('Use realistic clinical materials.', 'A quiet treatment room.', 'LOCKED_INTERACTIVE'),
  mode: 'LOCKED_INTERACTIVE',
  width: 960,
  height: 540,
  frameRate: 30,
  durationSeconds: 3,
  modelVersionId: 'preview:nxstage-system-one-v1',
  modelSourceHash
});
assert.equal(result.provider.name, 'deterministic-fixture');
assert.equal(result.output, 'CLEAN_PLATE');
assert.equal(result.video.contentType, 'video/mp4');
assert.equal(result.video.width, 960);
assert.equal(result.video.height, 540);
assert.equal(result.video.frameRate, 30);
assert.equal(result.video.durationSeconds, 3);
assert.ok(result.video.bytes.length > 12);
assert.match(composeImageGenerationPrompt('', 'A slow room walkthrough.', 'CINEMATIC'), /Integration mode: CINEMATIC/);
const cinematic = await provider.generate({
  generationId: 'openmontage-generation:cinematic-test',
  prompt: composeImageGenerationPrompt('', 'A slow room walkthrough.', 'CINEMATIC'),
  mode: 'CINEMATIC',
  width: 960,
  height: 540,
  frameRate: 30,
  durationSeconds: 3,
  modelVersionId: 'preview:nxstage-system-one-v1',
  modelSourceHash
});
assert.equal(cinematic.output, 'CINEMATIC_COMPOSITE');
assert.equal(cinematic.tracking?.status, 'PASS');
assert.equal(cinematic.provider.name, 'deterministic-offline-compositor');
assert.ok(cinematic.video.bytes.length > 12, 'cinematic fixture should contain the baked model composite');
assert.notDeepEqual(cinematic.video.bytes, result.video.bytes, 'cinematic composite must be distinct from the clean plate fixture');
const speech = await createSpeechProvider({ mode: 'deterministic' }).synthesize({ requestId: 'speech:test', text: 'Simulation-only training. Confirm Ready before shutdown.', voice: 'en-US-JennyNeural', locale: 'en-US' });
assert.equal(speech.audio.contentType, 'audio/wav');
assert.ok(speech.audio.bytes.length > 44);
assert.ok(speech.audio.durationSeconds >= 1);

const httpVideo = Uint8Array.from(Buffer.from('http-provider-video-fixture'));
let pollCount = 0;
let failedPostCount = 0;
const httpServer = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/fail') {
    failedPostCount += 1;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'temporary provider outage' }));
    return;
  }
  if (request.method === 'POST' && request.url === '/generate') {
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jobId: 'http-job-1', statusUrl: `http://127.0.0.1:${httpServer.address().port}/jobs/http-job-1` }));
    return;
  }
  if (request.method === 'GET' && request.url === '/jobs/http-job-1') {
    pollCount += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(pollCount === 1 ? JSON.stringify({ jobId: 'http-job-1', status: 'queued' }) : JSON.stringify({ jobId: 'http-job-1', status: 'completed', provider: 'http-fixture', videoBase64: Buffer.from(httpVideo).toString('base64'), contentType: 'video/mp4', width: 960, height: 540, frameRate: 30, durationSeconds: 3 }));
    return;
  }
  response.writeHead(404).end();
});
await new Promise(resolveListen => httpServer.listen(0, '127.0.0.1', resolveListen));
const previousPoll = process.env.OPENMONTAGE_PROVIDER_POLL_MS;
const previousTimeout = process.env.OPENMONTAGE_PROVIDER_TIMEOUT_MS;
process.env.OPENMONTAGE_PROVIDER_POLL_MS = '250';
process.env.OPENMONTAGE_PROVIDER_TIMEOUT_MS = '2000';
try {
  const httpProvider = createOpenMontageProvider({ mode: 'http', endpoint: `http://127.0.0.1:${httpServer.address().port}/generate` });
  const httpResult = await httpProvider.generate({ generationId: 'http-generation:test', prompt: 'fixture', mode: 'LOCKED_INTERACTIVE', width: 960, height: 540, frameRate: 30, durationSeconds: 3, modelVersionId: 'preview:nxstage-system-one-v1', modelSourceHash });
  assert.equal(httpResult.provider.name, 'http-fixture');
  assert.equal(httpResult.provider.jobId, 'http-job-1');
  assert.deepEqual([...httpResult.video.bytes], [...httpVideo]);
  assert.equal(pollCount, 2, 'HTTP provider must poll a queued job before retrieving completed bytes');
  const failingProvider = createOpenMontageProvider({ mode: 'http', endpoint: `http://127.0.0.1:${httpServer.address().port}/fail` });
  await assert.rejects(() => failingProvider.generate({ generationId: 'http-generation:retry', prompt: 'fixture', mode: 'LOCKED_INTERACTIVE', width: 960, height: 540, frameRate: 30, durationSeconds: 3, modelVersionId: 'preview:nxstage-system-one-v1', modelSourceHash }), /OPENMONTAGE_PROVIDER_HTTP_503/);
  assert.equal(failedPostCount, 2, 'HTTP provider must retry a failed create request once');
} finally {
  if (previousPoll === undefined) delete process.env.OPENMONTAGE_PROVIDER_POLL_MS; else process.env.OPENMONTAGE_PROVIDER_POLL_MS = previousPoll;
  if (previousTimeout === undefined) delete process.env.OPENMONTAGE_PROVIDER_TIMEOUT_MS; else process.env.OPENMONTAGE_PROVIDER_TIMEOUT_MS = previousTimeout;
  httpServer.closeAllConnections();
  await new Promise(resolveClose => httpServer.close(resolveClose));
}
const tenant = { organizationId: 'org:test', actorId: 'worker:test', correlationId: 'generation:test' };
const payload = {
  schemaVersion: 'openmontage-generation-request.v1', generationId: 'openmontage-generation:job-test', briefId: 'brief:job-test',
  sceneManifest: { sceneId: 'scene:job-test', model: { modelVersionId: 'model:test', sourceHash: 'b'.repeat(64) } },
  brief: { sourceScene: { modelVersionId: 'model:test', modelSourceHash: 'b'.repeat(64) }, background: { prompt: 'test', width: 960, height: 540, frameRate: 30, durationSeconds: 3 }, provenance: { promptHash: 'c'.repeat(64), rightsReview: 'REQUIRED' } },
  mode: 'LOCKED_INTERACTIVE', promptHash: 'c'.repeat(64), narrationText: 'Simulation-only training.', narrationVoice: 'en-US-JennyNeural'
};
const stored = { jobId: 'job_openmontage_job-test', jobType: 'openmontage.generate', state: 'QUEUED', payload, tenant, leaseGeneration: 0 };
const written = [];
const jobStore = {
  async get() { return stored; },
  async claim() { stored.state = 'RUNNING'; stored.leaseGeneration = 1; return stored; },
  async succeed(_tenant, _jobId, _workerId, _lease, outcome) { stored.state = 'SUCCEEDED'; stored.outcome = outcome; return stored; },
  async fail() { throw new Error('unexpected failure'); }
};
const storage = { async putObject(input) { written.push(input); } };
const providerForJob = { async generate(request) { return { provider: { name: 'test' }, output: 'CLEAN_PLATE', video: { bytes: new Uint8Array(32).fill(7), contentType: 'video/mp4', width: request.width, height: request.height, frameRate: request.frameRate, durationSeconds: request.durationSeconds } }; } };
const speechForJob = { async synthesize() { return { provider: { name: 'azure-speech' }, audio: { bytes: new Uint8Array(64).fill(8), contentType: 'audio/mpeg', durationSeconds: 3 } }; } };
await processOpenMontageGenerationJob({ jobStore, storage, provider: providerForJob, speech: speechForJob, tenant, jobId: stored.jobId, workerId: 'worker:test' });
assert.equal(stored.state, 'SUCCEEDED');
assert.equal(stored.outcome.details.narration.provider, 'azure-speech');
assert.equal(written.length, 2);

const sceneManifest = JSON.parse(await readFile('apps/web/src/model/nxstage-training-scene-manifest.json', 'utf8'));
const generationJobs = [];
const generationBrief = { briefId: 'brief:idempotency', brief: { sourceScene: { modelVersionId: 'model:test', modelSourceHash: 'b'.repeat(64) }, background: { prompt: 'test', width: 960, height: 540, frameRate: 30, durationSeconds: 3 }, provenance: { promptHash: 'c'.repeat(64), rightsReview: 'REQUIRED' } } };
const generationService = createOpenMontageGenerationService({
  scenes: { async createBrief() { return generationBrief; } },
  jobs: { async enqueue(job) { generationJobs.push(job); return job; } },
  storage: { async readObject() { throw new Error('not used'); } }
});
const firstGeneration = await generationService.create(tenant, { sceneManifest, prompt: 'test', idempotencyKey: 'same-key', requestHash: 'request-hash' });
const retriedGeneration = await generationService.create(tenant, { sceneManifest, prompt: 'test', idempotencyKey: 'same-key', requestHash: 'request-hash' });
assert.equal(retriedGeneration.generationId, firstGeneration.generationId, 'idempotent retries must preserve the generation identity');
assert.equal(retriedGeneration.jobId, firstGeneration.jobId, 'idempotent retries must preserve the job identity');
assert.equal(generationJobs[1].payload.generationId, generationJobs[0].payload.generationId);
console.log('OpenMontage generation contract passed: deterministic video and narration providers satisfy profile, mode, and audio guards.');
