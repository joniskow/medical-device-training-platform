# Course review and immutable release slice

This slice implements the first review-to-release vertical path from E5/E6.

## API contract

All routes require an authenticated Entra principal and exactly one active organization membership resolved server-side.

### Load review state

`GET /api/v1/course-versions/:courseVersionId`

Returns the tenant-scoped course version, its draft content, review decision history, and any published release.

### Record a review decision

`POST /api/v1/course-versions/:courseVersionId`

Requires the `reviewer`, `organization_admin`, or `operator` role and an `Idempotency-Key` header.

```json
{
  "targetType": "AI_DRAFT",
  "targetId": "ai:...",
  "decision": "APPROVE",
  "rationale": "Reviewed against the approved source.",
  "revision": 1
}
```

Supported target types are `COURSE`, `AI_DRAFT`, `SOURCE`, `MODEL`, `SIMULATION`, `ASSESSMENT`, and `POLICY`. Decisions are `APPROVE`, `REJECT`, or `NEEDS_CHANGES`.

### Publish a release

`POST /api/v1/course-versions/:courseVersionId/publish`

Requires the `publisher`, `organization_admin`, or `operator` role and an `Idempotency-Key` header. The course version must be in review, have an approved current AI draft and course decision, have reviewer/publisher separation, and reference approved source asset versions.

The transaction creates one `release_manifests` record, marks the course version published, activates the course, writes one `course.release.published` outbox event, and records audit evidence. The manifest contains the course content, source asset IDs and SHA-256 hashes, AI deployment metadata, and review decisions. Its canonical JSON is SHA-256 hashed and the release row is immutable by the draft APIs.

## Current boundary

This is the first E5/E6 slice, not the complete authoring epic. It does not yet include the full no-code module/activity editor, deterministic simulation validation for every authoring path, policy validation, preview path coverage, or release retirement/supersession. The model-release path now materializes hash-verified release-owned model/variant and immutable release-manifest artifacts, but the broader E6 artifact graph and pilot acceptance remain explicit backlog work and are not represented as complete by this slice.

## Verification

- `pnpm typecheck`
- `pnpm architecture:test`
- `pnpm --filter @medical-device/web build`
- `pnpm course-review-http:validate`
- `pnpm course-review:validate` when local PostgreSQL is running on `127.0.0.1:54329`

## Azure verification

The first E5/E6 review-to-release slice is deployed to the canonical personal Azure environment documented in `infra/azure/README.md`.

- API image: `mdtpersonalacr01.azurecr.io/api:personal-20261023-review1`, digest `sha256:238587d6be0d97b381786ea9f21ca1ab6e35eda3a0762e3396796b1b2b88e5f0`, revision `mdt-personal-api--review1`.
- Worker image: `mdtpersonalacr01.azurecr.io/worker:personal-20261023-review1`, digest `sha256:3ebd88b015579bea96b1ad26a23ff8d2a389552cf4ebda49dd9d978f1ab20f20`, revision `mdt-personal-worker--review1`.
- `/healthz` returned `200`; the protected review route returned `401` without a token.
- Browser OAuth succeeded for the pilot identity, and the live review page loaded a tenant-scoped draft.
- A synthetic `org_fixture` course version completed two-party review evidence and published an immutable release: `release:6fd42f33-005e-463e-bddd-d81a96b513b0`, status `PUBLISHED`, release hash `c5f48105357ace77188f1bde110de9af828959dc718425aed1555468e49e26d3`.
- The release manifest included the AI run, approved source-artifact SHA-256, review decisions, course version, and outbox-backed publication event.

The verification fixture is isolated under `org_fixture` and uses synthetic IDs only; it is not production course content.
