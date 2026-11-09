/** Shared pilot limits. Admission and provider adapters must use the same bounds. */
export const technicalLimits = Object.freeze({
  maxAiTokensPerRun: 4_000,
  maxConcurrentJobs: 4,
  monthlyBudgetUsd: 500,
  alertThresholdPercent: 80,
  sourceRetentionDays: 365,
  maxProviderBytes: 128 * 1024 * 1024,
  providerTimeoutMs: 120_000
});

export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

export function boundedInteger(value: string | undefined, fallback: number, maximum: number, key: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`CONFIGURATION_INVALID:${key}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`CONFIGURATION_INVALID:${key}`);
  return parsed;
}

export function readTechnicalLimits(env: DeploymentEnvironment) {
  return {
    ...technicalLimits,
    maxAiTokensPerRun: boundedInteger(env.AI_MAX_OUTPUT_TOKENS, technicalLimits.maxAiTokensPerRun, technicalLimits.maxAiTokensPerRun, 'AI_MAX_OUTPUT_TOKENS'),
    maxConcurrentJobs: boundedInteger(env.WORKER_MAX_CONCURRENT_CALLS, technicalLimits.maxConcurrentJobs, technicalLimits.maxConcurrentJobs, 'WORKER_MAX_CONCURRENT_CALLS'),
    maxProviderBytes: boundedInteger(env.PROVIDER_MAX_BYTES, technicalLimits.maxProviderBytes, technicalLimits.maxProviderBytes, 'PROVIDER_MAX_BYTES'),
    providerTimeoutMs: boundedInteger(env.PROVIDER_TIMEOUT_MS, technicalLimits.providerTimeoutMs, technicalLimits.providerTimeoutMs, 'PROVIDER_TIMEOUT_MS')
  };
}

/** Validate before opening connections. Errors name configuration keys, never values. */
export function assertProductionConfiguration(service: 'api' | 'worker', env: DeploymentEnvironment): void {
  readTechnicalLimits(env);
  const environment = env.APP_ENV?.trim().toLowerCase();
  if (env.NODE_ENV === 'production' && environment !== 'production' && environment !== 'staging') {
    throw new Error('PRODUCTION_CONFIGURATION_INVALID:APP_ENV');
  }
  if (environment !== 'production' && environment !== 'staging') return;
  const required = (key: string) => {
    if (!env[key]?.trim()) throw new Error(`PRODUCTION_CONFIGURATION_REQUIRED:${key}`);
  };
  const exact = (key: string, value: string) => {
    if (env[key]?.trim() !== value) throw new Error(`PRODUCTION_CONFIGURATION_INVALID:${key}`);
  };
  const https = (key: string) => {
    required(key);
    try {
      const url = new URL(env[key]!);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error();
    } catch { throw new Error(`PRODUCTION_CONFIGURATION_INVALID:${key}`); }
  };
  exact('AUDIT_LOGGING_ENABLED', 'true');
  required('OPERATIONAL_KEY_SECRET');
  if(new TextEncoder().encode(env.OPERATIONAL_KEY_SECRET!).byteLength<32)throw new Error('PRODUCTION_CONFIGURATION_INVALID:OPERATIONAL_KEY_SECRET');
  https('STORAGE_ACCOUNT_URL');
  exact('RETRIEVAL_MODE','hybrid');
  https('AZURE_EMBEDDING_ENDPOINT');
  for(const key of ['AZURE_EMBEDDING_API_KEY','AZURE_EMBEDDING_DEPLOYMENT','AZURE_EMBEDDING_MODEL'])required(key);
  if (env.AZURE_STORAGE_CONNECTION_STRING?.trim()) throw new Error('PRODUCTION_CONFIGURATION_INVALID:AZURE_STORAGE_CONNECTION_STRING');
  for (const key of ['CORS_ALLOWED_ORIGINS', 'ALLOWED_ORIGINS']) {
    if (env[key]?.split(',').some(value => value.trim() === '*')) throw new Error(`PRODUCTION_CONFIGURATION_INVALID:${key}`);
  }
  if (service === 'api') {
    exact('AI_PROVIDER_MODE', 'azure-openai');
    for (const key of ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_MODEL', 'AZURE_OPENAI_API_VERSION']) required(key);
    https('AZURE_OPENAI_ENDPOINT');
    const endpoint = new URL(env.AZURE_OPENAI_ENDPOINT!);
    if (!endpoint.hostname.endsWith('.openai.azure.com') || endpoint.pathname !== '/') throw new Error('PRODUCTION_CONFIGURATION_INVALID:AZURE_OPENAI_ENDPOINT');
  } else {
    exact('ASSET_SCANNER_MODE', 'clamav');
    required('CLAMAV_HOST');
    exact('OPENMONTAGE_PROVIDER_MODE', 'http');
    https('OPENMONTAGE_PROVIDER_URL');
    exact('AZURE_SPEECH_MODE', 'http');
    https('AZURE_SPEECH_ENDPOINT');
    required('AZURE_SPEECH_API_KEY');
  }
}
