import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OpenMontageProviderPort, OpenMontageProviderRequest, OpenMontageProviderResult } from '@medical-device/contracts';

function asMode(value: string | undefined): 'deterministic' | 'http' { return value?.trim().toLowerCase() === 'http' ? 'http' : 'deterministic'; }

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function createOpenMontageProvider(options: { mode?: string; endpoint?: string; apiKey?: string; fixturePath?: string } = {}): OpenMontageProviderPort {
  const mode = asMode(options.mode ?? process.env.OPENMONTAGE_PROVIDER_MODE);
  if (mode === 'http') {
    const endpoint = options.endpoint?.trim() || process.env.OPENMONTAGE_PROVIDER_URL?.trim();
    if (!endpoint) throw new Error('OPENMONTAGE_PROVIDER_URL_REQUIRED');
    const providerEndpoint = endpoint;
    const timeoutMs = Number(process.env.OPENMONTAGE_PROVIDER_TIMEOUT_MS ?? 900_000);
    const pollMs = Number(process.env.OPENMONTAGE_PROVIDER_POLL_MS ?? 2_000);
    const headers = { 'content-type': 'application/json', ...(options.apiKey || process.env.OPENMONTAGE_PROVIDER_API_KEY ? { authorization: `Bearer ${options.apiKey || process.env.OPENMONTAGE_PROVIDER_API_KEY}` } : {}) };
    async function createJob(request: OpenMontageProviderRequest): Promise<any> {
      const response = await fetchWithTimeout(providerEndpoint, { method: 'POST', headers, body: JSON.stringify(request) }, timeoutMs);
      if (!response.ok) throw new Error(`OPENMONTAGE_PROVIDER_HTTP_${response.status}`);
      return response.json();
    }
    async function pollJob(statusUrl: string): Promise<any> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const response = await fetchWithTimeout(statusUrl, { method: 'GET', headers }, Math.min(timeoutMs, 30_000));
        if (!response.ok) throw new Error(`OPENMONTAGE_PROVIDER_HTTP_${response.status}`);
        const body = await response.json() as any;
        const state = String(body.status ?? body.state ?? '').toLowerCase();
        if (typeof body.videoBase64 === 'string' || body.videoUrl || ['completed', 'succeeded', 'ready'].includes(state)) return body;
        if (['failed', 'error', 'cancelled'].includes(state)) throw new Error('OPENMONTAGE_PROVIDER_JOB_FAILED');
        await wait(Math.max(250, pollMs));
      }
      throw new Error('OPENMONTAGE_PROVIDER_TIMEOUT');
    }
    async function retrieveVideo(body: any): Promise<Uint8Array> {
      if (typeof body.videoBase64 === 'string') return Uint8Array.from(Buffer.from(body.videoBase64, 'base64'));
      if (typeof body.videoUrl !== 'string') throw new Error('OPENMONTAGE_PROVIDER_RESPONSE_INVALID');
      const response = await fetchWithTimeout(body.videoUrl, { method: 'GET', headers }, timeoutMs);
      if (!response.ok) throw new Error(`OPENMONTAGE_PROVIDER_HTTP_${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    return {
      async generate(request: OpenMontageProviderRequest): Promise<OpenMontageProviderResult> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const created = await createJob(request);
            const body = created.videoBase64 || created.videoUrl ? created : await pollJob(typeof created.statusUrl === 'string' ? created.statusUrl : `${providerEndpoint.replace(/\/$/, '')}/jobs/${encodeURIComponent(String(created.jobId ?? ''))}`);
            const bytes = await retrieveVideo(body);
            return { provider: { name: typeof body.provider === 'string' ? body.provider : 'http', ...(typeof created.jobId === 'string' ? { jobId: created.jobId } : {}), ...(typeof body.jobId === 'string' ? { jobId: body.jobId } : {}), ...(typeof body.model === 'string' ? { model: body.model } : {}) }, output: request.mode === 'CINEMATIC' ? 'CINEMATIC_COMPOSITE' : 'CLEAN_PLATE', ...(request.mode === 'CINEMATIC' ? { tracking: { status: body.tracking?.status === 'PASS' ? 'PASS' : 'FAIL', method: typeof body.tracking?.method === 'string' ? body.tracking.method : 'provider-tracked-reprojection', ...(Number.isFinite(body.tracking?.reprojectionErrorPixels) ? { reprojectionErrorPixels: Number(body.tracking.reprojectionErrorPixels) } : {}) } } : {}), video: { bytes, contentType: body.contentType === 'video/webm' ? 'video/webm' : 'video/mp4', width: Number(body.width ?? request.width), height: Number(body.height ?? request.height), frameRate: Number(body.frameRate ?? request.frameRate), durationSeconds: Number(body.durationSeconds ?? request.durationSeconds) } };
          } catch (error) { lastError = error; if (attempt === 0) await wait(500); }
        }
        throw lastError instanceof Error ? lastError : new Error('OPENMONTAGE_PROVIDER_FAILED');
      }
    };
  }
  return {
    async generate(request: OpenMontageProviderRequest): Promise<OpenMontageProviderResult> {
      const fixture = options.fixturePath || (request.mode === 'CINEMATIC' ? process.env.OPENMONTAGE_CINEMATIC_FIXTURE_VIDEO || resolve(process.cwd(), 'fixtures/nxstage-system-one/nxstage-hallway-to-room-composite.mp4') : process.env.OPENMONTAGE_FIXTURE_VIDEO || resolve(process.cwd(), 'fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4'));
      const bytes = new Uint8Array(await readFile(fixture));
      return { provider: { name: request.mode === 'CINEMATIC' ? 'deterministic-offline-compositor' : 'deterministic-fixture', model: request.mode }, output: request.mode === 'CINEMATIC' ? 'CINEMATIC_COMPOSITE' : 'CLEAN_PLATE', ...(request.mode === 'CINEMATIC' ? { tracking: { status: 'PASS', method: 'blender-calibrated-camera', reprojectionErrorPixels: 0 } } : {}), video: { bytes, contentType: 'video/mp4', width: request.width, height: request.height, frameRate: request.frameRate, durationSeconds: request.durationSeconds } };
    }
  };
}
