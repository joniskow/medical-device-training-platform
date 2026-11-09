import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateManifest, runSuite } from './technical-validation.mjs';

const directory = await mkdtemp(join(tmpdir(), 'technical-validation-'));
const manifest = { schemaVersion: 1, profiles: { pure: [{ id: 'passes', script: 'tools/check-pass.mjs', timeoutMs: 1000 }] } };
try {
  await mkdir(join(directory, 'tools'));
  await writeFile(join(directory, 'tools/check-pass.mjs'), 'process.exit(0)');
  await writeFile(join(directory, 'tools/check-empty.mjs'), '');
  await validateManifest(manifest, directory);
  for (const invalid of [null, {}, { ...manifest, schemaVersion: 2 }, { ...manifest, profiles: {} }, { ...manifest, profiles: { pure: [] } }, { ...manifest, profiles: { pure: [{ id: 'bad', script: '../escape.mjs', timeoutMs: 1 }] } }, { ...manifest, profiles: { pure: [{ id: 'bad', script: 'tools/missing.mjs', timeoutMs: 1 }] } }]) {
    await assert.rejects(() => validateManifest(invalid, directory));
  }
  await assert.rejects(() => validateManifest({ ...manifest, profiles: { pure: [manifest.profiles.pure[0], manifest.profiles.pure[0]] } }, directory), /STEP_INVALID/);
  await assert.rejects(() => validateManifest({ ...manifest, profiles: { pure: [{ id: 'empty', script: 'tools/check-empty.mjs', timeoutMs: 1000 }] } }, directory), /EMPTY/);
  const scripts = [
    ['pass', 'process.exit(0)', 2000],
    ['fail', 'process.exit(7)', 2000],
    ['timeout', 'setInterval(()=>{},1000)', 150],
    ['last', 'process.exit(0)', 2000]
  ];
  for (const [id, code] of scripts) await writeFile(join(directory, id + '.mjs'), code);
  const evidencePath = join(directory, 'evidence.json');
  const evidence = await runSuite({ profile: 'test', root: directory, steps: scripts.map(([id, , timeoutMs]) => ({ id, script: id + '.mjs', timeoutMs })), evidencePath, source: { revision: 'fixture' }, stdio: 'ignore' });
  assert.deepEqual(evidence.results.map(result => result.status), ['passed', 'failed', 'timed_out', 'passed']);
  assert.equal(evidence.results[1].exitCode, 7);
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.profile, 'test');
  assert.equal(evidence.source.revision, 'fixture');
  assert.equal(evidence.runtime.node, process.version);
  assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), evidence);
  const changed = await runSuite({ profile: 'changed', root: directory, steps: [{ id: 'pass', script: 'pass.mjs', timeoutMs: 2000 }], evidencePath, source: { revision: 'before' }, stdio: 'ignore', sourceCheck: async () => ({ revision: 'after' }) });
  assert.equal(changed.status, 'failed');
  assert.equal(changed.sourceStable, false);
  assert.equal(changed.errorCode, 'VALIDATION_SOURCE_CHANGED_DURING_RUN');
  await assert.rejects(() => runSuite({ profile: 'empty', root: directory, steps: [], evidencePath, source: {} }), /EMPTY/);
  const actual = JSON.parse(await readFile('config/technical-validation.json', 'utf8'));
  await validateManifest(actual, resolve('.'));
  for (const profile of ['pure', 'auth', 'database', 'integration']) assert.ok(actual.profiles[profile].length > 0);
  console.log('Technical validation passed: rejects invalid/empty/missing suites; preserves failure/timeout results, runs later checks, and writes structured evidence.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
