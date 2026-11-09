import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../packages/api-client/package.json',import.meta.url))('typescript');

const rules = [
  {
    directory: "packages/domain",
    forbidden: ["react", "@azure/", "pg", "prisma", "express", "fastify", "babylonjs", "three"]
  },
  {
    directory: "packages/contracts",
    forbidden: ["react", "@azure/", "pg", "prisma", "express", "fastify", "babylonjs", "three"]
  },
  {
    directory: "packages/simulation-schema",
    forbidden: ["react", "@azure/", "pg", "prisma", "express", "fastify", "babylonjs", "three"]
  }
];

// Use the existing API-client compiler parser (TypeScript 5.9); the workspace's
// native TypeScript 7 compiler does not expose a JavaScript AST API.
function dependencySpecifiers(source,file='architecture-boundary.ts') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length,0,'Architecture check cannot inspect malformed source');
  const dependencies = [];
  const add = literal => { if(literal && ts.isStringLiteralLike(literal)) dependencies.push(literal.text); };
  function visit(node) {
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))) add(node.arguments[0]);
    ts.forEachChild(node,visit);
  }
  visit(tree);
  return dependencies;
}

function forbiddenDependency(specifier, dependency) {
  if (dependency.endsWith('/')) return specifier.startsWith(dependency);
  return specifier === dependency || specifier.startsWith(dependency + '/');
}

// These fixtures guard the original false positive and the dependency forms
// that must continue to fail, including multiline/type-only declarations.
assert.deepEqual(dependencySpecifiers(`const summary = 'fewer than three distinct learners'; // import 'react'
/* export * from 'pg'; */ const from = 'three';`), []);
assert.deepEqual(dependencySpecifiers(`import 'three'; import type { X } from 'react';
import { Y }\nfrom '@azure/identity'; export * from 'pg'; export { A } from 'express';
const a = import('fastify'); const b = require /* comment */ ('prisma/client');
const c = import(\`three/addons\`); import Alias = require('pg');`), ['three', 'react', '@azure/identity', 'pg', 'express', 'fastify', 'prisma/client', 'three/addons', 'pg']);
assert.deepEqual(dependencySpecifiers(String.raw`import '\x70g';`), ['pg']);
assert.deepEqual(dependencySpecifiers(`const label = "from 'three'"; client.require('pg');`), []);
assert.deepEqual(dependencySpecifiers(String.raw`const regex = /require('three')/; const pattern = /import('pg')/;`), []);
assert.deepEqual(dependencySpecifiers('const interpolated = `value ${require("three")}`;'), ['three']);
assert.equal(forbiddenDependency('three/addons', 'three'), true);
assert.equal(forbiddenDependency('@azure/identity', '@azure/'), true);
assert.equal(forbiddenDependency('./three-types.js', 'three'), false);
assert.equal(forbiddenDependency('three-dimensional-helper', 'three'), false);

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(c|m)?tsx?$/.test(entry.name) ? [path] : [];
  });
}

const violations = [];
for (const rule of rules) {
  for (const file of sourceFiles(rule.directory)) {
    const dependencies = dependencySpecifiers(readFileSync(file, "utf8"),file);
    for (const dependency of rule.forbidden) {
      if (dependencies.some(specifier => forbiddenDependency(specifier, dependency))) {
        violations.push(`${file}: forbidden dependency "${dependency}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture dependency boundaries passed.");
}
