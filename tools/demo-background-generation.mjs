import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateTrainingSceneManifest } from '../packages/contracts/dist/index.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const prefix = '/api/v1/openmontage/generations';

// Local demo only. Keep credentials on the server and retain at most two previews.
export function createDemoBackgroundGeneration({ provider, staticRoot, sampleVideo, applicationOrigin, authorize, store }) {
  const generations = new Map();
  if (sampleVideo) {
    const generationId = 'demo-motion-sample';
    generations.set(generationId, { bytes: sampleVideo.bytes, status: { generationId, jobId: generationId, briefId: generationId, mode: 'LOCKED_INTERACTIVE', promptHash: digest('prepared free motion sample'), state: 'SUCCEEDED', previewMotion: true, previewVideo: { ...sampleVideo.profile, assetVersionId: generationId, sourceHash: digest(sampleVideo.bytes) } } });
  }
  let running = false;
  const reply = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code) => reply(res, status, { error: { code } });
  return async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
    const host = req.headers.host ?? '';
    const expectedOrigin = applicationOrigin || `http://${host}`;
    if ((applicationOrigin ? host !== new URL(applicationOrigin).host : !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) || (req.headers.origin && req.headers.origin !== expectedOrigin)) {
      fail(res, 403, 'DEMO_ORIGIN_REQUIRED'); return true;
    }
    const publicSample = req.method === 'GET' && /^\/api\/v1\/openmontage\/generations\/demo-motion-sample(?:\/preview)?$/.test(path);
    if (authorize && !publicSample && !await authorize(req)) { fail(res, 401, 'DEMO_SIGN_IN_REQUIRED'); return true; }
    try {
      if (req.method === 'POST' && path === prefix) {
        if (!provider) { fail(res, 503, 'VIDEO_PROVIDER_NOT_CONFIGURED'); return true; }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') { fail(res, 415, 'JSON_REQUIRED'); return true; }
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 32000) { fail(res, 413, 'REQUEST_TOO_LARGE'); return true; } chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 1800) throw Error('PROMPT_INVALID');
        if (input.mode !== 'LOCKED_INTERACTIVE') throw Error('DEMO_LOCKED_BACKGROUND_REQUIRED');
        const supplied = validateTrainingSceneManifest(input.sceneManifest);
        let scene;
        for (const file of ['nxstage-review-scene.json', 'nxstage-training-scene-manifest.json', 'aurora-training-scene-manifest.json']) {
          const trusted = validateTrainingSceneManifest(JSON.parse(await readFile(resolve(staticRoot, 'model', file), 'utf8')));
          if (trusted.model.modelVersionId === supplied.model.modelVersionId && trusted.model.sourceHash === supplied.model.sourceHash) scene = trusted;
        }
        if (!scene) throw Error('DEMO_MODEL_NOT_SUPPORTED');
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) throw Error('IDEMPOTENCY_KEY_INVALID');
        const fingerprint = digest(JSON.stringify({ prompt: input.prompt, model: scene.model, mode: input.mode }));
        const prior = [...generations.values()].find(item => item.key === key);
        if (prior) { reply(res, prior.fingerprint === fingerprint ? 202 : 409, prior.fingerprint === fingerprint ? prior.status : { error: { code: 'IDEMPOTENCY_KEY_REUSED' } }); return true; }
        if (running) { fail(res, 429, 'VIDEO_GENERATION_BUSY'); return true; }
        const generationId = `demo-video-${randomUUID()}`;
        const status = { generationId, jobId: generationId, briefId: generationId, mode: input.mode, promptHash: digest(input.prompt), state: 'RUNNING' };
        const item = { key, fingerprint, status };
        while (generations.size >= (sampleVideo ? 3 : 2)) generations.delete([...generations.keys()].find(id => id !== 'demo-motion-sample'));
        generations.set(generationId, item);
        running = true;
        try { await store?.saveStatus(status); } catch (error) { running = false; throw error; }
        void Promise.resolve().then(() => provider.generate({ generationId, prompt: input.prompt, mode: input.mode, width: scene.video.width, height: scene.video.height, frameRate: scene.video.frameRate, durationSeconds: scene.video.durationSeconds, modelVersionId: scene.model.modelVersionId, modelSourceHash: scene.model.sourceHash })).then(async result => {
          if (result.output !== 'CLEAN_PLATE' || result.video.contentType !== 'video/mp4' || !result.video.bytes?.length || result.video.bytes.length > 64 * 1024 * 1024) throw Error('VIDEO_OUTPUT_INVALID');
          for (const field of ['width', 'height', 'frameRate', 'durationSeconds']) if (result.video[field] !== scene.video[field]) throw Error('VIDEO_PROFILE_MISMATCH');
          item.bytes = Buffer.from(result.video.bytes);
          status.previewVideo = { ...scene.video, assetVersionId: generationId, sourceHash: digest(item.bytes) };
          status.previewMotion = result.motion === true;
          await store?.saveVideo(generationId, item.bytes);
          status.state = 'SUCCEEDED';
          await store?.saveStatus(status);
        }).catch(async () => { status.state = 'FAILED'; status.outcome = { warnings: [{ message: 'The video provider failed. No sample was substituted.' }] }; await store?.saveStatus(status).catch(() => undefined); }).finally(() => { running = false; });
        reply(res, 202, status); return true;
      }
      const match = path.match(/^\/api\/v1\/openmontage\/generations\/([^/]+)(\/preview)?$/);
      let item = match && generations.get(decodeURIComponent(match[1]));
      if (!item && match && store && /^demo-video-[a-f0-9-]{36}$/.test(match[1])) {
        const status = await store.getStatus(match[1]);
        if (status) item = { status, bytes: match[2] && status.state === 'SUCCEEDED' ? await store.getVideo(match[1]) : undefined };
      }
      if (req.method !== 'GET' || !item) { fail(res, 404, 'DEMO_GENERATION_NOT_FOUND'); return true; }
      if (match[2]) {
        if (!item.bytes) { fail(res, 409, 'VIDEO_NOT_READY'); return true; }
        const total = item.bytes.length;
        const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, total - Number(range[2])) : NaN;
          const end = range?.[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= total) {
            res.writeHead(416, { ...headers, 'content-range': `bytes */${total}` }); res.end(); return true;
          }
          res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1 });
          res.end(item.bytes.subarray(start, end + 1));
        } else {
          res.writeHead(200, { ...headers, 'content-length': total }); res.end(item.bytes);
        }
      } else reply(res, 200, item.status);
    } catch { fail(res, 422, 'DEMO_BACKGROUND_REQUEST_INVALID'); }
    return true;
  };
}
