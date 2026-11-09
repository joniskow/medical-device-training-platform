import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { addSceneTake, reserveSceneTake, sceneTakeBinding, type TakeLesson, type SceneTake } from '@medical-device/simulation-schema';

/** Reserve before any paid generation; callers persist this reservation even when generation fails. */
export async function generateSceneTake(input: {
  lesson: TakeLesson; sceneId: string; correction: SceneTake['correction']; provenance: SceneTake['provenance'];
  persist: (lesson: TakeLesson) => Promise<void>;
  generate: (request: { sceneId: string; binding: string; correction: SceneTake['correction']; provenance: SceneTake['provenance'] }) => Promise<{ path: string; startingState: string; endingState: string }>;
  ffprobe?: string;
}): Promise<SceneTake> {
  const correction = structuredClone(input.correction), provenance = structuredClone(input.provenance);
  const scene = input.lesson.scenes.find(s => s.sceneId === input.sceneId);
  if (!scene || !Number.isFinite(correction.atSeconds) || correction.atSeconds < scene.startSeconds || correction.atSeconds >= scene.endSeconds || !correction.defect.trim() || !correction.requestedCorrection.trim() || !provenance.provider.trim() || !provenance.model.trim()) throw Error('SCENE_TAKE_REQUEST_INVALID');
  const takeId = `take:${randomUUID()}`, binding = reserveSceneTake(input.lesson, input.sceneId, takeId);
  await input.persist(input.lesson);
  const result = await input.generate({ sceneId: input.sceneId, binding, correction, provenance });
  const info = await new Promise<string>((resolve, reject) => execFile(input.ffprobe ?? process.env.LESSON_FFPROBE ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', result.path], { windowsHide: true, timeout: 30_000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const probe = JSON.parse(info) as { format: { duration: string }; streams: Array<{ codec_type: string }> };
  if (!probe.streams.some(s => s.codec_type === 'video')) throw Error('SCENE_TAKE_VIDEO_REQUIRED');
  if (binding !== sceneTakeBinding(input.lesson, input.sceneId)) throw Error('SCENE_TAKE_GENERATION_STALE');
  const take: SceneTake = { takeId, sceneId: input.sceneId, binding, correction, provenance, startingState: result.startingState, endingState: result.endingState, artifact: { path: result.path, sha256: createHash('sha256').update(await readFile(result.path)).digest('hex'), mimeType: 'video/mp4', durationSeconds: Number(probe.format.duration) } };
  addSceneTake(input.lesson, take); await input.persist(input.lesson); return take;
}

/** Application-controlled recomposition of approved external views; never invents device motion. */
export async function generateControlledSceneTake(input: {
  lesson: TakeLesson; sceneId: string; correction: SceneTake['correction'];
  assets: Record<string, { path: string; approved: true }>;
  framing: 'fit' | 'detail'; outputDirectory: string; persist: (lesson: TakeLesson) => Promise<void>; ffmpeg?: string; ffprobe?: string;
}): Promise<SceneTake> {
  const scene = input.lesson.scenes.find(s => s.sceneId === input.sceneId);
  const visual = scene?.visual as { kind?: string; assetVersionId?: string } | undefined;
  const asset = visual?.assetVersionId ? input.assets[visual.assetVersionId] : undefined;
  if (!scene || asset?.approved !== true || !['source_image', 'source_video'].includes(visual?.kind ?? '') || !['fit', 'detail'].includes(input.framing)) throw Error('SCENE_TAKE_APPROVED_VISUAL_REQUIRED');
  const beat = input.lesson.direction?.beats.find(b => b.sceneId === scene.sceneId);
  if (!beat) throw Error('SCENE_TAKE_SHOT_REQUIRED');
  const path = resolve(input.outputDirectory); await mkdir(path, { recursive: true });
  return generateSceneTake({ ...input, provenance: { provider: 'application-controlled-ffmpeg', model: 'approved-view-composite-v1', configuration: { framing: input.framing, assetVersionId: visual!.assetVersionId!, width: 1280, height: 720, fps: 24 } }, generate: async () => {
    const output = join(path, `scene-take-${randomUUID()}.mp4`), duration = scene.endSeconds - scene.startSeconds;
    const scale = input.framing === 'detail' ? 'scale=1408:792:force_original_aspect_ratio=increase,crop=1280:720' : 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
    const args = ['-nostdin', '-y', '-v', 'error', ...(visual!.kind === 'source_image' ? ['-loop', '1'] : []), '-i', resolve(asset.path), '-vf', `${scale},setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${duration}`, '-t', String(duration), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', output];
    await new Promise<void>((resolveResult, reject) => execFile(input.ffmpeg ?? process.env.LESSON_FFMPEG ?? 'ffmpeg', args, { windowsHide: true, timeout: 120_000 }, error => error ? reject(error) : resolveResult()));
    return { path: output, startingState: beat.startingCondition, endingState: beat.result };
  } });
}
