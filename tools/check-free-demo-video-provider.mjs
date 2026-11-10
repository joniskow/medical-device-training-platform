import assert from 'node:assert/strict';
import { createFreeDemoVideoProvider } from './free-demo-video-provider.mjs';

const origin = 'https://lightricks-ltx-2-5.hf.space';
const id = 'a'.repeat(32);
const request = { prompt: 'An empty teaching room', mode: 'LOCKED_INTERACTIVE', width: 960, height: 540, frameRate: 30, durationSeconds: 3 };
let calls = [], failure = false, downloadOrigin = origin, normalized = false;
const provider = createFreeDemoVideoProvider({
  fetchImpl: async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'error');
    if (String(url).endsWith('/call/v2/run')) {
      const input = JSON.parse(options.body);
      assert.equal(input.image_path, null, 'Project photos must not be uploaded');
      assert.match(input.prompt, /clear continuous motion/);
      assert.equal(input.duration_s, 3);
      return Response.json({ event_id: id });
    }
    if (String(url).endsWith(`/call/run/${id}`)) {
      const text = failure ? 'event: error\ndata: "GPU quota exceeded"\n\n' : `event: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([{ url: `${downloadOrigin}/gradio_api/file=/tmp/gradio/video.mp4` }])}\n\n`;
      const bytes = new TextEncoder().encode(text);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 37)); controller.enqueue(bytes.slice(37)); controller.close(); } }));
    }
    assert.equal(new URL(url).origin, origin);
    return new Response(new Uint8Array([1, 2, 3]));
  },
  normalize: async bytes => { assert.deepEqual([...bytes], [1, 2, 3]); normalized = true; return new Uint8Array([4, 5, 6]); }
});
const result = await provider.generate(request);
assert.equal(result.motion, true); assert.equal(result.video.frameRate, 30); assert(normalized);
assert.equal(result.provider.name, 'huggingface-zerogpu'); assert.equal(calls.length, 3);
failure = true; calls = []; normalized = false;
await assert.rejects(provider.generate(request), /FREE_VIDEO_QUOTA_OR_PROVIDER_ERROR/);
assert.equal(calls.length, 2, 'Quota errors must not trigger retries, downloads or paid fallback'); assert.equal(normalized, false);
failure = false; downloadOrigin = 'https://untrusted.example';
await assert.rejects(provider.generate(request), /FREE_VIDEO_DOWNLOAD_ORIGIN_INVALID/);
await assert.rejects(provider.generate({ ...request, mode: 'CINEMATIC' }), /FREE_VIDEO_PROFILE_UNSUPPORTED/);
console.log('Free motion provider checks passed: text-to-video request, streamed result, normalization, quota failure without retries or charges, and download-origin validation.');
