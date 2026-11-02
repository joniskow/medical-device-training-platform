import { readFileSync } from 'node:fs';

/** Read deployment-wide instructions without logging their contents. */
export function readImageGenerationBaseInstructions(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inline = env.IMAGE_GENERATION_BASE_INSTRUCTIONS?.trim();
  const file = env.IMAGE_GENERATION_BASE_INSTRUCTIONS_FILE?.trim();
  if (inline && file) throw new Error('IMAGE_GENERATION_BASE_INSTRUCTIONS_AMBIGUOUS');
  if (inline) return inline;
  if (file) {
    const value = readFileSync(file, 'utf8').trim();
    return value || undefined;
  }
  return undefined;
}
