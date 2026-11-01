import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const template = await readFile('infra/azure/asset-pipeline-foundation.bicep', 'utf8');

assert.match(template, /resource storageBlobService 'Microsoft\.Storage\/storageAccounts\/blobServices@/);
assert.match(template, /isVersioningEnabled:\s*true/);
assert.match(template, /publicAccess:\s*'None'/);
assert.match(template, /resource lifecycle 'Microsoft\.Storage\/storageAccounts\/managementPolicies@/);
assert.match(template, /resource serviceBus 'Microsoft\.ServiceBus\/namespaces@/);
assert.match(template, /resource processingQueues 'Microsoft\.ServiceBus\/namespaces\/queues@/);
assert.match(template, /deadLetteringOnMessageExpiration:\s*true/);
assert.match(template, /maxDeliveryCount:\s*10/);
assert.match(template, /resource workerReceiver 'Microsoft\.Authorization\/roleAssignments@/);
assert.match(template, /resource apiSender 'Microsoft\.Authorization\/roleAssignments@/);
assert.match(template, /roleDefinitions',\s*'4a9ae827-6dc8-4573-8ac7-8239d42aa03f'/);
assert.match(template, /roleDefinitions',\s*'69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'/);
assert.match(template, /output assetContainers array/);
assert.match(template, /output processingQueues array/);

console.log('Asset-pipeline infrastructure contract passed: private versioned containers, lifecycle policy, durable queues, least-privilege messaging roles, and deployment outputs are declared.');
