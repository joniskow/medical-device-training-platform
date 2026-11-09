import {createHash} from 'node:crypto';
import type {PrivateObjectStoragePort, SpeechSynthesisPort, SpeechSynthesisRequest, SpeechSynthesisResult} from '@medical-device/contracts';
import {lessonAudioInputHash} from './lesson-audio.js';

const maxAudioBytes = 16 * 1024 * 1024;
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function actualNarration(result: SpeechSynthesisResult, voice: string): boolean {
  return typeof result?.provider?.name === 'string' && !!result.provider.name && !/deterministic|silent|fixture|mock/i.test(result.provider.name)
    && result.provider.voice === voice && ['audio/mpeg', 'audio/wav'].includes(result.audio?.contentType)
    && result.audio.bytes instanceof Uint8Array && result.audio.bytes.length >= 64 && result.audio.bytes.length <= maxAudioBytes
    && Number.isFinite(result.audio.durationSeconds) && result.audio.durationSeconds > 0 && result.audio.durationSeconds <= 300;
}

/** Cache raw provider speech; the renderer still measures/normalizes it and requires review. */
export function createCachedLessonSpeech(input: {
  speech: SpeechSynthesisPort; storage: PrivateObjectStoragePort; organizationId: string; courseVersionId: string;
  providerRevision: string; checkpoint?: () => Promise<void>;
  onResult?: (event: {request: SpeechSynthesisRequest; result: SpeechSynthesisResult; reused: boolean}) => void;
}): SpeechSynthesisPort {
  if (!input.organizationId || /[/\\]/.test(input.organizationId) || ['.', '..'].includes(input.organizationId) || !input.courseVersionId || !input.providerRevision) throw Error('LESSON_RENDER_SPEECH_CACHE_SCOPE_INVALID');
  return {async synthesize(request) {
    await input.checkpoint?.();
    const key = sha(JSON.stringify({version: 1, providerRevision: input.providerRevision, locale: request.locale, inputHash: lessonAudioInputHash(request)}));
    const blobKey = `${input.organizationId}/derived/lesson-speech/${encodeURIComponent(input.courseVersionId)}/${key}.json`;
    let result: SpeechSynthesisResult | undefined;
    try {
      const object = await input.storage.readObject({blobKey, maxBytes: Math.ceil(maxAudioBytes * 4 / 3) + 4096});
      if (object.contentType === 'application/json') {
        const cached = JSON.parse(Buffer.from(object.bytes).toString('utf8'));
        const candidate: SpeechSynthesisResult = {...cached, audio: {...cached.audio, bytes: new Uint8Array(Buffer.from(cached.audio.bytes, 'base64'))}};
        if (cached.key === key && actualNarration(candidate, request.voice) && sha(candidate.audio.bytes) === cached.sha256) result = {provider: candidate.provider, audio: candidate.audio};
      }
    } catch { /* Missing, damaged or unavailable cache regenerates this narration. */ }
    await input.checkpoint?.();
    const reused = !!result;
    if (!result) {
      result = await input.speech.synthesize(request);
      if (!actualNarration(result, request.voice)) throw Error('LESSON_RENDER_ACTUAL_NARRATION_REQUIRED');
      await input.checkpoint?.();
      const bytes = Buffer.from(JSON.stringify({key, sha256: sha(result.audio.bytes), provider: result.provider, audio: {...result.audio, bytes: Buffer.from(result.audio.bytes).toString('base64')}}));
      try { await input.storage.putObject({blobKey, bytes, contentType: 'application/json'}); } catch { /* Reuse is optional; valid narration can still render. */ }
    }
    await input.checkpoint?.();
    input.onResult?.({request, result, reused});
    return result;
  }};
}
