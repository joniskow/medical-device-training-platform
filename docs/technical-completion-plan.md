# Technical completion before UI

Date: 2026-11-07. Status: source implementations integrated across all seven workstreams; final independent local validation passed 105 of 106 checks, with the managed-auth build-artifact check blocked and a clean full web build outstanding. Hosted acceptance and launch approval remain open. See [the execution report](../tasks/technical-execution.md).

## Objective and scope

Finish the agreed MVP's APIs, database, workers, headless learning runtime, integrations, infrastructure and operating controls so a later UI can consume stable services. Reuse existing implementations and close their gaps. This extends the [project plan](../tasks/plan.md) and [backlog](../tasks/todo.md); it does not replace outstanding work.

Deferred: page/component design, styling, screen construction, final UI keyboard/screen-reader journeys and UI-specific physical-device acceptance. Still included: identity protocols/provider-hosted flows, model optimization/preparation, simulation semantics, equivalent-path APIs, narration/captions and media rendering. Those are technical dependencies of the future interface.

The milestone is **technically ready for UI integration**, not permission to launch the complete certification product. Independent content/model review, source/license clearance, final UI/device acceptance and organization-specific go/no-go remain separate gates.

## Baseline and findings

The application already implements substantial source processing, cited drafting, authoring, review/publication, learning, assessment/simulation, credential lifecycle, private delivery and tenant isolation. Do not rebuild those capabilities based on stale unchecked backlog entries.

The 2026-11-07 assessment passed build/typecheck and selected schema, assessment, certification-policy and controlled-auth checks. Root test/lint commands skipped substantive package suites; database-backed drafting could not run because its expected local PostgreSQL service was unavailable. Current Azure state was not independently inventoried.

Known gaps include real verified-email onboarding, the complete hosted enrolled-learner journey, production malware scanning, fail-closed provider configuration, provider URL trust, published dependency suppression, production telemetry, physical-device evidence and recovery rehearsal. Current video rendering is developer-mediated. Existing reconstruction evidence includes real engines but synthetic captures/fixture transport do not establish real-device/cloud acceptance.

Evidence: [MVP acceptance contract](medical-device-training-platform-solution-design.md#423-conditions-for-an-honest-mvp-promise), [hosted handoff](../tasks/developer-api-familiarization.md), [current delivery](../tasks/current-delivery.md), [render workflow](training-video-render-workflow.md), [operations runbook](operations-runbook.md).

## Delivery sequence

| Phase | Tasks | Exit result |
|---|---|---|
| A. Reproducible baseline | TC-01-03 | Reconciled code/cloud inventory, disposable restricted-role database, substantive CI gates. |
| B. Identity and trust | TC-04-09 | Real verification and account lifecycle, production scanning, safe egress, explicit provider configuration, abuse controls. |
| C. Certification vertical slice | TC-10-12 | Real-auth headless source-to-credential acceptance and versioned contracts for every UI surface. |
| D. Production processing | TC-13-19 | Evaluated real AI/retrieval, packaged reconstruction/model preparation, durable hosted rendering and narration. |
| E. Lifecycle and external services | TC-20-27 | Rights suppression, retention/holds, consent discovery/inquiries, reports/exports, webhooks and notifications. |
| F. Operations | TC-28-33 | Reconciled telemetry, enforced budgets, readiness/capacity evidence, restore/rollback/rotation rehearsals. |
| G. Security and handoff | TC-34-36 | Runtime feasibility, independent security review, hosted technical acceptance and UI integration package. |

Detailed acceptance, dependencies, verification, suggested implementation areas and sizing are in [the TC task list](../tasks/todo.md#technical-completion-before-ui---2026-11-07).

## Dependency order and checkpoints

Critical spine: TC-01 -> TC-02 -> TC-03 -> TC-04 -> TC-05 -> TC-10 -> TC-11 -> TC-12 -> TC-36. Final TC-36 also depends on every processing, lifecycle, operations and security checkpoint.

- Start identity and scanner service-selection spikes early. After the baseline, security, processing and lifecycle slices can progress independently where contracts/migrations do not overlap.
- Define contracts before downstream consumers. Serialize migration numbering and shared contract changes; preserve runtime grants and old-version compatibility.
- Introduce TC-28 telemetry before hosted processing rehearsals; implement TC-29 admission budgets before customer-scale reconstruction/rendering.
- Complete dependency suppression before final publication/revocation acceptance. Immutable evidence must coexist with current delivery restrictions.
- Rehearse restore after lifecycle/tombstone implementation, so restoration cannot resurrect withdrawn content or discovery consent.
- Verify each focused slice; run broader regression at checkpoints. Split tasks exceeding five likely source files or spanning independent behaviors before implementation.

### Checkpoint A/B: Trusted service foundation

Fresh checkout installs from the lockfile and builds. Restricted non-owner/non-bypass-RLS tests pass. A deliberately broken invariant fails CI. Real identity verification succeeds; forged/expired evidence fails. Malware and scanner outages are quarantined. Production rejects deterministic/missing provider configuration. Record commit, runtime/dependency versions and sanitized results.

### Checkpoint C/D: Complete headless product

A representative rights-cleared manual and GLB pass source approval, real Azure drafting, independent review, immutable publication, candidate enrollment, required procedure/fault/assessment, exactly-once credential issuance and public verification. Test retries, crashes, tenant substitution, source withdrawal, stale review and old release preservation. Photo and video jobs separately produce reviewable candidates through real storage/queue transport. Hosted lessons produce private source-bound video/audio/captions and cannot publish stale or unapproved artifacts.

### Checkpoint E: Privacy and integration completeness

Consent and credential lifecycle changes update discovery and inquiry access. Withdrawal/takedown reaches published delivery and dependent processing without rewriting historical evidence. Retention respects legal holds; restore reapplies tombstones. Reports reconcile with source records. Signed webhooks and notifications prove bounded retries, destination restrictions, deduplication and operator recovery.

### Checkpoint F/G: Technical readiness

Named operators receive deliberately triggered alerts. Representative concurrency and cost fit approved limits. Restore demonstrates the configured 15-minute RPO; set an explicit RTO target before rehearsal and record the achieved value. Regional recovery must actually be provisioned; do not infer it from a Southeast US config value. Rollback, queue replay and secret rotation preserve releases and credentials. Close security findings or record explicit accountable acceptance, never silent exceptions.

## Technical rules

- Preserve RLS, independent review, immutable release/evidence identity, server-authoritative scoring and credential idempotency.
- Public APIs require validation, tenant/role checks, stable errors, pagination/size bounds, concurrency/retry semantics and appropriate audit events.
- Label local fixtures, integration doubles and deployed evidence separately. Hosted acceptance uses real identity, queue, storage and provider paths.
- Pin versions and deploy tested image digests. Migrations are additive and tested with the previous compatible application version.
- Production startup rejects fixture providers and incomplete safety configuration. Feature switches can pause unsafe work, not silently remove agreed MVP scope.
- Keep Azure AI as the approved provider boundary. Any provider exception or engine-license decision remains explicit before enablement.
- Discovery/contact, reporting/exports and agreed customer API/webhooks remain in scope even with their screens deferred.

## Decisions resolved during implementation

| Decision | Task | Working approach |
|---|---|---|
| Verified-email authority | TC-04 | Test existing Entra/External ID assurance first. If inadequate, specify an Azure-hosted code flow and explicit server trust change; never manufacture token claims. |
| Malware service | TC-06 | Choose Azure-compatible scanning that gates processing on a trustworthy verdict and fails closed. |
| Reconstruction license/distribution | TC-15 | Resolve OpenMVS licensing before final packaging; retain working image and video paths. |
| Audiovisual providers | TC-07/18/19 | Preserve approved provider boundaries; prove real output and prohibit silent fixture success. |
| Withdrawal and credential effects | TC-20/21 | Preserve history, suppress unauthorized delivery and specify credential consequences explicitly. |
| RTO and service capacity | TC-30/32 | Set pilot service envelope from measurements; do not invent an HA/SLA commitment. |
| Machine integration authentication | TC-12/26 | Inventory current capability; provide least-privilege tenant-bound scopes and rotation where integrations require them. |

## UI integration deliverable

Deliver generated/versioned API contracts and client coverage; role/permission matrix; authentication/verification state machine; error/pagination/idempotency rules; upload/private-download protocols; job progress/cancel/retry behavior; authoring/review/publication states; learning/equivalent-path contracts; credential and discovery-consent semantics.

Include runnable headless examples, disposable seed/reset instructions, staging endpoint, test-account provisioning, capability discovery, sanitized fixtures, known limitations and version/deprecation policy. The UI must never become the authority for scores, approvals, rights or credential issuance.

## Remaining launch dependencies

After this plan: build the UI; perform full accessibility and physical-device product acceptance; independently approve actual pilot content/mechanics/source rights/licenses/issuer wording; measure a learner cohort; close organization-specific onboarding and DEC-020 go/no-go. Technical checks cannot manufacture these approvals.

Billing automation, enterprise SSO expansion, native/offline apps, VR/AR, advanced physics and portable cryptographic credentials remain future scope. The original certification MVP and reconstruction scope remain unchanged.

Task sizes are implementation slices, not calendar promises. Estimate the remaining work after baseline, identity and provider/engine spikes resolve; do not assign a completion date from unchecked-box counts.
