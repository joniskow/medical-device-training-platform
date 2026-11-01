# Requirements Reconciliation Audit

Source: `docs/medical-device-training-platform-solution-design.md` v0.31.  
Backlog: `tasks/todo.md`.  
Audit role: Chief Solution Architect standup review.

Decision ownership and approval status are separated from implementation work in [tasks/decisions.md](decisions.md). A covered requirement is not considered pilot-ready until its linked technical evidence exists and any prerequisite decision is approved.

## How to read this audit

This is a design-to-backlog reconciliation, not an implementation sign-off. `Covered—unproven` means the backlog contains the required work and acceptance evidence, but no software evidence exists yet. `Decision required` means the design intentionally leaves a product, legal, customer, or deployment choice open. Only the E10 pilot gate can change a row to pilot-validated or released.

## MVP acceptance checklist reconciliation

### Organization and access

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| Persistent personal learner account | E2-S1 | Entra/browser sign-up, verified profile, resume test | Covered—unproven |
| Email verification, password recovery, invitations, switching | E2-S1, E2-S3, E2-S4 | Identity and invitation E2E, expiry/replay tests | Covered—unproven |
| Multiple organization memberships | E2-S3 | Two-organization context-switch test | Covered—unproven |
| Organization roles restrict actions | E2-S5, E2-S7 | Full authorization matrix | Covered—unproven |
| Cross-tenant reads/writes fail | E2-S6, E10-S1 | Adversarial API/storage/job/retrieval/RLS suite | Covered—unproven |
| Database-enforced tenant isolation | E2-S6, E1-S6 | Production-schema RLS and non-owner role test | Covered—unproven |
| Author cannot be sole approver/publisher for critical content | E2-S5, E6-S5 | Role-separation publication test | Covered—unproven |

### Ingestion and authoring

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| PDF produces searchable content with page citations | E3-S7, E5-S1 | Reference PDF extraction/citation test | Covered—unproven |
| Upload formats, limits, resume, cancel/retry, checksum, unsupported errors | E3-S2, E3-S6 | Upload failure/recovery matrix | Covered—unproven |
| Existing 3D upload produces approved browser model | E3-S8, E4-S1 | Rights-cleared GLB device run and model review | Local manifest/runtime evidence passed; rights-cleared deployed model review remains open |
| Supported image fixture produces candidate and quality report | E8-S1, E8-S3 | Image fixture report and reviewer decision | Covered—unproven |
| Supported video fixture produces candidate and quality report | E8-S2, E8-S3 | Video fixture report and reviewer decision | Covered—unproven |
| Quality report includes coverage, scale, geometry, mapping, device performance | E8-S3 | Measured quality report | Covered—unproven |
| Unsupported image/video profiles are rejected before publication | E8-S1, E8-S2 | Negative fixture and publication-block test | Covered—unproven |
| AI creates structured source-linked draft | E5-S2, E5-S3 | Cited course/assessment/simulation draft | Covered—unproven |
| AI output remains draft until approved | E5-S3, E6-S5 | Unapproved-content publication test | Covered—unproven |
| No-code authoring supports all MVP activities | E6-S1 | Author creates each activity type without engineering | Covered—unproven |
| Pinned AI deployment passes evaluation set | E0-S4, E5-S6 | Versioned schema/citation/conflict/tenant/safety/cost report | Decision required + unproven |

### Simulation and learning

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| Select and manipulate configured components | E4-S2, E7-S6 | Reference semantic-action run | Local desktop/mobile-emulated semantic completion passed; named physical-device run remains open |
| Complete configured procedure | E6-S3, E7-S7 | Procedure completion and deterministic outcome | Covered—unproven |
| Encounter and resolve injected fault | E6-S3, E7-S6, E7-S7 | Fault fixture run and replay | Covered—unproven |
| Server-authoritative certification simulation | E7-S5, E7-S6 | Tamper, stale, duplicate, concurrency tests | Local authoritative/replay/tamper contract evidence passed; deployed E7 certification path remains open |
| Semantic actions recorded reliably | E4-S3, E7-S6 | Action trace/replay/idempotency test | Local persistence/idempotency/recovery evidence passed; deployed release session remains open |
| Assessments work desktop and mobile | E7-S9, E10-S2 | Named-browser/device assessment E2E | Covered—unproven |
| WebGL2 fallback/context loss/device matrix | E0-S3, E4-S1, E4-S4 | Device/performance/context-loss report | Local Chrome/emulated matrix and context-loss evidence passed; physical Safari/device report remains open |

### Certification

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| Issuer configures requirements, thresholds, retries, expiration | E7-S8 | Policy editor/evaluator tests | Covered—unproven |
| Server computes result; client cannot self-award | E7-S7, E7-S9 | Forged-result test | Covered—unproven |
| Passive completion cannot issue credential | E7-S3, E7-S8 | Passive-only policy negative test | Covered—unproven |
| Attempts retained and auditable | E7-S9, E7-S13 | Immutable attempt/audit/export test | Covered—unproven |
| Exactly one credential per qualifying completion | E7-S10 | Concurrent/repeated submission test | Covered—unproven |
| Public credential verification | E7-S12 | Unauthenticated verification E2E | Covered—unproven |
| Online lookup, not portable proof | E0-S1, E7-S12 | Copy/QR/public-contract review | Covered—unproven |
| Expiration, revocation, supersession reflected | E7-S11, E7-S12 | Lifecycle and read-time status test | Covered—unproven |
| New course version does not mutate old credentials | E6-S6, E7-S11 | Release/requalification replay test | Covered—unproven |
| Independent candidate enrollment and sharing | E7-S1, E7-S2, E7-S12 | Candidate journey and QR share test | Covered—unproven |

### Discovery and integration

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| Discoverability opt-in and reversible | E9-S1 | Default-off/withdrawal/projection-lag test | Covered—unproven |
| Search excludes hidden/inactive learners/credentials | E9-S2 | Projection/status test | Covered—unproven |
| Employer contact requires consent | E9-S3 | Inquiry acceptance/denial test | Covered—unproven |
| Search authenticated, bounded, rate-limited, non-exportable, block/report/withdraw/expire | E0-S6, E9-S2, E9-S3 | Privacy and abuse suite | Covered—unproven |
| Core API documented in OpenAPI | E1-S7, E9-S7 | OpenAPI lint/generated-client test | Covered—unproven |
| Critical API contracts pass idempotency/version/tamper/redaction tests | E1-S7, E4-S3, E7-S5–S12 | Contract and adversarial suite | Covered—unproven |
| Webhooks signed, retried, observable | E9-S8 | HMAC/replay/retry/dead-letter report | Covered—unproven |
| Notifications deduplicated, redacted, retried, visible, email observable | E9-S4 | Provider failure/retry/redaction test | Covered—unproven |
| Usage meters for AI, reconstruction, storage, learner delivery | E0-S6, E8-S4, E9-S6 | Reconciliation report | Covered—unproven |

### Operations

| Source requirement | Backlog coverage | Required evidence | Current status |
|---|---|---|---|
| Jobs retryable and operator-visible | E3-S5, E3-S6, E10-S4 | Queue/dead-letter/operator test | Covered—unproven |
| Application errors have correlation IDs | E1-S8 | Cross-service correlation trace | Covered—unproven |
| Secrets absent from source control | E1-S5, E10-S1 | Secret scan and deployment test | Covered—unproven |
| Production isolated from development | E1-S4 | Environment/resource isolation test | Covered—unproven |
| Backup and restore tested | E10-S5 | Restore rehearsal | Covered—unproven |
| Restore verifies old/new credentials and replays effects safely | E7-S13, E9-S9, E10-S5 | Restore plus outbox/deletion/projection replay | Covered—unproven |
| Liveness/readiness/drain/dead-letter recovery | E1-S8, E3-S5, E10-S6 | Deployment/failure rehearsal | Covered—unproven |
| Accessibility, keyboard, captions, visual, responsive checks | E1-S9, E4-S4, E10-S2 | Accessibility/device/visual report | Covered—unproven |
| Threat model and runbooks approved | E10-S1, E10-S4, E10-S5 | Security review/runbook exercises | Covered—unproven |
| Export, account/source lifecycle, takedown, holds, restore deletion replay | E0-S5, E3-S4, E9-S9, E10-S5 | Lifecycle/hold/takedown/export report | Covered—unproven |
| Event envelopes, compatibility, idempotent consumers, projections, replay | E9-S8, E10-S5 | Old/new consumer and replay suite | Covered—unproven |

## Architecture-contract reconciliation

| Design contract | Backlog coverage | Evidence required |
|---|---|---|
| One simple pilot topology before service splitting | E1-S4, E10-S3 | Bicep topology and scale-trigger report |
| Provider-neutral ports and dependency direction | E1-S1, E1-S3 | Architecture-import and adapter contract tests |
| Common asset adapter `inspect/canProcess/process` envelope | E3-S5, E8-S1–S2 | Adapter contract suite |
| AI gateway operations, versions, budgets, safety, citations | E5-S2–S6 | Mocked provider, evaluation, and promotion gate |
| Pure simulation/policy ports | E6-S3, E7-S8 | Domain unit tests with no infrastructure imports |
| Private storage/messaging/notification ports | E1-S1, E1-S4, E3-S2, E9-S4 | Test doubles and production adapter contracts |
| Browser runtime receives approved manifest/state and sends semantic actions | E4-S1–S3, E7-S5–S7 | Runtime/API tamper and version-binding tests |
| PostgreSQL constraints, RLS, transaction boundaries, JSON schema evolution | E1-S6, E2-S6, E7-S10, E9-S4, E10-S5 | Migration, constraint, RLS, concurrency, replay, and restore tests |
| Event schema compatibility, projection rebuild, replay/backfill | E9-S8, E10-S5 | Versioned envelope/consumer/rebuild report |
| Content-change impact and requalification | E7-S11, E10-S7 | Issuer decision and learner communication evidence |
| Exact quota/rate-limit/cache/egress controls | E0-S6, E4-S4, E9-S2 | Quota denial, metering, cache, and abuse tests |
| Core record relational fields and protected sensitive references | E1-S6, E1-T39, E2-S4, E7-S12, E9-S8 | Schema/field review, hash/protected-reference tests |
| Post-commit notification workflow and template behavior | E9-S4 | Outbox-to-notification/email/dismissal/redaction test |

## Business and experience reconciliation

| Business/design requirement | Backlog coverage | Evidence required |
|---|---|---|
| Reduce onboarding time versus live training | E9-S6 | Baseline and pilot cohort comparison |
| Reduce authoring time without engineering intervention | E5-S4, E6-S1, E9-S6 | Timed author/reviewer study |
| Preserve trust and source traceability | E5-S3, E6-S5–S6, E7-S13 | Citation, review, release, and evidence bundle |
| Make learner path understandable and resumable | E7-S2–S4, E10-S2 | Journey usability and recovery test |
| Make credential meaning clear | E0-S1, E7-S12, E10-S7 | Verifier/learner comprehension test |
| Keep the experience calm, accessible, and non-game-like | E1-S9, E10-S2 | Visual/accessibility review on named profiles |
| Keep platform economics within pilot budget | E0-S6, E8-S4, E9-S6, E10-S3 | Cost-per-course/certification report |

## Source-section coverage

| Source sections | What was checked | Backlog/audit coverage |
|---|---|---|
| 1–4 | Executive intent, users, success definition, hard constraints, out-of-scope, capability map, build order, architecture principles | E0 boundary/fixture/decision stories; plan dependency order; global guardrails |
| 5 | Azure web/API/database/storage/jobs/identity/AI/retrieval/secrets/notifications architecture | E1 foundation; E2 identity/tenancy; E3 jobs/assets; E5 AI/retrieval; E9 notifications |
| 6 | Rendering, normalization, reconstruction, model states/metadata, simulation schema, performance, media contracts | E3-S8, E4-S1–S4, E6-S3, E8-S1–S4 |
| 7 | AI responsibilities, lifecycle, prompt/retrieval security, model strategy, evaluation and production controls | E5-S1–S6, E10-S1 |
| 8 | Course hierarchy, activity catalog, authoring workflow, publication rules, release snapshot | E6-S1–S7 |
| 9 | Access modes, candidate journey, progress/evidence, server-authoritative sessions, policy, retries, credential lifecycle, requalification, intended use | E7-S1–S13 |
| 10–12 | Discovery/privacy/contact, roles/authorization, entities/relationships/immutability | E2-S5–S6, E7-S11–S12, E9-S1–S3, E1-S6 |
| 13–16 | REST/OpenAPI/API examples/webhooks, security/privacy/trust, reporting, NFRs | E1-S7–S8, E7-S5–S12, E9-S5–S8, E10-S1–S3 |
| 17–19 | Environments/IaC/network/config/rollout/CI/CD/tests/observability/runbooks/restore | E1-S4–S8, E10-S1–S6 |
| 20–25 | MVP capability checklist, future phases, risks, ADRs, spikes, acceptance gates | E0–E10 stories, future parking lot, checkpoints, requirements-audit tables |
| 26–28 | Specification boundaries, source references, recommended next step | Global guardrails, E0 decisions, E1 foundation, source remains design evidence only |
| 29–31 | Technical baseline, repository/flows/state machines/contracts, UX/cost/maintainability/security/business instrumentation, readiness/status | E1–E10 detailed tasks; standup audit; requirements-audit contract/business tables |
| 32–34 | Standup work packages, Definition of Done, pilot topology/scale triggers, alternatives | E0–E10 hierarchy, global definition, E1-S4, E10-S3, audit stop conditions |
| 35–39 | Data lifecycle/export/deletion, event evolution, medical-device guardrails, glossary, synthetic fixture | E0-S5, E3-S4, E7-S11/S13, E9-S8/S9, E10-S5/S7, E0-S2 |
| 40–42 | Technical closure contracts, build-ready gates, remaining sign-offs, product/visual/business validation, evidence status | E0 sign-offs, E1–E10 gates, E10-S2/S7, requirements-audit evidence classifications |
| 43–44 | Stable internal ports, dependency direction, asset/AI/simulation/storage/browser contracts, physical database rules | E1-S1/S3/S6, E3-S5, E4-S1/S3, E5-S2, E6-S3, E7-S8, E9-S8 |
| 45–46 | Chief architect standup status, priorities, stop conditions, original product-intent traceability | `standup-architecture-audit.md`, checkpoints, final traceability index |

## Remaining decisions and evidence gaps

These are the only known gaps after reconciliation; they are intentionally not hidden as implementation assumptions:

1. Use canonical synthetic fixture AIC-001 as the sole build and pilot baseline; named hardware models are not required for MVP, while browser/OS classes and representative runtime profiles remain required for evidence.
2. Approve the exact AI deployment/region/model/API version, quotas, and pilot budget after fixture evaluation and preflight.
3. Complete rights attestation, no-PHI acknowledgement, retention durations, legal holds, exceptional purge, and credential wording review.
4. Decide which pilot organizations, if any, explicitly enable discovery.
5. Produce implementation evidence for every `Covered—unproven` row; the backlog itself does not prove runtime completion.

## Audit conclusion

The source design and backlog are now aligned at the functional, architectural, UX, security, operations, and business-value levels. The correct current standup classification is **design-ready, implementation-unproven**. No additional product functionality should be added before the E0 sign-offs and E1/E2 tenant-safe foundation are evidenced.

## Implementation audit addendum — 2026-10-22

The first worker/storage slice was tested against the current source, local Docker services, deterministic doubles, adversarial concurrency/failure cases, and the production dependency advisory service. Baseline typecheck, build, architecture, fixture, model, job, Azurite, and production-dependency checks pass. The PDF command is not reproducible in the current shell because its `pypdf` dependency is not declared or installed.

The audit found two confirmed lifecycle defects and two additional high-severity contract risks: active jobs could be claimed concurrently by the in-memory store; quarantine errors could strand a job in `RUNNING`; storage exceptions were collapsed into terminal checksum mismatches; and the worker discarded `REVIEW_REQUIRED` status and the common adapter envelope. AUD-001 through AUD-004 now have local regression coverage and fixes. PostgreSQL job persistence, a transactional outbox, a Service Bus dispatcher/consumer contract, a graceful publisher runtime loop, and the Azure private data foundation now also have evidence. The dedicated Azure foundation contains the private Blob path, PostgreSQL, Key Vault, private DNS, and VNet-integrated Container Apps environment; live queue settlement, crash recovery, operator audit, and bounded production reads remain open. These findings are recorded with evidence and remediation order in [tasks/evidence-registry.md](evidence-registry.md). E3-S5 remains **locally implemented for the contract slice, not pilot-validated**.

The follow-up requirements audit found a critical tenant-boundary defect in the new PostgreSQL adapter. That defect is mitigated for the job-store slice: the port requires validated tenant context, the adapter sets transaction-local context, forced RLS is enabled, the local runtime role is non-owner/non-superuser, and the adversarial check now rejects no-context and cross-tenant claim/complete/fail attempts. The durable job schema now also exposes correlation, timeout/deadline, input asset, code/adapter version, error classification, operator metadata, and lease-generation fields; same-worker stale-lease completion is rejected. The transactional outbox, publisher loop, Service Bus consumer contract, graceful runtime loop, managed-identity factory, fail-closed container entrypoint, image build, and Azure private data foundation are now evidenced, but this does not yet satisfy the whole-system E2-T20/E2-T21 boundary because all tenant-owned tables and downstream paths still need the same evidence, downstream artifact/usage effects still need idempotent fencing, and live identity/settlement/restart behavior remain open. On 2026-10-22, `pnpm typecheck`, `pnpm build`, `pnpm architecture:test`, `pnpm local:validate`, `pnpm jobs:validate`, `pnpm db:validate`, `pnpm outbox:validate`, `pnpm servicebus:validate`, `pnpm worker:validate`, `pnpm storage:validate`, and `pnpm model:validate` passed; the worker image also builds and fails closed without a processor module; `pnpm test` and `pnpm lint` still run no package checks because no workspace scripts are defined; `pnpm document:extract` still fails because `pypdf` is undeclared or unavailable; and a fresh `pnpm audit --prod` could not reach the npm advisory service due DNS/network resolution. The correct status is **local background-processing and Azure foundation evidence with broader tenant-isolation, live application/settlement, AI/3D, and pilot-validation blockers; not pilot-ready**.

## Implementation audit addendum — 2026-10-24 E4

Current-build E4 foreground rerun: Chrome recorded 59–60 FPS with 180–218 ms loads and Edge recorded 58–61 FPS with 513–685 ms loads; approved full/mobile variants and zero canvas drift remained verified.

Final local hardening rerun: accepted action responses are cacheable only after bound authoritative-state validation, text-only routes are regression-checked to exclude the 3D feature, and the foreground harness reapplies target focus after navigation. Chrome `155.0.8059.86` passed at 59/61/60 FPS and Edge `156.0.4314.42` at 60/61/61 FPS across desktop/iOS-sized/Android-sized profiles on the versioned network budget, with zero visual drift. Physical iOS Safari/Android Chrome/Firefox traces, deployed release population, and pilot acceptance remain open.

Real PostgreSQL E4 integration now passes through generated AIC-001 publication, release-bound variant metadata, enrollment/attempt/policy joins, authoritative completion, idempotent replay, and resume via `pnpm e4:postgres:validate`; this also fixed the partial-index conflict target in session start.

Latest accessibility-matrix rerun: Chrome recorded 59–60 FPS with 169–203 ms loads and Edge recorded 36–61 FPS with 183–580 ms loads; keyboard/touch activation, live accessibility roles, approved full/mobile variants, semantic completion, and zero canvas drift remained verified.

Latest rerun correction: the installed Chrome `155.0.8059.86` and Edge `156.0.4314.42` executables passed the foreground matrix at 37–61 FPS and 162–553 ms loads with zero canvas drift; earlier measurements in this addendum are historical local-harness samples.

The E4 local implementation now has evidence beyond the original preview: Babylon.js/GLB loading, release/model/hash binding, server-authoritative semantic actions and simulation projection, actor-bound idempotent session start/resume, duplicate/stale/forged-state rejection, accessible equivalent controls, keyboard activation, server-projected allowed actions and score deltas, context-loss recovery, reduced-complexity fallback, performance telemetry, and visual baselines. `pnpm e4:variants` generates and validates component-preserving mobile/reduced artifacts with geometric triangle retention for larger meshes and simplified material payloads; the mobile and reduced GLBs are 2,360 and 2,488 bytes versus the 2,508-byte canonical fixture, and `pnpm e4:variant-publication` fail-closes missing variant blob keys, hashes, duplicate IDs, and release binding. `pnpm e4:budgets`, `pnpm e4:browser:validate`, `pnpm e4:context:validate`, and `pnpm e4:headful:measure` pass; the foreground Chromium and Edge matrices explicitly fetched the mobile artifacts for coarse-pointer profiles, measured 38–61 FPS and 48–539 ms loads, completed the semantic procedure, and observed zero canvas pixel drift. The three-triangle fixture remains at the component-preserving geometry floor, while larger production models now have an actual generated geometric LOD path.

This addendum does not promote E4 to pilot-complete. The local bound-session browser rehearsal now passes through the learner page with authenticated release asset lookup, mobile variant selection, release/model-bound semantic actions, authoritative completion, and resume. The remaining E4 evidence gates are physical iOS Safari/Android device traces, a deployed private release populated with the model/simulation/policy and variant descriptors, and pilot acceptance/sign-off. The local PostgreSQL publication integration test could not run in this turn because `127.0.0.1:54329` was not listening; the publication contract itself typechecks and its direct fail-closed variant test passes.

