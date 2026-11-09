# End-to-end test report — 2026-11-08

Three UI defects were reproduced, corrected, and guarded by a browser regression. The fixes are deployed to [the Azure workspace](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/admin). This report distinguishes live Azure evidence from controlled local integration tests. A complete signed-in browser upload-to-result journey remains unverified pending interactive Microsoft sign-in.

## Confirmed bugs and fixes

| Defect | Reproduction and resulting behavior | Correction |
|---|---|---|
| Concurrent changes could be overwritten | Another editor updates lesson 2; load lesson 1's saved playback, then save. The UI adopted the newer course revision while retaining old lesson 2 values, allowing an overwrite without a revision conflict. | Before refreshing the editable revision, compare all saved content except the active lesson's render metadata. Reject external edits and retain the original revision so stale forms cannot overwrite them. |
| Second lesson invalidated first playback | Play saved lesson 1, then lesson 2. Fetching the first lesson's Blob URL failed because playback revoked every URL for the course. | Revoke only the active lesson's URLs. Course removal/sign-out still disposes all private media. |
| Two independent narration editors | A source-directed scene appeared in both the shot-plan and speech panels; editing the speech copy left the displayed shot script and review checkbox stale. | Use the existing shot-plan narration editor as the single editable script. Its edits update narration and direction together and clear source review. |

`node tools/check-admin-lesson-state-browser.mjs` failed with all three reproductions before the fixes and passes afterward. It also checks synchronized script saving and invalidation of the source-review confirmation. The test uses an isolated Chrome profile and an explicit controlled revisioned API.

## Live Azure checks

| Check | Evidence/result |
|---|---|
| Azure UI deployment | Candidate readiness, HTML and JavaScript returned HTTP 200. Served JavaScript SHA-256 matched the locally tested bundle. API image: `sha256:4605abbf00a64d0ebffc3ceccf1ae6e3c05330acd36b66e0e4b3fa2f109d15d9`; revision `mdt-personal-api--admin-e2e-r9`. Previous `admin-speech-r8` retained. |
| Main URL after promotion | Health, readiness, HTML, JavaScript and auth configuration returned HTTP 200. The served main-origin bundle matched the tested bundle; Microsoft application origin matched the main URL. Anonymous lesson-render and rights writes both returned HTTP 401. |
| Existing 3D sample | Loaded the actual hosted GLB in the browser; UI reported model ready. Rotate, zoom and reset controls remained usable. This is a bundled example, not reconstruction from newly uploaded photos. |
| Live learning services | Private job `mdt-personal-learning-smoke-u4idclu`: PostgreSQL/pgvector, 1,536-dimensional embeddings, generated course module, actual spoken audio and generated background MP4 all passed. No customer content or credentials were printed. |
| Narrated video | Private job `mdt-personal-learning-smoke-r97wa1b`: real Azure speech with delivery controls, measured narration 3.744 seconds, actual 30.021-second MP4 with video/audio streams and matching captions passed. The fictional temporary fixture was deleted and never published. |
| Microsoft sign-in entry | The hosted button redirected to the configured Microsoft tenant/application. The browser awaits interactive login. No credentials were extracted, fabricated, or supplied through a test identity. |

## Local controlled checks

These passed after starting the repository-owned disposable test containers. Initial connection-refused errors were due to stopped local services; they are not Azure application failures.

- `check-admin-workspace-browser.mjs`: PDF upload/hash-bound generation, readable results, speech settings/save/render/captions, listening confirmation, stale-playback invalidation, saved-result recovery, source approval/rights, 3D preview, backgrounds, report errors and company isolation; widths 320/768/1024/1440.
- The same browser test with `ADMIN_TEST_NO_MEMBERSHIP=1` and `ADMIN_TEST_NARRATION_FAILURE=1`: sign-out without membership and explicit audio-download failures with stale-audio removal.
- `check-admin-lesson-state-browser.mjs`: all three confirmed bug regressions.
- `check-admin-rights-postgres.mjs`: real HTTP authentication/role checks, restricted PostgreSQL tenant isolation, source/hash binding, explicit confirmation, replay/audit/withdrawal enforcement.
- `check-hosted-lesson-render-postgres.mjs`: render admission/outbox, replay, tenant denial, private content hashes, rights withdrawal, edits, cancellation, retry and lease fencing.
- `check-independent-headless-pipeline.mjs`: HTTP → restricted PostgreSQL/outbox → signed queue → worker → private Azurite → authorized bytes, including role/tenant/replay/hash/withdrawal denial. Identity, queue transport and renderer are controlled fixtures; this is not cloud acceptance.
- `check-hosted-lesson-http-routing.mjs`, `check-admin-rights.mjs`, `check-signin-browser.mjs` and `check-session-renewal-browser.mjs`: protected routing, safe input/replay behavior, MSAL loading/callback-related UI and renewed-token request behavior.
- Web TypeScript validation passed.

## Remaining limits

- Interactive Microsoft login is still required to test the real signed-in browser journey from new upload through review, generation, persisted result and private playback. The Azure CLI identity has not been consented for this application's delegated API scope; no permissions were changed to bypass that boundary.
- One-photo reconstruction is disabled in the deployed worker (`RECONSTRUCTION_SINGLE_IMAGE_ENABLED=false`). New live photo/video reconstruction was not executed. Controlled reconstruction/browser tests do not establish production reconstruction quality.
- Hosted rendering supports synthesized speech-only narration. Recorded narration and independently reviewed device-sound mixing still use the advanced local rendering workflow.
- Real speech/MP4 engineering checks do not replace human listening, source fidelity, clinical or independent publication review.
- No CI run was triggered or claimed as passed. No release was published and no email was sent.

The disposable local test containers started for this audit were stopped afterward; the customer application continues to run on Azure.
