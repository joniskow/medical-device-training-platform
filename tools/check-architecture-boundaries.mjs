import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
    const source = readFileSync(file, "utf8").toLowerCase();
    for (const dependency of rule.forbidden) {
      if (source.includes(dependency.toLowerCase())) {
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
