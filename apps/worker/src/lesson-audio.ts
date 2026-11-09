import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechDelivery, SpeechSynthesisPort } from '@medical-device/contracts';
import {lessonMediaInputArgs} from './lesson-media-input.js';

/** Engineering defaults; representative speaker/listening acceptance is a separate review. */
export const lessonAudioProfile = { id: 'lesson-speech-v1', integratedLufs: -16, truePeakDb: -1.5, loudnessRangeLu: 7 } as const;
export interface LessonSoundBinding {assetVersionId: string; evidenceId: string; sourceStartSeconds: number; durationSeconds: number; atSeconds: number}
export interface LessonSoundAsset {path: string; approved: true; verifiedInstructionalSounds?: Array<{evidenceId: string; sourceStartSeconds: number; durationSeconds: number}>}
/** Approval records come from the trusted asset manifest, independently of scene author text. */
export async function resolveLessonInstructionalSounds(input: {
  scene: {startSeconds: number; endSeconds: number; visual: {kind: string; assetVersionId?: string}; citations: Array<{assetVersionId: string}>; audioMix?: {speechOnly: boolean; instructionalSounds: LessonSoundBinding[]}};
  assets: Record<string, LessonSoundAsset>; ffmpeg?: string; ffprobe?: string; signal?:AbortSignal;
}) {
  const run=(command:string,args:string[])=>execute(command,args,input.signal);
  if (input.scene.audioMix?.speechOnly !== false) return [];
  const sounds = input.scene.audioMix.instructionalSounds;
  if (!Array.isArray(sounds) || sounds.length > 8) throw Error('LESSON_AUDIO_SOUND_BINDING_INVALID');
  const directory = await mkdtemp(join(tmpdir(), 'lesson-sound-'));
  const ffmpeg = input.ffmpeg ?? process.env.LESSON_FFMPEG ?? 'ffmpeg', ffprobe = input.ffprobe ?? process.env.LESSON_FFPROBE ?? 'ffprobe';
  try {
    const result: Array<{bytes: Uint8Array; evidenceId: string; atSeconds: number}> = [];
    for (const [index, sound] of sounds.entries()) {
      const asset = input.assets[sound.assetVersionId];
      if (input.scene.visual.kind !== 'source_video' || input.scene.visual.assetVersionId !== sound.assetVersionId || !input.scene.citations.some(c => c.assetVersionId === sound.assetVersionId) || asset?.approved !== true || !asset.verifiedInstructionalSounds?.some(review => review.evidenceId === sound.evidenceId && review.sourceStartSeconds === sound.sourceStartSeconds && review.durationSeconds === sound.durationSeconds)) throw Error('LESSON_AUDIO_SOUND_REVIEW_REQUIRED');
      if (!sound.evidenceId || !Number.isFinite(sound.sourceStartSeconds) || sound.sourceStartSeconds < 0 || !Number.isFinite(sound.durationSeconds) || sound.durationSeconds <= 0 || sound.durationSeconds > 30 || !Number.isFinite(sound.atSeconds) || sound.atSeconds < 0 || sound.atSeconds !== sound.sourceStartSeconds || sound.atSeconds + sound.durationSeconds > input.scene.endSeconds - input.scene.startSeconds) throw Error('LESSON_AUDIO_SOUND_BINDING_INVALID');
      const mediaArgs=lessonMediaInputArgs(await readFile(asset.path),'video');
      const probe = JSON.parse(await run(ffprobe, ['-v', 'error',...mediaArgs, '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', asset.path])) as {format: {duration: string}; streams: Array<{codec_type: string}>};
      if (!probe.streams.some(s => s.codec_type === 'video') || !probe.streams.some(s => s.codec_type === 'audio') || sound.sourceStartSeconds + sound.durationSeconds > Number(probe.format.duration) + 0.01) throw Error('LESSON_AUDIO_SOUND_SOURCE_INVALID');
      const target = join(directory, `sound-${index}.wav`);
      await run(ffmpeg, ['-nostdin', '-y', '-v', 'error',...mediaArgs, '-i', asset.path, '-ss', String(sound.sourceStartSeconds), '-t', String(sound.durationSeconds), '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', target]);
      result.push({bytes: new Uint8Array(await readFile(target)), evidenceId: sound.evidenceId, atSeconds: sound.atSeconds});
    }
    return result;
  } finally { await rm(directory, {recursive: true, force: true}); }
}
export function lessonAudioInputHash(input: { text: string; delivery?: SpeechDelivery; voice?: string; speechOnly?: boolean }): string {
  const delivery = {rate: input.delivery?.rate ?? 1, emphasis: input.delivery?.emphasis ?? 'none', pauses: input.delivery?.pauses ?? [], pronunciations: input.delivery?.pronunciations ?? []};
  return createHash('sha256').update(JSON.stringify({ profile: lessonAudioProfile.id, text: input.text, delivery, voice: input.voice, speechOnly: input.speechOnly ?? true }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
}
function execute(command: string, args: string[],signal?:AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { signal,timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(`LESSON_AUDIO_PROCESS_FAILED: ${error.message}`)) : resolve(stdout + stderr)));
}
function measurements(log: string) {
  const match = log.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('LESSON_AUDIO_MEASUREMENT_MISSING');
  const data = JSON.parse(match[0]) as Record<string, string>;
  if (!['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every(key => Number.isFinite(Number(data[key])))) throw new Error('LESSON_AUDIO_SILENT_OR_INVALID');
  return data;
}
export async function finishLessonAudio(input: {
  speech: Uint8Array; speechOnly?: boolean;
  instructionalSounds?: Array<{ bytes: Uint8Array; evidenceId: string; atSeconds: number }>;
  ffmpeg?: string; ffprobe?: string;signal?:AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const run=(command:string,args:string[])=>execute(command,args,input.signal);
  if (!input.speech.length || input.speech.length > 64 * 1024 * 1024) throw new Error('LESSON_AUDIO_SIZE_INVALID');
  const sounds = input.speechOnly === false ? input.instructionalSounds ?? [] : [];
  if (sounds.length > 16 || sounds.some(s => !s.evidenceId?.trim() || !Number.isFinite(s.atSeconds) || s.atSeconds < 0 || s.atSeconds > 300 || !s.bytes.length || s.bytes.length > 16 * 1024 * 1024)) throw new Error('LESSON_AUDIO_SOUND_EVIDENCE_REQUIRED');
  const directory = await mkdtemp(join(tmpdir(), 'lesson-audio-'));
  const ffmpeg = input.ffmpeg ?? process.env.LESSON_FFMPEG ?? 'ffmpeg';
  const ffprobe = input.ffprobe ?? process.env.LESSON_FFPROBE ?? 'ffprobe';
  const profile = 'loudnorm=I=-16:TP=-1.5:LRA=7';
  try {
    const source = join(directory, 'source.audio'), normalized = join(directory, 'speech.wav'), output = join(directory, 'finished.wav');
    await writeFile(source, input.speech);
    const sourceArgs=lessonMediaInputArgs(input.speech,'audio');
    const before = measurements(await run(ffmpeg, ['-nostdin',...sourceArgs, '-i', source, '-af', `${profile}:print_format=json`, '-f', 'null', '-']));
    await run(ffmpeg, ['-nostdin', '-y',...sourceArgs, '-i', source, '-af', `${profile}:measured_I=${before.input_i}:measured_TP=${before.input_tp}:measured_LRA=${before.input_lra}:measured_thresh=${before.input_thresh}:offset=${before.target_offset}:linear=true`, '-ar', '48000', '-ac', '1', normalized]);
    const args = ['-nostdin', '-y','-protocol_whitelist','file,pipe','-f','wav', '-i', normalized];
    const filters: string[] = [];
    for (const [index, sound] of sounds.entries()) {
      const path = join(directory, `sound-${index}.audio`); await writeFile(path, sound.bytes); args.push(...lessonMediaInputArgs(sound.bytes,'audio'),'-i', path);
      filters.push(`[${index + 1}:a]adelay=${Math.round(sound.atSeconds * 1000)}:all=1[s${index}]`);
    }
    if (sounds.length) {
      filters.push(`[0:a]${sounds.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sounds.length + 1}:duration=longest:normalize=0,${profile}[out]`);
      args.push('-filter_complex', filters.join(';'), '-map', '[out]');
    }
    args.push('-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output); await run(ffmpeg, args);
    const after = measurements(await run(ffmpeg, ['-nostdin','-protocol_whitelist','file,pipe','-f','wav', '-i', output, '-af', `${profile}:print_format=json`, '-f', 'null', '-']));
    const durationSeconds = Number((await run(ffprobe, ['-v', 'error','-protocol_whitelist','file,pipe','-f','wav', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output])).trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300 || Number(after.input_tp) > -1) throw new Error('LESSON_AUDIO_PROFILE_FAILED');
    return { bytes: new Uint8Array(await readFile(output)), contentType: 'audio/wav' as const, durationSeconds, profile: lessonAudioProfile.id, speechOnly: !sounds.length, measurements: { inputIntegratedLufs: Number(before.input_i), inputTruePeakDb: Number(before.input_tp), inputClippingRisk: Number(before.input_tp) >= 0, outputIntegratedLufs: Number(after.input_i), outputTruePeakDb: Number(after.input_tp) }, soundEvidenceIds: sounds.map(s => s.evidenceId), reviewStatus: 'LISTENING_REVIEW_REQUIRED' as const };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function synthesizeLessonAudio(input: { speech: SpeechSynthesisPort; requestId: string; text: string; voice?: string; locale?: string; delivery?: SpeechDelivery; ffmpeg?: string; ffprobe?: string;signal?:AbortSignal }) {
  input.signal?.throwIfAborted();
  // Azure word-level emphasis is supported by Jane, but not the default Jenny voice.
  const voice = input.voice ?? (input.delivery?.emphasis && input.delivery.emphasis !== 'none' ? 'en-US-JaneNeural' : 'en-US-JennyNeural');
  if (input.delivery?.emphasis && input.delivery.emphasis !== 'none' && !['en-US-JaneNeural', 'en-US-GuyNeural', 'en-US-DavisNeural'].includes(voice)) throw Error('LESSON_AUDIO_EMPHASIS_VOICE_UNSUPPORTED');
  const result = await input.speech.synthesize({ requestId: input.requestId, text: input.text, voice, locale: input.locale ?? 'en-US', ...(input.delivery ? { delivery: input.delivery } : {}) });
  if (result.provider.name === 'deterministic-silent-speech') throw new Error('LESSON_AUDIO_ACTUAL_SPEECH_REQUIRED');
  return { ...await finishLessonAudio({ speech: result.audio.bytes, ffmpeg: input.ffmpeg, ffprobe: input.ffprobe,signal:input.signal }), provider: result.provider, inputHash: lessonAudioInputHash({...input, voice}) };
}
