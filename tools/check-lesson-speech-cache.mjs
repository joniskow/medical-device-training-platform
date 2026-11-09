import assert from 'node:assert/strict';
import {createCachedLessonSpeech} from '../apps/worker/dist/lesson-speech-cache.js';

const objects = new Map();
let calls = 0, reads = [], writes = 0;
const storage = {
  async readObject({blobKey}) { reads.push(blobKey); if (!objects.has(blobKey)) throw Error('missing'); return objects.get(blobKey); },
  async putObject({blobKey, bytes, contentType}) { writes++; objects.set(blobKey, {bytes, contentType}); }
};
const speech = {async synthesize(request) { calls++; return {provider: {name: 'azure-speech', voice: request.voice}, audio: {bytes: new Uint8Array(128).fill(calls), contentType: 'audio/mpeg', durationSeconds: 2}}; }};
const request = {requestId: 'first', text: 'Check the clamp.', voice: 'en-US-JennyNeural', locale: 'en-US'};
const events = [];
const cached = (options = {}) => createCachedLessonSpeech({speech, storage, organizationId: 'tenant-a', courseVersionId: 'course:1', providerRevision: 'endpoint-1', onResult: event => events.push(event), ...options});
const first = await cached().synthesize(request);
const again = await cached().synthesize({...request, requestId: 'second', delivery: {rate: 1, emphasis: 'none'}});
assert.deepEqual(again, first);
assert.equal(calls, 1, 'separate render instances reuse unchanged narration');
assert.deepEqual(events.map(e => e.reused), [false, true]);
assert.ok(reads.every(key => key.startsWith('tenant-a/derived/lesson-speech/')));
for (const changed of [{text: 'Check the new clamp.'}, {voice: 'en-US-JaneNeural'}, {locale: 'en-GB'}, {delivery: {rate: 0.8}}, {delivery: {pronunciations: [{term: 'clamp', alias: 'clip'}]}}]) await cached().synthesize({...request, ...changed});
assert.equal(calls, 6, 'changes to any synthesis input invalidate narration');
await cached({organizationId: 'tenant-b'}).synthesize(request);
await cached({courseVersionId: 'course:2'}).synthesize(request);
await cached({providerRevision: 'endpoint-2'}).synthesize(request);
assert.equal(calls, 9, 'cache is isolated by tenant, course version and provider revision');
const key = reads[0], saved = objects.get(key);
const corrupt = JSON.parse(Buffer.from(saved.bytes).toString());
corrupt.audio.bytes = Buffer.alloc(128, 99).toString('base64');
objects.set(key, {bytes: Buffer.from(JSON.stringify(corrupt)), contentType: 'application/json'});
await cached().synthesize(request);
assert.equal(calls, 10, 'corrupt cached bytes regenerate');
const brokenStorage = {async readObject() { throw Error('storage unavailable'); }, async putObject() { throw Error('storage unavailable'); }};
await cached({storage: brokenStorage}).synthesize(request);
assert.equal(calls, 11, 'cache outage does not block production');
await assert.rejects(cached({checkpoint: async () => {throw Error('lease lost');}}).synthesize(request), /lease lost/);
const beforeWrites = writes;
await assert.rejects(cached({providerRevision: 'synthetic', speech: {async synthesize() {return {...first, provider: {name: 'deterministic-silent-speech', voice: request.voice}};}}}).synthesize(request), /ACTUAL_NARRATION_REQUIRED/);
assert.equal(writes, beforeWrites, 'synthetic speech is never cached');
await assert.rejects(async () => cached({organizationId: '../escape'}), /SPEECH_CACHE_SCOPE_INVALID/);
console.log('lesson speech cache checks passed');
