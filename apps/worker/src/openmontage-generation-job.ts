import { createHash } from 'node:crypto';
import type { JobStorePort, OpenMontageGenerationPayload, OpenMontageProviderPort, PrivateObjectStoragePort, SpeechSynthesisPort, TenantContext } from '@medical-device/contracts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function processOpenMontageGenerationJob(input: { jobStore: JobStorePort; storage: PrivateObjectStoragePort; provider: OpenMontageProviderPort; speech?: SpeechSynthesisPort; tenant: TenantContext; jobId: string; workerId: string;signal?:AbortSignal }) {
  const stored = await input.jobStore.get<OpenMontageGenerationPayload>(input.tenant, input.jobId);
  if (stored?.jobType !== 'openmontage.generate') return null;
  const job = await input.jobStore.claim<OpenMontageGenerationPayload>(input.tenant, input.jobId, input.workerId, undefined, 3600);
  if (!job) return null;
  const lease = job.leaseGeneration ?? 0;
  try {
    input.signal?.throwIfAborted();
    const brief = job.payload.brief;
    const result = await input.provider.generate({ generationId: job.payload.generationId, prompt: brief.background.prompt, mode: job.payload.mode, width: brief.background.width, height: brief.background.height, frameRate: brief.background.frameRate, durationSeconds: brief.background.durationSeconds, modelVersionId: brief.sourceScene.modelVersionId, modelSourceHash: brief.sourceScene.modelSourceHash });
    if (job.payload.mode === 'LOCKED_INTERACTIVE' && result.output !== 'CLEAN_PLATE') throw new Error('OPENMONTAGE_OUTPUT_KIND_MISMATCH');
    if (job.payload.mode === 'CINEMATIC' && (result.output !== 'CINEMATIC_COMPOSITE' || result.tracking?.status !== 'PASS')) throw new Error('OPENMONTAGE_CINEMATIC_TRACKING_FAILED');
    const video = result.video;
    input.signal?.throwIfAborted();
    if (video.width !== brief.background.width || video.height !== brief.background.height || video.frameRate !== brief.background.frameRate || Math.abs(video.durationSeconds - brief.background.durationSeconds) > 0.05) throw new Error('OPENMONTAGE_GENERATION_PROFILE_MISMATCH');
    if (video.bytes.length < 12 || video.bytes.length > 512 * 1024 * 1024) throw new Error('OPENMONTAGE_GENERATION_OUTPUT_INVALID');
    const sourceHash = sha(video.bytes);
    const extension = video.contentType === 'video/webm' ? 'webm' : 'mp4';
    const blobKey = `${job.tenant.organizationId}/derived/openmontage/${encodeURIComponent(job.jobId)}/preview.${extension}`;
    await input.storage.putObject({ blobKey, bytes: video.bytes, contentType: video.contentType });
    let narrationDetails: Record<string, unknown> | undefined;
    if (job.payload.narrationText && input.speech) {
      input.signal?.throwIfAborted();
      const narration = await input.speech.synthesize({ requestId: job.payload.generationId, text: job.payload.narrationText, voice: job.payload.narrationVoice ?? 'en-US-JennyNeural', locale: 'en-US' });
      const audioHash = createHash('sha256').update(narration.audio.bytes).digest('hex');
      input.signal?.throwIfAborted();
      const audioExtension = narration.audio.contentType === 'audio/wav' ? 'wav' : 'mp3';
      const audioBlobKey = `${job.tenant.organizationId}/derived/openmontage/${encodeURIComponent(job.jobId)}/narration.${audioExtension}`;
      await input.storage.putObject({ blobKey: audioBlobKey, bytes: narration.audio.bytes, contentType: narration.audio.contentType });
      narrationDetails = { blobKey: audioBlobKey, sha256: audioHash, byteLength: narration.audio.bytes.length, contentType: narration.audio.contentType, durationSeconds: narration.audio.durationSeconds, provider: narration.provider.name };
    }
    input.signal?.throwIfAborted();
    return input.jobStore.succeed(job.tenant, job.jobId, input.workerId, lease, { adapter: 'openmontage', adapterVersion: 'openmontage-generation.v1', status: 'REVIEW_REQUIRED', outputArtifactIds: [blobKey, ...(narrationDetails ? [String(narrationDetails.blobKey)] : [])], warnings: [{ code: 'OPENMONTAGE_REVIEW_REQUIRED', severity: 'warning', message: 'Generated background and narration are preview-only until rights, continuity, occlusion, model-match, and script review are complete.' }], metrics: { outputBytes: video.bytes.length, ...(narrationDetails ? { narrationBytes: Number(narrationDetails.byteLength) } : {}) }, details: { generationId: job.payload.generationId, sceneId: job.payload.sceneManifest.sceneId, mode: job.payload.mode, promptHash: job.payload.promptHash, modelVersionId: job.payload.sceneManifest.model.modelVersionId, modelSourceHash: job.payload.sceneManifest.model.sourceHash, sceneRevision: job.payload.sceneManifest.production?.sourceRevision, rightsEvidence: job.payload.brief.provenance.rightsReview, provider: result.provider, preview: { blobKey, sha256: sourceHash, byteLength: video.bytes.length, contentType: video.contentType, width: video.width, height: video.height, frameRate: video.frameRate, durationSeconds: video.durationSeconds }, ...(narrationDetails ? { narration: narrationDetails } : {}) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OPENMONTAGE_GENERATION_FAILED';
    const permanent = /^OPENMONTAGE_GENERATION_(?:PROFILE_MISMATCH|OUTPUT_INVALID)/.test(message) || ['OPENMONTAGE_PROVIDER_RESPONSE_INVALID', 'OPENMONTAGE_OUTPUT_KIND_MISMATCH', 'OPENMONTAGE_CINEMATIC_TRACKING_FAILED'].includes(message);
    return input.jobStore.fail(job.tenant, job.jobId, input.workerId, lease, { class: permanent ? 'VALIDATION' : 'RETRYABLE', code: message, message: permanent ? 'The generated background did not satisfy the locked scene contract.' : 'The background provider or storage was temporarily unavailable.', ...(permanent ? {} : { retryAfterSeconds: 30 }) });
  }
}
