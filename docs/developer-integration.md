# Developer integration and NxStage familiarization

This handoff adds a generated TypeScript client, a standalone Babylon viewer, a runnable frontend reference, durable debrief, and a seven-step model familiarization exercise. Existing authentication, release bindings, enrollment access and mechanical constraints remain authoritative on the API.

## Open the hosted experience

Everything the learner or frontend developer uses is hosted in Azure. Open [the integration starter](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/developer/starter), sign in with Microsoft, select the dedicated test organization, open an enrolled course and launch its activity. The [API reference](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/developer/api) links the generated client, viewer, source example, contract and review candidate.

The browser and API share the existing HTTPS origin. Public `/api/v1/auth/config` supplies the tenant/client/scope configuration; the existing registered `/auth/redirect` callback completes sign-in. No local server, localhost redirect, token-pasting step, or frontend secret is required. The API validates tokens, memberships, enrollment ownership and exact release/model/session bindings. Private model bytes stay behind authenticated API routes and are never public downloadable assets.

The starter expects an existing personal profile and active enrollment. A new user creates their profile through the hosted main application first. It supports direct interactive activities; story-based courses use the hosted learner player. It never fabricates an enrollment or publishes source content. Sign-out clears private state and completes the provider sign-out flow.

## Reuse in another frontend

- API reference: `/developer/api`; raw contract: `/api/v1/openapi.json`.
- Client source and usage: `packages/api-client/README.md`.
- Viewer implementation: `apps/web/src/training-viewer.ts`; bundled ESM: `apps/web/dist/training-viewer.js` with its declaration file.
- Complete reference wiring: `apps/web/src/developer-starter.ts` and `.html`.
- Reviewable source candidate: `output/developer-kit/nxstage-familiarization.review.json`.

The viewer mounts into a supplied canvas and exposes `load`, `applyState`, `setEnabled`, `focusComponent`, `resetView`, `setHintsVisible` and idempotent `dispose`. It emits semantic actions and status. It owns rendering and immediate gesture feedback; the application owns authentication, pending requests and scores. `load` validates model/state/hash and accepts cancellation. Superseded loads are serialized and disposed so two renderers cannot race on one canvas. Apply only the API's matching, non-regressing state.

Fetch a launch result, obtain its private model descriptor, verify bindings, load authenticated bytes, then mount the viewer. On an action, create one request ID, persist the intent until it is resolved, and prevent competing input. Apply returned state for both accepted and rejected outcomes. A replay uses the same ID and payload. An account/organization change aborts work and disposes private state. Render named component controls alongside the canvas for keyboard and non-3D access.

`interactionOptions` describes mechanical availability with a blocked reason. It does not reveal whether an action satisfies the current procedure. The starter permits an attempted blocked action so the API can record a recoverable mistake; the model never moves through an interlock. Scores and progress remain server-owned.

`GET /api/v1/model-sessions/{sessionId}/debrief` returns steps, recorded feedback, hints and rejected attempts. It is owner-only and requires active enrollment and published release/policy/definition access. Expired completed history remains readable. It returns at most 500 events and marks truncation; totals cover the full history. Rejected task actions have durable idempotency receipts without consuming the accepted sequence. Invalid envelopes, stale retries and unauthorized requests do not count as training mistakes.

## Familiarization content and publication

The exercise identifies the handle and upper door, raises the handle, opens the door, inspects the simplified chamber, closes the door and lowers the handle. It supplies brief instructions, progressive hints, a focus control, mechanical rejection/recovery and a final debrief. The published policy uses `credentialIssuance: "DISABLED"`; both automatic and manual issuance honor it. Existing courses default to their prior credential behavior.

Build the candidate with `pnpm developer:content`. It is **REVIEW_REQUIRED**, tied to the model hash and independent of any published release. Source reference: [Manitoba Renal Program 50.20.08](https://www.kidneyhealth.ca/wp/wp-content/uploads/50.20.08.pdf), opening-order reference on pages 1–2. The current geometry is an unmeasured reconstruction with a simplified chamber. The return-to-start sequence is a model reset exercise. No treatment settings, consumable handling or patient care are simulated.

Before a pilot, the author binds the exact model version and source artifacts in the normal draft workflow, and an independent qualified reviewer checks the device variant, sequence, hints and limitations. Publish through the existing review workflow, then assign a consenting test learner in a dedicated test organization. Automated fixture reviewers are synthetic test data and cannot satisfy this review. Never publish the fixture into Azure as if human-approved.

## Verification

```powershell
pnpm developer:validate
```

This internal engineering command builds all packages and runs client/contract checks, the PostgreSQL debrief and familiarization checks, and automated Chromium against an isolated API/database/model fixture. The test environment supplies `DATABASE_URL`; test identities are synthetic. The browser test includes keyboard actions, a phone-sized viewport, lost-response retry, progressive hints, interlocks, expiry, debrief and standalone viewer load/dispose. These are engineering checks, not setup steps for users of the hosted experience.

`pnpm developer:artifacts` is an internal build command that prepares the client archive and documentation inside the API's web bundle. The Azure container serves these from `/developer`; a local server is not distributed. Install the downloadable TypeScript package in the frontend project that you deploy, or reuse the hosted starter as-is.

Engineering Chromium tests do not prove Microsoft login, deployed Azure integration, physical touch behavior or the five-second/30-FPS targets. Record Azure revision and real-auth evidence separately. Follow `docs/device-performance-validation.md` and `config/e4-device-matrix.json` for exact physical device/browser, accessibility and context-loss acceptance. No automated check establishes the absence of all bugs.
