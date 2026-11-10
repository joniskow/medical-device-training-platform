import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const origin = 'https://lightricks-ltx-2-5.hf.space';

async function boundedBytes(response, limit) {
  if (!response.ok || !response.body) throw Error('FREE_VIDEO_UNAVAILABLE');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('FREE_VIDEO_RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function normalizeDemoMotionVideo(bytes, request) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'demo-motion-'));
  try {
    const input = join(directory, 'source.mp4'), output = join(directory, 'background.mp4');
    await writeFile(input, bytes);
    const binaries = resolve('output/OpenMontage/remotion-composer/node_modules/@remotion/compositor-win32-x64-msvc');
    const ffmpeg = process.env.LESSON_FFMPEG || (process.platform === 'win32' ? join(binaries, 'ffmpeg.exe') : 'ffmpeg');
    const ffprobe = process.env.LESSON_FFPROBE || (process.platform === 'win32' ? join(binaries, 'ffprobe.exe') : 'ffprobe');
    await execute(ffmpeg, ['-v', 'error', '-y', '-i', input, '-an', '-vf', `scale=${request.width}:${request.height}`, '-r', String(request.frameRate), '-t', String(request.durationSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    const { stdout } = await execute(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,duration', '-of', 'json', output], { timeout: 10000, windowsHide: true });
    const stream = JSON.parse(stdout).streams?.[0];
    const [numerator, denominator] = String(stream?.r_frame_rate).split('/').map(Number);
    if (stream?.width !== request.width || stream.height !== request.height || numerator / denominator !== request.frameRate || Math.abs(Number(stream.duration) - request.durationSeconds) > 0.05) throw Error('FREE_VIDEO_PROFILE_MISMATCH');
    return new Uint8Array(await readFile(output));
  } finally {
    if (resolve(directory).startsWith(temporaryRoot + sep)) await rm(directory, { recursive: true, force: true });
  }
}

export function createFreeDemoVideoProvider({ fetchImpl = fetch, normalize = normalizeDemoMotionVideo } = {}) {
  return { async generate(request) {
    if (request.mode !== 'LOCKED_INTERACTIVE' || request.durationSeconds < 1 || request.durationSeconds > 5 || request.width / request.height !== 16 / 9) throw Error('FREE_VIDEO_PROFILE_UNSUPPORTED');
    const signal = AbortSignal.timeout(240000);
    const prompt = `${request.prompt}\nFixed tripod camera. Show clear continuous motion, such as a staff member walking across the rear of the room, or a curtain billowing strongly when no people are requested. Keep the center foreground empty for a separately rendered training device. No medical procedures, medical devices, lettering, visible camera equipment, camera movement or scene cuts.`;
    const submitted = await fetchImpl(`${origin}/gradio_api/call/v2/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, image_path: null, height: 576, width: 1024, duration_s: request.durationSeconds, seed: 102, decoder: 'conv', auto_len: false, randomize_seed: false, do_enhance: false }), redirect: 'error', signal });
    const job = JSON.parse((await boundedBytes(submitted, 32000)).toString('utf8'));
    if (typeof job.event_id !== 'string' || !/^[a-f0-9]{32}$/.test(job.event_id)) throw Error('FREE_VIDEO_SUBMISSION_INVALID');
    const events = await fetchImpl(`${origin}/gradio_api/call/run/${job.event_id}`, { redirect: 'error', signal });
    if (!events.ok || !events.body) throw Error('FREE_VIDEO_UNAVAILABLE');
    let buffer = '', total = 0, file;
    const decoder = new TextDecoder();
    for await (const chunk of events.body) {
      total += chunk.length; if (total > 1024 * 1024) throw Error('FREE_VIDEO_RESPONSE_TOO_LARGE');
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = message.match(/^event: (.+)$/m)?.[1];
        const data = message.match(/^data: (.+)$/m)?.[1];
        if (event === 'error') throw Error('FREE_VIDEO_QUOTA_OR_PROVIDER_ERROR');
        if (event === 'complete') { file = JSON.parse(data)?.[0]; break; }
      }
      if (file) break;
    }
    if (typeof file?.url !== 'string') throw Error('FREE_VIDEO_RESULT_MISSING');
    const url = new URL(file.url);
    if (url.origin !== origin || !url.pathname.startsWith('/gradio_api/file=/tmp/gradio/')) throw Error('FREE_VIDEO_DOWNLOAD_ORIGIN_INVALID');
    const download = await fetchImpl(url.href, { redirect: 'error', signal });
    const source = await boundedBytes(download, 64 * 1024 * 1024);
    const bytes = await normalize(source, request);
    return { provider: { name: 'huggingface-zerogpu', model: 'Lightricks/LTX-2.5', jobId: job.event_id }, motion: true, output: 'CLEAN_PLATE', video: { bytes, contentType: 'video/mp4', width: request.width, height: request.height, frameRate: request.frameRate, durationSeconds: request.durationSeconds } };
  } };
}
