import createClient from 'openapi-fetch';
import type { paths, components } from './schema.js';
export type { paths, components } from './schema.js';
export type ModelSession = components['schemas']['ModelSession'];
export type ModelState = components['schemas']['ModelState'];
export type ModelAction = components['schemas']['ModelAction'];
export type ModelActionResult = components['schemas']['ModelActionResult'];
export type ModelDebrief = components['schemas']['ModelDebrief'];
export type ModelAsset = components['schemas']['ModelAsset'];

export class TrainingApiError extends Error {
  readonly name = 'TrainingApiError';
  constructor(readonly status: number, readonly code: string, message: string,
    readonly correlationId?: string, readonly retryAfterSeconds?: number) { super(message); }
  get retryable() { return this.status === 0 || this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504; }
}

export interface TrainingClientOptions {
  /** Origin only, e.g. https://training.example.com. Defaults to the browser's origin. */
  baseUrl?: string;
  getAccessToken(): string | undefined | Promise<string | undefined>;
  /** Identity stays stable across token renewal, but changes on account/organization switch or sign-out. */
  getContext(): { identity: string; organizationId?: string };
  fetch?: typeof fetch;
}

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

export function createTrainingClient(options: TrainingClientOptions) {
  const origin = new URL(options.baseUrl ?? globalThis.location?.origin);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))) throw new Error('API baseUrl must be an HTTPS origin or HTTP loopback origin.');
  if (globalThis.location && origin.origin !== location.origin) throw new Error('Use the same-origin hosted /api/v1 API.');
  const contextKey = () => JSON.stringify(options.getContext());
  const changed = () => new TrainingApiError(409, 'SESSION_CONTEXT_CHANGED', 'Your account or organization changed. Reload before continuing.');
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== origin.origin || !url.pathname.startsWith('/api/v1/') || url.username || url.password) throw new TrainingApiError(400, 'API_DESTINATION_DENIED', 'The API destination is not allowed.');
    const identity = contextKey(), context = options.getContext();
    const headers = new Headers(request.headers);
    if (url.pathname !== '/api/v1/auth/config') {
      let token: string | undefined;
      try { token = await options.getAccessToken(); }
      catch { throw new TrainingApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in again to continue.'); }
      if (identity !== contextKey()) throw changed();
      if (!token) throw new TrainingApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      headers.set('authorization', `Bearer ${token}`);
      if (context.organizationId) headers.set('x-organization-id', context.organizationId);
      else headers.delete('x-organization-id');
    } else { headers.delete('authorization'); headers.delete('x-organization-id'); }
    let response: Response;
    try { response = await (options.fetch ?? fetch)(new Request(request, { headers, credentials: 'omit', redirect: 'error', cache: 'no-store' })); }
    catch (error) {
      if (request.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      throw new TrainingApiError(0, 'NETWORK_ERROR', 'The response was interrupted. Resume or retry the same intent.');
    }
    if (identity !== contextKey()) throw changed();
    return response;
  };
  const api = createClient<paths>({ baseUrl: origin.origin, fetch: transport });
  const organization = () => ({ 'X-Organization-Id': options.getContext().organizationId ?? '' });
  async function read<T>(run: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
    const identity = contextKey();
    let result: { data?: T; error?: unknown; response: Response };
    try { result = await run(); }
    catch (error) {
      if (identity !== contextKey()) throw changed();
      if (error instanceof SyntaxError) throw new TrainingApiError(502, 'INVALID_API_RESPONSE', 'The API returned an unreadable response.');
      throw error;
    }
    const { data, error, response } = result;
    if (identity !== contextKey()) throw changed();
    if (!response.ok) {
      const failure = error && typeof error === 'object' && 'error' in error ? error.error : undefined;
      const fields = failure && typeof failure === 'object' ? failure as Record<string, unknown> : {};
      throw new TrainingApiError(response.status, typeof fields.code === 'string' ? fields.code : `HTTP_${response.status}`,
        typeof fields.message === 'string' ? fields.message : 'The request could not be completed.', response.headers.get('x-correlation-id') ?? undefined, retryAfter(response.headers.get('retry-after')));
    }
    if (data === undefined) throw new TrainingApiError(502, 'INVALID_API_RESPONSE', 'The API returned an empty response.');
    return data;
  }
  return {
    getAuthConfig: (signal?: AbortSignal) => read(() => api.GET('/api/v1/auth/config', { signal })),
    getAccount: (signal?: AbortSignal) => read(() => api.GET('/api/v1/account', { signal })),
    listOrganizations: (signal?: AbortSignal) => read(() => api.GET('/api/v1/organization-contexts', { signal })),
    selectOrganization: (organizationId: string, idempotencyKey: string, signal?: AbortSignal) => read(() => api.POST('/api/v1/organization-contexts/{organizationId}/select', { params: { path: { organizationId }, header: { 'Idempotency-Key': idempotencyKey } }, body: {}, signal })),
    listEnrollments: (after?: string, signal?: AbortSignal) => read(() => api.GET('/api/v1/enrollments', { params: { header: organization(), query: { after } }, signal })),
    getEnrollment: (enrollmentId: string, signal?: AbortSignal) => read(() => api.GET('/api/v1/enrollments/{enrollmentId}', { params: { header: organization(), path: { enrollmentId } }, signal })),
    startActivity: (enrollmentId: string, activityId: string, signal?: AbortSignal) => read(() => api.POST('/api/v1/enrollments/{enrollmentId}/activities/{activityId}/start', { params: { header: organization(), path: { enrollmentId, activityId } }, body: {}, signal })),
    async getModelAsset(releaseId: string, modelVersionId: string, signal?: AbortSignal): Promise<ModelAsset> {
      const value = await read(() => api.GET('/api/v1/releases/{releaseId}/model-assets/{modelVersionId}', { params: { header: organization(), path: { releaseId, modelVersionId } }, signal }));
      if (!value || typeof value !== 'object' || !['releaseId','releaseHash','modelVersionId','releaseBindingId','variantId','manifestHash','manifestUrl','modelUrl','cacheControl'].every(key => typeof (value as Record<string, unknown>)[key] === 'string') || !('fallbackManifest' in value) || !value.fallbackManifest || typeof value.fallbackManifest !== 'object') throw new TrainingApiError(502, 'INVALID_MODEL_DESCRIPTOR', 'The approved model descriptor is invalid.');
      return value as ModelAsset;
    },
    submitAction: (sessionId: string, action: ModelAction, signal?: AbortSignal) => read(() => api.POST('/api/v1/model-sessions/{sessionId}/actions', { params: { header: { ...organization(), 'Idempotency-Key': action.clientActionId }, path: { sessionId } }, body: action, signal })),
    resume: (session: Pick<ModelSession, 'sessionId' | 'releaseBindingId' | 'modelVersionId'>, nextSequence: number, signal?: AbortSignal) => read(() => api.GET('/api/v1/model-sessions/{sessionId}', { params: { header: organization(), path: { sessionId: session.sessionId }, query: { releaseBindingId: session.releaseBindingId, modelVersionId: session.modelVersionId, nextSequence } }, signal })),
    getDebrief: (sessionId: string, signal?: AbortSignal) => read(() => api.GET('/api/v1/model-sessions/{sessionId}/debrief', { params: { header: organization(), path: { sessionId } }, signal }))
  };
}

export type TrainingClient = ReturnType<typeof createTrainingClient>;
/** Save this object until the intent receives a definitive response; never regenerate it on a transport retry. */
export function prepareModelAction(session: Pick<ModelSession, 'releaseBindingId' | 'modelVersionId'>, state: Pick<ModelState, 'nextSequence'>,
  action: Omit<ModelAction, 'clientActionId' | 'expectedSequence' | 'releaseBindingId' | 'modelVersionId'>): ModelAction {
  return { ...action, clientActionId: crypto.randomUUID(), expectedSequence: state.nextSequence, releaseBindingId: session.releaseBindingId, modelVersionId: session.modelVersionId };
}
