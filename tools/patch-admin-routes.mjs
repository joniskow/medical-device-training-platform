import {readFile, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
const file = process.argv[2];
if (!file) throw Error('Supply the compiled API router path.');
let source = await readFile(file, 'utf8');
if (!source.includes('const staticFiles = {')) throw Error('Unexpected base-image router. Inspect it before deploying.');
if (!/['"]\/admin['"]\s*:/.test(source)) source = source.replace('const staticFiles = {', `const staticFiles = {
  '/admin': {file:'admin.html',contentType:'text/html; charset=utf-8'},
  '/admin.js': {file:'admin.js',contentType:'text/javascript; charset=utf-8'},
  '/admin-viewer.js': {file:'admin-viewer.js',contentType:'text/javascript; charset=utf-8'},
  '/admin.css': {file:'admin.css',contentType:'text/css; charset=utf-8'},`);
else for (const [route, name] of [['/admin','admin.html'],['/admin.js','admin.js'],['/admin-viewer.js','admin-viewer.js'],['/admin.css','admin.css']]) {
  if (!source.includes(`'${route}': {file:'${name}'`)) throw Error('Unexpected existing admin routes. Inspect the base image before deploying.');
}
const embedded = /const embeddedImages = url\.pathname === (['"])\/learner\/model\1/;
if (embedded.test(source)) source = source.replace(embedded, "const embeddedImages = url.pathname === '/admin' || url.pathname === '/learner/model'");
else if (!source.includes("const embeddedImages = url.pathname === '/admin' ||")) throw Error('Unexpected image policy. Inspect the base image before deploying.');
if (!source.includes("action === 'rights'")) {
  if (!source.includes('(content|review|frames)')) throw Error('Unexpected media route. Inspect the base image.');
  source = source.replace('(content|review|frames)', '(content|review|frames|rights)');
  const point = /const id = mediaReviewMatch\[1\][^;]+;/;
  if (!point.test(source)) throw Error('Unexpected media handler. Inspect the base image.');
  source = source.replace(point, `$&
    if (action === 'rights') {
      const {handleAdminRights} = await import('./admin-rights.js');
      await handleAdminRights({request,response,tenant,id,service,readBody:()=>readJsonBody(request,maxBodyBytes),key:()=>idempotencyKey(request)}); return;
    }`);
}
if(!source.includes("from './admin-rights-openapi.js'")) source="import {assetRightsOpenApiPath} from './admin-rights-openapi.js';\n"+source;
if(!source.includes('Object.assign(learnerOpenApi.paths, assetRightsOpenApiPath)')) source+='\nObject.assign(learnerOpenApi.paths, assetRightsOpenApiPath);\n';
const serviceFile=join(dirname(file),'media-review-service.js');
let service=await readFile(serviceFile,'utf8');
if (!service.includes('attestRights:')) {
  const point=/return \{\s*async list\(tenant/;
  if (!point.test(service)) throw Error('Unexpected media service. Inspect the base image.');
  service="import {createAssetRightsAttestor} from './admin-rights.js';\n"+service.replace(point,'return { attestRights: createAssetRightsAttestor(pool), async list(tenant');
  await writeFile(serviceFile,service);
}
await writeFile(file, source);
console.log('Installed admin UI routes and authenticated, tenant-scoped usage-rights registration; retained existing backend handlers.');
