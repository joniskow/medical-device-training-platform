import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateControlledSceneTake } from '../apps/worker/dist/lesson-scene-takes.js';

const [lessonFile, requestFile, assetsFile, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw Error('Usage: node tools/generate-lesson-scene-take.mjs lesson.json correction.json approved-assets.json output-directory');
const lesson = JSON.parse(await readFile(lessonFile, 'utf8'));
const request = JSON.parse(await readFile(requestFile, 'utf8'));
const assets = JSON.parse(await readFile(assetsFile, 'utf8'));
const take = await generateControlledSceneTake({ lesson, sceneId: request.sceneId, framing: request.framing, correction: request.correction, assets, outputDirectory: resolve(outputDirectory), persist: value => writeFile(lessonFile, JSON.stringify(value, null, 2)) });
await writeFile(resolve(outputDirectory, `${take.takeId.replace(':', '-')}.json`), JSON.stringify({ schemaVersion: 'scene-take-import.v1', take, attempts: lesson.sceneTakes.attempts, maxPerScene: lesson.sceneTakes.maxPerScene, budget: lesson.sceneTakes.budget }, null, 2));
console.log(`Generated ${take.takeId} for ${take.sceneId}; saved attempts and alternate to ${lessonFile}. Import the take manifest in the author scene editor, inspect the video and select explicitly.`);
