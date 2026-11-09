# Identity and provider trust operations

The independent email-possession protocol supplements signed identity claims. It does not create or change an Entra token. All challenge endpoints require a validated issuer, identity tenant, and subject. Signed `email_verified: true` retains precedence; the server assurance is used only when signed verification is absent.

## Email protocol

1. Start accepts an email address and delivers a random six-digit code through the configured sender. The API returns a random challenge ID and 600-second lifetime, never the code.
2. Completion binds the ID and code to the authenticated identity tuple. PostgreSQL locks the challenge row, counts failed attempts, and atomically consumes it. Five failed guesses, expiry, replay, or the wrong identity fail without revealing account existence.
3. The server stores a 24-hour possession assurance. Request enrichment requires an unexpired validated access token and caps effective verification at that token's expiry. Revocation deletes assurance and consumes outstanding challenges.

Challenge hashes use HMAC-SHA256 with a dedicated secret of at least 32 bytes. Rotate that secret to invalidate outstanding codes; completed assurances expire independently or can be explicitly revoked. Codes, email addresses, tokens, and HMAC secrets must not appear in telemetry. Resends are limited to one per minute and five per hour for each identity, plus five per hour per recipient across identities; generic API admission remains required.

The challenge and assurance tables are private. Grant the API role only execution of the specific security-definer functions; never grant public table access. The functions pin their search path to `pg_catalog`. Restricted runtime PostgreSQL and real Entra/ACS acceptance must be exercised before deployment.

## Malware scanning

Set `ASSET_SCANNER_MODE=clamav`, `CLAMAV_HOST`, and optionally `CLAMAV_PORT` (3310), `CLAMAV_TIMEOUT_MS` (30000). Keep clamd on a private, authenticated network segment; its TCP protocol does not provide application authentication. Operate a maintained signature-update service and monitor freshness, scanner availability, and quarantine rates. Set clamd StreamMaxLength at or above the application byte bound and enforce container CPU/memory limits.

The adapter reads bounded bytes, checks the queued SHA-256, size, MIME and basic signature, then submits those bytes via clamd INSTREAM. Only the exact `stream: OK` verdict returns CLEAN. Outages, timeouts, malformed/error verdicts and changed content quarantine. Deterministic scanning is limited to development/test. Tenant authority remains in the signed queue envelope and asset lifecycle lookup; downstream processors also validate source hashes before parsing.

A protocol simulator test proves the adapter behavior; it does not prove current real ClamAV signatures or cloud network isolation. Run the real scanning integration with approved safe-malicious fixtures before go-live.

## Provider egress

Configure an HTTPS `OPENMONTAGE_PROVIDER_URL`. Poll URLs must use exactly that origin. Video downloads may additionally use explicit HTTPS origins in `OPENMONTAGE_VIDEO_ORIGINS` (comma-separated). Additional download origins never receive provider authorization credentials. Redirects, credentials in URLs, fragments, private/reserved IP addresses and DNS answers containing any unsafe address are rejected. The HTTPS socket pins a checked DNS address while preserving TLS hostname verification.

`PROVIDER_MAX_BYTES` and `PROVIDER_TIMEOUT_MS` can reduce the shared pilot bounds. JSON, decoded base64 and streamed video all have byte limits; DNS and HTTPS requests have deadlines. Do not configure wildcard origins or use an untrusted shared provider origin. These controls intentionally reject localhost HTTP provider simulators. Transport tests use controlled HTTPS/DNS substitutes, with full provider boundary checks separately from real external acceptance.

## Focused verification

After building contracts, database, API and worker, run:

- `node tools/check-email-verification-challenge.mjs`
- `node tools/check-email-verification-service.mjs`
- `node tools/check-production-asset-scanner.mjs`
- `node tools/check-provider-egress.mjs`
- `node tools/check-provider-egress-transport.mjs`
- `node tools/check-openmontage-egress.mjs`
- `node tools/check-entra-authenticator.mjs`
- `node tools/check-openmontage-generation.mjs`

The email checks use the local development PostgreSQL database unless `TEST_DATABASE_URL` selects an isolated test database. They install the email challenge migration and remove their fixture records. Never target a live production database with test scripts.
