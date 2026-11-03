import type { OpaqueId } from './common.js';

export interface SpeechSynthesisRequest {
  requestId: OpaqueId;
  text: string;
  voice: string;
  locale: string;
}

export interface SpeechSynthesisResult {
  provider: { name: string; voice: string };
  audio: { bytes: Uint8Array; contentType: 'audio/mpeg' | 'audio/wav'; durationSeconds: number };
}

export interface SpeechSynthesisPort {
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}
