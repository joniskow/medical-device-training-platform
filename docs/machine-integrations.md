# Organization machine integrations

Organization integrations use Entra OAuth2 client credentials. A machine access token is a separate principal type; it cannot create a personal account, attest an email, enroll, take assessments, author courses, issue credentials, administer memberships, or access ordinary organization APIs. Machines use only the explicit external route allowlist below. Human account and verification requirements are unchanged.

Public health, documentation, verification and static endpoints retain their anonymous semantics. Supplying a machine bearer token does not grant additional access to those public resources. Authenticated routes outside the integration allowlist return 403 for machine principals; unknown paths return 404.

Microsoft documents application permissions in `roles`, the v2 client application in `azp`, and app-only identity classification through the optional `idtyp` claim. Delegated tokens can also carry `roles`, so roles alone never identify a machine. Configure the API registration to emit `idtyp` for access tokens and require assignments. See [access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference), [application versus delegated permissions](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/application-delegated-permission-access-tokens-identity-platform), and [client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow).

## Provisioning and authorization

1. Register the customer application/service principal in the approved Entra tenant. Assign only required API application roles. Prefer certificates or federated credentials over shared secrets. Customer credentials/private keys remain in the customer/Entra credential infrastructure; this application never collects or stores them. See [certificate credentials](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials).
2. A signed-in human organization administrator posts to `/api/v1/integration-clients`, with the normal `X-Organization-Id` and `Idempotency-Key` headers. Supply the exact trusted issuer, Entra tenant GUID, application client GUID, service-principal GUID, scopes, `enabled: true`, and `revision: 0`. List bindings with GET on the same path. Update/revoke with PUT to `/api/v1/integration-clients/{integrationId}`, current revision and a new idempotency key. Preserve each write key on retry.
3. The returned integration UUID is the external tenant binding. Request the API resource's `/.default` application permissions through the tenant-specific Entra token endpoint using `grant_type=client_credentials`.
4. Send the resulting API access token to `/api/v1/integration/{integrationId}/...`. Do not send `X-Organization-Id`: tenant scope comes from the provisioned binding, and attempted header overrides are rejected.

The server validates token signature, audience, issuer, tenant and expiry. App tokens additionally require `idtyp: app`, no delegated `scp`, GUID client/service-principal claims and a signed issue time. Missing/ambiguous app classification fails closed. Any email or human-role claims on an app token are ignored.

Every call rechecks the exact binding tuple, active integration, active organization, active dedicated service membership, minimum token issue time, configured integration scope and the corresponding signed application role. There is no positive authorization cache. A human cannot use machine tokens to manage bindings; a client cannot register itself.

| Integration scope | Required Entra application role |
|---|---|
| `reports:read` | `Training.Reports.Read` |
| `exports:read` | `Training.Exports.Read` |
| `exports:write` | `Training.Exports.Write` |
| `webhooks:read` | `Training.Webhooks.Read` |
| `webhooks:write` | `Training.Webhooks.Write` |

## External API allowlist

| Method | Path suffix after `/api/v1/integration/{integrationId}` | Scope |
|---|---|---|
| GET | `/reports/summary` | `reports:read` |
| GET | `/reports/credentials`, `/reports/usage` | `reports:read` |
| POST | `/exports` | `exports:write` |
| GET | `/exports/{exportId}`, `/exports/{exportId}/content` | `exports:read` |
| GET | `/webhooks` | `webhooks:read` |
| POST | `/webhooks` | `webhooks:write` |
| PUT | `/webhooks/{subscriptionId}` | `webhooks:write` |

Reports use bounded pages. Pass the returned opaque `nextCursor` as `after`. Export creation accepts JSON summary or credential-register output; CSV and internal evidence-lineage exports are not machine capabilities. Export reads remain requester-bound and recheck the integration on every request. Projected JSON content does not advertise the underlying internal artifact's checksum.

Resource IDs and pagination cursors are persistent random UUID references scoped to the integration. The same internal resource has different references in different integrations. Organization IDs, actor IDs, blob keys, private URLs, answer keys and source prose are excluded. References cannot resolve outside their integration/organization. Entra client/service-principal GUIDs are visible only in human administrator configuration responses, not ordinary external reports.

Machine-created webhook subscriptions are atomically bound to the integration. A client can list/change only its own subscriptions. Event payload identifiers and event/delivery headers are translated before JSON serialization and HMAC signing. Stable aliases preserve deduplication across retries. The signing `keyId` is a public key-version label and is intentionally preserved; the generated webhook HMAC secret is returned only on create/key rotation and must be stored securely by the receiver. It is independent of Entra client credentials.

## Revocation and rotation

- PUT `enabled: false` with the current revision to revoke the binding. Subsequent API calls fail; dedicated membership is suspended and bound webhooks are disabled. Removing `webhooks:write` also disables bound subscriptions.
- Rotate or replace customer certificates/federated credentials in Entra first. Advance `validAfter` to a UTC issue-time cutoff to reject already-issued older tokens at the application boundary. The cutoff cannot move backward. Obtain a fresh token issued at or after the cutoff and prove access; prove an older token is denied. Entra issue times have one-second precision, so choose a whole-second cutoff.
- The API does not generate replacement client secrets or claim that local configuration rotates Entra credentials. Certificate lifecycle and tenant consent remain Entra administrative responsibilities.

## Database boundary

Bindings and alias tables use tenant RLS. Production runtime roles must be `NOBYPASSRLS` and must not own these tables. The mapping owner can resolve a global external integration UUID through the narrowly granted `authorize_machine_integration` security-definer function; these control-plane tables intentionally use ENABLE RLS without FORCE so that owner-only resolver can establish tenant scope. It returns no binding for a mismatched issuer/tenant/client/service principal/scope.

A separate `sync_machine_integration_actor` security-definer function verifies an existing active human tenant administrator and manages only the exact `service-integration:{mappingUUID}` actor and fixed downstream administrative role. The runtime receives no general membership-write permission. Real Entra user object GUIDs cannot collide with this reserved service actor namespace. Ordinary routes reject machine principals before personal-account/verification or human-role handling.

## Verification and external acceptance

`node tools/check-machine-integrations.mjs` creates an isolated restricted database role that cannot insert memberships, and exercises real PostgreSQL operations and HTTP with controlled RSA-signed tokens: human provisioning/replay, app/user separation, tenant/client/role denial, external aliases, requester-bound exports, real webhook worker projection/signing, rotation and revocation. Run after building contracts, database, API and worker. The fixture removes its role and tenant records.

Controlled signed tokens prove implementation behavior, not real Entra registration or consent. Before launch, configure the actual application roles and optional claim, obtain a genuine certificate/federated client-credentials token, verify the allowed call and wrong-scope/wrong-tenant/revoked/rotated denials, and retain deployment evidence. No live cloud identity success is inferred from the local suite.
