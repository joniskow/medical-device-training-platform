import { createHash } from 'node:crypto';
import type {
  JobStorePort,
  OpenMontageGenerationPayload,
  OpenMontageGenerationService,
  OpenMontageGenerationStatus,
  OpenMontageIntegrationMode,
  PrivateObjectStoragePort,
  TenantContext
} from '@medical-device/contracts';
import { validateTrainingSceneManifest } from '@medical-device/contracts';
import type { OpenMontageSceneService } from './openmontage-scene-service.js';

const idPattern = /^[A-Za-z0-9._:-]{1,200}$/;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function generationIdFor(tenant: TenantContext, idempotencyKey: string): string {
  return `openmontage-generation:${hash(`${tenant.organizationId}:${idempotencyKey}`)}`;
}

function jobIdFor(generationId: string): string { return `job_openmontage_${hash(generationId)}`; }

export function createOpenMontageGenerationService(input: {
  jobs: JobStorePort;
  storage: Pick<PrivateObjectStoragePort, 'readObject'>;
  scenes: OpenMontageSceneService;
}): OpenMontageGenerationService & { preview(tenant: TenantContext, generationId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> } {
  return {
    async create(tenant, request) {
      const scene = validateTrainingSceneManifest(request.sceneManifest);
      const mode: OpenMontageIntegrationMode = request.mode === 'CINEMATIC' ? 'CINEMATIC' : 'LOCKED_INTERACTIVE';
      if (!request.idempotencyKey.trim() || request.idempotencyKey.length > 200) throw new Error('IDEMPOTENCY_KEY_INVALID');
      const narrationText = request.narrationText?.trim();
      if (narrationText && narrationText.length > 12_000) throw new Error('OPENMONTAGE_NARRATION_INVALID');
      const narrationVoice = request.narrationVoice?.trim();
      if (narrationVoice && narrationVoice.length > 200) throw new Error('OPENMONTAGE_NARRATION_INVALID');
      const briefResult = await input.scenes.createBrief(tenant, { sceneManifest: scene, prompt: request.prompt, mode, idempotencyKey: `brief:${request.idempotencyKey}`, requestHash: request.requestHash });
      // Keep the public generation identity stable across retries. The job store
      // deduplicates by idempotency key, so a random ID here would let a retry
      // receive a new generation ID that cannot resolve to the existing job.
      const generationId = generationIdFor(tenant, request.idempotencyKey);
      const payload: OpenMontageGenerationPayload = {
        schemaVersion: 'openmontage-generation-request.v1',
        generationId,
        briefId: briefResult.briefId,
        sceneManifest: scene,
        brief: briefResult.brief,
        mode,
        promptHash: briefResult.brief.provenance.promptHash,
        ...(narrationText ? { narrationText, ...(narrationVoice ? { narrationVoice } : {}) } : {})
      };
      await input.jobs.enqueue({
        jobId: jobIdFor(generationId),
        jobType: 'openmontage.generate',
        attempt: 1,
        maxAttempts: 2,
        idempotency: { key: `generation:${tenant.organizationId}:${request.idempotencyKey}`, requestHash: request.requestHash },
        tenant,
        payload,
        timeoutSeconds: mode === 'CINEMATIC' ? 3600 : 900,
        codeVersion: 'openmontage-generation.v1'
      });
      return { generationId, jobId: jobIdFor(generationId), briefId: briefResult.briefId, brief: briefResult.brief };
    },

    async get(tenant, generationId): Promise<OpenMontageGenerationStatus | null> {
      if (!idPattern.test(generationId)) return null;
      const job = await input.jobs.get<OpenMontageGenerationPayload>(tenant, jobIdFor(generationId));
      if (!job || job.jobType !== 'openmontage.generate' || job.payload.generationId !== generationId) return null;
      const details = job.outcome?.details as Record<string, any> | undefined;
      return {
        generationId,
        jobId: job.jobId,
        briefId: job.payload.briefId,
        mode: job.payload.mode,
        promptHash: job.payload.promptHash,
        state: job.state,
        outcome: job.outcome,
        ...(details?.artifactId ? { artifactId: details.artifactId as string } : {}),
        ...(details?.narration && typeof details.narration === 'object' ? {
          narration: {
            audioUrl: `/api/v1/openmontage/generations/${encodeURIComponent(generationId)}/narration`,
            contentType: String(details.narration.contentType ?? 'audio/mpeg'),
            durationSeconds: Number(details.narration.durationSeconds ?? 0),
            provider: String(details.narration.provider ?? 'unknown')
          }
        } : {})
      };
    },

    async preview(tenant, generationId) {
      const job = await input.jobs.get<OpenMontageGenerationPayload>(tenant, jobIdFor(generationId));
      const preview = (job?.outcome?.details as Record<string, any> | undefined)?.preview;
      if (!job || job.jobType !== 'openmontage.generate' || !preview || typeof preview.blobKey !== 'string' || !preview.blobKey.startsWith(`${tenant.organizationId}/`)) return null;
      const object = await input.storage.readObject({ blobKey: preview.blobKey, maxBytes: 128 * 1024 * 1024 });
      if (object.sha256 !== preview.sha256 || object.bytes.length !== preview.byteLength) throw new Error('OPENMONTAGE_GENERATION_CONTENT_MISMATCH');
      return { bytes: object.bytes, contentType: object.contentType };
    },

    async narration(tenant, generationId) {
      const job = await input.jobs.get<OpenMontageGenerationPayload>(tenant, jobIdFor(generationId));
      const narration = (job?.outcome?.details as Record<string, any> | undefined)?.narration;
      if (!job || job.jobType !== 'openmontage.generate' || !narration || typeof narration.blobKey !== 'string' || !narration.blobKey.startsWith(`${tenant.organizationId}/`)) return null;
      const object = await input.storage.readObject({ blobKey: narration.blobKey, maxBytes: 16 * 1024 * 1024 });
      if (object.sha256 !== narration.sha256 || object.bytes.length !== narration.byteLength) throw new Error('OPENMONTAGE_NARRATION_CONTENT_MISMATCH');
      return { bytes: object.bytes, contentType: object.contentType };
    }
  };
}
