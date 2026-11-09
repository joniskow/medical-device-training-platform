import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintFile } from './lint-source.mjs';
const directory = await mkdtemp(join(tmpdir(), 'source-lint-'));
try {
  for (const [name, content, expected] of [['good.mjs', 'export const value = 1;', undefined], ['broken.mjs', 'export const = ;', 'JAVASCRIPT_SYNTAX_INVALID'], ['conflict.ts', '<<<<<<< incoming\nexport const value = 1;', 'UNRESOLVED_MERGE_MARKER']]) {
    const path = join(directory, name); await writeFile(path, content); assert.equal(await lintFile(path), expected);
  }
  console.log('Source lint regression passed: valid JavaScript accepted; broken syntax and unresolved merge conflicts rejected.');
} finally { await rm(directory, { recursive: true, force: true }); }
