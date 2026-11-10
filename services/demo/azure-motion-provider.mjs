import { normalizeDemoMotionVideo } from '../../tools/free-demo-video-provider.mjs';

export function createAzureMotionProvider({ endpoint, deployment, credential, fetchImpl = fetch, normalize = normalizeDemoMotionVideo }) {
  const origin = new URL(endpoint);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.services.ai.azure.com') || origin.pathname !== '/' || origin.port || origin.username || origin.password || !/^[a-zA-Z0-9-]{1,64}$/.test(deployment)) throw Error('AZURE_MOTION_CONFIGURATION_INVALID');
  const base = `${origin.origin}/providers/falai/v1/lightricks/ltx-2.5`;
  const json = async (path, body) => {
    const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
    const response = await fetchImpl(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`AZURE_MOTION_HTTP_${response.status}`);
    return response.json();
  };
  return { async generate(request) {
    const submitted = await json('/text-to-video/fast', { model: deployment, prompt: `${request.prompt}\nContinuous visible motion. Stationary viewpoint, clear center foreground for a separate device overlay. No medical procedures or device operation.`, duration: 6, resolution: '720p', aspect_ratio: '16:9', fps: 24, generate_audio: false });
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(submitted.request_id ?? '')) throw Error('AZURE_MOTION_REQUEST_INVALID');
    const id = submitted.request_id;
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const status = await json(`/requests/${id}/status`);
      if (status.status === 'COMPLETED') { ready = true; break; }
      if (['FAILED', 'ERROR', 'CANCELLED'].includes(status.status)) throw Error('AZURE_MOTION_FAILED');
      await new Promise(done => setTimeout(done, 3000));
    }
    if (!ready) throw Error('AZURE_MOTION_TIMEOUT');
    const result = await json(`/requests/${id}`);
    const url = new URL(result.video?.url);
    // Download results without forwarding the Foundry bearer credential.
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.origin === origin.origin || url.hostname.endsWith('.blob.core.windows.net'))) throw Error('AZURE_MOTION_DOWNLOAD_ORIGIN_INVALID');
    const downloadToken = url.origin === origin.origin ? await credential.getToken('https://cognitiveservices.azure.com/.default') : null;
    const response = await fetchImpl(url, { ...(downloadToken ? { headers: { authorization: `Bearer ${downloadToken.token}` } } : {}), redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw Error('AZURE_MOTION_DOWNLOAD_FAILED');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > 64 * 1024 * 1024) throw Error('AZURE_MOTION_TOO_LARGE'); chunks.push(chunk); }
    const bytes = await normalize(Buffer.concat(chunks), request);
    return { provider: { name: 'azure-foundry-fal', model: deployment, jobId: id }, motion: true, output: 'CLEAN_PLATE', video: { bytes, contentType: 'video/mp4', width: request.width, height: request.height, frameRate: request.frameRate, durationSeconds: request.durationSeconds } };
  } };
}
