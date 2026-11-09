import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOperationalQueueSampler} from '../apps/worker/dist/operational-sampler.js';
import {emitOperationalEvent,operationalRouteGroup} from '../apps/api/dist/operations-runtime.js';
import {createPostgresAiRunStore} from '../packages/db/dist/ai-run-store.js';
import {createSourceUsageMeteringStore} from '../packages/db/dist/source-usage-metering.js';
import {issueCredentialInTransaction} from '../packages/db/dist/credential-service.js';

let instant=Date.parse('2026-11-07T12:00:00Z');const lines=[],queries=[];
let rows=[{state:'PENDING',available_at:new Date(instant-5000)},{state:'FAILED',available_at:new Date(instant-10000)}];
const client={async query(text){queries.push(text);return {rows:text.startsWith('SELECT state')?rows:[]};},release(){}};
let messages=[{state:'scheduled',enqueuedTimeUtc:new Date(instant-900000),scheduledEnqueueTimeUtc:new Date(instant+900000),correlationId:'private-scheduled-id'},{state:'deferred',enqueuedTimeUtc:new Date(instant-900000)},{state:'active',enqueuedTimeUtc:new Date(instant-2000),correlationId:'private-job-id'},{state:'active',enqueuedTimeUtc:new Date(instant-900000),scheduledEnqueueTimeUtc:new Date(instant-1000)},{state:'active',enqueuedTimeUtc:new Date(instant-100000),expiresAtUtc:new Date(instant-1)}];
let peekCount;
const receiver={async peekMessages(count,options){peekCount=count;assert.equal(options.fromSequenceNumber.toNumber(),0);assert.ok(options.abortSignal);return messages;}};
const sampler=createOperationalQueueSampler({outboxPool:{async connect(){return client;}},applicationPool:{totalCount:4,idleCount:1,waitingCount:2},receiver,secret:'telemetry-hmac-secret-at-least-32bytes',sink:line=>lines.push(JSON.parse(line)),now:()=>instant});
await sampler();await sampler();assert.equal(peekCount,32);
assert.equal(lines.filter(event=>event.event==='queue_snapshot').length,1,'sampler must be throttled');
assert.equal(lines.find(event=>event.event==='broker_age_snapshot').oldestObservedActiveAgeSeconds,2,'future scheduled/deferred/expired messages are not age evidence');
assert.match(lines.find(event=>event.event==='broker_age_snapshot').oldestCorrelationHash,/^[a-f0-9]{64}$/);
assert.ok(!JSON.stringify(lines).includes('private-job-id'));assert.ok(!JSON.stringify(lines).includes('private-scheduled-id'));
assert.ok(queries.includes("SET LOCAL statement_timeout='2000ms'"));assert.ok(queries.some(query=>query.includes('LIMIT 10001')));
instant+=60001;messages=Array.from({length:32},()=>({state:'scheduled',enqueuedTimeUtc:new Date(instant-999999),scheduledEnqueueTimeUtc:new Date(instant+999999)}));
await sampler();const unknown=lines.filter(event=>event.event==='broker_age_snapshot').at(-1);
assert.equal(unknown.oldestObservedActiveAgeSeconds,null);assert.equal(unknown.observation,'NO_ELIGIBLE_IN_SAMPLE');assert.equal(unknown.truncated,true);
const badSink=createOperationalQueueSampler({outboxPool:{async connect(){return client;}},applicationPool:{totalCount:0,idleCount:0,waitingCount:0},receiver,secret:'telemetry-hmac-secret-at-least-32bytes',sink(){throw Error('closed sink');},now:()=>instant});
await badSink();
const failed=[];await createOperationalQueueSampler({outboxPool:{async connect(){return client;}},applicationPool:{totalCount:0,idleCount:0,waitingCount:0},receiver:{async peekMessages(){throw Error('private broker secret');}},secret:'telemetry-hmac-secret-at-least-32bytes',sink:line=>failed.push(JSON.parse(line)),now:()=>instant})();
assert.ok(failed.some(event=>event.event==='operational_snapshot_failed'));assert.ok(!JSON.stringify(failed).includes('private broker secret'));
const connectFailed=[];let peekAfterConnectionFailure=false;
await createOperationalQueueSampler({outboxPool:{async connect(){throw Error('private database password');}},applicationPool:{totalCount:0,idleCount:0,waitingCount:0},receiver:{async peekMessages(){peekAfterConnectionFailure=true;return [];}},secret:'telemetry-hmac-secret-at-least-32bytes',sink:line=>connectFailed.push(JSON.parse(line)),now:()=>instant})();
assert.equal(peekAfterConnectionFailure,true,'failed telemetry DB acquisition must not abort broker sampling or later maintenance');
assert.ok(connectFailed.some(event=>event.event==='operational_snapshot_failed'&&event.domain==='outbox'));assert.ok(connectFailed.some(event=>event.event==='db_pool_snapshot'));assert.ok(!JSON.stringify(connectFailed).includes('private database password'));
emitOperationalEvent({event:'api_request',durationMs:-1,status:200},line=>{assert.equal(JSON.parse(line).durationMs,undefined);});
emitOperationalEvent({event:'api_request',status:200},()=>{throw Error('closed sink');});
assert.equal(operationalRouteGroup('/api/v1/course-versions/private-id/publish'),'publication');
assert.equal(operationalRouteGroup('/api/v1/credentials/private-id'),'credentials');

// Simulate committed stores with stdout unavailable. The business call must still succeed.
const writes=[];const committedClient={async query(text){writes.push(text);return {rows:[]};},release(){}};
const pool={async connect(){return committedClient;}};
await createSourceUsageMeteringStore(pool,{sink(){assert.ok(writes.includes('COMMIT'));throw Error('sink unavailable');}}).record({organizationId:'safe-org',correlationId:'private-correlation'},{receiptId:'safe-receipt',operation:'provider.speech',provider:'azure-speech',phase:'SUCCEEDED',metrics:{calls:1,input_characters:5}});
const savedLog=console.log;
try{
  console.log=()=>{assert.equal(writes.at(-1),'COMMIT');throw Error('stdout unavailable');};
  const id=await createPostgresAiRunStore(pool).record({tenant:{organizationId:'safe-org',correlationId:'private-correlation'},request:{operation:'course.draft',sourceArtifactIds:[],input:{},outputSchemaVersion:'v1',tokenBudget:10},result:{status:'DRAFT',providerMetadata:{provider:'azure-openai',model:'model',deployment:'deployment',apiVersion:'v1'},metrics:{inputTokens:1,outputTokens:2,durationMs:3},citations:[],warnings:[]},promptVersion:'v1'});
  assert.match(id,/^ai:/);
}finally{console.log=savedLog;}
const anomaly=[];const constraintError=Object.assign(Error('private learner identity must not leak'),{code:'23505',constraint:'credentials_qualification_unique',detail:'private email@example.invalid'});
try{
  console.log=line=>anomaly.push(JSON.parse(line));
  await assert.rejects(()=>issueCredentialInTransaction({async query(){throw constraintError;}},{organizationId:'private-org',correlationId:'private-id'},'private-enrollment'),error=>error===constraintError);
}finally{console.log=savedLog;}
assert.equal(anomaly[0].event,'credential_integrity_violation');assert.equal(anomaly[0].code,'QUALIFICATION_UNIQUENESS');assert.ok(!JSON.stringify(anomaly).includes('private'));

const catalog=JSON.parse(await readFile('infra/azure/operational-panels.json','utf8'));
const contract=JSON.parse(await readFile('config/observability-contract.json','utf8'));
const fields=new Set(['event','status','routeGroup','durationMs','correlationHash','provider','operation','phase','duration_ms','inputTokens','outputTokens','input_tokens','provenance','microUsd','code','jobType','jobState','sourceType','bytes','domain','failed','outboxPendingSampled','outboxFailedSampled','outboxOldestAgeSeconds','truncated','oldestObservedActiveAgeSeconds','hasEligibleActiveMessage','observation','sampledMessages','oldestCorrelationHash']);
assert.equal(catalog.workbooks.length,4);
for(const dashboard of contract.dashboards){const workbook=catalog.workbooks.find(item=>item.id===dashboard.id);assert.ok(workbook);for(const panelId of dashboard.panels)assert.ok(workbook.panels.some(panel=>panel.id===panelId),`missing panel ${panelId}`);}
for(const workbook of catalog.workbooks)for(const panel of workbook.panels){
  for(const [,field] of panel.query.matchAll(/signal\.([A-Za-z_]+)/g))assert.ok(fields.has(field),`query refers to undefined signal field ${field}`);
  assert.ok(!/signal\.(?:prompt|sourceText|accessToken|blobSas|rawEmail|organizationId|jobId|credentialId)/.test(panel.query));
}
const monitoring=await readFile('infra/azure/monitoring.bicep','utf8');
for(const metric of ['connections_failed','active_connections','storage_percent','DeadletteredMessages'])assert.ok(monitoring.includes(metric));
assert.ok(monitoring.includes("loadJsonContent('operational-panels.json')"));assert.ok(monitoring.includes("category:'AllMetrics'"));
assert.equal(contract.status,'implementation-present-hosted-acceptance-pending');
for(const alert of contract.alerts)assert.ok(contract.alertResources[alert]?.length,`missing implementation mapping for ${alert}`);
console.log('Operational signals passed: bounded sampled queue age, exclusion/unknown semantics, HMAC privacy, throttling, sink-failure isolation, post-commit AI/source logging and four workbook/query contracts.');
