import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOpenMontageSceneBrief, validateOpenMontageSceneBrief } from '../packages/contracts/dist/openmontage-brief.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

const scenePath = resolve(argument('--scene-manifest'));
const outputPath = resolve(argument('--output'));
const prompt = argument('--prompt');
const scene = JSON.parse(await readFile(scenePath, 'utf8'));
const promptHash = createHash('sha256').update(prompt, 'utf8').digest('hex');
const brief = validateOpenMontageSceneBrief(createOpenMontageSceneBrief(scene, prompt, promptHash));
await writeFile(outputPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, sceneId: brief.sceneId, modelVersionId: brief.foreground.modelVersionId, promptHash: brief.provenance.promptHash }));
