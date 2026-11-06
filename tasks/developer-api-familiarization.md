# Developer API and NxStage familiarization implementation

Goal: implement the accepted developer-ready API and realistic NxStage familiarization plan in full. Preserve pre-existing model/UI work. Ponytail: reuse existing authentication, authoritative sessions, shared constraints, renderer, and checks.

## Deliverables and completion evidence

- [x] OpenAPI 3.1 contract, browsable documentation, generated framework-independent TypeScript client for auth/context/enrollments/launch/assets/actions/resume/debrief.
- [x] Client retains structured HTTP errors, correlation/retry metadata, semantic outcomes, stable idempotency, cancellation and identity fences.
- [ ] Runnable developer starter with real Microsoft sign-in, same-origin hosted Azure API, hosted public configuration and sample journey.
- [x] Reusable Babylon viewer with mount/load/callbacks/apply/reset/dispose and no dependency on the current page DOM.
- [x] Additive session interaction availability from shared mechanical constraints.
- [x] Owner-authorized durable debrief, accepted/rejected task actions and hints, retry deduplication without sequence changes.
- [x] Source-referenced NxStage familiarization: briefing, identify handle/door, open, inspect, return to initial state, hints, incorrect-order recovery, debrief; no credential issuance.
- [x] Contract/client/database/HTTP/browser regressions, including concurrent retries, stale sequence, access changes, cancellation and expiry.
- [x] Developer handoff lists actual engineering-test/Azure verification status and commands; existing API routes and release bindings remain compatible.
- [ ] Dedicated Azure test organization, sample release/enrollment, deployed real-auth acceptance, reviewed source sequence, physical-device performance/accessibility evidence.

## Acceptance boundaries

No generic claim of zero bugs. Local fixture evidence does not prove Azure deployment or physical-device acceptance. The current NxStage model is an unmeasured review asset; reference-grounded familiarization must retain that provenance and must not imply treatment simulation. Human reviewer approval cannot be fabricated.

## Progress

- Implementation started after re-reading both installed Ponytail instructions and the current dirty worktree. Existing changes belong to prior work and must be retained.

- User correction: all deliverables run in Azure. No local server/setup or localhost callback; the unexecuted callback approval is superseded. The user performing setup will review the source/device sequence. Physical device evidence still requires actual runs.

## Engineering evidence (2026-11-05 / 2026-11-06 UTC)

- Full developer validation passed before the hosted auth follow-up. Includes generated-contract compatibility, client transport/context checks, real database debrief and NxStage journey, and isolated Chromium against real private GLB/API assets.
- Restricted-role debrief and familiarization tests passed using the production bootstrap's table grants and a disposable non-login, non-superuser, non-bypass-RLS role. The test removes its role and grants afterward; persistent runtime grants are unchanged.
- Managed-auth, browser auth configuration, sign-in and renewal regression checks passed after adding the homepage-to-sign-in return route and safe incomplete-callback handling.
- Existing semantic-action, fault-story, credential and requalification regressions passed. These tests do not establish human/device acceptance.
- Removed generated local proxy, local package entry point and localhost callback instructions. Hosted artifacts are produced inside the Azure API container.

## Azure rollout and remaining evidence

- Final API image `api:developer-20261106-r4` uploaded to `mdtpersonalacr01.azurecr.io` (digest `sha256:b7d1fee0532bdb454f79395057effaf665ac5015b0eed3f30b02588d30a79810`). Revision `mdt-personal-api--developer-r4` has 100% of application traffic; both staged and live-origin checks passed, including the generated contract, public downloads, gzip transfer and unauthenticated private-route denial. Evidence: `output/developer-kit/evidence/azure-production-r4.json`.
- Container App uses multiple revisions for rollback. Temporary `developer-staged` and zero-traffic `training-scene` / `developer-r2` revisions were deactivated after final verification; their revision records remain available for rollback. No authentication registration changes made.
- Real Microsoft account selection originally returned to a missing homepage. Revision `developer-r2` adds the homepage return route. The live browser then loaded the real account profile, active organization, selected organization and enrollment list successfully. No active enrollments were present.
- Entra SPA registration re-read: its only callback is the existing production HTTPS `/auth/redirect`; no localhost callback exists.
- Full developer validation, compressed/identity HTTP delivery checks and independent package installation passed. Public viewer transfer reduced from roughly 16.4 MB uncompressed to 1.74 MB gzip; physical device performance remains unmeasured.
- User input requested: current Microsoft token has no signed verified-email proof, which the API requires for organization creation. Choose an Azure-hosted email-code flow or provide an existing External ID verification flow before configuring that account-security boundary. No verification bypass or fabricated claim was added.
- Worker source built successfully in Azure (ACR run `cj1q`) after local Docker DNS failures. Image `worker:developer-20261106`, digest `sha256:c54e37716ef186af26e5017d484b58572ec04be6efe951d8426b5db9e717f5d2`, contains the shared practice-only policy guard for deferred qualification. Revision `mdt-personal-worker--developer-policy` is active and Healthy.
- Direct worker log streaming failed DNS resolution, but the existing Azure Log Analytics workspace subsequently verified the exact `developer-policy` revision: 10 collected records, one `worker_started` event and zero `worker_runtime_error` entries in the 24-hour query. Observed records cover startup at 2026-11-06 04:30:36 UTC; this is startup evidence, not a claim of error-free operation. Evidence: `output/developer-kit/evidence/azure-worker-startup.json`. The worker remains active and Healthy with one replica.
- Final hosted starter screenshot refreshed after the `developer-r4` rollout. Real browser evidence records successful account/organization access and an empty enrollment list in `output/developer-kit/evidence/azure-browser.json`; the enrolled learner journey remains outstanding.
- Temporary regression-test PostgreSQL was stopped. Obsolete generated local starter application/proxy files were removed; only source/review artifacts and engineering evidence remain in the workspace.
- Dedicated Azure organization, reviewable sample course, enrollment, real-auth journey, variant-matched human review and named physical-device acceptance remain outstanding.
