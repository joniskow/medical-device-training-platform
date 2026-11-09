import assert from 'node:assert/strict';
import { assertProductionConfiguration, boundedInteger, readTechnicalLimits, technicalLimits } from '../packages/contracts/dist/index.js';

assert.equal(technicalLimits.maxAiTokensPerRun, 4000);
assert.equal(readTechnicalLimits({}).maxConcurrentJobs, 4);
for (const invalid of ['', '0', '-1', '1.1', 'NaN', 'Infinity', '5', ' 2', '2e0']) {
  assert.throws(() => boundedInteger(invalid, 2, 4, 'limit'), /CONFIGURATION_INVALID:limit/);
}
assert.equal(boundedInteger('2', 1, 4, 'limit'), 2);
assertProductionConfiguration('api', { APP_ENV: 'local' });
for (const APP_ENV of [undefined, '', 'local', 'prodution']) {
  assert.throws(() => assertProductionConfiguration('api', { NODE_ENV: 'production', APP_ENV }), /APP_ENV/);
}
const base = { APP_ENV: 'production', AUDIT_LOGGING_ENABLED: 'true', STORAGE_ACCOUNT_URL: 'https://example.blob.core.windows.net', OPERATIONAL_KEY_SECRET:'x'.repeat(32), RETRIEVAL_MODE:'hybrid',AZURE_EMBEDDING_ENDPOINT:'https://example.openai.azure.com/',AZURE_EMBEDDING_API_KEY:'test-only-secret',AZURE_EMBEDDING_DEPLOYMENT:'embedding',AZURE_EMBEDDING_MODEL:'text-embedding-3-small' };
const api = { ...base, AI_PROVIDER_MODE: 'azure-openai', AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/', AZURE_OPENAI_API_KEY: 'test-only-secret', AZURE_OPENAI_DEPLOYMENT: 'training', AZURE_OPENAI_MODEL: 'approved-model', AZURE_OPENAI_API_VERSION: 'approved-version' };
const worker = { ...base, ASSET_SCANNER_MODE: 'clamav', CLAMAV_HOST: 'scanner', OPENMONTAGE_PROVIDER_MODE: 'http', OPENMONTAGE_PROVIDER_URL: 'https://provider.example/generate', AZURE_SPEECH_MODE: 'http', AZURE_SPEECH_ENDPOINT: 'https://speech.example/synthesize', AZURE_SPEECH_API_KEY: 'test-only-secret' };
assertProductionConfiguration('api', api);
assertProductionConfiguration('worker', worker);
for (const key of ['AI_PROVIDER_MODE', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_MODEL', 'AUDIT_LOGGING_ENABLED']) {
  assert.throws(() => assertProductionConfiguration('api', { ...api, [key]: undefined }), error => error.message.includes(key) && !error.message.includes('test-only-secret'));
}
for (const key of ['ASSET_SCANNER_MODE', 'CLAMAV_HOST', 'OPENMONTAGE_PROVIDER_MODE', 'AZURE_SPEECH_MODE']) {
  assert.throws(() => assertProductionConfiguration('worker', { ...worker, [key]: undefined }), error => error.message.includes(key));
}
for (const endpoint of ['http://example.openai.azure.com/', 'https://example.openai.azure.com.evil.test/', 'https://user:secret@example.openai.azure.com/', 'https://example.openai.azure.com/?secret=value']) {
  assert.throws(() => assertProductionConfiguration('api', { ...api, AZURE_OPENAI_ENDPOINT: endpoint }), /AZURE_OPENAI_ENDPOINT/);
}
assert.throws(() => assertProductionConfiguration('api', { ...api, APP_ENV: 'staging', AI_PROVIDER_MODE: 'deterministic' }), /AI_PROVIDER_MODE/);
assert.throws(() => assertProductionConfiguration('api', { ...api, CORS_ALLOWED_ORIGINS: '*' }), /CORS_ALLOWED_ORIGINS/);
assert.throws(() => assertProductionConfiguration('api', { ...api, AZURE_STORAGE_CONNECTION_STRING: 'secret' }), /AZURE_STORAGE_CONNECTION_STRING/);
console.log('Deployment policy passed: shared bounded limits, real production provider requirements and safe key-only configuration failures.');
