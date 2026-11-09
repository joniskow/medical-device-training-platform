# Independent technical implementation verification

Date: 2026-11-07. Scope: independent headless implementation testing after the seven implementation workstreams and shared integration. This is local technical evidence, not launch approval or proof that software is free of bugs.

## Subsequent bug fixes

The subsequent [bug audit and correction record](./bug-audit-2026-11-07.md) documents two additional reproduced defects, their fixes, 14 independently reviewed PostgreSQL cases and the newer 105/106 validation checkpoint. The results below retain the earlier independent full-run evidence.

## Earlier frozen results

| Gate | Result |
|---|---|
| Fresh backend, contracts, worker and generated client build | Passed; web bundle excluded following the denied outside-sandbox build request |
| Whole-workspace TypeScript checks, including web | Passed |
| Source lint | Passed, 578 source files |
| Pure profile | 47/47 passed |
| Authentication/security profile | 11/12 passed; managed-auth environment failure retained |
| Database profile | 37/37 passed |
| Integration profile | 7/7 passed |
| Infrastructure profile | 1/1 passed, compiling ten templates with pinned Bicep 0.49.2 and no diagnostics |

**103 of 104 named profile steps passed.** The failed step is not counted as a pass. Individual steps contain multiple assertions and scenarios; 104 is the number of executed manifest steps, not a count of individual unit tests. These final results supersede the earlier 94/96 checkpoint.

The full build reached the web bundler and failed because esbuild could not traverse an ancestor directory under the sandbox. Its outside-sandbox retry was rejected by the user. The later frozen build refreshed backend/client artifacts without retrying that permission. The authentication profile's remaining failed step is:

- `managed-auth`: esbuild cannot resolve its temporary entry file under the sandbox. Its earlier denied escalation was not retried.

The final browser-auth-configuration HTTP check passed. That check does not establish a complete freshly bundled browser application; full browser delivery remains outside accepted build evidence.

The [validation manifest](../config/technical-validation.json) defines the exact steps. Machine-readable results remain in the ignored output directory: `output/technical-validation/pure.json`, `auth.json`, `database.json`, `integration.json` and `infrastructure.json`.

## Frozen source identity

All five final profile receipts have `sourceStable: true` and identical source metadata. The tree contains pre-existing staged work and this execution's uncommitted implementation; the revision alone does not identify the tested tree.

| Identity | Value |
|---|---|
| Base revision | `72a5ca104cfb157f439ee8f75ccf1e055baeb1c1` |
| Source tree SHA-256 | `48b2a301e21fd9b199bff7b23cdc034f5b05311d8dcd0b35f9d52b38cd47d8ee` |
| Tracked diff SHA-256 | `c2cd8cd45a27c9e4af547d456d2b17f31bf22241fe5f1d2be1e1f825033c855b` |
| Manifest SHA-256 | `e8310c11be208852a5d21eeeca058da79bfd476b2e4147fde054cec7630f5ea3` |
| Lockfile SHA-256 | `39f21b6b164dccb486d06180dfab8ec85f48fa4f513af8afb3d0b45571f9f91c` |

Tracked source or documentation edits after this freeze require new receipts for the changed tree. This untracked Markdown report is outside the runner's source extension inventory and does not modify the recorded tracked diff.

## Independent end-to-end and adversarial coverage

- [Headless pipeline](../tools/check-independent-headless-pipeline.mjs): actual HTTP admission, restricted PostgreSQL job/outbox state, signed queue routing, worker processing, private Azurite writes and authenticated artifact retrieval. Negative checks include roles, tenant substitution, duplicate messages, corrupted bytes and source-rights withdrawal. Identity, queue transport and renderer are controlled boundaries.
- [Lifecycle HTTP](../tools/check-independent-lifecycle-http.mjs): actual HTTP and restricted PostgreSQL discovery ownership, cohort privacy, inquiry replay and recipient-only response, contact withdrawal, asynchronous private export authorization/expiry and webhook secret exposure rules. Export object transport and identity are controlled.
- [Runtime boundaries](../tools/check-independent-runtime-boundaries.mjs): 13 private tables reject runtime SELECT; eight immutable-evidence triggers are installed; actual audit row locking succeeds while UPDATE/DELETE fail and foreign tenant rows remain invisible.
- [Retention fairness](../tools/check-independent-retention-fairness.mjs): eligible retention work is found within two bounded scans behind 100 older organizations whose jobs remain active.
- [Metered retention](../tools/check-independent-metered-retention.mjs): actual PostgreSQL/Azurite with domain and metering pools each capped at two connections handles eight concurrent writes. A ninth physical write followed by domain rollback preserves usage and retention receipts; bounded reconciliation recovers the orphan without inventing a deletion policy.
- [Non-superuser maintenance owner](../tools/check-independent-maintenance-owner.mjs): isolated copies of actual selector definitions first reproduce invisible work under FORCE RLS, then verify the production owner-only policy factory. A legal hold remains effective, and the caller cannot probe hold state or read routing tables directly. The [actual maintenance routing test](../tools/check-maintenance-routing.mjs) additionally exercises inquiry-expiry notifications/outbox/audit insertion under the managed-PostgreSQL-like owner and verifies context restoration.
- Actual local FFmpeg rough/final rendering and corrected scene processing passed. The audio is explicitly an engineering signal, not accepted narration.
- Actual pgvector storage, cosine ranking, persisted vector cache, source-hash/configuration isolation and withdrawal checks passed. Embeddings are controlled vectors, not a production quality evaluation.
- Signed app-only token HTTP and restricted database tests passed for registered client/service-principal/tenant scopes, human API exclusion, opaque external references, webhook delivery aliases, token cutoff and revocation. Token signing is controlled; live Entra client-credentials issuance was not tested.
- TC28 signal checks passed for bounded/throttled outbox sampling, filtered broker-age observations, unknown sample semantics, correlation hashing, sink/connection-failure isolation, committed usage/AI signals and four workbook contracts. A real non-superuser/non-bypass outbox role observed routing aggregates across two organizations while credential-table reads remained denied. Production KQL, metric export and alert delivery are not established by these checks.

The final profiles also exercised authoritative assessment/credential workflows, independent publication, source approvals, account/organization lifecycles, production scanner protocol, pinned provider egress, email verification, admission budgets, shared rate limits, migration/bootstrap and private uploads.

## Correction loops completed

1. Independent review identified stale export workers overwriting a newer successful artifact and reverting outbox state. The lifecycle owner introduced attempt-specific objects and a fenced winning pointer. The owner's takeover regressions and independent rerun passed.
2. The independent retention test reproduced permanent starvation behind 100 ineligible organizations. The lifecycle owner added durable scan progress; the independent bounded-scan regression passed.
3. Restore review identified inconsistent resource and exact-asset suppression. The lifecycle owner reapplied exact-asset tombstones and retired state during replay; the expanded real PostgreSQL/Azurite suite passed independently.
4. Layering review exposed the need for durable accounting and object registration after domain rollback. Separate metering/receipt pools, durable write receipts and bounded orphan reconciliation were implemented; independent concurrency/rollback/recovery checks passed. The helper now rejects a missing or identical receipt pool before I/O.
5. The first frozen profiles found an architecture prose false positive, optional/empty-query retrieval coverage differences, an obsolete exact policy-count assertion, an outbox query selecting a new webhook row and an outdated withdrawn-model error assertion. Original owners corrected implementation or assertions, added focused regressions, and the final pure/database suites passed. No security denial was changed into an allowed operation to obtain a pass.
6. Non-superuser owner tests reproduced global maintenance selectors returning no work behind FORCE RLS, a condition hidden by superuser fixture ownership. The lifecycle owner introduced a dedicated NOLOGIN/NOSUPERUSER/NOBYPASSRLS owner and narrowly scoped policies. A further independent hold test found the source-retention selector could not see held state; its helper now establishes/restores the exact tenant context, with direct caller probing denied. Both isolated and actual-function regressions passed.
7. Post-I/O receipt failure tests covered both the retention receipt commit and an inner usage-metering commit after actual Blob success. Ambiguous outcomes now retain durable STARTED receipts instead of falsely asserting physical failure; reconciliation recovers the object without automatic deletion. The independent production-layering test passed.
8. Hybrid retrieval provenance was separated into semantic ranking versus lexical matching, and persisted AI evidence records the hybrid version and embedding configuration. Actual pgvector and legacy grounding regressions passed independently.
9. Independent telemetry review reproduced a queue-sampler connection acquisition failure escaping into business maintenance. The operations owner isolated acquisition/rollback/release errors; the original repro and expanded signals/non-superuser database tests passed.

## Acceptance not established by these tests

No cloud deployment, production email delivery, live Entra identity journey, complete real-provider source-to-credential journey, live malware-engine deployment, GPU/model-weight inference acceptance, measured production AI quality, real customer captures, provider billing reconciliation, production load, alert receipt, restore/rollback/rotation rehearsal, physical-device acceptance or qualified content/licensing approval is claimed. Bicep compilation does not prove successful deployment or operating permissions.

The complete web build and managed-auth bundling check require an environment in which the bundler can run. CI image builds, remote vulnerability/secret scans and production acceptance must be executed against the eventual release artifact. See the [technical acceptance policy](../config/technical-acceptance.json) and [technical security review](technical-security-review.md).

The tests demonstrate the named local scenarios and corrected regressions. They do not certify every requirement merely because its implementation or documentation exists, and they do not justify a bug-free or go-live claim.
