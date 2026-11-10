import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { ManagedIdentityCredential } from '@azure/identity';
import { createJobStatusHttpServer } from '../../apps/api/dist/job-status-http.js';
import { createEntraRequestAuthenticator } from '../../apps/api/dist/entra-authenticator.js';
import { createDemoBackgroundGeneration } from '../../tools/demo-background-generation.mjs';
import { createAzureMotionProvider } from './azure-motion-provider.mjs';

const required = key => { const value = process.env[key]; if (!value) throw Error(`Missing ${key}`); return value; };
const applicationOrigin = required('APPLICATION_ORIGIN');
const staticRoot = resolve(process.env.STATIC_ROOT || '/app/web');
const credential = new ManagedIdentityCredential({ clientId: required('AZURE_CLIENT_ID') });
const container = new BlobServiceClient(required('DEMO_STORAGE_URL'), credential).getContainerClient('demo-media');
const allowedSubjects = new Set(required('DEMO_GENERATION_ALLOWED_SUBJECTS').split(','));
const authenticator = createEntraRequestAuthenticator({ tenantId: required('ENTRA_TENANT_ID'), audience: required('ENTRA_AUDIENCE'), openIdConfigurationUrl: required('ENTRA_OPENID_CONFIGURATION_URL') });
const authorize = async req => { const principal = await authenticator.authenticate(req); return !!principal && !principal.machineIdentity && allowedSubjects.has(principal.subject); };
const readBlob = async (name, limit) => {
  const blob = container.getBlockBlobClient(name);
  try { const properties = await blob.getProperties(); if (properties.contentLength > limit) throw Error('DEMO_BLOB_TOO_LARGE'); return await blob.downloadToBuffer(0, properties.contentLength); }
  catch (error) { if (error.statusCode === 404) return null; throw error; }
};
const sampleName = 'samples/clinical-motion.mp4';
if (!await container.getBlockBlobClient(sampleName).exists()) {
  await container.getBlockBlobClient(sampleName).uploadData(await readFile('/app/sample.mp4'), { blobHTTPHeaders: { blobContentType: 'video/mp4' } });
}
const sample = await readBlob(sampleName, 64 * 1024 * 1024);
const profile = JSON.parse(await readFile(resolve(staticRoot, 'model/nxstage-review-scene.json'), 'utf8')).video;
const store = {
  saveStatus: status => container.getBlockBlobClient(`generations/${status.generationId}.json`).uploadData(Buffer.from(JSON.stringify(status)), { blobHTTPHeaders: { blobContentType: 'application/json' } }),
  saveVideo: (id, bytes) => container.getBlockBlobClient(`generations/${id}.mp4`).uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'video/mp4' } }),
  getStatus: async id => { const bytes = await readBlob(`generations/${id}.json`, 32000); return bytes ? JSON.parse(bytes.toString('utf8')) : null; },
  getVideo: id => readBlob(`generations/${id}.mp4`, 64 * 1024 * 1024)
};
const background = createDemoBackgroundGeneration({ staticRoot, applicationOrigin, authorize, store, sampleVideo: { bytes: sample, profile }, provider: createAzureMotionProvider({ endpoint: required('AZURE_MOTION_ENDPOINT'), deployment: required('AZURE_MOTION_DEPLOYMENT'), credential }) });
const server = createJobStatusHttpServer({ staticRoot, allowedOrigins: [applicationOrigin], authenticator, statusService: { get: async () => null, retry: async () => null } });
const [application] = server.listeners('request'); server.removeListener('request', application);
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
server.on('request', (req, res) => { void (async () => {
  const path = new URL(req.url, applicationOrigin).pathname;
  if (path === '/healthz' || path === '/readyz') { json(res, 200, { ok: true, provider: 'azure-foundry-fal', storage: 'azure-blob' }); return; }
  if (path === '/demo-config.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); res.end("globalThis.__DEMO_HOSTING__='AZURE';"); return; }
  if (path === '/api/v1/auth/config') { json(res, 200, { clientId: required('BROWSER_AUTH_CLIENT_ID'), tenantId: required('ENTRA_TENANT_ID'), authority: required('BROWSER_AUTH_AUTHORITY'), apiScope: required('BROWSER_AUTH_API_SCOPE'), applicationOrigin, knownAuthorities: ['login.microsoftonline.com'] }); return; }
  if (path === '/api/v1/account') { json(res, await authorize(req) ? 200 : 401, {}); return; }
  if (path === '/signin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo sign-in</title><main><h1>Sign in to generate an Azure video</h1><p id="message" role="status">Prepared sample playback is public. New billable video requests require the configured demo operator account.</p><button id="continue">Sign in with Microsoft</button><p><a href="/demo?model=nxstage-review">Return to demo</a></p></main><script type="module" src="/demo-signin.js"></script></html>'); return;
  }
  if (!await background(req, res)) application(req, res);
})().catch(() => { if (!res.headersSent) json(res, 500, { error: { code: 'HOSTED_DEMO_UNAVAILABLE' } }); else res.end(); }); });
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
