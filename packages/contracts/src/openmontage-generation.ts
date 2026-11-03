import type { JobOutcome, JobState, OpaqueId, TenantContext } from './common.js';
import type { OpenMontageIntegrationMode, OpenMontageRenderArtifact, OpenMontageSceneBrief } from './openmontage-brief.js';
import type { TrainingSceneManifest } from './scene-manifest.js';

export interface OpenMontageGenerationPayload {
  schemaVersion: 'openmontage-generation-request.v1';
  generationId: OpaqueId;
  briefId: OpaqueId;
  sceneManifest: TrainingSceneManifest;
  brief: OpenMontageSceneBrief;
  mode: OpenMontageIntegrationMode;
  promptHash: string;
  narrationText?: string;
  narrationVoice?: string;
}

export interface OpenMontageProviderRequest {
  generationId: OpaqueId;
  prompt: string;
  mode: OpenMontageIntegrationMode;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  modelVersionId: string;
  modelSourceHash: string;
}

export interface OpenMontageProviderResult {
  provider: { name: string; jobId?: string; model?: string };
  output: 'CLEAN_PLATE' | 'CINEMATIC_COMPOSITE';
  tracking?: { status: 'PASS' | 'FAIL'; method: string; reprojectionErrorPixels?: number };
  video: { bytes: Uint8Array; contentType: 'video/mp4' | 'video/webm'; width: number; height: number; frameRate: number; durationSeconds: number };
}

export interface OpenMontageProviderPort {
  generate(request: OpenMontageProviderRequest): Promise<OpenMontageProviderResult>;
}

export interface OpenMontageGenerationStatus {
  generationId: OpaqueId;
  jobId: OpaqueId;
  briefId: OpaqueId;
  mode: OpenMontageIntegrationMode;
  promptHash: string;
  state: JobState;
  outcome?: JobOutcome;
  artifactId?: OpaqueId;
  artifact?: OpenMontageRenderArtifact;
  narration?: { audioUrl: string; contentType: string; durationSeconds: number; provider: string };
}

export interface OpenMontageGenerationService {
  create(tenant: TenantContext, input: { sceneManifest: unknown; prompt: string; mode?: OpenMontageIntegrationMode; narrationText?: string; narrationVoice?: string; idempotencyKey: string; requestHash: string }): Promise<{ generationId: string; jobId: string; briefId: string; brief: OpenMontageSceneBrief }>;
  get(tenant: TenantContext, generationId: string): Promise<OpenMontageGenerationStatus | null>;
  narration(tenant: TenantContext, generationId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
