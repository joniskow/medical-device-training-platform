import assert from 'node:assert/strict';
import { assertDisposableVolumes, testProject } from './local-test-environment.mjs';
const expected = ['postgres-data', 'azurite-data'].map(name => ({ Name: `${testProject}_${name}`, Labels: { 'com.docker.compose.project': testProject } }));
assert.doesNotThrow(() => assertDisposableVolumes(expected, testProject));
for (const confirmation of ['', 'local', testProject + '-other']) assert.throws(() => assertDisposableVolumes(expected, confirmation), /CONFIRMATION/);
for (const volume of [{ Name: 'production-data', Labels: { 'com.docker.compose.project': testProject } }, { ...expected[0], Labels: { 'com.docker.compose.project': 'other' } }, { ...expected[0], Labels: null }]) assert.throws(() => assertDisposableVolumes([volume], testProject), /OWNERSHIP/);
assert.throws(() => assertDisposableVolumes([expected[0], expected[0]], testProject), /OWNERSHIP/);
console.log('Local test environment safety passed: exact project confirmation, explicit volume names/labels, duplicate and foreign-volume denial.');
