import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { currentPreviewAccepted, lessonRenderRevision, type LessonRenderManifest, type SpeechSynthesisPort } from '@medical-device/contracts';
import { finishLessonAudio, synthesizeLessonAudio, resolveLessonInstructionalSounds, lessonAudioInputHash, type LessonSoundAsset, type LessonSoundBinding } from './lesson-audio.js';
import { validateVideoLesson, selectedSceneTake, validateSceneTakeState, lessonDirectionRevision, type TakeLesson } from '@medical-device/simulation-schema';
import {lessonMediaInputArgs} from './lesson-media-input.js';

interface Scene { sceneId: string; startSeconds: number; endSeconds: number; narration: string; narrationDelivery?: Parameters<typeof synthesizeLessonAudio>[0]['delivery']; audioMix?: {speechOnly: boolean; instructionalSounds: LessonSoundBinding[]}; visual: {kind: string; assetVersionId?: string}; citations: Array<{assetVersionId: string}>; onScreenText: string[] }
interface Beat {sceneId: string; observationHoldSeconds: number; callouts: Array<{text: string; startSeconds: number; endSeconds: number}>}
const execute = (binary: string, args: string[], cwd?: string, signal?: AbortSignal) => new Promise<string>((resolveResult, reject) => execFile(binary, args, {cwd, signal, windowsHide: true, timeout: 300_000, maxBuffer: 4 * 1024 * 1024}, (error, stdout, stderr) => error ? reject(new Error(`LESSON_RENDER_PROCESS_FAILED: ${error.message}\n${stderr.slice(-2000)}`)) : resolveResult(stdout)));
export function lessonCaptionLines(narration: string): string[] {
  const lines: string[] = [];
  for (const word of narration.trim().split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last]!.length + word.length + 1 <= 55) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}
export async function renderLessonJob(input: {
  lesson: Record<string, unknown>; mode: 'rough-cut' | 'final'; outputDirectory: string;
  assets: Record<string, LessonSoundAsset>;
  recordedNarration?: Record<string, {bytes: Uint8Array; transcript: string; delivery?: Scene['narrationDelivery']}>;
  speech?: SpeechSynthesisPort; ffmpeg?: string; ffprobe?: string; signal?:AbortSignal; checkpoint?:()=>Promise<void>;
}): Promise<LessonRenderManifest> {
  const run=(binary:string,args:string[],cwd?:string)=>execute(binary,args,cwd,input.signal);
  const {lesson} = input;
  if (!validateVideoLesson(lesson).valid || !validateSceneTakeState(lesson as TakeLesson).valid) throw Error('LESSON_RENDER_INPUT_INVALID');
  const scenes = lesson.scenes as Scene[], direction = lesson.direction as {beats: Beat[]} | undefined;
  if (lesson.generationStatus === 'STALE' || !direction || (lesson.directionReview as {revision?: string})?.revision !== lessonDirectionRevision(direction)) throw Error('LESSON_RENDER_DIRECTION_REVIEW_REQUIRED');
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 12 || !Number.isFinite(lesson.durationSeconds) || Number(lesson.durationSeconds) > 300) throw Error('LESSON_RENDER_TIMELINE_INVALID');
  let cursor = 0;
  for (const scene of scenes) {
    const beat = direction.beats.find(b => b.sceneId === scene.sceneId);
    if (scene.startSeconds !== cursor || !Number.isFinite(scene.endSeconds) || scene.endSeconds <= cursor || !scene.narration?.trim() || !scene.citations?.length || !beat || !(beat.observationHoldSeconds >= 1 && beat.observationHoldSeconds < scene.endSeconds - cursor)) throw Error('LESSON_RENDER_TIMELINE_INVALID');
    if (beat.callouts.some(c => !Number.isFinite(c.startSeconds) || !Number.isFinite(c.endSeconds) || c.startSeconds < 0 || c.endSeconds <= c.startSeconds || c.endSeconds > scene.endSeconds - cursor)) throw Error('LESSON_RENDER_CALLOUT_INVALID');
    cursor = scene.endSeconds;
  }
  if (cursor !== lesson.durationSeconds) throw Error('LESSON_RENDER_TIMELINE_INVALID');
  if (input.mode === 'final' && !currentPreviewAccepted(lesson)) throw Error('LESSON_RENDER_CURRENT_PREVIEW_REQUIRED');
  const ffmpeg = input.ffmpeg ?? process.env.LESSON_FFMPEG ?? 'ffmpeg', ffprobe = input.ffprobe ?? process.env.LESSON_FFPROBE ?? 'ffprobe';
  const directory = await mkdtemp(join(tmpdir(), 'lesson-render-'));
  const outputDirectory = resolve(input.outputDirectory); await mkdir(outputDirectory, {recursive: true});
  const placeholders: string[] = [], rendered: LessonRenderManifest['scenes'] = [], captions: string[] = [];
  const size = input.mode === 'rough-cut' ? '640:360' : '1280:720';
  try {
    // Copy the system font so filter paths remain portable and free of shell/filter escaping.
    let font = '';
    if (process.platform === 'win32') { await copyFile('C:/Windows/Fonts/arial.ttf', join(directory, 'font.ttf')); font = 'fontfile=font.ttf:'; }
    for (const [index, scene] of scenes.entries()) {
      input.signal?.throwIfAborted();await input.checkpoint?.();
      const duration = scene.endSeconds - scene.startSeconds, beat = direction.beats.find(b => b.sceneId === scene.sceneId)!;
      const recorded = input.recordedNarration?.[scene.sceneId];
      if (recorded && recorded.transcript !== scene.narration) throw Error('LESSON_RENDER_RECORDING_TRANSCRIPT_STALE');
      if (recorded && lessonAudioInputHash({text: recorded.transcript, delivery: recorded.delivery}) !== lessonAudioInputHash({text: scene.narration, delivery: scene.narrationDelivery})) throw Error('LESSON_RENDER_RECORDING_DELIVERY_STALE: regenerate and review the recording for the saved delivery controls.');
      const audio = recorded ? await finishLessonAudio({speech: recorded.bytes, ffmpeg, ffprobe,signal:input.signal}) : input.speech ? await synthesizeLessonAudio({speech: input.speech, requestId: `lesson-${index}`, text: scene.narration, delivery: scene.narrationDelivery, ffmpeg, ffprobe,signal:input.signal}) : undefined;
      if (!audio) throw Error('LESSON_RENDER_ACTUAL_NARRATION_REQUIRED');
      if (audio.durationSeconds + beat.observationHoldSeconds > duration) throw Error(`LESSON_RENDER_SPEECH_EXCEEDS_SCENE: ${scene.sceneId}; extend the scene to retain its observation hold.`);
      const instructionalSounds = await resolveLessonInstructionalSounds({scene, assets: input.assets, ffmpeg, ffprobe,signal:input.signal});
      const mixedAudio = instructionalSounds.length ? await finishLessonAudio({speech: audio.bytes, speechOnly: false, instructionalSounds, ffmpeg, ffprobe,signal:input.signal}) : audio;
      if (mixedAudio.durationSeconds > duration + 0.01) throw Error('LESSON_RENDER_SOUND_EXCEEDS_SCENE');
      await writeFile(join(directory, `audio-${index}.wav`), mixedAudio.bytes);
      const selected = selectedSceneTake(lesson as TakeLesson, scene.sceneId);
      if (selected && instructionalSounds.length) throw Error('LESSON_RENDER_SELECTED_TAKE_SOUND_REVIEW_REQUIRED');
      if (selected) {
        const selectedBytes = await readFile(selected.artifact.path);
        const selectedBeat = direction.beats.find(b => b.sceneId === scene.sceneId) as Beat & {startingCondition?: string; result?: string};
        if (createHash('sha256').update(selectedBytes).digest('hex') !== selected.artifact.sha256 || selected.startingState !== selectedBeat.startingCondition || selected.endingState !== selectedBeat.result || Math.abs(selected.artifact.durationSeconds - duration) > 0.1) throw Error('LESSON_RENDER_SELECTED_TAKE_INVALID');
      }
      const asset = selected ? {path: selected.artifact.path, approved: true as const} : scene.visual.assetVersionId ? input.assets[scene.visual.assetVersionId] : undefined;
      const visualKind = selected ? 'source_video' : scene.visual.kind;
      const supported = asset?.approved === true && ['source_video', 'source_image'].includes(visualKind);
      if (!supported) { placeholders.push(scene.sceneId); if (input.mode === 'final') throw Error('LESSON_RENDER_FINAL_PLACEHOLDER_FORBIDDEN'); }
      const args = ['-nostdin', '-y', '-v', 'error'];
      if (supported) args.push(...(visualKind === 'source_image' ? ['-loop', '1'] : []),...lessonMediaInputArgs(await readFile(asset.path),visualKind==='source_image'?'image':'video'), '-i', resolve(asset.path));
      else args.push('-f', 'lavfi', '-i', `color=c=0x243040:s=${size.replace(':', 'x')}:r=24`);
      args.push('-protocol_whitelist','file,pipe','-f','wav','-i', `audio-${index}.wav`);
      const filter = [`scale=${size}:force_original_aspect_ratio=decrease`, `pad=${size}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'fps=24', `tpad=stop_mode=clone:stop_duration=${duration}`];
      const overlay = async (name: string, value: string, y: string, enable?: string) => {
        await writeFile(join(directory, name), value);
        filter.push(`drawtext=${font}textfile=${name}:expansion=none:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.8:x=12:y=${y}${enable ? `:enable='${enable}'` : ''}`);
      };
      await overlay(`title-${index}.txt`, input.mode === 'rough-cut' ? `ROUGH CUT - ${scene.sceneId}${supported ? '' : ' - UNFINISHED SHOT PLACEHOLDER'}` : scene.sceneId, '12');
      for (const [calloutIndex, callout] of beat.callouts.entries()) await overlay(`callout-${index}-${calloutIndex}.txt`, callout.text, String(48 + calloutIndex * 24), `between(t,${callout.startSeconds},${callout.endSeconds})`);
      // Open captions are a companion review aid; a selectable WebVTT is emitted as well.
      const lines = lessonCaptionLines(scene.narration);
      const chunkSeconds = audio.durationSeconds / lines.length;
      for (const [lineIndex, line] of lines.entries()) await overlay(`caption-${index}-${lineIndex}.txt`, line, 'h-36', `between(t,${lineIndex * chunkSeconds},${(lineIndex + 1) * chunkSeconds})`);
      args.push('-vf', filter.join(','), '-af', 'apad', '-t', String(duration), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', `scene-${index}.mp4`);
      const visualHash = supported ? createHash('sha256').update(await readFile(resolve(asset.path))).digest('hex') : 'unfinished-placeholder';
      const cacheKey = createHash('sha256').update(JSON.stringify({scene, beat, mode: input.mode, visualHash, audioHash: createHash('sha256').update(mixedAudio.bytes).digest('hex'), renderer: 'lesson-compositor-v3'}, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
      const cachePath = join(outputDirectory, `scene-cache-${cacheKey}.mp4`), cacheHashPath = `${cachePath}.sha256`;
      let reused = false;
      try {
        const [cached, expected] = await Promise.all([readFile(cachePath), readFile(cacheHashPath, 'utf8')]);
        if (createHash('sha256').update(cached).digest('hex') === expected) {await writeFile(join(directory, `scene-${index}.mp4`), cached); reused = true;}
      } catch { /* Missing/invalid cache renders only the affected scene again. */ }
      if (!reused) {
        await run(ffmpeg, args, directory);
        const bytes = await readFile(join(directory, `scene-${index}.mp4`));
        await writeFile(cachePath, bytes); await writeFile(cacheHashPath, createHash('sha256').update(bytes).digest('hex'));
      }
      rendered.push({sceneId: scene.sceneId, startSeconds: scene.startSeconds, endSeconds: scene.endSeconds, narrationSeconds: audio.durationSeconds});
      const stamp = (seconds: number) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
      lines.forEach((line, i) => captions.push(`${stamp(scene.startSeconds + i * chunkSeconds)} --> ${stamp(scene.startSeconds + (i + 1) * chunkSeconds)}\n${line.replaceAll('-->', 'â†’')}`));
    }
    await writeFile(join(directory, 'concat.txt'), rendered.map((_, i) => `file 'scene-${i}.mp4'`).join('\n'));
    const outputPath = join(outputDirectory, `${String(lesson.lessonId).replace(/[^a-zA-Z0-9_-]/g, '_')}-${input.mode}.mp4`);
    await run(ffmpeg, ['-nostdin', '-y', '-v', 'error','-protocol_whitelist','file,pipe', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', outputPath], directory);
    const durationSeconds = Number((await run(ffprobe, ['-v', 'error', '-protocol_whitelist','file,pipe','-f','mov','-enable_drefs','0','-use_absolute_path','0','-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', outputPath])).trim());
    if (Math.abs(durationSeconds - cursor) > 0.25) throw Error('LESSON_RENDER_DURATION_MISMATCH');
    const captionsPath = outputPath.replace(/\.mp4$/, '.vtt'); await writeFile(captionsPath, `WEBVTT\n\n${captions.join('\n\n')}\n`);
    const sha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
    const captionsSha256 = createHash('sha256').update(await readFile(captionsPath)).digest('hex');
    const manifest: LessonRenderManifest = {schemaVersion: 'lesson-render.v1', mode: input.mode, artifactId: `sha256:${sha256}`, sha256, inputRevision: lessonRenderRevision(lesson), durationSeconds, placeholders, scenes: rendered, outputPath, captionsPath, captionsSha256};
    await writeFile(outputPath.replace(/\.mp4$/, '.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { await rm(directory, {recursive: true, force: true}); }
}
