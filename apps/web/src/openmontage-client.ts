import type { OpenMontageRenderArtifact, OpenMontageSceneBrief, TrainingSceneManifest } from '@medical-device/contracts';

export interface OpenMontageBriefResponse { briefId: string; brief: OpenMontageSceneBrief; }
export interface OpenMontageArtifactResponse { artifactId: string; artifact: OpenMontageRenderArtifact; }
export interface OpenMontageApprovalResponse extends OpenMontageArtifactResponse { sceneManifest: TrainingSceneManifest; }
export interface OpenMontageSceneResponse { sceneManifest: TrainingSceneManifest; videoUrl: string; }

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.code || `OPENMONTAGE_HTTP_${response.status}`);
  return body as T;
}

function endpoint(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`;
}

export function createOpenMontageSceneBrief(apiBaseUrl: string, sceneManifest: TrainingSceneManifest, prompt: string, idempotencyKey: string): Promise<OpenMontageBriefResponse> {
  return fetch(endpoint(apiBaseUrl, '/api/v1/openmontage/briefs'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ sceneManifest, prompt })
  }).then(json<OpenMontageBriefResponse>);
}

export function ingestOpenMontageRender(apiBaseUrl: string, input: { sceneId: string; briefId: string; video: OpenMontageRenderArtifact['video']; idempotencyKey: string }): Promise<OpenMontageArtifactResponse> {
  return fetch(endpoint(apiBaseUrl, '/api/v1/openmontage/artifacts'), {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey },
    body: JSON.stringify({ sceneId: input.sceneId, briefId: input.briefId, video: input.video })
  }).then(json<OpenMontageArtifactResponse>);
}

export function approveOpenMontageRender(apiBaseUrl: string, artifactId: string, reviewRef: string, idempotencyKey: string, reviewerId?: string): Promise<OpenMontageApprovalResponse> {
  return fetch(endpoint(apiBaseUrl, `/api/v1/openmontage/artifacts/${encodeURIComponent(artifactId)}/approve`), {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ reviewRef, ...(reviewerId ? { reviewerId } : {}) })
  }).then(json<OpenMontageApprovalResponse>);
}

export function loadApprovedOpenMontageScene(apiBaseUrl: string, sceneId: string): Promise<OpenMontageSceneResponse> {
  return fetch(endpoint(apiBaseUrl, `/api/v1/openmontage/scenes/${encodeURIComponent(sceneId)}`), { cache: 'no-store' }).then(json<OpenMontageSceneResponse>);
}

export function openMontageVideoUrl(apiBaseUrl: string, sceneId: string): string {
  return endpoint(apiBaseUrl, `/api/v1/openmontage/scenes/${encodeURIComponent(sceneId)}/video`);
}
