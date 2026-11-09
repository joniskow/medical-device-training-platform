import type { OpaqueId } from './common.js';

/** Reviewed delivery instructions; aliases alter pronunciation, never the saved transcript. */
export interface SpeechDelivery {
  rate?: number;
  emphasis?: 'none' | 'reduced' | 'moderate';
  pauses?: Array<{ afterText: string; milliseconds: number }>;
  pronunciations?: Array<{ term: string; alias: string }>;
}

export interface SpeechSynthesisRequest {
  requestId: OpaqueId;
  text: string;
  voice: string;
  locale: string;
  delivery?: SpeechDelivery;
}

export interface SpeechSynthesisResult {
  provider: { name: string; voice: string };
  audio: { bytes: Uint8Array; contentType: 'audio/mpeg' | 'audio/wav'; durationSeconds: number };
}

export interface SpeechSynthesisPort {
  synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}
