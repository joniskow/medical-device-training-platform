import {build} from '../apps/web/node_modules/esbuild/lib/main.js';
import {copyFile, mkdir, writeFile, readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';

// Admin overlay: preserve existing API/worker handlers and add the scoped rights endpoint. The base
// digest is explicit so a working tree's unrelated backend edits cannot ship.
const baseImage = process.argv.find(arg => arg.startsWith('--base-image='))?.slice('--base-image='.length);
if (!baseImage || !/^mdtpersonalacr01\.azurecr\.io\/api@sha256:[a-f0-9]{64}$/.test(baseImage)) throw Error('Supply the currently deployed immutable API image with --base-image=.');
const directory = resolve('output/admin-deploy');
await mkdir(resolve(directory, 'web'), {recursive: true});
for (const entry of ['admin', 'admin-viewer', 'signin']) {
  const outfile = resolve(directory, 'web', entry + '.js');
  await build({entryPoints:[resolve('apps/web/src', entry + '.ts')],outfile,bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',external:['./admin-viewer.js'],legalComments:'none'});
  await writeFile(outfile + '.gz', gzipSync(await readFile(outfile), {level:9}));
  await copyFile(outfile, resolve('apps/web/dist', entry + '.js'));
}
for (const name of ['admin.html', 'admin.css']) { await copyFile(resolve('apps/web/src', name), resolve(directory, 'web', name)); await copyFile(resolve('apps/web/src', name), resolve('apps/web/dist', name)); }
await build({entryPoints:[resolve('apps/api/src/admin-rights.ts')],outfile:resolve(directory,'admin-rights.js'),bundle:false,format:'esm',platform:'node',target:'node24',legalComments:'none'});
await build({entryPoints:[resolve('packages/contracts/src/asset-rights-openapi.ts')],outfile:resolve(directory,'admin-rights-openapi.js'),bundle:false,format:'esm',platform:'node',target:'node24',legalComments:'none'});
await copyFile(resolve('tools/patch-admin-routes.mjs'), resolve(directory, 'patch-admin-routes.mjs'));
await writeFile(resolve(directory, 'Dockerfile'), `FROM ${baseImage}\nUSER root\nCOPY web/ /app/web/\nCOPY admin-rights.js admin-rights-openapi.js /app/dist/\nCOPY patch-admin-routes.mjs /tmp/patch-admin-routes.mjs\nRUN node /tmp/patch-admin-routes.mjs /app/dist/job-status-http.js && rm /tmp/patch-admin-routes.mjs\nUSER app\n`);
console.log('Built admin Azure image context: ' + directory);
