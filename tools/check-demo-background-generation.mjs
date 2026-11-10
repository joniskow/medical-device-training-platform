import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDemoBackgroundGeneration } from './demo-background-generation.mjs';

const sceneManifest = JSON.parse(await readFile('apps/web/dist/model/nxstage-review-scene.json', 'utf8'));
const bytes = await readFile('fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4');
let generate, failGeneration, calls = 0;
const provider = { generate(request) {
  calls++;
  assert.equal(request.prompt, 'A bright teaching room');
  assert.equal(request.modelSourceHash, sceneManifest.model.sourceHash);
  return new Promise((resolve, reject) => { generate = () => resolve({ output: 'CLEAN_PLATE', video: { ...sceneManifest.video, bytes } }); failGeneration = reject; });
} };
const statuses = new Map(), videos = new Map();
const store = { saveStatus: async value => { statuses.set(value.generationId, structuredClone(value)); }, saveVideo: async (id, value) => { videos.set(id, Buffer.from(value)); }, getStatus: async id => statuses.get(id), getVideo: async id => videos.get(id) };
const handler = createDemoBackgroundGeneration({ provider, staticRoot: 'apps/web/dist', store });
const restored = createDemoBackgroundGeneration({ provider: null, staticRoot: 'apps/web/dist', store });
const protectedHandler = createDemoBackgroundGeneration({ provider, staticRoot: 'apps/web/dist', store, authorize: async req => req.headers.authorization === 'Bearer test-operator' });
const missing = createDemoBackgroundGeneration({ provider: null, staticRoot: 'apps/web/dist' });
const server = createServer((req, res) => { void (req.headers['x-test-no-provider'] ? missing : req.headers['x-test-restored'] ? restored : req.headers['x-test-protected'] ? protectedHandler : handler)(req, res); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const endpoint = `${origin}/api/v1/openmontage/generations`;
const post = (key, body = {}, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers }, body: JSON.stringify({ sceneManifest, prompt: 'A bright teaching room', mode: 'LOCKED_INTERACTIVE', ...body }) });
try {
  assert.equal((await post('missing', {}, { 'x-test-no-provider': 'true' })).status, 503);
  assert.equal((await post('cross-origin', {}, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post('cinematic', { mode: 'CINEMATIC' })).status, 422);
  assert.equal((await post('unknown-model', { sceneManifest: { ...sceneManifest, model: { ...sceneManifest.model, sourceHash: '0'.repeat(64) } } })).status, 422);
  const created = await post('one'); assert.equal(created.status, 202);
  const first = await created.json();
  assert.equal(first.state, 'RUNNING');
  assert.equal((await post('two')).status, 429);
  assert.equal((await post('one')).status, 202); assert.equal(calls, 1, 'A repeated request must not generate twice');
  assert.equal((await post('one', { prompt: 'Different prompt' })).status, 409);
  assert.equal((await fetch(`${endpoint}/${first.generationId}/preview`)).status, 409);
  generate();
  let status;
  for (let i = 0; i < 20; i++) { status = await (await fetch(`${endpoint}/${first.generationId}`)).json(); if (status.state === 'SUCCEEDED') break; await new Promise(done => setTimeout(done, 10)); }
  assert.equal(status.state, 'SUCCEEDED');
  assert.equal((await post('protected', {}, { 'x-test-protected': 'true' })).status, 401);
  const recovered = await fetch(`${endpoint}/${first.generationId}`, { headers: { 'x-test-restored': 'true' } });
  assert.equal((await recovered.json()).state, 'SUCCEEDED', 'Completed state must survive a fresh handler instance');
  const recoveredVideo = await fetch(`${endpoint}/${first.generationId}/preview`, { headers: { 'x-test-restored': 'true' } });
  assert.deepEqual(Buffer.from(await recoveredVideo.arrayBuffer()), bytes);
  assert.equal((await fetch(`${endpoint}/${first.generationId}`, { headers: { 'x-test-protected': 'true' } })).status, 401);
  assert.equal((await fetch(`${endpoint}/${first.generationId}`, { headers: { 'x-test-protected': 'true', authorization: 'Bearer test-operator' } })).status, 200);

  const preview = await fetch(`${endpoint}/${first.generationId}/preview`);
  assert.equal(preview.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  const range = await fetch(`${endpoint}/${first.generationId}/preview`, { headers: { range: 'bytes=0-15' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-15/${bytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  assert.equal((await fetch(`${endpoint}/${first.generationId}/preview`, { headers: { range: `bytes=${bytes.length}-` } })).status, 416);
  assert.equal(status.previewVideo.sourceHash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(status.previewVideo.width, sceneManifest.video.width);
  const failed = await (await post('failure')).json(); failGeneration(Error('provider failed'));
  for (let i = 0; i < 20; i++) { status = await (await fetch(`${endpoint}/${failed.generationId}`)).json(); if (status.state === 'FAILED') break; await new Promise(done => setTimeout(done, 10)); }
  assert.equal(status.state, 'FAILED');
  assert.equal((await fetch(`${endpoint}/${failed.generationId}/preview`)).status, 409, 'Failure must not return a sample video');
  console.log('Demo background checks passed: provider request, exact MP4/hash, single-flight/idempotency, model and origin checks, and failure without fixture substitution.');
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
