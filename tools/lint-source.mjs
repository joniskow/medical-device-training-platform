import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function lintFile(file) {
  const text = await readFile(file, 'utf8');
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) return 'UNRESOLVED_MERGE_MARKER';
  if (/\.(?:mjs|cjs)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000 });
    if (result.error || result.status !== 0) return 'JAVASCRIPT_SYNTAX_INVALID';
  }
  return undefined;
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', 'blender-portable', '__pycache__'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(?:ts|mjs|cjs)$/.test(entry.name)) result.push(path);
  }
  return result;
}
async function main() {
  const paths = (await Promise.all(['apps', 'packages', 'tools', 'tests'].map(directory => files(resolve(directory))))).flat();
  if (!paths.length) throw Error('LINT_SOURCE_EMPTY');
  let failed = false;
  for (const path of paths) {
    const violation = await lintFile(path);
    if (violation) { failed = true; console.error(`${violation}: ${path}`); }
  }
  console.log(`Source lint checked ${paths.length} source files for merge markers and native JavaScript syntax. TypeScript semantic checks run separately.`);
  process.exitCode = failed ? 1 : 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
