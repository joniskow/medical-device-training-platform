# Chief Solution Architect Standup Audit

Date: 2026-10-20  
Source reviewed: `docs/medical-device-training-platform-solution-design.md` v0.31  
Backlog reviewed: `tasks/todo.md` and `tasks/plan.md`

Detailed requirement mapping: [tasks/requirements-audit.md](requirements-audit.md)

## Executive verdict

The backlog now separates buildable technical work from choices requiring human approval. The technical hierarchy remains in [todo.md](todo.md); the decision register is in [decisions.md](decisions.md). This prevents an approved design choice from being mistaken for an implemented or validated capability.

**Architecture: conditionally approved for implementation planning.** The solution is coherent, maintainable, pilot-sized, and commercially sensible, provided the team keeps the existing-model/PDF path as the first thin slice and treats reconstruction, AI generation, discovery, and pilot scale as evidence-gated capabilities.

**Product: valuable if the pilot proves the complete business loop.** The product value is not “AI creates a course.” It is reduced onboarding time and repeatable product competency with an issuer-controlled evidence trail. The pilot must measure source preparation, author/reviewer time, learner completion, support burden, processing cost, and cost per issuer-approved certification.

**Production readiness: not yet demonstrated.** The design explicitly says no application, infrastructure, database, provider integration, runtime, or restore evidence exists yet. The backlog must therefore be treated as implementation work, not as proof that the platform already works.

## Review results by quality axis

### Correctness and functional completeness

- The backlog covers the full design flow: organization → product → private source upload → scan/rights/quarantine → PDF/model/media processing → cited AI draft → no-code editing → review → immutable release → enrollment → semantic progress → server-authoritative simulation/assessment → credential → online verification.
- Certification integrity is correctly server-owned. The client cannot submit a score, pass flag, completion assertion, arbitrary transform, or credential status.
- Historical meaning is protected through release, model, simulation, assessment, policy, attempt, credential-event, and evidence immutability.
- All four ingestion paths are represented with explicit supported-input profiles, quality reports, human review, and safe rejection. Existing GLB remains the production fallback when reconstruction is unavailable or rejected.
- The independent candidate journey is included without forcing the candidate to join the issuer organization.
- Discovery is correctly separate from training and credential issuance, opt-in by default, privacy-projected, consent-based, bounded, and revocable.

### Architecture and maintainability

- The modular monolith plus worker model is the right pilot default for five organizations. It avoids premature microservices while keeping boundaries that can be extracted later.
- Domain logic is isolated from Azure, React, Babylon.js, database clients, and provider AI types through explicit ports.
- PostgreSQL is appropriately the MVP system of record, retrieval store, session snapshot store, policy/credential transaction store, and outbox store. Azure AI Search and a separate session/event store are triggers, not pre-provisioned assumptions.
- Async work is consistently modeled with durable jobs, correlation IDs, bounded retry, dead-letter handling, idempotency, operator actions, and usage meters.
- The backlog now defines the low-cost pilot rate-limiting approach: application-level limiting for low-risk traffic and short-lived atomic PostgreSQL counters for sensitive/costly operations. A distributed limiter is deferred until measured database contention justifies it.
- The backlog now requires measured scale triggers before adding services or splitting modules.

### Security and trust

- The two-layer tenant boundary is preserved: application policy actions plus PostgreSQL RLS with a non-owner runtime role and transaction-local tenant context.
- Tenant context is required in API, repository, storage, retrieval, job, event, notification, audit, and projection paths, with connection-pool reset and adversarial filter-removal tests.
- Private Blob storage, scoped short-lived URLs, malware/quarantine, parser limits, no external parser fetches, no-PHI controls, rights attestations, and takedown dependency handling are represented.
- AI output is tenant-scoped, schema-constrained, citation-bearing, redacted in telemetry, draft-only, and subject to safety/evaluation gates.
- Public verification is minimal, opaque-ID based, rate-limited, online-only, and does not expose source files, answers, private contact details, or unrelated tenant data.

### User experience and aesthetics

- The backlog includes the required ten screen families, light-first clinical/industrial visual direction, named design tokens, semantic status labels, persistent context, split-pane review, learner requirements remaining, clear credential meaning, and responsive Compact/Standard/Wide compositions.
- It explicitly covers loading, empty, processing, needs-review, blocked, failed, expired, revoked, permission-denied, and offline-not-supported states.
- 3D is not allowed to be a canvas-only experience: instructions, actions, errors, score effects, hints, and completion are also available in text/status UI.
- Visual quality is treated as a release gate through responsive snapshots, visual regression, focus/contrast checks, reduced motion, touch targets, and screen-reader testing.
- The design avoids game-like certification theatrics and keeps the credential’s meaning clear.

### Performance, scalability, and cost

- The design targets pilot scale rather than speculative enterprise scale: five organizations, low-thousands of learners, bounded workers, one database, one storage account, one Service Bus namespace, and scale-to-zero where practical.
- Heavy PDF/OCR, transcription, embeddings, AI generation, normalization, reconstruction, and thumbnails remain asynchronous.
- Cost controls cover quotas, token ceilings, retries, concurrency, storage/egress, model variants, caching, usage reconciliation, provider failure, and operator pause behavior.
- The 3D path has a named device matrix, WebGL2 baseline, optional WebGPU, lazy loading, performance budgets, context-loss behavior, and equivalent path.
- The backlog requires measured load, latency, queue, cost, restore, and support evidence before five-organization admission.

## Corrections made during this audit

1. Removed the hidden dependency from identity invitation delivery to the later E9 notification feature. E2 now depends on the E1 notification port/outbox contract; E9 supplies the delivery implementation later.
2. Added a per-entity retention matrix and legal-hold requirement.
3. Added explicit low-cost rate limiting and artifact cache/egress rules.
4. Added medical-device content-change impact classification and issuer requalification/learner-communication requirements.
5. Added event compatibility, schema evolution, projection rebuild, backfill, and replay acceptance criteria.
6. Added measured scale triggers and an explicit future parking item for instructor/evaluator workflows and broader quality-system integration.
7. Reconciled the RPO discrepancy as an explicit decision: the approved pilot target is ≤15 minutes, and implementation must configure and rehearse it before pilot data is loaded.
8. Tightened the browser matrix to include desktop Firefox, added role-assignment/database JSON-schema/index discipline, and preserved the design’s PostgreSQL-first simplicity.

## Standup status

| Workstream | Status | Standup evidence required next |
|---|---|---|
| Product boundary | Ready for decision | Approved intended-use language, no-go scope list, pilot customer promise |
| Tenant/identity | Design-ready, unproven | E2 adversarial API/RLS/Blob/job/retrieval tests |
| PDF + existing GLB | First implementation path | One fixture through E3 → E5 → E6 → E7 |
| Browser 3D | Spike required | Runtime comparison, named-device performance, equivalent path |
| AI authoring | Design-ready, unproven | Versioned evaluation set, citations, conflicts, unsafe content, cost |
| Reconstruction | High-risk, isolated | Same-fixture adapter comparison, quality/licensing/cost report |
| Certification | Design-ready, unproven | Deterministic replay, tamper/concurrency, one-credential evidence |
| Discovery | Pilot-gated | Opt-in/revocation/status/rate-limit/inquiry tests |
| Operations | Design-ready, unproven | Restore, outbox/deletion/projection replay, runbook exercise |
| Business value | Measurement-ready | Baseline and cost-per-certification pilot report |

## Next standup order

1. Resolve the remaining sign-offs: customer/rights-cleared fixture if needed beyond canonical AIC-001, devices, accessibility target, region, AI deployment, rights/no-PHI, retention, budget/quotas, and credential wording.
2. Build E1 foundation and E2 identity/RLS before any customer source is loaded.
3. Prove E3 with one PDF and one GLB, including failure and retry paths.
4. Prove E5/E6 with a cited draft, no-code correction, simulation validation, review, and immutable release.
5. Prove E7 with an independent learner, server-authoritative action sequence, assessment, credential, QR/verification, and evidence export.
6. Run E4/E8 spikes without destabilizing the existing-GLB path.
7. Add E9 only after credential/status/privacy contracts are proven.
8. Run E10 security, accessibility, performance, recovery, cost, and pilot operating rehearsals.

## Architecture stop conditions

Stop and escalate if any change would:

- Let a browser or client-provided event determine certification truth.
- Disable or bypass RLS, tenant context, rights quarantine, publication validation, or release immutability.
- Allow AI, reconstruction, simulation, assessment, or policy content to publish without the required review.
- Make a certification-critical 3D competency inaccessible without an equivalent path.
- Add a provider, queue, search service, distributed limiter, GPU, or microservice without measured justification and an adapter boundary.
- Process PHI, claim accreditation/licensure, add offline credential proof, or expand into ATS/LMS behavior without a new phase decision.
- Change the meaning of an issued credential without a new release/requalification decision and preserved lineage.

## Final architectural assessment

The backlog now contains 11 Epics, 41 Features, 81 Stories, and 332 unique implementation-task IDs. It matches the solution design across the MVP checklist, source-to-credential flow, internal contracts, UX states, business measures, operations, and pilot gates, and includes the missing simplicity, cost, event-evolution, retention, and content-change controls found in this audit. The architecture is suitable for implementation as a maintainable pilot system. Confidence should be reported as **design-ready, implementation-unproven** until the E0–E10 evidence gates pass.

