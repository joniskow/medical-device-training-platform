const MAX_EFFECTIVE_PROMPT_LENGTH = 4000;

export type ImageGenerationMode = 'LOCKED_INTERACTIVE' | 'CINEMATIC';

export const DEFAULT_IMAGE_GENERATION_BASE_INSTRUCTIONS = [
  'Make the result as realistic as possible: every visible material and surface must be photorealistic, with physically plausible texture, color, roughness, reflectance, transparency, wear, geometry, scale, lighting, shadows, reflections, depth, and camera perspective. Avoid illustration, stylization, plastic-looking CGI, flat or synthetic materials, impossible geometry, and invented details.',
  'Always use the user\'s standpoint as the point of view. Place the camera where the user would naturally be, with a realistic human eye-level perspective and field of view. Do not show an observer, third-person camera, selfie framing, or an external audience.'
].join('\n');

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

/**
 * Combines deployment-wide image-generation guidance with a scene request.
 * The returned value is the prompt sent to the generator and therefore the
 * value that must be hashed and persisted for provenance.
 */
export function composeImageGenerationPrompt(baseInstructions: string | undefined, scenePrompt: string, mode: ImageGenerationMode = 'LOCKED_INTERACTIVE'): string {
  const base = [DEFAULT_IMAGE_GENERATION_BASE_INSTRUCTIONS, normalize(baseInstructions)]
    .filter(Boolean)
    .join('\n\n');
  const modeGuard = mode === 'LOCKED_INTERACTIVE'
    ? 'Integration mode: LOCKED_INTERACTIVE. Keep the camera locked to the supplied composition, preserve the reserved foreground safe region, do not move the viewpoint, do not add, replace, duplicate, or hallucinate any foreground medical device, avoid invented tubing or controls, and keep the device area unobstructed for a separately rendered interactive model.'
    : 'Integration mode: CINEMATIC. Camera motion is allowed only if it remains physically coherent and trackable. Do not add, replace, duplicate, or hallucinate the medical device; reserve the supplied foreground region for the tracked offline model composite, with coherent lighting and no foreground occluders.';
  const scene = normalize(scenePrompt);
  if (!scene) throw new Error('IMAGE_GENERATION_SCENE_PROMPT_REQUIRED');
  const prompt = base
    ? `Global image-generation instructions (apply to every request):\n${base}\n\n${modeGuard}\n\nScene-specific request:\n${scene}`
    : `${modeGuard}\n\n${scene}`;
  if (prompt.length > MAX_EFFECTIVE_PROMPT_LENGTH) throw new Error('IMAGE_GENERATION_PROMPT_TOO_LONG');
  return prompt;
}
