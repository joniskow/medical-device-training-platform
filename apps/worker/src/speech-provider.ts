import type { SpeechDelivery, SpeechSynthesisPort, SpeechSynthesisRequest, SpeechSynthesisResult } from '@medical-device/contracts';

const maxText = 12_000;
const defaultVoice = 'en-US-JennyNeural';
const defaultLocale = 'en-US';

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character] ?? character));
}

export function validateSpeechDelivery(text: string, value: unknown): value is SpeechDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as SpeechDelivery;
  if (Object.keys(d).some(key => !['rate', 'emphasis', 'pauses', 'pronunciations'].includes(key))) return false;
  if (d.rate !== undefined && (!Number.isFinite(d.rate) || d.rate < 0.75 || d.rate > 1.25)) return false;
  if (d.emphasis !== undefined && !['none', 'reduced', 'moderate'].includes(d.emphasis)) return false;
  const boundedText = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 160;
  if (d.pauses !== undefined && (!Array.isArray(d.pauses) || d.pauses.length > 24 || !d.pauses.every(p => p && Object.keys(p).every(k => ['afterText', 'milliseconds'].includes(k)) && boundedText(p.afterText) && text.split(p.afterText).length === 2 && Number.isInteger(p.milliseconds) && p.milliseconds >= 0 && p.milliseconds <= 5000) || new Set(d.pauses.map(p => p.afterText)).size !== d.pauses.length)) return false;
  if (d.pronunciations !== undefined && (!Array.isArray(d.pronunciations) || d.pronunciations.length > 32 || !d.pronunciations.every(p => p && Object.keys(p).every(k => ['term', 'alias'].includes(k)) && boundedText(p.term) && boundedText(p.alias) && text.includes(p.term)) || new Set(d.pronunciations.map(p => p.term)).size !== d.pronunciations.length)) return false;
  return true;
}

export function buildSpeechSsml(request: SpeechSynthesisRequest): string {
  if (!request.text.trim() || request.text.length > maxText || (request.delivery !== undefined && !validateSpeechDelivery(request.text, request.delivery))) throw new Error('AZURE_SPEECH_TEXT_OR_DELIVERY_INVALID');
  const delivery = request.delivery ?? {};
  const pauses = new Map((delivery.pauses ?? []).map(p => [request.text.indexOf(p.afterText) + p.afterText.length, p.milliseconds]));
  const terms = [...(delivery.pronunciations ?? [])].sort((a, b) => b.term.length - a.term.length);
  let body = '';
  for (let i = 0; i < request.text.length;) {
    const term = terms.find(p => request.text.startsWith(p.term, i) && ![...pauses.keys()].some(end => end > i && end < i + p.term.length));
    if (term) { body += `<sub alias="${xml(term.alias)}">${xml(term.term)}</sub>`; i += term.term.length; }
    else { body += xml(request.text[i]!); i++; }
    if (pauses.has(i)) body += `<break time="${pauses.get(i)}ms"/>`;
  }
  if (delivery.emphasis && delivery.emphasis !== 'none') body = `<emphasis level="${delivery.emphasis}">${body}</emphasis>`;
  return `<speak version="1.0" xml:lang="${xml(request.locale)}"><voice name="${xml(request.voice)}"><prosody rate="${Math.round((delivery.rate ?? 1) * 100)}%">${body}</prosody></voice></speak>`;
}

function estimatedDuration(text: string): number {
  return Math.max(1, Math.min(300, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length / 2.35)));
}

function silentWav(durationSeconds: number): Uint8Array {
  const sampleRate = 16_000;
  const channels = 1;
  const bits = 16;
  const frames = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataBytes = frames * channels * (bits / 8);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => value.split('').forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true); write(36, 'data'); view.setUint32(40, dataBytes, true);
  return bytes;
}

async function fetchSpeech(endpoint: string, apiKey: string, request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/ssml+xml',
        'x-microsoft-outputformat': 'audio-24khz-160kbitrate-mono-mp3',
        'ocp-apim-subscription-key': apiKey,
        'user-agent': 'medical-device-training-worker/1.0'
      },
      body: buildSpeechSsml(request)
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error(`AZURE_SPEECH_HTTP_${response.status}`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType && !contentType.startsWith('audio/')) throw new Error('AZURE_SPEECH_RESPONSE_INVALID');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 64) throw new Error('AZURE_SPEECH_RESPONSE_INVALID');
  return { provider: { name: 'azure-speech', voice: request.voice }, audio: { bytes, contentType: 'audio/mpeg', durationSeconds: estimatedDuration(request.text) } };
}

export function createSpeechProvider(options: { mode?: string; endpoint?: string; apiKey?: string; voice?: string; locale?: string } = {}): SpeechSynthesisPort {
  const mode = (options.mode ?? process.env.AZURE_SPEECH_MODE ?? 'deterministic').trim().toLowerCase();
  const voice = options.voice?.trim() || process.env.AZURE_SPEECH_VOICE?.trim() || defaultVoice;
  const locale = options.locale?.trim() || process.env.AZURE_SPEECH_LOCALE?.trim() || defaultLocale;
  if (mode === 'http') {
    const endpoint = options.endpoint?.trim() || process.env.AZURE_SPEECH_ENDPOINT?.trim();
    const apiKey = options.apiKey?.trim() || process.env.AZURE_SPEECH_API_KEY?.trim();
    if (!endpoint || !apiKey) throw new Error('AZURE_SPEECH_CONFIGURATION_REQUIRED');
    return { synthesize: request => fetchSpeech(endpoint, apiKey, { ...request, voice: request.voice || voice, locale: request.locale || locale }) };
  }
  return {
    async synthesize(request) {
      buildSpeechSsml(request);
      const text = request.text.trim();
      if (!text || text.length > maxText) throw new Error('AZURE_SPEECH_TEXT_INVALID');
      const durationSeconds = estimatedDuration(text);
      return { provider: { name: 'deterministic-silent-speech', voice: request.voice || voice }, audio: { bytes: silentWav(durationSeconds), contentType: 'audio/wav', durationSeconds } };
    }
  };
}
