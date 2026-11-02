const MAX_EFFECTIVE_PROMPT_LENGTH = 4000;

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
export function composeImageGenerationPrompt(baseInstructions: string | undefined, scenePrompt: string): string {
  const base = [DEFAULT_IMAGE_GENERATION_BASE_INSTRUCTIONS, normalize(baseInstructions)]
    .filter(Boolean)
    .join('\n\n');
  const scene = normalize(scenePrompt);
  if (!scene) throw new Error('IMAGE_GENERATION_SCENE_PROMPT_REQUIRED');
  const prompt = base
    ? `Global image-generation instructions (apply to every request):\n${base}\n\nScene-specific request:\n${scene}`
    : scene;
  if (prompt.length > MAX_EFFECTIVE_PROMPT_LENGTH) throw new Error('IMAGE_GENERATION_PROMPT_TOO_LONG');
  return prompt;
}
