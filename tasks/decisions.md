# Decision Register: Medical Device Training and Certification Platform

This register separates choices that need human approval from the technical work that implements them.

**Last reviewed:** 2026-10-22  
**Source design:** `docs/medical-device-training-platform-solution-design.md` v0.31  
**Decision owner:** Confirm per record before approval

The technical implementation backlog remains in [todo.md](todo.md). Do not close a decision by changing code. Close it by recording the decision, approver, effective date, rationale, and evidence here. Technical tasks may start only when their prerequisite decision is **Approved** or when the decision explicitly permits a reversible spike.

## Status and ownership

| Status | Meaning |
|---|---|
| **Open** | A decision is required before the dependent implementation becomes fixed. |
| **Spike allowed** | A reversible comparison or fixture test may proceed, but no production commitment may be made. |
| **Approved** | The choice is recorded and the named technical work may implement it. |
| **Blocked** | The decision depends on a missing customer, legal, security, accessibility, or platform input. |

| Role | Responsibility |
|---|---|
| Product owner | Product promise, intended use, scope, credential wording, business value, and pilot acceptance. |
| Solution architect | Technical option analysis, boundaries, contracts, versioning, and migration triggers. |
| Security/privacy/legal | Rights, no-PHI boundary, retention, legal holds, takedown, data processing, and public disclosure. |
| Platform/operations | Azure region, topology, recovery, cost controls, quotas, reliability, and operational ownership. |
| Accessibility/QA | Device matrix, WCAG target, equivalent paths, test evidence, and release quality. |
| Organization owner | Customer-specific pilot approval, content rights, intended audience, and discovery choice. |

## Decision summary

| ID | Decision | Current state | Needed before |
|---|---|---|---|
| DEC-001 | MVP promise, non-goals, and product language | Approved | Product copy and release planning |
| DEC-002 | Synthetic pilot fixture and evidence set | Approved | E0 spikes and all repeatable tests |
| DEC-003 | Browser, device, performance, and accessibility baseline | Approved | 3D implementation and acceptance testing |
| DEC-004 | Browser 3D runtime | Spike allowed | E4 runtime implementation |
| DEC-005 | Image/video reconstruction adapter | Spike allowed | E8 reconstruction implementation |
| DEC-006 | AI provider, deployment, model, OCR/transcription, and terms | Open | AI gateway configuration |
| DEC-007 | Retrieval baseline and migration trigger | Approved | E5 retrieval implementation |
| DEC-008 | Azure region, restore region, network posture, and processing boundary | Approved | Infrastructure provisioning |
| DEC-009 | Source rights, no-PHI, retention, legal hold, and takedown policy | Open | Customer content and production-like data |
| DEC-010 | Budget, quotas, rate limits, caching, and egress controls | Approved | Pilot data and cost-intensive processing |
| DEC-011 | Pilot recovery point objective | Approved | Backup configuration and pilot go/no-go |
| DEC-012 | Evidence classification and release gates | Approved | Claims of implemented or pilot-validated behavior |
| DEC-013 | Pilot topology and scale-out triggers | Approved | Production-like deployment |
| DEC-014 | Database schema, JSON versioning, and physical tuning rules | Approved | Migration and schema implementation |
| DEC-015 | Provider-neutral internal contracts and job envelope | Approved | Adapter and worker implementation |
| DEC-016 | Content-change impact and requalification policy | Approved | Release updates and learner communication |
| DEC-017 | Assessment, certification policy, and credential semantics | Approved | Certification and credential issuance |
| DEC-018 | Discovery, sharing, privacy, and public verification behavior | Approved | Discovery and credential-facing UI |
| DEC-019 | API, event, and webhook compatibility policy | Approved | External integration implementation |
| DEC-020 | Pilot onboarding and go/no-go approval | Open | Pilot launch |

## Decision records

### DEC-001 — MVP promise, non-goals, and product language

**Decision needed:** Approve the online, English, browser-based MVP for organization-issued product-training certification, with an approximately five-organization initial pilot-sizing assumption, no PHI, LLM-assisted PDF/handbook-to-training conversion as a core workflow, and 3D modeling/interaction as a core workflow.

**Must explicitly exclude:** Offline delivery, native applications, onsite scheduling/sign-off, patient data, ATS/job marketplace behavior, LMS replacement, regulatory approval, VR/AR, multiplayer, automatic AI publication, and any later-phase scope listed in the design.

**Choices:** Approve the stated MVP boundary, narrow it, or create a separately approved phase. No implementation may silently expand it.

**Decision:** Approved with amendments. The initial organization count is a pilot-sizing assumption, not a product or architectural cap. LLM conversion of PDFs/handbooks into source-grounded training drafts and 3D model preparation/learner interaction are central MVP pillars. Image/video reconstruction remains an evidence-gated MVP path.

**Rationale:** The platform’s value depends on reducing the effort required to turn product knowledge into training and on providing meaningful interactive 3D competency practice. A fixed organization count would be an arbitrary product constraint; scaling must instead be governed by measured pilot thresholds and the approved topology decision.

**Owner:** Product owner, with legal/security review of credential wording.

**Approved by:** Product owner (conversation approval, 2026-10-22); legal/security wording review remains required before pilot release.

**Effective scope:** MVP product promise and first thin slice; initial pilot sizing remains approximately five organizations without a hard cap.

**Backlog linkage:** E0-T01–E0-T04.

**Closure evidence:** Approved scope record, approved credential/intended-use copy, and scope-change rule linked from the release checklist.

### DEC-002 — Synthetic pilot fixture and evidence set

**Decision needed:** Select the one synthetic or rights-cleared product story used for spikes, CI, browser tests, worker tests, restore tests, and pilot gates.

**Required content:** PDF/manual, existing GLB, image set, video, component list, procedure, fault, assessment, expected credential, source hashes, citation locations, model component IDs, scale/orientation, expected interactions, and expected scoring outcomes.

**Choices:** Use one synthetic fixture, use one rights-cleared customer fixture, or approve both with separate data-handling rules. Negative variants must be included in every option.

**Decision:** Approved with default. Fixture provenance does not narrow pilot scope. Use one fully synthetic fixture as the repeatable canonical baseline, and permit rights-cleared pilot fixtures as additional validation inputs under the approved rights/no-PHI policy. All MVP ingestion and training capabilities must be implemented and evidenced before pilot admission regardless of which fixture is used.

**Rationale:** Synthetic data makes CI, restore, negative, and security tests repeatable without customer-data dependencies. Rights-cleared content can validate operational realism, but neither choice may be used to defer PDF/handbook conversion, existing-model interaction, image reconstruction, video reconstruction, 3D behavior, or credential flow from the pilot acceptance scope.

**Owner:** Product owner and implementation lead; legal/security approve rights and no-PHI status.

**Approved by:** Product owner (conversation approval, 2026-10-22); legal/security rights and no-PHI review remains required for any rights-cleared fixture.

**Effective scope:** E0–E10 pilot evidence and all repeatable tests; fixture selection is not a capability gate.

**Implementation selection (2026-10-24):** Use the approved synthetic AIC-001 fixture as the sole build and pilot baseline. Do not introduce an additional customer or rights-cleared fixture or any related design scope during this build sequence.

**Backlog linkage:** E0-T05–E0-T08.

**Closure evidence:** Canonical fixture is generated at `fixtures/reference/`, with manifest at `fixtures/reference/fixture.json`, generator at `tools/create-reference-fixture.py`, validator at `tools/validate-reference-fixture.mjs`, stable SHA-256/byte metadata for six positive assets, nine page/time/frame/model citations, component/procedure/fault/assessment/credential outcomes, and six negative variants. `node tools/validate-reference-fixture.mjs` and `node tools/dry-run-reference-import.mjs` pass; the latter writes `output/fixture-import/reference-import-report.json` and verifies tenant/idempotency/retry job metadata plus explicit negative classification. Clean-checkout/local-CI consumption and production runtime processing remain open implementation evidence; any customer/rights-cleared fixture requires a separate rights/no-PHI review.

### DEC-003 — Browser, device, performance, and accessibility baseline

**Decision needed:** Approve the supported browser/device matrix, WebGL2 minimum, optional WebGPU, target 30 FPS budget, five-second approved-model interactivity target, WCAG 2.2 AA for non-3D surfaces, and equivalent-path rules.

**Choices:** Approve the design baseline, narrow the supported matrix, or defer a device class. A deferred device class must not be advertised as supported.

**Decision:** Approved. Use WebGL2 as the required browser graphics baseline and WebGPU as an optional enhancement. An approved model must reach usable interactive state within five seconds and maintain a 30 FPS target on named supported devices. Non-3D surfaces must meet WCAG 2.2 AA. Every certification-critical 3D activity must also provide an equivalent text, keyboard, or reduced-complexity path when full 3D interaction is unavailable or inaccessible. Exact device models and browser versions remain test configuration under the approved matrix and may not weaken these requirements.

**Plain-language rationale:** WebGL2 provides the widest practical browser compatibility for the pilot; WebGPU can improve performance where available without becoming a support dependency. The frame-rate and startup targets protect learner usability, while WCAG and equivalent-path requirements prevent certification from depending on inaccessible graphics alone.

**Owner:** Accessibility/QA lead and product owner, with architecture review.

**Approved by:** Product owner (conversation approval, 2026-10-22).

**Effective scope:** Pilot browser 3D runtime, learner activities, author previews, accessibility validation, and E10 acceptance evidence.

**Implementation selection (2026-10-24):** Named hardware models are not an MVP requirement. Use the approved desktop, iOS/iPadOS, and Android browser classes and representative test profiles where runtime evidence is required; this does not relax the approved WebGL2, 30 FPS, five-second interactivity, WCAG 2.2 AA, or equivalent-path requirements.

**Backlog linkage:** E0-T09–E0-T12.

**Closure evidence:** Versioned device matrix, accessibility protocol, equivalent-path test, and browser/3D smoke results.

### DEC-004 — Browser 3D runtime

**Decision needed:** Select Babylon.js or Three.js for the initial browser runtime after testing the reference GLB, component selection, manipulation, mobile performance, accessibility behavior, and context-loss recovery.

**Choices:** Babylon.js, Three.js, or a documented exception. The selected runtime remains behind the model-runtime port.

**Decision:** Babylon.js is approved as the initial runtime candidate for the reversible spike. Three.js remains the comparison candidate. No final production commitment is made until the spike produces evidence for the reference GLB, component selection/manipulation, named-device performance, accessibility/equivalent-path behavior, and context-loss recovery.

**Rationale:** Babylon.js is the design’s preferred initial candidate for a browser-based, interactive 3D runtime and provides a focused path to prove the pilot’s model and semantic-interaction requirements. Keeping the runtime behind the model-runtime port preserves the ability to select Three.js if the evidence is stronger.

**Owner:** Solution architect and frontend lead.

**Approved by:** Product owner (conversation approval, 2026-10-22) for the initial candidate only.

**Effective scope:** E4 runtime spike and first 3D thin-slice implementation; final runtime selection remains evidence-gated.

**Backlog linkage:** E0-T13; implementation begins at E4-T01.

**Closure evidence:** Repeatable comparison report, license review, decision record, and runtime fixture results.

**Implementation update 2026-10-24:** The Babylon.js adapter is now the local E4 implementation path, pinned at `@babylonjs/core`/`@babylonjs/loaders` `9.32.0`, bundled with `esbuild`, and browser-verified against the AIC-001 GLB. Final pilot closure remains gated on the named-profile performance, accessibility-equivalent, context-loss, visual, and mobile evidence listed in E4.

### DEC-005 — Image/video reconstruction adapter

**Decision needed:** Select whether the pilot uses AliceVision/Meshroom, COLMAP, another approved adapter, or rejects reconstruction as a pilot capability.

**Choices:** Select an adapter only if it meets the fixture quality, component mapping, operator effort, cost, processing time, licensing, and GLB-readiness gates. Existing GLB ingestion remains the fallback path.

**Decision:** Approved evaluation approach. Run the same supported image and video fixtures through AliceVision/Meshroom and COLMAP, then select the adapter or adapter combination that meets the documented quality, licensing, cost, processing-time, operator-effort, and GLB-readiness gates. Reconstruction is required pilot functionality; it may not be removed from the pilot to avoid a weak result. Unsupported input profiles must still be rejected explicitly before publication.

**Approved by:** Product owner (conversation approval, 2026-10-22) for the comparison approach; final adapter selection remains evidence-gated.

**Effective scope:** E8 reconstruction spike and pilot acceptance; existing-GLB processing remains the production fallback path when a reconstruction candidate is rejected for a specific input.

**Owner:** Solution architect, ML/media lead, and security/legal reviewer.

**Backlog linkage:** E0-T14; implementation begins at E8-T03 and E8-T07.

**Closure evidence:** Same-input comparison, quality report, processing-cost report, license/SBOM review, and explicit fallback decision.

### DEC-006 — AI provider, deployment, model, and processing terms

**Decision needed:** Pin the approved Azure AI deployment/region/model/API version, OCR/transcription path, retrieval configuration, token limits, and provider terms.

**Choices:** Approve the selected Azure OpenAI/Microsoft Foundry configuration, choose another approved Azure deployment, or defer a capability. Domain code must remain provider-neutral.

**Boundary decision:** Approved. The MVP uses Azure OpenAI/Microsoft Foundry as the sole AI provider boundary behind an internal provider-neutral gateway. Customer content must remain within approved Azure deployments and approved processing regions. No unapproved cross-provider fallback is permitted. The exact deployment, model, API version, OCR/transcription path, retrieval settings, token limits, and provider terms remain open for fixture-based evaluation and configuration approval.

**Evaluation decision:** Approved. Select the exact Azure deployment, model, API version, OCR/transcription path, retrieval configuration, and token limits by evaluating approved options against the pilot fixture for citation quality, training usefulness, schema validity, safety, latency, and cost. The selected configuration must be version-pinned and recorded before customer content is loaded.

**Approved by:** Product owner (conversation approval, 2026-10-22) for the provider boundary.

**Effective scope:** All PDF/handbook extraction, retrieval, LLM training-content generation, assessment generation, simulation-draft generation, OCR/transcription, evaluation, and AI-related processing in the MVP.

**Owner:** AI/platform lead, solution architect, and security/privacy/legal reviewer.

**Backlog linkage:** E0-T15; implementation begins at E1-T04, E5-T07, and E5-T10.

**Closure evidence:** Provider evaluation set, versioned gateway configuration, terms/data-processing review, safety/citation report, and cost estimate.

### DEC-007 — Retrieval baseline and migration trigger

**Decision needed:** Approve PostgreSQL full-text plus `pgvector` for the pilot and define measurable conditions for moving to Azure AI Search.

**Choices:** Keep PostgreSQL retrieval while corpus size, hybrid ranking, and permission filtering remain within measured targets; migrate only when the agreed trigger is met; or approve Azure AI Search earlier with a cost and operating justification.

**Decision:** Approved. Use PostgreSQL full-text search plus `pgvector` as the pilot retrieval baseline, behind a provider-neutral retrieval interface. Migrate to Azure AI Search only when measured corpus size, latency, relevance, hybrid-ranking, permission-filtering, operational, or cost thresholds show that PostgreSQL is insufficient. The migration must preserve tenant filtering, source citations, release/version lineage, and AI gateway contracts.

**Rationale:** Keeping retrieval with the transactional data store reduces pilot topology and permission-boundary complexity while still supporting semantic retrieval for LLM authoring. Azure AI Search remains the stronger scale-out option when evidence—not novelty—justifies a separate search service.

**Approved by:** Product owner (conversation approval, 2026-10-22).

**Effective scope:** MVP knowledge indexing, cited retrieval, AI authoring, and future search migration trigger.

**Owner:** Solution architect and data/platform lead.

**Backlog linkage:** E0-T16; implementation begins at E5-T01 and E5-T05.

**Closure evidence:** Retrieval evaluation set, latency/quality baseline, permission-filter test, cost model, and written migration trigger.

### DEC-008 — Azure region, restore region, network posture, and processing boundary

**Decision needed:** Select the named Azure US East/Southeast deployment region, restore region, endpoint posture, and data-processing boundary after service-availability preflight.

**Choices:** Use the preferred available region pair in the design, select an equivalent approved pair, or block the affected capability until the boundary is approved. Customer residency or private-endpoint requirements require an explicit phase decision.

**Decision:** Approved. Use an approved US East region for the primary deployment and an approved US Southeast region for restore, subject to service-availability and data-processing preflight. Expose only the web application and API through HTTPS; keep PostgreSQL, Blob Storage, Service Bus, Key Vault, and AI resources private or tightly restricted. Exact region names and endpoint details must be recorded from the preflight before infrastructure provisioning.

**Rationale:** This preserves the Azure-first design, keeps customer processing within an approved US boundary, and limits public exposure while retaining a practical restore region for the pilot.

**Owner:** Platform/operations and security/privacy/legal.

**Approved by:** Product owner (conversation approval, 2026-10-22), subject to platform/security/data-processing preflight.

**Effective scope:** Local/shared development, staging/acceptance, production-like pilot infrastructure, AI processing, storage, messaging, secrets, and restore planning.

**Backlog linkage:** E0-T17 and E1-T12–E1-T14.

**Closure evidence:** Region and service preflight, network decision, data-processing review, restore-region confirmation, and environment parameter approval.

**Implementation preflight evidence (2026-10-22):** The Azure portal confirms an active Microsoft Azure Sponsorship subscription (`8e95a112-23a5-40e8-97a4-285380a1438e`) with Owner access in the Kumo Partners tenant. A dedicated `rg-medical-device-dev` resource group was created in East US and tagged `project=medical-device-training`. `mdtdevstorage01` was deployed as Standard_LRS Blob Storage with public network access and anonymous blob access disabled, TLS 1.2, and 7-day blob/container soft delete. `mdt-dev-sb-01` was deployed as a Basic Service Bus namespace with local authentication disabled and public connectivity; Basic is a cost-effective development choice but does not provide private connectivity. The worker foundation deployment `CustomDeployment-20261022125627` succeeded and created `mdt-dev-logs`, `mdt-dev-aca-env`, `mdt-dev-worker-id`, and the worker identity's Blob and Service Bus data role assignments. A PostgreSQL capability preflight showed provisioning restricted in East US for this subscription, while Central US was available. The successful `data-foundation-centralus-20261022` deployment therefore created a Central US private data foundation: `mdt-devcentral-pg` (Ready, public access disabled, Standard_B1ms), `mdtdevcentralkv01` (public access disabled), `mdt-devcentral-vnet`, private Blob and Key Vault endpoints, private DNS links, and `mdt-devcentral-aca-private`. The generated PostgreSQL administrator password is stored only in Key Vault as `postgres-admin-password`. Restore-region service availability, live queue/consumer evidence, application smoke deployment, runtime database bootstrap, and recovery rehearsal remain open.

### DEC-009 — Source rights, no-PHI, retention, legal hold, and takedown

**Decision needed:** Approve asset rights attestations, no-PHI acknowledgement, screening/quarantine behavior, uncertainty handling, archive/disable/tombstone states, retention periods, legal holds, exceptional purge, and dependency impact behavior.

**Choices:** Approve the design’s non-destructive default and operator-approved exceptional purge, or document a stricter customer/legal policy. Normal destructive deletion is not a default choice.

**Boundary decision:** Approved. Every source requires a rights attestation before processing. Suspected PHI or uncertain rights status is quarantined and blocks processing/publication. The platform is not HIPAA-ready and does not accept patient data. Normal lifecycle actions are archive, disable, suppress, or tombstone; historical releases and credential evidence remain addressable unless an exceptional legal/security purge is approved. Retention durations, legal-hold ownership, and customer-specific policy details remain open for explicit policy approval.

**Product default:** Accepted as a low-priority configurable policy rather than a product blocker. Retain active training materials, derived artifacts, published release lineage, credential evidence, and required audit records for as long as needed to operate the organization and explain historical credentials. Support archive/tombstone without routine destructive purge; legal holds override normal retention; exceptional purge is audited and dependency-aware. Exact durations remain configurable and require security/privacy/legal confirmation before pilot data is loaded.

**Approved by:** Product owner (conversation approval, 2026-10-22) for the rights/no-PHI/safety boundary.

**Effective scope:** All source uploads, derived artifacts, AI processing, model processing, releases, credentials, discovery projections, exports, takedowns, and operator workflows.

**Owner:** Security/privacy/legal, product owner, and organization owner.

**Backlog linkage:** E0-T18–E0-T21 and E0-T32; implementation continues in E3 and E9.

**Closure evidence:** Rights/retention policy, no-PHI acknowledgement, retention matrix, legal-hold rules, takedown rehearsal, and customer-facing copy.

### DEC-010 — Budget, quotas, rate limits, caching, and egress

**Decision needed:** Approve the numerical pilot budget, quota matrix, concurrency limits, rolling AI limits, rate-limit behavior, artifact caching rules, and alert/pause thresholds.

**Required quota areas:** Source size/count, PDF pages, video duration, concurrent jobs, AI by organization/operation/rolling period, reconstruction reruns, storage, verification by IP and credential ID, discovery by user/organization, inquiries by requester/recipient, and webhook volume/retry budget.

**Design default:** Keep low-risk UI limits in the application and use short-lived atomic PostgreSQL counters for high-risk operations. Do not add a distributed limiter until measured bottleneck evidence exists.

**Decision:** Approved. Define numerical pilot budgets, quotas, concurrency limits, rate limits, cache rules, egress controls, and alert/pause thresholds from the workload model and measured fixture costs. Every cost-intensive operation must have an idempotency key, quota check, usage meter, bounded retry, and operator-visible outcome. Non-critical processing may be paused when thresholds are reached; credential integrity and auditability may not be degraded. The initial organization count is not the scaling control.

**Rationale:** These are engineering controls that should be derived from observed workload and cost rather than imposed as arbitrary product restrictions. The controls protect the pilot while preserving a path to measured scale-out.

**Approved by:** Product owner (conversation approval, 2026-10-22) for the control approach; numerical values and evidence are implementation outputs.

**Owner:** Product owner, platform/operations, and finance/business owner.

**Backlog linkage:** E0-T22–E0-T25 and E0-T30–E0-T33.

**Closure evidence:** Signed budget, quota matrix, usage-meter replay test, denial/recovery test, alert thresholds, and cost dashboard.

### DEC-011 — Pilot recovery point objective

**Decision needed:** Resolve the source-design conflict between the general NFR target of **≤15 minutes** and the pilot-default wording of **24 hours**.

**Decision:** Approved. Use a pilot RPO target of **≤15 minutes** for learner progress, authoring changes, audit records, credential events, outbox effects, and other certification-relevant data. Treat any Azure service or cost limitation that prevents this target as an explicit risk exception requiring review; do not silently fall back to 24 hours.

**Plain-language meaning:** RPO is the maximum amount of recent data that could be lost after a serious failure. A 15-minute target protects the integrity of recent learner, author, audit, and credential activity better than the design’s 24-hour pilot alternative.

**Approved by:** Product owner (delegated architecture decision, 2026-10-22), subject to platform preflight and explicit risk exception if unavailable.

**Effective scope:** Pilot backup, restore, outbox replay, credential evidence, learner progress, authoring, audit, and go/no-go operations.

**Choices:** Approve ≤15 minutes, approve 24 hours with an explicit pilot risk exception, or set another measurable target. The choice must cover PostgreSQL, Blob, secrets, queues/outbox, projections, verification, and deletion replay.

**Owner:** Platform/operations and product owner, with security/business approval.

**Backlog linkage:** E0-T29 and E10-T11.

**Closure evidence:** Approved RPO/RTO record, backup configuration, restore rehearsal, communication decision, and documented risk acceptance if applicable.

### DEC-012 — Evidence classification and release gates

**Decision needed:** Approve the vocabulary and evidence required to distinguish designed, spike-proven, implemented, pilot-validated, and released behavior.

**Decision:** Approved. Use the evidence lifecycle **Designed → Spike-proven → Implemented → Pilot-validated → Released**. A capability may advance only when its required acceptance evidence, decision dependencies, tests, operational artifacts, and owner review are recorded. An endpoint, worker run, generated document, model load, or passing unit test alone is not evidence of pilot readiness.

**Rationale:** The project has a large design and backlog, so status must distinguish intended behavior from demonstrated behavior. This prevents the team from treating architecture or scaffolding as proof of a working medical-device training workflow.

**Approved by:** Product owner (delegated process decision, 2026-10-22).

**Effective scope:** All E0–E10 stories, checkpoints, pilot claims, release reviews, decision records, requirements audit, and standup reporting.

**Choices:** Use the design’s evidence classifications and stop conditions, or add stricter organization-specific gates. No weaker classification may be presented as production proof.

**Owner:** Product owner, engineering lead, QA, security, and operations.

**Backlog linkage:** E0-T26–E0-T28.

**Closure evidence:** Evidence matrix, Epic exit criteria, release-gate checklist, and stop-condition review.

### DEC-013 — Pilot topology and scale-out triggers

**Decision needed:** Approve the low-cost pilot topology and the measured conditions that justify adding services or capacity.

**Decision:** Approved. Use one Static Web Apps application, one modular-monolith API application, one CPU worker family, separately controlled GPU-capable reconstruction capacity only when required, one PostgreSQL server, one private Blob account, one Service Bus namespace, one Key Vault, and one telemetry workspace per environment. Add services, split modules, or increase capacity only after measured queue age, latency, database contention, worker utilization, storage/egress, cost, reliability, security-isolation, or ownership evidence crosses an agreed trigger. Organization count alone is not a scale trigger.

**Rationale:** This keeps the pilot simple and maintainable while preserving clear internal boundaries and an evidence-based path to scale.

**Approved by:** Product owner (delegated architecture decision, 2026-10-22).

**Effective scope:** E1 infrastructure, E3/E5/E8 workers, E10 performance/cost gates, and future service extraction decisions.

**Recommended default:** One Static Web Apps site, one API, one CPU worker family, GPU-capable reconstruction only when needed, one PostgreSQL instance, private Blob Storage, Service Bus, Key Vault, and environment telemetry. Keep the modular monolith until a documented trigger is met.

**Owner:** Solution architect and platform/operations.

**Backlog linkage:** E1-T38 and E10-T29.

**Closure evidence:** Topology diagram, deployment parameters, measured trigger table, load test, and cost baseline.

### DEC-014 — Database schema, JSON versioning, and physical tuning rules

**Decision needed:** Approve which core fields are relational, which extensibility remains validated JSON, how persisted JSON and release schemas evolve, and when indexes/partitions are added.

**Decision:** Approved. Store identity, ownership, tenant scope, lifecycle, version binding, retention, approval, hashes, timestamps, lineage, audit, and deduplication fields as explicit relational columns. Use JSON only for validated extensible activity/configuration documents, provider reports, model metadata, and AI output after schema validation. Version every persisted JSON document, support explicitly approved prior versions, preserve release schema/hash metadata, use expand-and-contract migrations, and add indexes or partitions only from measured query/size evidence.

**Rationale:** Certification and tenant-safety fields must remain queryable, constrained, and auditable; bounded JSON preserves extension without turning the core record model into an unvalidated document store.

**Approved by:** Product owner (delegated architecture decision, 2026-10-22).

**Effective scope:** E1 migrations/schema, E5 AI documents, E6 course/simulation documents, E7 releases/policies/evidence, and E10 restore/replay.

**Recommended default:** Materialize identity, ownership, scope, lifecycle, version, retention, approval, hashes, timestamps, lineage, audit, and deduplication as relational fields. Use JSON only for validated extensible configuration or provider reports. Add physical complexity only after measured `EXPLAIN` evidence.

**Owner:** Solution architect and data/platform lead.

**Backlog linkage:** E1-T36 and E1-T39.

**Closure evidence:** Schema decision record, migration review, JSON schema/version rules, representative query plans, and rollback plan.

### DEC-015 — Provider-neutral internal contracts and job envelope

**Decision needed:** Approve the stable ports and common envelope used by asset processors, AI, simulation, policy, storage, jobs, and notifications.

**Decision:** Approved. Keep domain code independent of Azure SDKs, React, Babylon.js/Three.js, database clients, HTTP frameworks, and provider AI types. Define stable ports for asset processing, AI, simulation, policy evaluation, private object storage, jobs, and notifications. Use a common durable envelope carrying tenant scope, correlation ID, job ID, release/version lineage, idempotency data, retry classification, and safe telemetry metadata. Adapters must distinguish retryable, terminal, unauthorized, unsupported-input, and validation failures.

**Rationale:** The platform needs to change providers, runtime candidates, and worker capacity without changing certification-critical domain behavior or leaking infrastructure types into core logic.

**Approved by:** Product owner (delegated architecture decision, 2026-10-22).

**Effective scope:** E1 contracts and architecture tests, E3/E5/E8 adapters, E6/E7 domain evaluation, E9 notifications/webhooks, and E10 recovery/replay.

**Recommended default:** Every adapter exposes a common inspect/process contract and versioned result envelope. Job messages are server-created and integrity-protected; workers re-check tenant, rights, lifecycle, and referenced records. Artifacts are never overwritten.

**Owner:** Solution architect and engineering lead.

**Backlog linkage:** E1-T04, E1-T37, E3-T32, and E3-T33.

**Closure evidence:** Port contract tests, adapter envelope schema, retry/terminal/unauthorized matrix, duplicate-delivery test, and job-integrity test.

**Implementation evidence (2026-10-22):** The shared job outcome/lease contract is exercised by `pnpm jobs:validate`; PostgreSQL idempotency, atomic claim, lease recovery, stale-worker protection, retry scheduling, outcome persistence, transaction-local tenant context, forced RLS, non-owner runtime access, no-context invisibility, cross-tenant claim/complete/fail rejection, explicit ProcessingJob fields, and same-worker lease-generation fencing are exercised by `pnpm db:validate`; atomic outbox creation, single publisher claims, owner-checked publication, and idempotent enqueue are exercised by `pnpm outbox:validate`; the server-created Service Bus envelope with tenant metadata, correlation ID, message identity, HMAC integrity, valid processing, duplicate completion, retry abandon, and tamper dead-lettering are exercised by `pnpm servicebus:validate`; the publisher loop's initial drain and graceful shutdown are exercised by `pnpm worker:validate`; the managed-identity runtime factory, pilot processor, private Blob initialization, database migration/runtime-role bootstrap, smoke publisher, fail-closed container entrypoint, worker image build, successful foundation deployments `CustomDeployment-20261022125627`, `data-foundation-centralus-20261022`, and `data-foundation-centralus-20261022-runtime-secrets` are evidenced by the worker source, `Dockerfile.worker`, Azure templates, and Azure Cloud Shell output. The job-store tenant boundary and lease-update fence are now implemented locally, but the same database-enforced boundary must still be extended and evidenced across the remaining tenant-owned tables and downstream side effects. Actual worker Container App deployment, live queue settlement, private Blob runtime reachability, and production recovery evidence remain open because the Cloud Shell source upload path is currently failing.

### DEC-016 — Content-change impact and requalification

**Decision needed:** Approve how changes are classified and when learners must be notified, requalified, or kept on a historical release.

**Decision:** Approved. Every published change creates a new immutable release. Non-certification-critical changes may be communicated without requalification. Changes affecting procedures, safety, assessments, scoring, or certification requirements require issuer review and may require learner requalification. Existing credentials remain tied to their historical release, and affected learners are notified when requalification or credential impact applies.

**Rationale:** Versioned lineage preserves the meaning of previously issued credentials while allowing organizations to keep current training accurate and safe.

**Approved by:** Product owner (conversation approval, 2026-10-22).

**Effective scope:** E6 release publication, E7 credentials/requalification, learner communication, discovery projections, exports, and E10 pilot review.

**Required classifications:** Cosmetic, instructional, assessment, simulation/behavior, and certification-policy changes.

**Recommended default:** Preserve historical releases; require an issuer requalification decision and learner communication whenever competency meaning can change.

**Owner:** Product owner, quality lead, and organization issuer.

**Backlog linkage:** E7-T40, E7-T41, and E7-T49.

**Closure evidence:** Change-impact matrix, issuer decision record, notification evidence, and release/credential lineage test.

### DEC-017 — Assessment, certification policy, and credential semantics

**Decision needed:** Approve required activities, thresholds, attempts, cooldowns, requalification, expiration, randomized question-bank behavior, and the meaning of the organization-issued credential.

**Decision:** Approved. Organizations configure required activities, thresholds, attempts, cooldowns, expiration, requalification, and any question-bank behavior within validated policy rules. The server evaluates the result; the client cannot self-award completion or a credential. Credentials are organization-issued records tied to immutable releases and are online-verifiable, expirable, revocable, and supersedable. They do not imply professional licensing, regulatory approval, accreditation, or portable cryptographic proof, and passive completion cannot satisfy a policy that requires interactive competency evidence.

**Rationale:** Issuers need control over competency standards while learners and verifiers need a clear, bounded meaning for the credential.

**Approved by:** Product owner (conversation approval, 2026-10-22).

**Effective scope:** E6 policy validation, E7 assessment/simulation/credential flows, public verification, evidence export, and E10 pilot claims review.

**Choices:** Configure the policy within the design’s declarative boundaries, or defer a policy capability. No credential may imply accreditation, licensure, or portable cryptographic proof.

**Owner:** Product owner, quality/learning lead, and organization issuer.

**Backlog linkage:** E7-T26–E7-T29 and E7-T50.

**Closure evidence:** Immutable assessment/policy version, policy evaluation fixtures, concurrent-issuance test, approved credential copy, and requalification policy.

### DEC-018 — Discovery, sharing, privacy, and public verification

**Decision needed:** Approve whether discovery is enabled for each initial organization and which learner, issuer, product, competency, status, and intended-use fields may be shown.

**Design default:** Discovery is opt-in and off by default. Enrollment, credential issuance, sharing, and verification must never implicitly enable discovery. Public verification returns only issuer-approved public fields and current status.

**Decision:** Approved. Discovery is disabled by default for every organization. Learners explicitly opt in and may withdraw at any time. Search results expose only minimal verified profile and certification information; employer contact requires a consent-based request. Public verification exposes only issuer-approved fields and current status, never private contact details, source files, assessment answers, or unrelated tenant data. Discovery and verification are authenticated or rate-limited, bounded, and non-exportable.

**Rationale:** Discovery is an optional privacy-sensitive surface, not a prerequisite for training or credential issuance. The default must protect learners without preventing a deliberate pilot organization from enabling the capability.

**Approved by:** Product owner (conversation approval, 2026-10-22).

**Effective scope:** E7 credential sharing/verification, E9 discovery/contact/projections, privacy settings, rate limits, and pilot organization onboarding.

**Owner:** Product owner, privacy/legal, and each organization owner.

**Backlog linkage:** E7-T42–E7-T44 and E9-T03–E9-T06.

**Closure evidence:** Per-organization discovery setting, privacy copy, suppression/minimum-result policy, public-field allowlist, and abuse/rate-limit test.

### DEC-019 — API, event, and webhook compatibility

**Decision needed:** Approve versioning, additive-field rules, deprecation, consumer tolerance, replay, projection rebuilds, and the initial webhook event set.

**Recommended default:** Use versioned envelopes, additive evolution where safe, explicit deprecation, old/new consumer contract tests, replay-safe handlers, and no internal database IDs or private source data in external responses.

**Decision:** Approved. Use versioned API, event, and webhook envelopes; additive evolution where safe; explicit deprecation; old/new consumer contract tests; replay-safe handlers; projection rebuild and backfill support; signed retryable webhooks; and no internal database IDs, private source data, assessment answers, or other tenant-private fields in external payloads.

**Rationale:** Stable external contracts reduce integration breakage while replay and rebuild behavior protect recovery and historical projections.

**Approved by:** Product owner (delegated engineering decision, 2026-10-22).

**Effective scope:** E1 API contracts, E9 integrations/webhooks/projections/exports, and E10 replay/recovery evidence.

**Owner:** API/integration lead and solution architect.

**Backlog linkage:** E9-T25–E9-T30 and E9-T36.

**Closure evidence:** OpenAPI, event catalog, compatibility policy, old/new consumer tests, signed webhook test, and changelog.

### DEC-020 — Pilot onboarding and go/no-go approval

**Decision needed:** Approve the initial organizations, authorized roles, representative product/model, policy, expiration, device matrix, learner cohort, discovery setting, support path, restrictions, and stop conditions.

**Timing decision:** Defer until E10 pilot admission. This decision cannot be responsibly closed before the implementation and evidence gates exist. The approved defaults already recorded in DEC-001, DEC-003, DEC-017, and DEC-018 constrain the eventual onboarding review; the go/no-go record will add organization-specific owners, fixtures, cohort, support, restrictions, and stop conditions.

**Owner:** Product owner, security, accessibility, operations, business owner, and each organization owner.

**Backlog linkage:** E10-T25–E10-T28.

**Closure evidence:** Completed onboarding checklist, MVP evidence matrix, owner approvals, pilot restrictions, stop conditions, and go/no-go record.

### DEC-021 — Dedicated database identity for transactional-outbox publishing

**Decision needed:** Resolve how the deployed worker may publish transactional-outbox messages while PostgreSQL forced row-level security remains enabled.

**Decision:** Approved. Provision a separate `medical_device_outbox_publisher` login during worker database bootstrap and give it only the database/schema and `processing_job_outbox` permissions required to claim, publish, and mark outbox rows. The worker must use a separate protected `POSTGRES_OUTBOX_PASSWORD`/`DATABASE_OUTBOX_URL` configuration rather than silently reusing the normal runtime login. Do not weaken forced RLS or add a broad bypass role.

**Rationale:** The normal runtime login correctly cannot see outbox rows without an organization context, while the publisher loop intentionally claims rows across organizations. A narrowly scoped publisher identity preserves the tenant boundary for application operations and makes the cross-organization delivery responsibility explicit and auditable.

**Implementation evidence (2026-10-22):** `apps/worker/src/postgres-bootstrap.ts` provisions the role and grants only the required outbox access; `apps/worker/src/entrypoint.ts` builds a separate outbox connection; `pnpm outbox:validate` passes; Azure revision `mdt-devcentral-worker--0000004` started with the protected secret; the live smoke publisher reached `SUCCEEDED` with outbox state `PUBLISHED` and zero active queue messages; `apps/api/src/job-status-service.ts` exposes the resulting status/retry behavior without returning the raw job payload; and `apps/api/src/job-status-http.ts` exposes the safe status and explicit retry boundary with authentication, operator-role enforcement, request limits, CORS allowlisting, and security headers, covered by `pnpm api:validate`.

**Approved by:** Solution architect (implementation decision consistent with DEC-015 and DEC-014, 2026-10-22).

**Effective scope:** E3 durable jobs/outbox, Azure worker bootstrap, PostgreSQL RLS, Service Bus delivery, and pilot deployment evidence.

**Owner:** Engineering/platform operations.

**Backlog linkage:** E1-T15, E3-T16–E3-T20, E3-T32–E3-T33, and E10 recovery gates.

**Closure evidence:** Dedicated role and grants, secret-safe deployment, live outbox settlement, restart/replay rehearsal, and operator audit trail.

## Decision closure checklist

For each decision marked **Approved**, record:

- [ ] Decision ID and title.
- [ ] Selected option and rejected alternatives.
- [ ] Rationale and source-design reference.
- [ ] Named approver(s), role(s), and approval date.
- [ ] Effective version/environment and affected organizations.
- [ ] Technical tasks unlocked or constrained.
- [ ] Required tests, dashboards, runbooks, and customer copy.
- [ ] Revisit trigger, expiry, or migration condition where applicable.

### DEC-022 — API identity validation and tenant claim boundary

**Decision needed:** Decide where the status/recovery API validates Microsoft Entra identity and how it obtains the organization boundary.

**Decision:** Approved for the pilot. The API validates Microsoft Entra bearer tokens itself against the tenant OpenID configuration and rotating RSA signing keys. It requires an exact issuer, audience, tenant ID, expiry window, a configured organization claim, and application roles. The API does not trust an organization ID supplied in the URL, body, or browser state.

**Rationale:** Container ingress can provide network exposure but is not the application authorization boundary. Verifying the signed token in the API keeps tenant selection and operator authorization next to the database call and makes failures explicit. A required organization claim prevents an authenticated user with no tenant assignment from becoming a cross-tenant default.

**Implementation evidence (2026-10-22):** `apps/api/src/entra-authenticator.ts` implements bounded OpenID/JWKS retrieval, RS256 verification, issuer/audience/tenant/expiry checks, configured organization-claim extraction, and role extraction. `tools/check-entra-authenticator.mjs` passes with generated keys and invalid-token cases. `apps/api/src/entrypoint.ts` wires the adapter into the HTTP server. The single-tenant `Medical Device Training API` registration was created with audience `api://22da2477-5ca4-4e1e-bc8f-cc7c960aa787` and enabled `operator`/`learner` app roles. The API image was deployed to `mdt-devcentral-api`, and its `/healthz` endpoint returned `HTTP/2 200`. Real organization-claim issuance and real-token smoke remain open.

**Approved by:** Solution architect (pilot identity boundary, 2026-10-22).

**Effective scope:** E3 job-status/recovery API and future authenticated API routes.

**Owner:** Engineering/platform operations.

**Backlog linkage:** E1-T15, E3-T21–E3-T23, and E10 identity/recovery gates.

**Closure evidence:** Entra app registration, app role/claim configuration, deployed API, real-token status read, denied cross-tenant token, denied non-operator retry, and monitored authentication failures.

### DEC-023 — Resolve organization scope from server-side membership

**Status:** Accepted; supersedes the custom-organization-claim requirement in DEC-022.

**Decision needed:** Decide how an authenticated Entra user is assigned the organization boundary used by the API.

**Decision:** Validate the signed Entra token for tenant, issuer, audience, time validity, subject, and application roles. Resolve the subject against the application’s active organization-membership table. The API proceeds only when exactly one active organization is available; no membership returns `403`, and multiple active memberships return `409` until an explicit server-managed organization-context flow is added. A custom `organization_id` token claim is optional legacy data and is not trusted as the authorization source.

**Rationale:** Entra proves identity and broad application role; the application owns organization membership because users may belong to multiple organizations and memberships can be suspended, removed, or audited without changing identity tokens. This keeps the tenant boundary next to the database call, avoids treating a browser- or URL-supplied organization ID as authority, and supports organization switching as a later server-managed feature.

**Implementation evidence (2026-10-22):** `apps/api/src/entra-authenticator.ts` now accepts a valid token without a custom organization claim while retaining issuer, audience, tenant, expiry, signature, subject, and role checks. `packages/db/src/organization-membership-store.ts` resolves only active memberships using a parameterized query. `apps/api/src/job-status-http.ts` requires that resolver before constructing tenant context and returns explicit no-membership/multiple-membership failures. The migration creates the control-plane membership table, and `tools/check-entra-authenticator.mjs` plus the API typecheck pass. Azure created the membership table and the worker one-shot seed logged `MEMBERSHIP_OK` for the signed-in pilot user in `org_fixture`; the worker template was restored afterward. A live user-token smoke was attempted from Azure Cloud Shell, but Microsoft Entra completed the sign-in and then rejected the device-code authentication flow under the tenant's Conditional Access policy. The API therefore remains deployed and the smoke remains unproven; this is an environment access gate, not evidence of an API authorization failure.

**Approved by:** Solution architect (identity/tenancy boundary, 2026-10-22).

**Effective scope:** E2 identity and memberships, E3 job-status/recovery API, and all future authenticated organization-scoped routes.

**Owner:** Engineering/platform operations.

**Backlog linkage:** E2-T01–E2-T10, E2-T16–E2-T24, E3-T21–E3-T23, and E10 identity/recovery gates.

**Closure evidence:** Seeded pilot membership, real-token status read, denied no-membership access, multiple-membership context behavior, denied cross-tenant token, denied non-operator retry, and monitored authentication failures.

### DEC-024 — Personal Azure subscription is the pilot deployment boundary

**Decision:** Approved. The personal Azure tenant and subscription owned by `joniskow@gmail.com` are the canonical pilot deployment boundary. The Kumo Partners tenant is not an application environment for this project.

**Rationale:** The project resources were initially created in the wrong tenant. Rebuilding the pilot foundation in the intended personal subscription provides a clean ownership boundary and avoids disturbing unrelated Kumo workloads.

**Implementation evidence (2026-10-22):** Personal tenant `491266a6-1f7f-419f-9da1-1a600c27cc2f`, subscription `e30f800a-473e-4040-9622-6ea38413c991`, resource group `rg-medical-device-personal`, private PostgreSQL foundation, worker, Service Bus, Blob Storage, Key Vault, API Container App, and personal Entra app were deployed. The worker reached `worker_started`; `/healthz` returned `200`; an unauthenticated protected route returned `401`. Kumo cleanup was scoped to the project-tagged medical resource group and the medical API app registration only; unrelated Kumo resources were preserved. Resource-group deletion was submitted asynchronously and requires final verification.

**Approved by:** Product owner (account-boundary correction, 2026-10-22).

**Effective scope:** All pilot Azure resources, identity configuration, deployment scripts, runbooks, and cost controls.

**Owner:** Engineering/platform operations.

**Backlog linkage:** E1 environment foundation, E3 durable processing, E10 pilot readiness.

**Closure evidence:** Personal subscription resource inventory, live worker/API checks, final Kumo deletion verification, and updated Azure README/evidence registry.

## Relationship to the technical backlog

The technical backlog contains implementation work only in the broad engineering sense: code, schemas, infrastructure, adapters, UI, tests, fixtures, runbooks, and evidence production. Decision records are kept here so they are visible in standups without being confused with buildable work.

Before a technical task is started, check its decision dependencies. Before a decision is marked complete, check the linked technical evidence. This prevents a selected option from being mistaken for a working capability.
