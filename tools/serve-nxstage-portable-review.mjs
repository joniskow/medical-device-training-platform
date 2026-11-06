import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await readFile(join(root, 'package-integrity.json'), 'utf8'));
for (const [path, expected] of Object.entries(data.sha256)) {
  const actual = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  if (actual !== expected) throw new Error(`Package integrity check failed: ${path}`);
}
const modelBytes = await readFile(join(root, 'model/nxstage-system-one.glb'));
const compressedModel = gzipSync(modelBytes);
const routes = new Map([
  ['/demo', ['demo.html', 'text/html; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/demo.css', ['demo.css', 'text/css; charset=utf-8']],
  ['/model/nxstage-system-one.glb', ['model/nxstage-system-one.glb', 'model/gltf-binary']],
  ['/model/nxstage-system-one-manifest.json', ['model/nxstage-system-one-manifest.json', 'application/json; charset=utf-8']],
  ['/model/nxstage-training-scene-manifest.json', ['model/nxstage-training-scene-manifest.json', 'application/json; charset=utf-8']],
  ['/demo-assets/nxstage-clinical-photo-v4.png', ['demo-assets/nxstage-clinical-photo-v4.png', 'image/png']],
  ['/demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4', ['demo-assets/nxstage-doctors-office-walkthrough-photoreal-v3.mp4', 'video/mp4']],
  ['/demo-assets/nxstage-interactive-exam-room.png', ['demo-assets/nxstage-interactive-exam-room.png', 'image/png']],
  ['/demo-assets/nxstage-system-one-preview.png', ['demo-assets/nxstage-system-one-preview.png', 'image/png']]
]);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') { response.writeHead(302, {location:'/demo?review=1'}); response.end(); return; }
  if (url.pathname === '/demo' && url.searchParams.has('review')) {
    response.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store'});
    createReadStream(join(root, 'demo-review.html')).on('error', () => response.destroy()).pipe(response);
    return;
  }
  const route = routes.get(url.pathname);
  if (!route) { response.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); response.end('Not found'); return; }
  if (url.pathname === '/model/nxstage-system-one.glb') {
    const acceptsGzip = (request.headers['accept-encoding'] ?? '').split(',').some(part => { const [encoding, ...params] = part.trim().toLowerCase().split(';'); const quality = params.find(param => param.trim().startsWith('q=')); return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0); });
    response.writeHead(200, {'content-type':route[1], 'cache-control':'no-store', vary:'Accept-Encoding', ...(acceptsGzip ? {'content-encoding':'gzip'} : {})});
    response.end(acceptsGzip ? compressedModel : modelBytes);
    return;
  }
  response.writeHead(200, {'content-type':route[1], 'cache-control':'no-store'});
  createReadStream(join(root, route[0])).on('error', () => response.destroy()).pipe(response);
});
const port = Number(process.env.NXSTAGE_PORTABLE_PORT ?? 4217);
server.listen(port, '127.0.0.1', () => console.log(`Portable interaction review: http://127.0.0.1:${port}/`));
