import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {learnerOpenApi} from '../packages/contracts/dist/learner-openapi.js';
import {technicalOpenApiPaths,technicalOpenApiSchemas} from '../packages/contracts/dist/technical-openapi.js';

assert(JSON.stringify(JSON.parse(await readFile(new URL('../packages/api-client/openapi.json',import.meta.url),'utf8')))===JSON.stringify(learnerOpenApi),'Regenerate API client after contract changes');
for(const [path,methods]of Object.entries(technicalOpenApiPaths))for(const [method,contract]of Object.entries(methods)){
 assert.deepEqual(learnerOpenApi.paths[path]?.[method],contract,`Missing or divergent integrated contract: ${method} ${path}`);
 assert(contract.responses.default.content['application/json'].schema.$ref==='#/components/schemas/ApiError');
 if(['post','put'].includes(method)){
  const schema=contract.requestBody.content['application/json'].schema;
  assert((schema.oneOf??[schema]).every(branch=>branch.additionalProperties===false),`Mutation must reject undocumented properties: ${method} ${path}`);
 }
}
for(const [name,schema]of Object.entries(technicalOpenApiSchemas))assert.deepEqual(learnerOpenApi.components.schemas[name],schema,`Missing integrated schema ${name}`);
const search=learnerOpenApi.paths['/api/v1/discovery/search'].get;
for(const name of ['coarseArea','after','courseId','certificationPolicyId','productId'])assert(search.parameters.some(parameter=>parameter.in==='query'&&parameter.name===name),`Missing discovery filter ${name}`);
const effort=learnerOpenApi.paths['/api/v1/reports/effort'].post;
assert(effort.parameters.some(parameter=>parameter.in==='header'&&parameter.name==='Idempotency-Key'&&parameter.required));
assert.deepEqual(effort.requestBody.content['application/json'].schema.required,['courseVersionId','durationSeconds','kind']);
assert.equal(effort.requestBody.content['application/json'].schema.properties.durationSeconds.maximum,28800);
const exportBody=learnerOpenApi.paths['/api/v1/exports'].post.requestBody.content['application/json'].schema;
for(const name of ['kind','format','releaseId'])assert((exportBody.oneOf??[exportBody]).some(branch=>branch.properties[name]),`Missing export option ${name}`);
const evidenceExport=exportBody.oneOf.find(branch=>branch.properties.kind.const==='evidence-lineage');
assert(evidenceExport.required.includes('releaseId')&&evidenceExport.properties.format.const==='json','Lineage export requires a release and JSON');
const exported=learnerOpenApi.paths['/api/v1/exports/{exportId}/content'].get.responses['200'].content;
assert(exported['application/json']&&exported['text/csv'],'Export format must preserve JSON and CSV media types');
for(const [path,method]of [['/api/v1/webhooks','post'],['/api/v1/webhooks/{subscriptionId}','put']])assert(learnerOpenApi.paths[path][method].parameters.some(parameter=>parameter.name==='Idempotency-Key'&&parameter.required),'Webhook mutations need replay identity');
const ids=new Set();
for(const [path,methods]of Object.entries(learnerOpenApi.paths))for(const [method,contract]of Object.entries(methods)){
 if(!['get','post','put','patch','delete'].includes(method))continue;
 assert(!ids.has(contract.operationId),`Duplicate operation ID ${path}`);ids.add(contract.operationId);
}
function visit(value){
 if(!value||typeof value!=='object')return;
 if(value.$ref){assert(value.$ref.startsWith('#/components/schemas/'));assert(learnerOpenApi.components.schemas[value.$ref.slice('#/components/schemas/'.length)],`Unresolved schema ${value.$ref}`);}
 Object.values(value).forEach(visit);
}
visit(learnerOpenApi);
console.log('Technical contract coverage and generated client drift passed for lifecycle and private lesson-render routes. Runtime/hosted compatibility remains separately tested.');
