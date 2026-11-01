import { createPublicKey, verify } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AuthenticatedPrincipal, RequestAuthenticator } from "./job-status-http.js";

interface OpenIdConfiguration {
  issuer: string;
  jwks_uri: string;
}

interface JsonWebKeyRecord {
  kid: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

interface JsonWebTokenHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JsonWebTokenClaims {
  iss?: unknown;
  aud?: unknown;
  tid?: unknown;
  sub?: unknown;
  oid?: unknown;
  exp?: unknown;
  nbf?: unknown;
  [claim: string]: unknown;
}

export interface EntraAuthenticatorOptions {
  tenantId: string;
  audience: string;
  openIdConfigurationUrl: string;
  issuer?: string;
  organizationClaim?: string;
  rolesClaim?: string;
  clockSkewSeconds?: number;
  fetchImpl?: typeof fetch;
}

const maxDiscoveryBytes = 64 * 1024;
const maxJwksBytes = 512 * 1024;

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJsonSegment<T>(value: string): T {
  if (!value || value.length > maxDiscoveryBytes) throw new Error("JWT_SEGMENT_INVALID");
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
  } catch {
    throw new Error("JWT_SEGMENT_INVALID");
  }
}

async function readJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) throw new Error("ENTRA_METADATA_UNAVAILABLE");
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("ENTRA_METADATA_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) throw new Error("ENTRA_METADATA_TOO_LARGE");
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function bearerToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 && token.length <= 16_384 ? token : null;
}

function stringClaim(claims: JsonWebTokenClaims, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayClaim(claims: JsonWebTokenClaims, name: string): string[] {
  const value = claims[name];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function audienceMatches(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function configurationShape(value: unknown): OpenIdConfiguration {
  if (!value || typeof value !== "object") throw new Error("ENTRA_METADATA_INVALID");
  const candidate = value as Partial<OpenIdConfiguration>;
  if (typeof candidate.issuer !== "string" || typeof candidate.jwks_uri !== "string") throw new Error("ENTRA_METADATA_INVALID");
  return { issuer: candidate.issuer, jwks_uri: candidate.jwks_uri };
}

function keyShape(value: unknown): JsonWebKeyRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<JsonWebKeyRecord>;
  if (typeof candidate.kid !== "string" || candidate.kty !== "RSA" || typeof candidate.n !== "string" || typeof candidate.e !== "string") return null;
  return candidate as JsonWebKeyRecord;
}

function jwksShape(value: unknown): JsonWebKeyRecord[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { keys?: unknown }).keys)) throw new Error("ENTRA_JWKS_INVALID");
  return (value as { keys: unknown[] }).keys.map(keyShape).filter((key): key is JsonWebKeyRecord => key !== null);
}

export function createEntraRequestAuthenticator(options: EntraAuthenticatorOptions): RequestAuthenticator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const organizationClaim = options.organizationClaim ?? "organization_id";
  const rolesClaim = options.rolesClaim ?? "roles";
  const clockSkewSeconds = options.clockSkewSeconds ?? 120;
  let configurationPromise: Promise<OpenIdConfiguration> | undefined;
  let jwksCache: { expiresAt: number; keys: JsonWebKeyRecord[] } | undefined;

  const discover = async (): Promise<OpenIdConfiguration> => {
    configurationPromise ??= fetchImpl(options.openIdConfigurationUrl, { headers: { accept: "application/json" } })
      .then((response) => readJsonResponse(response, maxDiscoveryBytes))
      .then(configurationShape)
      .catch((error) => {
        configurationPromise = undefined;
        throw error;
      });
    return configurationPromise;
  };

  const loadKeys = async (configuration: OpenIdConfiguration, forceRefresh = false): Promise<JsonWebKeyRecord[]> => {
    if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
    const response = await fetchImpl(configuration.jwks_uri, { headers: { accept: "application/json" } });
    const keys = jwksShape(await readJsonResponse(response, maxJwksBytes));
    if (keys.length === 0) throw new Error("ENTRA_JWKS_EMPTY");
    jwksCache = { keys, expiresAt: Date.now() + 15 * 60 * 1000 };
    return keys;
  };

  return {
    async authenticate(request) {
      try {
        const token = bearerToken(request);
        if (!token) return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const [encodedHeader, encodedClaims, encodedSignature] = parts;
        const header = parseJsonSegment<JsonWebTokenHeader>(encodedHeader);
        const claims = parseJsonSegment<JsonWebTokenClaims>(encodedClaims);
        if (header.alg !== "RS256" || !header.kid) return null;
        const configuration = await discover();
        const expectedIssuer = options.issuer ?? configuration.issuer;
        if (claims.iss !== expectedIssuer || !audienceMatches(claims.aud, options.audience)) return null;
        if (claims.tid !== options.tenantId) return null;
        const now = Math.floor(Date.now() / 1000);
        if (typeof claims.exp !== "number" || claims.exp <= now - clockSkewSeconds) return null;
        if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + clockSkewSeconds)) return null;
        const subject = stringClaim(claims, "oid") ?? stringClaim(claims, "sub");
        const organizationId = stringClaim(claims, organizationClaim) ?? undefined;
        if (!subject) return null;
        let keys = await loadKeys(configuration);
        let key = keys.find((candidate) => candidate.kid === header.kid);
        if (!key) {
          keys = await loadKeys(configuration, true);
          key = keys.find((candidate) => candidate.kid === header.kid);
        }
        if (!key?.n || !key.e) return null;
        const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
        const valid = verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedClaims}`), publicKey, decodeBase64Url(encodedSignature));
        if (!valid) return null;
        // A login name, email address, or string "true" alone is not verification.
        const email=stringClaim(claims,'email')?.trim().toLowerCase();
        const verifiedEmail=claims.email_verified===true&&email&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:undefined;
        return {
          subject,
          issuer:expectedIssuer,
          identityTenant:options.tenantId,
          ...(verifiedEmail?{verifiedEmail}:{}),
          ...(verifiedEmail?{verificationExpiresAt:new Date(claims.exp*1000).toISOString()}:{}),
          ...(organizationId ? { organizationId } : {}),
          roles: stringArrayClaim(claims, rolesClaim)
        };
      } catch {
        return null;
      }
    }
  };
}
