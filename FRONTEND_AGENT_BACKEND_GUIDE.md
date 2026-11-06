# Frontend Agent Backend Integration Guide

This is the handoff for anyone building a frontend for the Medical Device Training Platform. You do not need to understand PostgreSQL, Azure, the worker runtime, or the internal service wiring to build a good frontend. Treat this document as the browser-to-backend contract: the API exposes resource projections and controlled transitions, while persistence, queues, private storage, and provider calls remain server concerns. Use the referenced source files when a detail is ambiguous.

## The short version

- The browser talks to the API over same-origin HTTP under `/api/v1/...`.
- Public catalog and credential-verification reads do not require a signed-in session.
- Private requests use an Entra access token in `Authorization: Bearer ...`.
- Organization-scoped requests also send `x-organization-id` for the currently selected organization.
- The server authenticates the token and resolves organization access from server-side membership data. Never treat a client-supplied organization ID, role, email, or user ID as proof of authority.
- The frontend never talks directly to PostgreSQL, Azure Blob, Service Bus, the worker, or AI providers.
- Long-running work is asynchronous. Start the operation through the API, then poll the returned job or session resource.
- State-changing requests are designed to be retried safely. Use a stable `Idempotency-Key` for each logical action and keep it when a response is interrupted.
- Published course content, certification rules, model bindings, scores, and credential issuance are authoritative server decisions. The UI may present them, but must not re-create them locally as a second source of truth.

## Hosted developer integration

The starter, reference, and client/viewer downloads are served from the existing Azure application under `/developer/starter` and `/developer/api`. Use Microsoft sign-in on that HTTPS origin; no local server or localhost callback is needed. See `docs/developer-integration.md` for the action/retry/resume/debrief lifecycle and the exact acceptance boundaries. Build-generated downloads are included in the API container, alongside the static frontend.

## Backend resource model

The API is resource-oriented, but its JSON responses are route-specific projections rather than raw database rows. A response is authoritative for the operation that returned it; do not assume that a field accepted by one route is valid input to another route.

The main resource chain is:

```text
signed identity
  └─ organization context ── membership/roles ──┐
                                                │
source upload session → asset version → processing/review → approved source/model/media
                                                │
knowledge sources + approved assets → course version draft → review decisions → published release
                                                                                └─ release bindings
published release → candidate enrollment / organization assignment → enrollment snapshot
                                      └─ activity → assessment or simulation/model attempt/session
                                                                                └─ progress → credential
```

Use the resource class to decide how the frontend should behave:

| Resource class | Examples | Frontend rule |
| --- | --- | --- |
| Public | Catalog course, public credential verification | No bearer token or organization header; use `fetch` with `cache: 'no-store'`. |
| Personal | Account, candidate enrollments, credential wallet | Scope by the signed-in subject. The wallet is intentionally not selected by organization. |
| Organization-scoped | Organization profile, sources, courses, assignments, enrollments, notifications | Send the selected `x-organization-id`; the server still checks membership and role on every request. |
| Versioned content | Asset version, course version, model version, simulation definition, policy | Keep the ID, status, revision/version, and hash/binding returned by the server. Do not edit published versions in place. |
| Release-bound learner state | Release, enrollment, assessment session, simulation attempt, model session | Use the exact release/activity/policy/model references returned by the API. Never substitute a current draft or latest model. |
| Private delivery | Media projection/bytes, approved model descriptor/manifest/bytes, scene video | Obtain delivery information from the API; never construct a Blob key, SAS URL, or model URL. |
| Async operation | Processing job, reconstruction, media review, model import, draft generation | Render the operation state and next action; a successful start response is not completion. |

The frontend normally follows this sequence: load a representation, let the user confirm an explicit transition, submit the transition with its current revision/binding and idempotency key, then replace local state with the returned representation. Local state may hold form edits and transient UI state, but it must not become a second authority for permissions, completion, scores, certification, or asset approval.

## Repository map

The useful frontend/backend boundary is intentionally small:

| Area | Location | What it owns |
| --- | --- | --- |
| Browser pages and consumers | `apps/web/src` | Page entrypoints, rendering, auth/session helpers, learner flows, 3D model player |
| HTTP API | `apps/api/src` | Authentication, routing, authorization, validation, orchestration, response projection |
| Shared request and domain contracts | `packages/contracts/src` and `packages/simulation-schema/src` | Types and validation shared across services |
| Database access | `packages/db/src` | Tenant-scoped persistence; do not import this into browser code |
| Private file/model delivery | `packages/storage/src` and API services | Blob access and bounded private delivery; browser receives an approved URL or same-origin stream |
| Background processing | `apps/worker/src` | PDF/media/model processing, email, outbox and queue consumers; browser observes status through the API |
| Architecture and feature evidence | `docs/` and `tools/check-*.mjs` | Design rationale and browser/integration checks |

The API entrypoint wires the services together in `apps/api/src/entrypoint.ts`. The browser route and response handling live primarily in `apps/api/src/job-status-http.ts`. Read those files when adding a new integration rather than guessing from a page's current behavior.

## Runtime shape

```text
Consumer browser
    │ same-origin HTTPS, /api/v1/*
    ▼
API ── validates Entra token and organization membership
    ├── PostgreSQL through tenant-scoped stores
    ├── private Blob/model delivery
    ├── transactional outbox and job records
    └── worker / AI / email services for asynchronous work
```

The API may return a job ID, a private media URL, an approved model descriptor, an authoritative activity session, or a projected course snapshot. The browser should use that returned object as the next navigation/rendering input.

## Hosted integration and engineering checks

Use the Azure-hosted `/developer/starter` with Microsoft sign-in for the end-to-end integration. The frontend, API, sign-in callback and private model delivery use the same HTTPS origin. Users do not start a local server or configure a localhost callback.

Internal engineering checks (run in an isolated test environment, not during user setup):

```powershell
pnpm build
pnpm developer:validate
pnpm web:validate
pnpm learner-browser:validate
pnpm candidate-enrollment:validate
pnpm personal-wallet:validate
pnpm managed-auth:validate
```

The learner integration uses the generated OpenAPI client in `packages/api-client`, served with its contract and usage example at `/developer/api`. For a new endpoint, update the shared contract and inspect the API handler, relevant service/store and existing browser caller together. Regenerate the client and run the contract compatibility check.

## Authentication and session handling

### Use the existing session helpers

The canonical browser helpers are in `apps/web/src/auth-session.ts` and `apps/web/src/managed-auth.ts`:

- `getAccessToken()` reads the current application bearer.
- `authenticatedFetch()` restricts requests to same-origin `/api/v1/` paths, sends the bearer, omits ambient credentials, rejects redirects, and checks that the session did not change during the request.
- `getOrganizationHeaders()` returns the current `x-organization-id` header when one is selected.
- `getSessionIdentity()` is stable across token renewal but changes when the signed-in account or organization changes.
- `clearAccessToken()` clears private browser state and completes managed-provider logout when applicable.

Use these helpers instead of calling `fetch()` with hand-rolled token storage. Do not put access tokens in URLs, HTML, logs, query strings, localStorage, or application state that is rendered into the DOM. Do not use an ID token as an API access token.

The browser auth bootstrap endpoint is:

```text
GET /api/v1/auth/config
```

It returns allowlisted public registration metadata only. It never returns a client secret. The current managed-auth flow uses authorization-code redirect through MSAL and obtains an access token for the configured API scope. See `docs/managed-browser-authentication.md` before changing sign-in or sign-out behavior.

### What the server validates

The API validates the bearer token's signature, issuer, audience, tenant, expiry, and roles. It derives the application subject from the signed identity. Organization access is then checked against application membership data. A token claim or body field is not a substitute for an active membership.

Some actions additionally require a verified email claim. A display name, email-looking string, or string value such as `"true"` is not enough. When the API returns a verification-related error, guide the user to the account/sign-in flow instead of trying to bypass it in the client.

### Organization context

Use these endpoints for the organization switcher:

```text
GET  /api/v1/organization-contexts
POST /api/v1/organization-contexts
POST /api/v1/organization-contexts/{organizationId}/select
```

After selection, persist the selected organization through `setOrganizationId()` and reload or re-fetch organization-bound views. A selected organization is not permission by itself; the API re-checks membership on every private request.

Personal account, candidate enrollment, and the credential wallet intentionally have organization-independent behavior. Do not send an organization header to the wallet just to choose an issuer; the server derives credential ownership from private routing data.

### Browser request pattern

For private API calls, use `authenticatedFetch()` (or a small wrapper around it) and add `getOrganizationHeaders()` when the resource is organization-scoped:

```ts
const response = await authenticatedFetch(`/api/v1/enrollments/${encodeURIComponent(enrollmentId)}`, {
  headers: getOrganizationHeaders(),
  cache: 'no-store',
});

const body = await response.json().catch(() => null);
if (!response.ok) {
  const code = body?.error?.code;
  // Branch on response.status and stable code; do not show raw server diagnostics.
  throw new Error(code ?? `HTTP_${response.status}`);
}
```

For mutations, add `content-type: application/json`, send only the fields documented by that route, and include a stable `Idempotency-Key`. Encode every path ID with `encodeURIComponent()`. Build query strings with `URLSearchParams`; cursors and revisions are opaque values and must not be inferred from display labels.

Do not add a second token store or call `fetch()` directly for a private `/api/v1/` route. The existing helper renews managed-auth tokens, omits ambient cookies, rejects redirects, restricts destinations to same-origin API paths, and detects an account/organization change while a request is in flight. Public catalog and verification reads are the exception and intentionally use unauthenticated `fetch()`.

On a response, keep the server representation that matters to the next action:

- `id` identifies the resource; it is not a permission grant.
- `revision` or `version` is an optimistic-concurrency input when the route requires it.
- `status` is a server state machine; render it and wait for the next allowed transition.
- `nextCursor` is an opaque continuation token; do not turn it into an offset.
- `releaseId`, `releaseHash`, `releaseBindingId`, `modelVersionId`, and policy/version fields are compatibility bindings; send them back exactly when the contract requires them.
- `error.code` is for control flow. `error.message` is safe to display only as a product message, not as a diagnostic log.

Keep request generation/session identity in view state. If the account, organization, enrollment, activity, release, or model changes, invalidate in-flight work and ignore late responses from the old identity.

## Resource lifecycles from the frontend

### Files and derived assets

An uploaded file is not immediately a usable source or model. The normal authoring flow is:

1. Create an upload session with the file name, source type, content type, byte size, SHA-256, and optional product ID.
2. Upload the bytes to the returned `uploadUrl` before `expiresAt`. The URL may be a same-origin API upload endpoint or an approved private-storage URL; use the returned URL and required content type exactly.
3. Complete the session with the returned `blobKey` and the same content metadata. The API verifies the object and returns an asset version and/or processing job.
4. Poll the returned job or review resource. The resulting asset version can be `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, or another lifecycle state.

The UI should make the asset's current state and next action visible. Do not let a local file object, upload success, or job `SUCCEEDED` state stand in for an approved source/model. A source hash is the lineage check that prevents the reviewer from approving different bytes than the ones inspected.

### Drafts and immutable releases

Authoring edits a `courseVersion` draft. Saving sends the current draft `revision`; a stale revision is a conflict and requires reloading/reconciling. Review decisions are separate resources and are recorded against a target such as the course, AI draft, source, model, simulation, assessment, policy, or video lesson. Publication is a server transition that validates the required review gates and creates an immutable release manifest.

After publication, learner-facing screens must use the release snapshot and its release-bound IDs. A revised course creates a new draft/version and later release; it does not mutate the release already used by existing enrollments. Keep draft editing state separate from the last server snapshot so a refresh or conflict can discard/reconcile unsaved edits deliberately.

### Learner progress and attempts

An enrollment is a server-owned view of access to a particular release. Its detail response is the player snapshot: modules, activities, progress, assessment state, and certification eligibility. Content acknowledgement, assessment submission, story choices, simulation launch, and model actions are explicit transitions. After each transition, use the returned resource or re-fetch the enrollment/session instead of calculating progress locally.

Assessment sessions and simulation/model sessions are attempts against a release, activity, and policy snapshot. They can expire, hit attempt limits, require review, or become invalidated. Display those states as distinct product states; do not silently start a new attempt after a timeout or treat a locally calculated score as a pass.

### Credentials

A credential is issued only after the server evaluates the published certification policy and evidence. The personal wallet is historical and subject-owned: it may show a credential for an old or superseded release even when the learner can no longer open that training. Credential sharing, revocation, and supersession are separate explicit mutations with their own revisions/idempotency keys. Public verification reads a sanitized public projection and is independent of the private wallet screen.

## Public and consumer-facing endpoint families

These are the endpoint families currently used by the browser. IDs must be URI-encoded. Query parameters are deliberately strict; do not add convenience selectors or send duplicate parameters.

### Public discovery

```text
GET /api/v1/catalog
GET /api/v1/catalog/{publicCourseId}
GET /api/v1/verify/{publicVerificationId}
```

Catalog results may include an `after` cursor for pagination and published certification disclosures. Render titles, issuer text, instructions, and descriptions as text, not HTML. Verification is a public read and should not require a private session.

### Personal account and candidate enrollment

```text
GET  /api/v1/account
POST /api/v1/account
POST /api/v1/candidate-enrollments
GET  /api/v1/my-candidate-enrollments?after=...
```

The account mutation is an explicit `create` or `update` action and uses a revision for optimistic concurrency. Candidate enrollment includes the course's current `publicId`, `revision`, and enrollment notice version, plus explicit confirmation. If those disclosures changed, reload the public course before retrying.

The candidate flow is:

1. Browse a public course.
2. Sign in and create/review the personal profile.
3. Confirm the current enrollment notice through `POST /api/v1/candidate-enrollments`.
4. Use the returned organization and enrollment IDs to open training.
5. Set the returned organization as the selected context before loading organization-bound training routes.

Enrollment alone does not award a credential.

### Learner training

```text
GET  /api/v1/enrollments?after=...
GET  /api/v1/enrollments/{enrollmentId}
POST /api/v1/enrollments/{enrollmentId}/activities/{activityId}/acknowledge
GET  /api/v1/enrollments/{enrollmentId}/activities/{activityId}/media
GET  /api/v1/enrollments/{enrollmentId}/activities/{activityId}/inspection
POST /api/v1/enrollments/{enrollmentId}/activities/{activityId}/start
GET/POST /api/v1/enrollments/{enrollmentId}/story[/{choices|restart}]
```

The enrollment detail is the authoritative course/player snapshot. It includes modules, activities, progress, assessment sessions, and current certification eligibility. Re-open or refresh it after a learner action when the UI needs the latest progress or eligibility.

Activity handling is type-specific:

| Activity kind | Browser behavior |
| --- | --- |
| `text`, `rich_text` | Render the supplied text; completion is an explicit `acknowledge` POST. |
| `image`, `video` | Request the private media projection; render the returned media URL/type and description or transcript; acknowledgement remains explicit. |
| `3d_viewer`, `hotspot` | Request the release-bound inspection projection, then load the approved model asset; do not invent a model URL or component mapping. |
| Assessment types | Start/resume an assessment session and submit answers through the assessment-session routes. |
| Interactive types such as `simulation`, `guided_procedure`, `manipulation`, or `assembly` | Start a release-bound model session, navigate to the model player, and send semantic actions to the model-session API. |
| Story activity | Read the current story node and submit only an available choice using the current story revision. |

Do not automatically mark media, reading, or 3D content complete merely because it rendered. The product requires an explicit learner acknowledgement after the validated content is available.

### Assessments and credentials

The learner player uses:

```text
POST /api/v1/assessment-sessions
GET  /api/v1/assessment-sessions/{sessionId}
POST /api/v1/assessment-sessions/{sessionId}/submit
POST /api/v1/enrollments/{enrollmentId}/credential
GET  /api/v1/my-credentials?after=...
POST /api/v1/my-credentials/{credentialId}/sharing
```

The server enforces attempt limits, cooldowns, expiry, review gates, pass scores, certification policy, and credential eligibility. The frontend should display the returned status and guidance rather than locally deciding that a learner passed.

The credential wallet is personal and historical. It can remain readable even when an old organization or release is no longer active; that does not restore access to training. Sharing is a separate, explicit owner action and requires the current sharing revision plus an idempotency key.

Credential administration is organization-scoped and separate from the learner wallet:

```text
GET  /api/v1/credentials?after=...&learnerId=...
POST /api/v1/credentials/{credentialId}/sharing
POST /api/v1/credentials/{credentialId}/revoke
POST /api/v1/credentials/{credentialId}/supersede
```

Use the organization credential routes only for authorized administration. A learner's owner sharing setting uses `/my-credentials/{credentialId}/sharing`; do not swap the two route families.

### Release-bound 3D model sessions

```text
POST /api/v1/model-sessions
GET  /api/v1/model-sessions/{sessionId}?releaseBindingId=...&modelVersionId=...&nextSequence=...
POST /api/v1/model-sessions/{sessionId}/actions
GET  /api/v1/releases/{releaseId}/model-assets/{modelVersionId}
```

Model actions are semantic, for example `select_component`, `activate_target`, `transform_component`, `complete_step`, `diagnose_fault`, or `resolve_fault`. They are not arbitrary database updates. Each action needs a unique `clientActionId`, sent as the `Idempotency-Key`, and must include the current `releaseBindingId`, `modelVersionId`, and `expectedSequence`. A transform is a bounded semantic value such as `{ rotationY, translationX }`; it is not a raw scene-graph mutation.

The API returns authoritative state: sequence, next sequence, selected component, transforms, score, completion, active step/fault, and allowed actions. Apply that state to the player. If the API reports a retryable network failure, resume with the server-provided binding and next sequence before allowing the user to continue. See `apps/web/src/model-contract.ts` and `apps/web/src/model-player.ts`.

Model delivery has two layers: the descriptor/approved binding and the bytes. First load the descriptor from the release-bound route; then request `?content=manifest` or `?content=model` using the approved IDs. Use `fetchModelAsset()` or the same authenticated, organization-aware boundary for private delivery. Treat a `404 APPROVED_MODEL_NOT_FOUND` as a release/content problem, not as permission to fall back to a local model.

## Authoring and operator routes

Author/admin screens use the same API boundary but are not consumer permissions. The currently implemented resource families include:

```text
GET      /api/v1/organization-contexts
POST     /api/v1/organization-contexts
POST     /api/v1/organization-contexts/{organizationId}/select
GET/POST /api/v1/organization-profile
GET/POST /api/v1/members[/{memberId}/roles|status]
GET/POST /api/v1/invitations[/{invitationId}/revoke]
GET/POST /api/v1/enrollments[/{enrollmentId}/options]
GET      /api/v1/notifications[/{notificationId}/read]
GET/POST /api/v1/releases/{releaseId}/offering

POST /api/v1/organizations/{organizationId}/assets/upload-sessions
PUT  /api/v1/upload-sessions/{uploadSessionId}/content
POST /api/v1/upload-sessions/{uploadSessionId}/complete
DELETE /api/v1/upload-sessions/{uploadSessionId}/cancel
GET  /api/v1/jobs/{jobId}
POST /api/v1/jobs/{jobId}/retry
GET      /api/v1/knowledge-sources[/{assetVersionId}]
POST     /api/v1/knowledge-sources/{assetVersionId}
GET      /api/v1/courses?after=...
POST     /api/v1/courses
GET/PUT/POST /api/v1/course-versions/{courseVersionId}
POST /api/v1/course-versions/{courseVersionId}/generate-draft
POST /api/v1/course-versions/{courseVersionId}/revise
GET/POST /api/v1/course-versions/{courseVersionId}/history
POST /api/v1/course-versions/{courseVersionId}/publish
GET      /api/v1/course-versions/{courseVersionId}/model-preview?revision=...
GET      /api/v1/approved-media?after=...
GET      /api/v1/approved-models[?modelVersionId=...]
GET/POST /api/v1/media-review[/{id}[/content|/frames|/review]]
GET/POST /api/v1/model-imports[/{id}[/content|/configuration|/review]]
GET/POST /api/v1/reconstructions[/{id}[/candidate|quality|foreground|conditioning-image|views]]
GET/POST /api/v1/openmontage/briefs
GET/POST /api/v1/openmontage/artifacts[/{id}/approve]
GET/POST /api/v1/openmontage/generations[/{id}/preview|narration]
GET      /api/v1/openmontage/scenes/{sceneId}[/video]
GET      /api/v1/course-changes/{courseChangeId}?after=...
GET/POST /api/v1/course-change-jobs[/{jobId}/retry]
GET/POST /api/v1/attempts[/{kind}/{attemptId}/invalidate]
GET/POST /api/v1/attempt-reviews[/{kind}/{attemptId}[/reset]]
```

Bracketed forms above are shorthand for the concrete collection/detail/action paths in the handler. Read that handler branch before adding a screen because several routes use narrowly constrained query parameters and role-specific transitions. The API checks role and organization access; hiding a button is only a UX improvement, not authorization. Do not expose author/operator endpoints in a consumer UI without confirming the intended role and product boundary.

## Mutation safety rules

### Idempotency

For a logical state change:

```ts
const key = crypto.randomUUID();

await authenticatedFetch('/api/v1/example', {
  method: 'POST',
  headers: {
    ...getOrganizationHeaders(),
    'content-type': 'application/json',
    'idempotency-key': key,
  },
  body: JSON.stringify(input),
});
```

Keep `key` associated with the user intent until the request succeeds, the server returns a deliberate validation/conflict result, or the UI abandons that action. If the network response is lost, retry the same body with the same key. Generating a new key can create a second enrollment, attempt, story choice, upload completion, or credential request.

### Revisions and conflicts

When a response includes a `revision`, send that exact revision for the next mutation that requires it. A `409` such as `*_STALE`, `*_CONFLICT`, or `IDEMPOTENCY_KEY_REUSED` means the client must stop and reload or reconcile; it is not a reason to blindly retry with a new revision or new key.

### Pagination

Most collections return `{ items, nextCursor }` and use an opaque `after` cursor. Treat cursors as opaque strings, URI-encode them, request one page at a time, and stop when `nextCursor` is absent. Do not use offsets or assume IDs sort chronologically.

### Async jobs

Uploads, PDF extraction, media inspection, model import, reconstruction, and AI draft generation can outlive the initiating request. The browser should:

1. Submit the request and retain the returned ID.
2. Show a non-blocking pending state.
3. Poll the corresponding status/detail endpoint with a bounded cadence.
4. Render `QUEUED`, `RUNNING`, `RETRY_SCHEDULED`, `SUCCEEDED`, `FAILED`, or `DEAD_LETTERED` distinctly.
5. Offer deliberate retry only when the API says the operation is retryable or the product exposes an operator retry.

Never infer completion because a request returned `200`; inspect the returned job/session state.

### Image/video reconstruction and video/model scenes

The browser is a review and playback client. It is not the reconstruction engine and it must not upload directly to a worker, Blob container, or Service Bus queue.

The server-side flow is:

1. Create an upload session and send source bytes to the private `source-assets` container.
2. Complete the upload with the source hash, rights/review evidence, and a stable idempotency key.
3. Start an asynchronous reconstruction job. The worker consumes the appropriate Service Bus queue, re-checks the source hash and approval state, and writes a private candidate GLB, report, and selected source views.
4. Keep the candidate in `REVIEW_REQUIRED` until an authorized author prepares it and an independent reviewer approves it. A completed job is not an approved model.
5. Publish an immutable model version and release binding. The learner receives only the release-bound model manifest and a short-lived same-origin/private delivery response.

For a model composited over a video plate, the API should return a server-issued `training-scene.v1` manifest containing:

- the video asset version, SHA-256, MIME type, dimensions, frame rate, and duration;
- the approved model version and SHA-256, plus placement and scale;
- camera intrinsics (focal length, principal point, and distortion coefficients);
- render policy such as opacity and shadow behavior.

The shared validator is `packages/contracts/src/scene-manifest.ts`. The browser must treat the manifest as a binding, not as a hint: reject unknown schema versions, hash mismatches, browser-supplied URLs, out-of-range camera data, and model/video assets that are not returned by the API. The local demo uses `apps/web/src/babylon-model-runtime.ts` with a transparent canvas over a real MP4 plate; it demonstrates the rendering shape, but it is not evidence of physical-device accuracy. Production overlay accuracy additionally requires camera extrinsics/pose, time-synchronized tracking when the camera moves, verified metric scale, distortion-aware projection, occlusion/shadow handling, and reviewer acceptance against the reference device.

Dispose the video element, Babylon runtime, event listeners, and any object URLs when the activity, account, organization, or release changes. Fence late model/video loads with both a request generation and `getSessionIdentity()`. Do not mark a reconstruction or scene accepted because it rendered successfully.

### Azure asset pipeline contract

The Azure deployment template is `infra/azure/asset-pipeline-foundation.bicep`, with its operator notes in `docs/azure-asset-pipeline.md`. It assumes the existing private Storage Account, Service Bus namespace, and API/worker managed identities, then declares:

- private, versioned containers for `source-assets`, `reconstruction-artifacts`, `video-plates`, `renders`, `published-assets`, and `quarantine`;
- retention and lifecycle rules that cool old data without silently deleting evidence;
- durable processing queues with bounded delivery count, TTL, lock duration, and dead-letter-on-expiration behavior;
- queue-scoped managed-identity roles: the worker receives messages and the API publishes messages; neither browser code nor a broad namespace role is appropriate;
- deployment outputs that give the API/worker configuration the approved container and queue names.

Run these checks when changing the asset or scene boundary:

```powershell
pnpm infra:validate
pnpm scene-manifest:validate
pnpm training-scene:validate
```

The browser continues to use `/api/v1/...` for job status and private delivery. Azure resource names, storage keys, queue names, SAS tokens, and managed-identity details remain server configuration and must not be embedded in frontend code.

## Response and error conventions

Successful JSON is usually a projection specific to the route. Do not assume that a field returned by one endpoint is accepted as input to another. For errors, expect:

```json
{
  "error": {
    "code": "SOME_STABLE_CODE",
    "message": "A safe user-facing description"
  }
}
```

Use the status and stable code for control flow, and use a friendly product message for the user. Do not display raw stack traces, provider diagnostics, storage keys, SQL errors, JWT claims, or internal IDs unless the product explicitly labels the ID for support.

Common cases:

| Status/code family | Frontend response |
| --- | --- |
| `401` authentication required/invalid | Clear private state and send the user through sign-in. Do not replay a mutation automatically. |
| `403` membership, role, verification, account, or enrollment access | Explain the missing access condition; do not keep retrying. |
| `404` unavailable course/release/activity/resource | Remove stale UI state or ask the user to refresh. |
| `409` revision, idempotency, attempt, story, or publication conflict | Reload authoritative state and ask for a deliberate retry if appropriate. |
| `422` invalid body/query/cursor | Fix the client request; retrying the same invalid request will not help. |
| `429` rate limit | Show a wait/retry affordance with backoff. |
| `5xx` or sanitized provider/storage failure | Preserve the user intent when safe, but retry only with the same idempotency key for a mutation. |

## Browser security and rendering rules

- Use `textContent` or DOM text nodes for user, course, filename, issuer, transcript, and instruction text. Do not inject backend strings with `innerHTML`.
- Use `cache: 'no-store'` for private and rapidly changing reads unless the endpoint explicitly documents a different cache policy.
- Use `credentials: 'omit'` for API calls; authentication is bearer-based.
- Reject unsafe media/model addresses. Same-origin API paths and HTTPS URLs without embedded credentials are the accepted browser shapes.
- Dispose media, object URLs, model runtimes, and event listeners when navigating between activities or signing out.
- For video/model compositing, keep the video and transparent Babylon canvas in the same aspect-ratio box; never claim camera-accurate alignment unless the server manifest includes verified intrinsics, extrinsics/pose, frame timing, and review evidence.
- Fence asynchronous callbacks with both a request generation and `getSessionIdentity()`. A late response from a previous account, organization, course, or model session must not update the current screen.
- Keep the UI usable at compact widths and with keyboard/screen-reader navigation. For media, show alt text or transcript and keep acknowledgement explicit.

## What not to do

- Do not import `@medical-device/db`, `pg`, Azure SDKs, worker code, or server-only environment variables into `apps/web`.
- Do not call a queue, Blob container, database, or worker directly from the browser.
- Do not construct a storage key, SAS URL, model URL, release hash, score, credential, or tenant identity on the client.
- Do not trust `x-organization-id`, a role claim, an email string, or a hidden form field as authorization.
- Do not silently create a new idempotency key after a timeout.
- Do not retry a stale revision without reloading the current representation.
- Do not mark an activity complete on render, optimistic button click, or local score calculation.
- Do not make an endpoint public just because the current screen is public; preserve the API's authentication and authorization boundary.

## Recommended implementation workflow for an agent

For each frontend feature:

1. Map the user journey to a resource chain: identity/context → source or release → enrollment/activity → attempt/session → result. Name the authoritative resource for every screen and mutation.
2. Search `apps/api/src/job-status-http.ts` for the route and read its method, query allowlist, body validation, authorization, status mapping, and returned projection.
3. Read the underlying API service and, when relevant, the shared contract/schema. Check the database migration only to understand lifecycle/state names; never copy database access into the browser.
4. Find the closest existing browser implementation in `apps/web/src` and reuse its auth, organization, idempotency, cursor, upload, private-delivery, and session-fencing patterns.
5. Write down the transition being made and its prerequisites: current ID, revision/version, release binding, confirmation, and idempotency key. Do not make a UI control imply a transition the API does not expose.
6. Implement loading, empty, success, conflict, access-loss, expired, retryable, and interrupted-request states before polishing the happy path.
7. After every successful mutation, apply the returned projection or re-fetch the authoritative resource. Do not advance progress, score, approval, publication, or credential state from local assumptions.
8. Build and run the narrowest browser/integration validation that exercises the changed journey.
9. If the endpoint shape or product rule is unclear, document the uncertainty and ask for a backend contract change rather than inventing client behavior.

## Canonical references

- `docs/medical-device-training-platform-solution-design.md` — overall solution and architectural rationale.
- `docs/managed-browser-authentication.md` — managed auth, token renewal, sign-out, and session fencing.
- `docs/personal-account-foundation.md` — personal identity/profile ownership and verification semantics.
- `docs/personal-wallet.md` — historical credentials and owner sharing.
- `docs/local-demo.md` — local demo roles, fixtures, and smoke verification.
- `docs/private-browser-uploads.md` — private upload behavior.
- `docs/media-activities.md` — image/video activity contracts and acknowledgement rules.
- `docs/azure-asset-pipeline.md` — private containers, queues, lifecycle, and managed-identity deployment contract.
- `docs/reconstruction-workflow.md` — reconstruction lineage, quality reports, review gates, and private candidate delivery.
- `packages/contracts/src/scene-manifest.ts` — source-bound video/model scene validation.
- `apps/web/src/auth-session.ts` — browser session and authenticated request boundary.
- `apps/web/src/learner.ts` — consumer learner orchestration and activity routing.
- `apps/web/src/model-contract.ts` — authoritative semantic model action transport.
- `apps/api/src/job-status-http.ts` — current HTTP route, validation, and error boundary.
- `apps/api/src/entrypoint.ts` — production service composition and configuration wiring.

When this guide and the running API disagree, trust the current API handler and shared contract, then update this guide as part of the same change.
