import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';

const port = Number(process.env.NXSTAGE_REVIEW_PORT || 4215);
const request = (path, encoding) => new Promise((resolve, reject) => {
  get({ host: '127.0.0.1', port, path, headers: { 'accept-encoding': encoding } }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    response.on('error', reject);
  }).on('error', reject);
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse((await request('/learner/model-manifest.mobile.json', 'identity')).bytes);
for (const path of ['/learner/model/aurora-infusion-controller.glb', '/learner/model/aurora-infusion-controller.mobile.glb']) {
  const [raw, zipped, declined] = await Promise.all([request(path, 'identity'), request(path, 'gzip, deflate'), request(path, 'gzip;q=0, identity')]);
  assert.equal(raw.status, 200); assert.equal(zipped.status, 200);
  assert.equal(raw.headers['content-encoding'], undefined);
  assert.equal(declined.headers['content-encoding'], undefined, 'The server must respect gzip;q=0');
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.match(zipped.headers.vary, /accept-encoding/i);
  assert.equal(hash(raw.bytes), manifest.sourceHash, 'Uncompressed bytes must match the model manifest');
  assert.equal(hash(gunzipSync(zipped.bytes)), manifest.sourceHash, 'Decoded gzip must match exactly the same model');
  assert(zipped.bytes.length < raw.bytes.length * .7, 'Compressed transfer must materially reduce download size');
  console.log(`${path}: ${raw.bytes.length} bytes -> ${zipped.bytes.length} bytes; decoded SHA-256 verified.`);
}
