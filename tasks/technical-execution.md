# Technical implementation and verification

Date: 2026-11-07. Shared foundations and all seven workstreams are integrated. Final independent validation passed **105 of 106 named checks** on one unchanged source fingerprint, after original owners corrected the independent findings. **Technical launch acceptance is not complete:** the full web build and the managed-auth artifact check remain blocked, and real deployed/provider/recovery/device evidence remains outstanding.

## Follow-up bug audit

A subsequent [bug audit](../docs/bug-audit-2026-11-07.md) reproduced stale-worker lifecycle writes and raw exception disclosure. Both are now corrected: lifecycle/job outcomes commit atomically under the current lease, and stored unexpected exceptions plus historical status responses use safe failure messages. Independent review expanded the real PostgreSQL fencing regression to 14 passing cases. New fencing/privacy regressions are registered in validation.

## Work completed

The user requested shared implementation first, one implementation agent per workstream, and a separate independent tester who returns failures to the original owners. That sequence was followed. Existing staged work was preserved; no commit, push, deployment or launch approval is claimed.

Shared foundations reuse tenant transactions/RLS, private object storage, immutable releases and authoritative assessment/credential rules. Added shared production configuration, 4,000 AI output-token/four-job limits, conservative global admission with the $500 monthly pilot envelope, signed delayed retries, immutable evidence triggers, a single runtime grant matrix and substantive source-fingerprinted validation. Production rejects missing/fixture provider configuration and missing hybrid retrieval configuration.

| Workstream | Implemented and integrated |
|---|---|
| 1. Baseline and CI | Explicit nonempty validation profiles, guarded disposable environments and restricted roles, meaningful test/lint commands, pinned CI tooling, generated-client drift checks, infrastructure compilation, image/SBOM/vulnerability/secret gates and optional scanner/single-image build jobs. |
| 2. Identity and security | Durable independently verified email challenges and managed-identity email sender; actual ClamAV protocol adapter and private scanner recipe; bounded pinned HTTPS provider egress; signed Entra app-only client credentials with tenant/scopes/roles, opaque external references, revocation and rotation cutoffs. |
| 3. Certification APIs | Generated versioned contracts/client, stable typed request transport, course review/publication, enrollment/assessment/credential lifecycle compatibility checks and a fail-closed real-identity acceptance runner. |
| 4. Processing | Hybrid full-text/pgvector retrieval, bounded Azure embeddings and source/configuration caching/backfill; preserved photo/video engines; isolated optional single-image worker with verified offline assets/preflight; durable private lesson rendering, narration/captions/provenance and reviewed corrected-clip promotion; stale/retry/cancel/lease fences and media input restrictions. |
| 5. Lifecycle and integrations | Transitive withdrawal and historical evidence preservation; source/derived-resource holds, explicit retention policies, tombstones and durable orphan-write recovery; consent discovery/inquiries and competency/course/policy/product filters; filtered course/activity reports, consistent exports, required webhook families and lifecycle notification delivery. |
| 6. Operations | Replica-wide rate/admission/budget controls, readiness/drain, four operational workbooks, bounded queue/provider/cost/pool signals, database-pressure alerts and an independent readiness probe, conservative failure accounting, durable measured storage/provider usage and trusted billed reconciliation; private infrastructure/secret references; serialized privileged migration job and guarded operator recovery/rollback/rotation tools. |
| 7. Acceptance and handoff | Versioned acceptance policy, source/image/evidence gates, independent boundary tests, security findings/corrections and the UI integration handoff. |

## Independent correction loop

The independent tester found stale export workers could overwrite winning objects and mutate published outbox state. The lifecycle owner introduced attempt-specific objects and fenced winner finalization; independent reruns passed. Retention scanning could starve eligible organizations; a durable fair scan cursor and independent regression passed. Blob writes surviving domain rollback initially lost retention registration; independent receipts and bounded reconciliation now recover such objects as orphans without granting purge permission. A required distinct receipt pool prevents connection starvation.

Frozen regression also found optional retrieval evidence compatibility and empty-query relevance errors. The processing owner corrected them and proved unknown/zero/positive cases. Baseline owners corrected architecture-checker prose/regex false positives using the existing pinned AST parser, verified exact tenant/dispatcher policies, and scoped publication assertions to the correct outbox event. Security invariants were retained.

Independent testing also reproduced maintenance routing failures under a non-superuser function owner with FORCE RLS. A dedicated NOLOGIN, non-superuser routing owner and narrowly scoped policies/functions restore maintenance without exposing cross-tenant rows to API/outbox callers. Held-source filtering, private helper denial and context restoration passed real PostgreSQL tests. Hybrid evidence now separates fused semantic rank from lexical support and records the pinned retrieval configuration. The tester caught a telemetry connection failure escaping the sampler; its original owner added safe failure handling and a regression proving the maintenance cycle continues.

## Final frozen validation

| Profile | Passing steps | Result |
|---|---|---|
| pure | 48/48 | Passed |
| auth | 11/12 | managed-auth blocked/failing; browser-auth-config passed |
| database | 38/38 | Passed |
| integration | 7/7 | Passed |
| infrastructure | 1/1 | Passed |

Backend and generated-client fresh builds passed. Full workspace typechecking passed. Source lint passed for 581 files. The infrastructure profile compiled all ten Bicep templates with pinned digest-verified Bicep 0.49.2 and no diagnostics.

All five profile files report sourceStable=true and the same source tree SHA-256:

f78059e3a50ee15aea88d108d4a68c29b9ddb7877eb59442e6c35aa7934f2893

The authoritative profile receipts are in [post-fix local validation evidence](../output/bug-fixes/). They retain actual failures and do not convert an unavailable environment into a pass. These are dirty-working-tree source fingerprints, not a committed or deployed image identity. UI remains deferred.

### Blocked verification

The frozen whole-workspace build compiled backend/client packages, then the web esbuild process failed on sandbox filesystem access. Its requested outside-sandbox rerun was rejected and was not retried. The final browser-auth-config check passed. The managed-auth check still cannot build its temporary esbuild artifact inside the sandbox and remains an actual failed result in the evidence. A permitted clean full build and managed-auth rerun are required; no earlier full-build success substitutes for this frozen source.

The optional single-image image build/public dependency and model downloads were also rejected. Static packaging/preflight and controlled runtime tests pass, but the resulting production image and real inference are unverified. Azure profile inspection and other earlier declined tool requests were not retried.

## Required before technical go-live

1. Complete a clean full build and the blocked managed-auth check; execute remote CI, dependency/secret/container scans and promote their tested image digests. Build and scan the single-image/scanner targets and run actual inference and clean/EICAR/outage/freshness tests.
2. Provision/reconcile isolated staging from the compiled infrastructure, migration/grants and secret references. Prove genuine Entra user and client-credentials flows, email verification/delivery, private storage, signed queue, real Azure AI/embeddings/speech/video and real receiver/webhook behavior.
3. Execute the complete real source-to-independent-review-to-publication-to-enrollment-to-procedure/fault/assessment-to-credential/public-verification journey. Validate retries, crashes, withdrawal and historical evidence on the deployed digests. Local protocol doubles and prepared-course subsets do not satisfy this gate.
4. Measure held-out source/retrieval quality, real photo/video/single-image reconstruction and optimized-model fidelity, spoken narration/captions and the agreed technical device/runtime envelope. Supply qualified source/license/content/mechanical approvals; finish final UI/accessibility journeys later.
5. Approve and apply resource-specific retention policies/rate inputs, reconcile actual storage/invoices, receive deliberately triggered alerts and measure load/cost. Rehearse DB/Blob/key recovery and tombstone/orphan reconciliation, record actual RPO/RTO, and execute rollback/drain/replay/rotation drills. Configuration does not prove regional recovery.
6. Retain the independently reviewed acceptance receipts and named pilot go/no-go. The 36 TC tasks remain acceptance-tracked; local tests do not manufacture those approvals.

No finite test run establishes that software is free of bugs. The two follow-up audit defects are now covered by passing regressions; the blocked build/authentication verification and the acceptance gates above remain explicit.

## Maintainer handoff

Start with [the UI integration handoff](../docs/ui-integration-handoff.md), [validation commands](../docs/technical-validation.md), [technical operations](../docs/technical-operations.md), [machine integrations](../docs/machine-integrations.md), [hybrid retrieval/backfill](../docs/hybrid-source-retrieval.md), [hosted rendering](../docs/hosted-lesson-rendering.md), [single-image packaging](../docs/single-image-worker-runtime.md), [security review](../docs/technical-security-review.md) and [the original technical plan](../docs/technical-completion-plan.md). The substantive test manifest is the maintained list of automated checks; new regressions belong in the applicable profile.


## Azure deployment ? 8 November 2026

The two follow-up fixes are now deployed on top of the latest administration/speech images. The [deployment report](../docs/azure-bugfix-deployment-2026-11-08.md) records the actual Azure PostgreSQL regression, scanner self-tests, successful API readiness, 100% traffic and preserved rollback revisions. The earlier local managed-auth build limitation was cleared by a successful Azure Linux verification build. Wider acceptance gates above remain separate.
