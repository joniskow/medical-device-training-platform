import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.fromEntries(await Promise.all([
  ["api", "apps/api/src/entrypoint.ts"],
  ["worker", "apps/worker/src/entrypoint.ts"],
  ["reconstructionConfig", "apps/worker/src/reconstruction-engine-configuration.ts"],
  ["photogrammetry", "apps/worker/src/photogrammetry-engine.ts"],
  ["runtime", "apps/worker/src/azure-runtime.ts"],
  ["apiTemplate", "infra/azure/api-foundation.bicep"],
  ["workerTemplate", "infra/azure/worker-app-foundation.bicep"],
  ["workerFoundation", "infra/azure/worker-foundation.bicep"],
  ["env", ".env.example"]
].map(async ([name, path]) => [name, await readFile(path, "utf8")])));

assert.match(files.api, /createPostgresJobStore\(pool\)/);
assert.match(files.api, /jobStore: store/);
assert.match(files.api, /createAzureBlobStorage\(/);
assert.match(files.api, /createUploadSessionService\(/);
assert.match(files.api, /statusService/);

for (const name of [
  "ASSET_PROCESSOR_MODULE",
  "POSTGRES_RUNTIME_PASSWORD",
  "POSTGRES_ADMIN_PASSWORD",
  "POSTGRES_OUTBOX_PASSWORD",
  "SERVICE_BUS_NAMESPACE",
  "SERVICE_BUS_SIGNING_SECRET",
  "STORAGE_ACCOUNT_URL"
]) assert.match(files.worker, new RegExp(`required\\(\\"${name}\\"\\)`));

assert.match(files.runtime, /createPostgresOutboxStore\(outboxPool\)/);
assert.match(files.runtime, /createAzureServiceBusDispatcher\(/);
assert.match(files.runtime, /createAzureServiceBusWorker\(/);
assert.match(files.runtime, /queueName: options\.serviceBusQueueName/);
assert.match(files.runtime, /signingSecret: options\.signingSecret/);
assert.match(files.runtime, /accountUrl: options\.storageAccountUrl/);
assert.match(files.reconstructionConfig, /BLENDER_CONFIGURATION_INCOMPLETE/);
assert.match(files.reconstructionConfig, /blender:\{executable:blenderExecutable,script:blenderScript\}/);
assert.match(files.photogrammetry, /package_candidate\.py/);
assert.match(files.photogrammetry, /BLENDER_STAGE_INVALID/);

for (const name of [
  "POSTGRES_HOST", "POSTGRES_DATABASE", "POSTGRES_RUNTIME_LOGIN",
  "POSTGRES_RUNTIME_PASSWORD", "SERVICE_BUS_NAMESPACE", "SERVICE_BUS_QUEUE_NAME",
  "SERVICE_BUS_SIGNING_SECRET", "STORAGE_ACCOUNT_URL", "STORAGE_CONTAINER_NAME"
]) assert.match(files.workerTemplate, new RegExp(`name: '${name}'`));
for (const name of ["BLENDER_EXECUTABLE", "BLENDER_SCRIPT"]) assert.match(files.workerTemplate, new RegExp(`name: '${name}'`));
assert.match(files.workerTemplate, /name: 'POSTGRES_OUTBOX_PASSWORD', secretRef: 'postgres-outbox-password'/);
assert.match(files.workerTemplate, /name: 'SERVICE_BUS_SIGNING_SECRET', secretRef: 'service-bus-signing-secret'/);
assert.match(files.workerTemplate, /name: 'ASSET_PROCESSOR_MODULE', value: '\.\/pilot-asset-processor\.js'/);

for (const name of [
  "POSTGRES_HOST", "POSTGRES_DATABASE", "POSTGRES_RUNTIME_LOGIN",
  "POSTGRES_RUNTIME_PASSWORD", "STORAGE_ACCOUNT_URL", "STORAGE_CONTAINER_NAME"
]) assert.match(files.apiTemplate, new RegExp(`name: '${name}'`));

assert.match(files.workerFoundation, /resource processingQueue 'Microsoft\.ServiceBus\/namespaces\/queues@/);
assert.match(files.workerFoundation, /scope: processingQueue/);
assert.doesNotMatch(files.workerFoundation, /scope: serviceBus/);

for (const name of [
  "POSTGRES_HOST", "POSTGRES_RUNTIME_PASSWORD", "POSTGRES_OUTBOX_PASSWORD",
  "SERVICE_BUS_NAMESPACE", "SERVICE_BUS_QUEUE_NAME", "SERVICE_BUS_SIGNING_SECRET",
  "ASSET_PROCESSOR_MODULE", "BLENDER_EXECUTABLE", "BLENDER_SCRIPT"
]) assert.match(files.env, new RegExp(`^${name}=`, "m"));

console.log("Backend handoff contract passed: API persistence/storage wiring, transactional outbox, worker queue/secret/storage wiring, and queue-scoped Azure permissions are aligned.");
