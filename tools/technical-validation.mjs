import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');

export async function validateManifest(manifest, root) {
  if (manifest?.schemaVersion !== 1 || !manifest.profiles || Array.isArray(manifest.profiles) || typeof manifest.profiles !== 'object' || !Object.keys(manifest.profiles).length) throw Error('VALIDATION_MANIFEST_INVALID');
  for (const [profile, steps] of Object.entries(manifest.profiles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(profile) || !Array.isArray(steps) || !steps.length) throw Error('VALIDATION_SUITE_EMPTY_OR_INVALID');
    const ids = new Set();
    for (const step of steps) {
      if (!step || !/^[a-z][a-z0-9-]*$/.test(step.id) || ids.has(step.id) || typeof step.script !== 'string' || !/^tools\/check-[a-z0-9-]+\.mjs$/.test(step.script) || !Number.isInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 600000) throw Error('VALIDATION_STEP_INVALID');
      const target = resolve(root, step.script);
      const info = await stat(target);
      if (!target.startsWith(resolve(root) + sep) || !info.isFile() || info.size === 0) throw Error('VALIDATION_SCRIPT_MISSING_OR_EMPTY');
      ids.add(step.id);
    }
  }
  return manifest;
}

async function sourceMetadata(root, manifestBytes) {
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw Error('VALIDATION_GIT_METADATA_UNAVAILABLE');
    return result.stdout;
  };
  const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(path => /\.(?:ts|mjs|cjs|json|sql|yaml|yml|py|sh|ps1|bicep)$/.test(path) || /(?:^|\/)Dockerfile(?:\.[^/]+)?$/.test(path)))].sort();
  const sourceTree = createHash('sha256');
  let sourceFileCount = 0;
  for (const path of files) {
    let bytes;
    try { bytes = await readFile(resolve(root, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    sourceTree.update(path + '\0').update(digest(bytes) + '\0');
    sourceFileCount++;
  }
  return {
    revision: git(['rev-parse', 'HEAD']).trim(),
    dirty: git(['status', '--porcelain']).length > 0,
    trackedDiffSha256: digest(git(['diff', 'HEAD', '--no-ext-diff', '--binary'])),
    sourceTreeSha256: sourceTree.digest('hex'),
    sourceFileCount,
    manifestSha256: digest(manifestBytes),
    runnerSha256: digest(await readFile(resolve(root, 'tools/technical-validation.mjs'))),
    lockfileSha256: digest(await readFile(resolve(root, 'pnpm-lock.yaml'))),
    packageSha256: digest(await readFile(resolve(root, 'package.json')))
  };
}

function execute(step, root, stdio) {
  return new Promise(done => {
    const started = Date.now();
    let timedOut = false;
    let spawnErrorCode;
    const child = spawn(process.execPath, [resolve(root, step.script)], {
      cwd: root, shell: false, windowsHide: true, stdio,
      env: { ...process.env, CI: '1', TZ: 'UTC', LC_ALL: 'C' }
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, step.timeoutMs);
    child.once('error', error => { spawnErrorCode = error.code ?? 'SPAWN_ERROR'; });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      done({ id: step.id, script: step.script, timeoutMs: step.timeoutMs, status: timedOut ? 'timed_out' : spawnErrorCode || exitCode !== 0 ? 'failed' : 'passed', exitCode, signal, durationMs: Date.now() - started, ...(spawnErrorCode ? { errorCode: spawnErrorCode } : {}) });
    });
  });
}

export async function runSuite({ profile, root, steps, evidencePath, source, stdio = 'inherit', sourceCheck }) {
  if (!Array.isArray(steps) || !steps.length) throw Error('VALIDATION_SUITE_EMPTY');
  const evidence = { schemaVersion: 'technical-validation.v1', profile, source, runtime: { node: process.version, platform: process.platform, arch: process.arch }, startedAt: new Date().toISOString(), status: 'running', results: [] };
  const persist = async () => { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); };
  await persist();
  for (const step of steps) {
    console.log(`[${profile}] ${step.id}`);
    evidence.results.push(await execute(step, root, stdio));
    await persist();
  }
  evidence.status = evidence.results.every(result => result.status === 'passed') ? 'passed' : 'failed';
  if (sourceCheck) {
    evidence.finalSource = await sourceCheck();
    evidence.sourceStable = JSON.stringify(source) === JSON.stringify(evidence.finalSource);
    if (!evidence.sourceStable) { evidence.status = 'failed'; evidence.errorCode = 'VALIDATION_SOURCE_CHANGED_DURING_RUN'; }
  }
  evidence.finishedAt = new Date().toISOString();
  await persist();
  return evidence;
}

async function main() {
  const args = process.argv.slice(2);
  let profile = 'pure';
  let evidencePath;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value || !['--profile', '--evidence'].includes(key)) throw Error('USAGE: node tools/technical-validation.mjs --profile pure|auth|database|integration|infrastructure [--evidence path]');
    if (key === '--profile') profile = value;
    else evidencePath = resolve(value);
  }
  const bytes = await readFile(resolve(repositoryRoot, 'config/technical-validation.json'));
  const manifest = await validateManifest(JSON.parse(bytes), repositoryRoot);
  if (!Object.hasOwn(manifest.profiles, profile)) throw Error('VALIDATION_PROFILE_UNKNOWN');
  const output = evidencePath ?? resolve(repositoryRoot, 'output/technical-validation', profile + '.json');
  const result = await runSuite({ profile, root: repositoryRoot, steps: manifest.profiles[profile], evidencePath: output, source: await sourceMetadata(repositoryRoot, bytes), sourceCheck: async () => sourceMetadata(repositoryRoot, await readFile(resolve(repositoryRoot, 'config/technical-validation.json'))) });
  console.log(`Technical validation ${profile}: ${result.status} (${result.results.length} checks).`);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
