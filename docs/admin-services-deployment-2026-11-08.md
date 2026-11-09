# Azure service workspace rollout ? 8 November 2026

Live page: https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/admin

The simple workspace now exposes seven service areas and 78 selectable actions from the deployed catalogue and existing content routes. Nine application-identity automation endpoints remain separately configured rather than being called with a human token. Infrastructure services remain behind the existing API; cloud credentials and infrastructure configuration are not exposed to end users.

## Changes

- Editable learning defaults for audience, knowledge, format, video length, objective, setting, source revision, visual style and terminology. Approved reference selection is tied to a saved validated lesson brief before video generation. Document-only generation works without approved views.
- Scene presets, actual Azure narration voice choice, and optional spoken narration.
- Forms for reports, private export creation/status/download, notification preferences, event connections, integration clients, discovery, credentials, privacy and retention. Existing interactive tools remain available for review, publishing, simulations, assessments and company membership.
- Explicit write review, unchecked confirmation, idempotency, saved-value loading and returned revision updates. Results use text rendering; returned connection secrets are masked. Company changes dispose private results and downloads. Missing permissions and unavailable dependencies are shown as errors.

## Verification

Passed TypeScript validation, lesson-brief evidence/generation checks, rights checks and hosted-render HTTP routing checks. Dedicated real Chrome fixtures passed upload/hash-bound generation with the customized brief saved first, speech controls/render/captions/recovery, source review/rights, reconstruction and actual WebGL viewing, backgrounds, report errors and company isolation. Both the missing-membership and narration-download-failure variants passed. Cross-lesson URL ownership, concurrent-editor protection and synchronized narration regressions passed.

The service browser regression renders every action, exercises controlled export download, saved connection settings, explicit mutation confirmation, notification revision updates, secret masking, 503 handling and private-result disposal. It passes against both the checked-in and freshly downloaded live API catalogue. These writes use fixtures; no invitation, email, webhook, consent or retention action was performed against real user data.

## Deployment evidence

ACR build `cj2g` succeeded. API revision `mdt-personal-api--admin-services-r11` is Healthy/Provisioned and receives 100% of traffic. Image: `mdtpersonalacr01.azurecr.io/api@sha256:c33012c5be0bc174fd64f374cd1feeeda11c8471ddcaa3fd7e4aff50c0d78473`.

The overlay uses the then-current `bugfix-1108` backend image (`sha256:95139481b61750ad63b2fbbcef9d1388e3cb21beb05b549c59efbb03b775e797`) to preserve its intervening fixes. Worker and private configuration are unchanged. The earlier r10 build was not deployed. Previous `bugfix-1108` revision is retained for rollback.

Candidate and public UI JavaScript hashes match the tested build. Public readiness returned ready; unauthenticated private-export creation returned 401. In the real shared browser, the new service catalogue loaded 78 actions, summary/JSON export defaults were visible, protected actions remained disabled without sign-in, and the page had no horizontal overflow at the checked desktop viewport.

## Remaining acceptance

The shared browser remains signed out. A complete signed-in live upload-to-result workflow is not established by these controlled tests. Existing real-provider smoke evidence is recorded in the earlier E2E report; this UI-only rollout did not repeat those paid provider operations. Recorded narration and verified device-sound mixing still require the advanced CLI and are explicitly identified as unavailable in this hosted panel. Reconstruction methods remain subject to the live server configuration; the UI does not enable unsupported one-photo generation. Azure Monitor, Key Vault, queue and storage settings remain operator-managed backend services.
