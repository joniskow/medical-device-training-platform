/** Public registration metadata only. Never project environment variables wholesale. */
export interface BrowserAuthConfig {
  clientId: string;
  tenantId: string;
  authority: string;
  apiScope: string;
  applicationOrigin: string;
  knownAuthorities: string[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readBrowserAuthConfig(env: Record<string, string | undefined>): BrowserAuthConfig | undefined {
  const enabled = env.BROWSER_AUTH_ENABLED?.trim();
  if (!enabled || enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error('BROWSER_AUTH_ENABLED must be true or false.');
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`${key} is required for browser authentication.`);
    return value;
  };
  const tenantId = required('ENTRA_TENANT_ID').toLowerCase();
  const clientId = required('BROWSER_AUTH_CLIENT_ID').toLowerCase();
  if (!uuid.test(tenantId) || !uuid.test(clientId)) throw new Error('Browser authentication requires tenant and client UUIDs.');
  let authority: URL;
  let application: URL;
  try {
    authority = new URL(required('BROWSER_AUTH_AUTHORITY'));
    application = new URL(required('APPLICATION_ORIGIN'));
  } catch { throw new Error('Browser authentication URLs are invalid.'); }
  const external = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ciamlogin\.com$/.test(authority.hostname);
  if (authority.protocol !== 'https:' || authority.port || authority.username || authority.password || authority.search || authority.hash ||
      (authority.hostname !== 'login.microsoftonline.com' && !external) ||
      authority.pathname.replace(/\/$/, '').toLowerCase() !== `/${tenantId}`) {
    throw new Error('Browser authority must use the configured tenant UUID on Microsoft login or a CIAM host.');
  }
  const local = application.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(application.hostname);
  if ((!local && application.protocol !== 'https:') || application.username || application.password || application.search || application.hash || application.pathname !== '/') {
    throw new Error('APPLICATION_ORIGIN must be an HTTPS origin (HTTP loopback is allowed for local development).');
  }
  const apiScope = required('BROWSER_AUTH_API_SCOPE');
  if (!/^api:\/\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(apiScope) || !uuid.test(apiScope.split('/')[2] ?? '')) {
    throw new Error('BROWSER_AUTH_API_SCOPE must be one explicit api://application-UUID/scope.');
  }
  return {
    clientId, tenantId, authority: `${authority.origin}/${tenantId}`, apiScope,
    applicationOrigin: application.origin,
    knownAuthorities: external ? [...new Set([authority.hostname, `${tenantId}.ciamlogin.com`])] : [authority.hostname]
  };
}
