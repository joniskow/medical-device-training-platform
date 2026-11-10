import assert from 'node:assert/strict';
import { createAzureMotionProvider } from '../services/demo/azure-motion-provider.mjs';
let downloads = 0, destination = 'https://demo.blob.core.windows.net/results/video.mp4?sv=test';
const provider = createAzureMotionProvider({ endpoint: 'https://demo.services.ai.azure.com/', deployment: 'training-motion', credential: { getToken: async () => ({ token: 'test-token' }) }, normalize: async bytes => bytes, fetchImpl: async (url, options) => {
  url = String(url);
  assert.equal(options.redirect, 'error');
  if (url.endsWith('/text-to-video/fast')) { const body = JSON.parse(options.body); assert.equal(body.model, 'training-motion'); assert.equal(body.duration, 6); assert.equal(options.headers.authorization, 'Bearer test-token'); return Response.json({ request_id: 'job-test' }); }
  if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
  if (url.endsWith('/requests/job-test')) return Response.json({ video: { url: destination } });
  downloads++;
  if (url.startsWith('https://demo.services.ai.azure.com/')) assert.equal(options.headers.authorization, 'Bearer test-token', 'Same-origin Foundry results require authentication');
  else assert.equal(options.headers, undefined, 'Bearer credentials must not reach Blob download URLs');
  return new Response(new Uint8Array([1, 2, 3]));
} });
const request = { prompt: 'A staff member walking behind an empty training area', width: 960, height: 540, frameRate: 30, durationSeconds: 3 };
assert.equal((await provider.generate(request)).motion, true); assert.equal(downloads, 1);
destination = 'https://demo.services.ai.azure.com/results/video.mp4';
assert.equal((await provider.generate(request)).motion, true); assert.equal(downloads, 2);
destination = 'http://127.0.0.1/private';
await assert.rejects(provider.generate(request), /AZURE_MOTION_DOWNLOAD_ORIGIN_INVALID/);
assert.equal(downloads, 2);
console.log('Azure demo provider checks passed: deployed model, six-second request, completion polling, credential isolation and download-origin validation.');
