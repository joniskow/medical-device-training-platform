import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Opt-in deployed check; it never submits a paid generation or reads credentials.
const base = process.env.AZURE_DEMO_ORIGIN;
if (!base || !/^https:\/\/[a-z0-9.-]+\.azurecontainerapps\.io$/.test(base)) throw Error('AZURE_DEMO_ORIGIN_REQUIRED');
const get = path => fetch(base + path, { signal: AbortSignal.timeout(60000), redirect: 'error' });
const health = await get('/healthz'); assert.equal(health.status, 200);
assert.equal((await health.json()).provider, 'azure-foundry-fal');
const signin = await get('/signin'); assert.equal(signin.status, 200);
assert.match(await signin.text(), /src="\/demo-signin.js"/);
const script = await get('/demo-signin.js'); assert.equal(script.status, 200, 'The sign-in button script must be served');
assert.match(script.headers.get('content-type'), /(?:java|ecma)script/);
assert.match(await script.text(), /loginRedirect/);
const config = await get('/api/v1/auth/config'); assert.equal((await config.json()).applicationOrigin, base);
const samplePath = '/api/v1/openmontage/generations/demo-motion-sample/preview';
const sample = await get(samplePath); assert.equal(sample.status, 200);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(Buffer.from(await sample.arrayBuffer())), hash(await readFile('fixtures/demo-motion/background.mp4')));
const range = await fetch(base + samplePath, { headers: { range: 'bytes=0-127' }, signal: AbortSignal.timeout(60000) });
assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 128);
const denied = await fetch(base + '/api/v1/openmontage/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60000), redirect: 'error' });
assert.equal(denied.status, 401);
console.log('Hosted Azure checks passed: health, executable sign-in script, auth configuration, sample integrity, video byte ranges, and anonymous generation rejection. No paid render was submitted.');
