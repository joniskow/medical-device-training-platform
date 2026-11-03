import assert from 'node:assert/strict';
import { composeImageGenerationPrompt } from '../packages/contracts/dist/index.js';
import { readImageGenerationBaseInstructions } from '../apps/api/dist/image-generation-configuration.js';

const base = 'Keep the foreground device unchanged.\r\nDo not add text or logos.';
assert.equal(readImageGenerationBaseInstructions({ IMAGE_GENERATION_BASE_INSTRUCTIONS: base }), base.trim());
assert.equal(readImageGenerationBaseInstructions({ IMAGE_GENERATION_BASE_INSTRUCTIONS_FILE: '' }), undefined);

const prompt = composeImageGenerationPrompt(base, 'Create a quiet clinical room.');
assert.match(prompt, /Make the result as realistic as possible/);
assert.match(prompt, /every visible material and surface must be photorealistic/);
assert.match(prompt, /Always use the user's standpoint as the point of view/);
assert.match(prompt, /Keep the foreground device unchanged/);
assert.match(prompt, /Scene-specific request:\nCreate a quiet clinical room\./);
const cinematicPrompt = composeImageGenerationPrompt(base, 'Create a slow room walkthrough.', 'CINEMATIC');
assert.match(cinematicPrompt, /Integration mode: CINEMATIC/);
assert.match(cinematicPrompt, /physically coherent and trackable/);
assert.match(prompt, /Integration mode: LOCKED_INTERACTIVE/);
assert.throws(() => composeImageGenerationPrompt(undefined, '   '), /IMAGE_GENERATION_SCENE_PROMPT_REQUIRED/);
assert.throws(() => composeImageGenerationPrompt('x'.repeat(4000), 'scene'), /IMAGE_GENERATION_PROMPT_TOO_LONG/);
assert.throws(() => readImageGenerationBaseInstructions({ IMAGE_GENERATION_BASE_INSTRUCTIONS: 'inline', IMAGE_GENERATION_BASE_INSTRUCTIONS_FILE: 'instructions.txt' }), /IMAGE_GENERATION_BASE_INSTRUCTIONS_AMBIGUOUS/);

console.log('Image-generation instructions passed: configured guidance is composed, normalized, bounded, and never ambiguous.');
