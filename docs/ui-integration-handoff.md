# Backend integration handoff

This handoff defines the backend boundary for a later UI. It does not establish hosted acceptance or launch approval. Use the generated [OpenAPI document](../packages/api-client/openapi.json) and [typed client](../packages/api-client/src/index.ts), extended by [technical route contracts](../packages/contracts/src/technical-openapi.ts). Run `node tools/check-technical-acceptance-contracts.mjs` after building contracts and regenerating the client. Contract drift fails this check.

## Start and authenticate

Create the disposable restricted-role environment using [local test instructions](local-test-environment.md); use the [technical validation profiles](technical-validation.md). Never seed/reset a customer database. Staging endpoints, real identities, keys and image digests are deployment-specific inputs; no sample hostname or token in this repository is an accepted production configuration.

Obtain public `/api/v1/auth/config`, then acquire an Entra **API access token** with the returned API scope. Send `Authorization: Bearer ...`. Signed identity issuer, tenant and subject are validated by the API. Signed provider email assurance or a successful independent possession challenge is required for verified operations. `POST /account/email-verification/start` returns a 10-minute challenge; `complete` consumes the one-time code. Subsequent requests use server assurance capped by token expiry. Never manufacture verification claims. See [identity operations](identity-security-operations.md).

Use `/api/v1/organization-contexts` and explicitly send `X-Organization-Id` for organization routes. Personal wallet, discovery profile/recipient inquiries and notification preferences belong to the signed account; changing a UI organization selector must not change their identity. Obtain current revisions before saving; refresh and reconcile conflicts. Never automatically overwrite on `409`.

| Actor | API responsibility |
|---|---|
| Author | Upload/derive rights-cleared material, save revisions, request rendering and submit for review |
| Independent reviewer | Review current source/model/course/assessment/policy/media revisions; self-review is denied |
| Publisher | Publish only the complete independently approved immutable release |
| Learner | Consume own release-bound enrollment, perform authoritative semantic actions and assessment; obtain eligible credential |
| Organization admin | Assign learners, administer rights/holds/retention, inspect minimized reporting/exports, manage webhook configuration |
| Employer or organization admin | Search consented minimized profiles and create bounded inquiries; contact appears only after recipient acceptance and current eligibility |
| Operator | Operate jobs/alerts/recovery using authorized tooling; no bypass of review or scoring |

Roles are resolved from active scoped server membership. A role shown in the UI is not an authorization grant. Human access uses the configured Entra user flow. Organization integrations use the separate [Entra client-credentials boundary](machine-integrations.md): explicit signed app-only identity, tenant mapping, registered scopes intersected with application roles, integration-scoped references, revocation and rotation cutoffs. Machine identities cannot enter personal or learner workflows. Genuine Entra application provisioning remains hosted acceptance.

## State and transport rules

Use JSON with the exact documented properties. Responses use `{error:{code,message}}`, with correlation headers where supplied. `401` requires renewed sign-in, `403` means lost role/consent, `404` may intentionally hide unauthorized resources, `409` means state/revision conflict, `429` means admission limits, and `5xx` needs bounded operator-aware recovery. HTTP `200` model actions may contain a rejected semantic outcome; inspect status and authoritative state. Never compute scores or credential eligibility in the client.

Retain an idempotency key per documented intent across interrupted responses. Changed intent needs a new key. Model action keys equal `clientActionId` and preserve release/model binding plus monotonic sequence; use server resume state after interruption. Other mutations do not universally support idempotency: inspect each operation. List `nextCursor` is opaque and must be sent as `after`; stop on null. Limits are server-owned.

Upload through the existing upload-session API, retain source hash/rights identity, and wait for a production scanner verdict. Upload/processing success is not approval. Treat all generated and reconstructed models/media as review-required. Use API-controlled private delivery; internal blob paths are object identities, never public URLs. A withdrawal can invalidate a previously available release or artifact. Previously minted private URLs have bounded expiry and cannot be recalled by changing UI state.

Poll jobs with bounded backoff, retaining job identity and correlation ID. Lesson renders snapshot the saved course revision and approved asset hashes. `/lesson-renders` returns `202`; fetch current state, then authenticated `/content?kind=video|captions|manifest`. Author cancellation fences the active lease; cancelled renders cannot be retried. Retry only eligible current jobs. Local scene-take filesystem paths cannot enter hosted rendering. A successful render attaches review-required media and increments the draft revision; refresh before further edits or review. Rough-cut acceptance is required for final rendering. Listening/caption/mechanical review remains mandatory.

Credential issuance is server-authoritative and exactly once per eligible enrollment. Consent revisions control sharing; anonymous verification deliberately returns a minimal projection. Discovery consent is separate from credential sharing. Credential expiry/revocation, source restrictions and withdrawn consent may suppress discovery and contact without rewriting historical evidence.

Lifecycle `/lifecycle/assets/{assetVersionId}` mutations require organization admin and idempotency key. `WITHDRAW` suppresses dependent delivery; `HOLD` preserves objects; `TOMBSTONE` is irreversible suppression and cannot bypass a hold. Retention schedules cover explicitly registered withdrawn asset objects; unregistered derived artifacts need additional retention coverage. Recovery must import independently retained tombstones before reopening delivery.

Discovery search accepts required `coarseArea` plus optional `courseId`, `certificationPolicyId`, `productId` and opaque `after`. Filters operate on current eligible credentials; fewer than three distinct learners remain suppressed. They never authorize access to raw tenant data or recipient contact.

`POST /api/v1/reports/effort` requires an idempotency key and `{courseVersionId,durationSeconds,kind}`. Authors record `AUTHORING`, reviewers record `REVIEW`, and organization admins may record either; duration is 1–28,800 seconds. This is explicit self-reporting, not measured elapsed time. Summary responses separate provider-billed cost, estimated cost and self-reported effort; missing data is null, never a measured zero.

Protected exports are original-requester-bound, authorized again after storage I/O, and expire after 24 hours. `POST /api/v1/exports` takes an idempotency key and optional `{kind,format,releaseId}`. Empty JSON selects `summary`/`json`; `credential-register` supports `json` or formula-safe `csv`; `evidence-lineage` requires `releaseId` and JSON. Other combinations are rejected. Evidence exports include minimized immutable release/review/model/attempt/credential lineage and hashes; they omit contact, answer keys and private blob locations. Poll the returned export ID before downloading content, and respect `application/json` versus `text/csv`.

Webhook create/update requires both current revision and idempotency key. Operators provision master keys and key IDs. Creation or key rotation returns an optional **subscription-scoped signingSecret**, including identical idempotent replay; list never returns it. Deliver that secret securely to the receiver, never place it in client logs/telemetry, and use its literal UTF-8 hex-string bytes as the HMAC key. The master key never crosses the API boundary. Receivers verify timestamp/HMAC and deduplicate stable event IDs; rotation allows the documented 24-hour overlap. Inspect the generated contract before assuming every successful update returns a new secret.

## Runnable acceptance and release evidence

The [prepared certification runner](certification-api-acceptance.md) exercises an already prepared course through independent review, enrollment, activities and public credential verification using distinct real identities. Its controlled-transport unit test is not hosted proof. Source ingestion, real AI/reconstruction, lifecycle and operating rehearsals remain separate evidence requirements.

`node tools/check-technical-acceptance.mjs` tests the gate's rejection behavior with labeled local fixtures. For an actual candidate release run:

```text
node tools/technical-acceptance.mjs --evidence=<absolute-manifest-path> --revision=<tested-40-character-commit>
```

The manifest uses `technical-acceptance-evidence.v1`, a `release` containing `revision`, `lockfileSha256`, `images` (`api`, `worker`, `reconstruction`, each `registry/image@sha256:...`) and HTTPS `baseUrl`, plus `gates` for every ID in [the policy](../config/technical-acceptance.json). Each gate contains its policy task IDs and execution type, `status: passed`, `fixturesUsed: false`, distinct named `executor`/`reviewer`, UTC `observedAt`, matching `releaseRevision`, `imagesSha256`, and nonempty `artifacts` (`path`, `sha256`). Image-set identity is SHA-256 of `JSON.stringify(Object.entries(release.images).sort(([a],[b])=>a.localeCompare(b)))`. Artifact paths are relative to the manifest, physically confined to its directory, and limited to 32 MiB per receipt. Store large raw traces privately and include their independently reviewed bounded receipt.

`runtime-feasibility` additionally needs `devices` for `ios-safari`, `android-chrome`, `firefox`: physical execution, actual `model`, `osVersion`, `browserVersion`, `modelSha256`, `traceSha256`, measured `interactiveMs` <=5000 and `minimumFps` >=30, plus `contextRecovery`, `equivalentPath`, `mediaDecode` true. The trace hash must reference an included artifact. Use the [existing device matrix](../config/e4-device-matrix.json) and engineering harness; emulated viewport tests do not satisfy physical evidence.

`independent-security` needs a findings array. Every finding has ID, owner and status: `closed` requires an included `retestSha256`; `accepted` requires `acceptedBy` and unexpired UTC `expiresAt`. Attach the actual threat model/review report even when no findings remain. Reports must cover all boundaries in [the security register](technical-security-review.md). Named fields and hashes provide integrity and accountability, not proof that an attestation is true; release owners must review receipts and retain approval in the controlled delivery process.

Missing, stale, fixture, duplicate, mismatched-release, unresolved-security and unavailable physical evidence all keep the gate blocked. The output can only say **technically ready for UI integration**. Final UI/accessibility journeys, independent pilot content/mechanical review, source/engine licenses, issuer wording, learner cohort and organization launch approval are separate gates.
