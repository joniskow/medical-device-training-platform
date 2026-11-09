import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OpenMontageProviderPort, OpenMontageProviderRequest, OpenMontageProviderResult } from '@medical-device/contracts';
import {readTechnicalLimits} from '@medical-device/contracts';
import {approvedOrigin,approvedUrl,boundedHttpsRequest} from './provider-egress.js';

function asMode(value: string | undefined): 'deterministic' | 'http' {
  const mode=value?.trim().toLowerCase()??'deterministic';
  if(mode!=='http'&&mode!=='deterministic')throw Error('OPENMONTAGE_PROVIDER_MODE_INVALID');
  if(mode==='deterministic'&&['production','staging'].includes(process.env.APP_ENV?.trim().toLowerCase()??''))throw Error('PRODUCTION_VIDEO_PROVIDER_REQUIRED');
  return mode;
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export function createOpenMontageProvider(options: { mode?: string; endpoint?: string; apiKey?: string; fixturePath?: string } = {}): OpenMontageProviderPort {
  const mode = asMode(options.mode ?? process.env.OPENMONTAGE_PROVIDER_MODE);
  if (mode === 'http') {
    const endpoint = options.endpoint?.trim() || process.env.OPENMONTAGE_PROVIDER_URL?.trim();
    if (!endpoint) throw new Error('OPENMONTAGE_PROVIDER_URL_REQUIRED');
    const providerEndpoint = endpoint;
    const limits=readTechnicalLimits(process.env);
    const timeoutMs = limits.providerTimeoutMs;
    const pollMs = 2_000;
    const providerOrigin=approvedOrigin(providerEndpoint);
    const providerOrigins=new Set([providerOrigin]);
    const videoOrigins=new Set([providerOrigin,...(process.env.OPENMONTAGE_VIDEO_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean).map(approvedOrigin)]);
    const headers = { 'content-type': 'application/json', ...(options.apiKey || process.env.OPENMONTAGE_PROVIDER_API_KEY ? { authorization: `Bearer ${options.apiKey || process.env.OPENMONTAGE_PROVIDER_API_KEY}` } : {}) };
    async function createJob(request: OpenMontageProviderRequest): Promise<any> {
      const response = await boundedHttpsRequest({url:providerEndpoint,origins:providerOrigins,method:'POST',headers,body:JSON.stringify(request),timeoutMs,maxBytes:Math.min(Math.ceil(limits.maxProviderBytes*4/3)+4096,192*1024*1024)});
      return JSON.parse(response.bytes.toString('utf8'));
    }
    async function pollJob(statusUrl: string): Promise<any> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const response = await boundedHttpsRequest({url:statusUrl,origins:providerOrigins,headers,timeoutMs:Math.max(1,Math.min(deadline-Date.now(),30_000)),maxBytes:Math.ceil(limits.maxProviderBytes*4/3)+4096});
        const body = JSON.parse(response.bytes.toString('utf8')) as any;
        const state = String(body.status ?? body.state ?? '').toLowerCase();
        if (typeof body.videoBase64 === 'string' || body.videoUrl || ['completed', 'succeeded', 'ready'].includes(state)) return body;
        if (['failed', 'error', 'cancelled'].includes(state)) throw new Error('OPENMONTAGE_PROVIDER_JOB_FAILED');
        await wait(Math.max(250, pollMs));
      }
      throw new Error('OPENMONTAGE_PROVIDER_TIMEOUT');
    }
    async function retrieveVideo(body: any): Promise<Uint8Array> {
      if (typeof body.videoBase64 === 'string') {
        if(body.videoBase64.length>Math.ceil(limits.maxProviderBytes/3)*4 || body.videoBase64.length%4!==0 || /[^A-Za-z0-9+/=]/.test(body.videoBase64))throw Error('OPENMONTAGE_PROVIDER_VIDEO_INVALID');
        const bytes=Buffer.from(body.videoBase64,'base64');
        if(!bytes.length||bytes.length>limits.maxProviderBytes||bytes.toString('base64')!==body.videoBase64)throw Error('OPENMONTAGE_PROVIDER_VIDEO_INVALID');
        return bytes;
      }
      if (typeof body.videoUrl !== 'string') throw new Error('OPENMONTAGE_PROVIDER_RESPONSE_INVALID');
      const url=approvedUrl(body.videoUrl,videoOrigins);
      const response = await boundedHttpsRequest({url:url.href,origins:videoOrigins,headers:url.origin===providerOrigin?headers:{accept:'video/mp4,video/webm'},timeoutMs,maxBytes:limits.maxProviderBytes});
      if(!response.bytes.length)throw Error('OPENMONTAGE_PROVIDER_VIDEO_INVALID');
      return response.bytes;
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
