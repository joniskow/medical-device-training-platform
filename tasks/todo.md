# Technical Implementation Backlog: Medical Device Training and Certification Platform MVP

AI input evidence update 2026-10-30: new runs persist versioned service-input fingerprints, selected passage/source hashes, coverage, retrieval version and model/media identity without duplicate raw source/instruction text. Generation excludes chunks whose extraction hash differs from current asset hash. Additive local migration, accepted/rejected persistence, stable/changed fingerprint tests, full build, AI/race and architecture pass. Historical evidence stays null; exact provider replay, deployed migration and live evaluation remain open. See docs/ai-generation-validation.md.

AI passage ranking update 2026-10-30: author instructions now drive PostgreSQL English lexical ranking within each selected document, preserving balanced interleaving, stable fallback, tenant/lifecycle filters and total coverage counts. Relevant page-40 passages from two documents, deterministic/stopword behavior, query bounds and SQL-looking input pass database fixtures; forwarding/race, AI, full build and architecture pass. Semantic retrieval, production relevance/latency measurement and live AI evaluation remain open. See docs/ai-generation-validation.md.

AI retrieval coverage update 2026-10-30: existing interleaved retrieval now reports per-source totals from the same query. Generation exposes selected/total counts, includes coverage in the prompt and persists/displays partial or unknown coverage warnings independently of provider output. Oversized source selection rejects instead of truncating. Two-document 16-of-40 database/persistence fixture, author Chrome, full build, AI/race and architecture checks pass. Semantic coverage, relevance ranking, multi-pass generation and live evaluation remain open. See docs/ai-generation-validation.md.

AI media selection update 2026-10-30: author generation form adds paged approved-media selection, inert filenames, 32-item bounds and course/sign-out cleanup. HTTP validates distinct media IDs; service resolves selected approval before provider execution, supplies metadata context and rejects unselected output bindings with approval recheck. Full build, AI/service, Chrome, HTTP 422/selection, race, architecture and PostgreSQL source regressions pass. Live semantic/provider evaluation and asynchronous generation/proposals remain open. See docs/ai-generation-validation.md.

AI media validation update 2026-10-30: generated image/video references resolve through tenant-scoped approved-version/parent lookup with supported MIME types, then shared media validation checks binding, type, description/transcript and strict fields before save. Foreign/quarantined/retired assets and malformed content reject. Full build, AI/service, restricted-runtime media/access HTTP, media schema, race, architecture and PostgreSQL source regressions pass. Trusted media selection/context and live semantic/provider evaluation remain open. See docs/ai-generation-validation.md.

AI story/policy validation update 2026-10-30: generated policy/story payloads reuse certification and story validators with generated activity descriptors, expanded module requirements and fault context. Invalid policies, unknown activities/facts, cycles and required-learning bypasses reject before save. Full build, AI service, story/policy, race, architecture and PostgreSQL source regression checks pass. Media payloads, semantic evaluation and live provider acceptance remain open. See docs/ai-generation-validation.md.

AI inspection validation update 2026-10-30: generated viewers/hotspots reuse the shared inspection validator with authoritative bound-model components. Missing overview/text, unknown/duplicate components, extra scoring fields, misplaced exploration and unbound inspection reject before save. Valid viewer/hotspot service tests, AI, full build, exploration, architecture, race and PostgreSQL source regressions pass. Media/story/policy payloads, semantic evaluation and live provider acceptance remain open. See docs/ai-generation-validation.md.

AI approved-model context update 2026-10-30: generation resolves the bound model through tenant-scoped approved database lookup before provider execution, validates manifest/hash and rejects stale bindings. Prompt receives model metadata; omission preserves binding and changed/invented output models reject. Full build, AI/service, restricted-runtime lookup/binding HTTP, race, architecture and source persistence pass. Read-time model approval remains independently rechecked at publication; live provider/geometry and remaining payload validation remain open. See docs/ai-generation-validation.md.

AI simulation validation update 2026-10-30: generated definitions reuse runtime procedure/fault/scoring/completion/equivalent-path validation; activity/course/definition IDs and model version/hash/component references must agree before save. All six simulation activity types pass; malformed definitions and mismatched bindings reject without output or save. AI/service, full build, schema, architecture, race and PostgreSQL source regressions pass. Trusted generation model context, other payloads, semantic evaluation and live provider acceptance remain open. See docs/ai-generation-validation.md.

AI assessment validation update 2026-10-30: generated drafts reuse the production assessment schema and shared publication activity catalog. Invalid answer/scoring/competency/rationale structures, duplicate assessment IDs, misplaced assessments and unknown activity types reject before save; exact question citations remain checked. All three question types pass service fixtures; AI, full build, architecture, assessment, generation-race and PostgreSQL source regressions pass. Other activity payload validation, semantic support evaluation and live AI deployment remain open. See docs/ai-generation-validation.md.

AI citation validation update 2026-10-30: source draft service checks exact supplied passage locators at course/activity and nested citation levels, bounded nonempty structure and protected fields before recording/applying any provider DRAFT. Rejections preserve usage/audit with no output or draft write; cited asset IDs derive from checked references. Prompt/deterministic fixtures updated. AI/service tests, full build, architecture, race and PostgreSQL rejected-citation persistence pass. Complete activity schema, claim support/coverage evaluation and live deployment remain open. See docs/ai-generation-validation.md.

AI gateway acceptance update 2026-10-30: complete-response checks reject truncated/filtered/refused/malformed output without draft mutation; oversized instructions/passages reject before sending instead of silently truncating. Valid token usage survives accepted/rejected responses and AI-run persistence; transport errors remain safely retryable. Full build, architecture, gateway/race and PostgreSQL source-generation checks pass. Live deployment/OCR, full schema/citation validation, coverage-aware retrieval and AI evaluation remain open. See docs/ai-generation-validation.md.

Draft conflict comparison update 2026-10-30: author editor compares loaded, unsaved and latest saved content with overlap labels, inert values and heading focus. Comparison is read-only; edit/revision/session fencing rejects stale responses, failures preserve recovery, and confirmed reload adopts saved content. Web build, architecture and Chrome comparison/failure/edit-race/reload/sign-out checks pass. Local E6-T06 compare/reload increment verified; deployed multi-browser/accessibility and broader MVP remain open. See docs/draft-history.md.

Author draft history update 2026-10-30: paged saved changes, exact before/after comparison, reasoned confirmation and restore/redo workflow now appear in the author editor. New edits invalidate comparisons; interrupted restoration preserves retry identity and reloads/focuses the draft. Author-only snapshot GET preserves lineage and rejects mixed queries. Build/architecture, restricted-runtime comparison/HTTP access and Chrome stale-edit/cancellation/retry checks pass. Deployed/accessibility and broader MVP work remain open. See docs/draft-history.md.

Durable draft history update 2026-10-30: reused immutable before/after audit snapshots for revision-checked restore/redo; model-binding operations now capture snapshots too. Author GET/POST history supports paged metadata, strict confirmation/reason/idempotency and no-store. Restricted-runtime DB/HTTP verifies tenant/course boundaries, rollback, concurrency, later-edit and lineage preservation, and published immutability; binding undo and build/architecture pass. Author compare/history/restore UI remains next. See docs/draft-history.md.

Fault preview/path update 2026-10-30: author local preview supports unavailable, recorded-negative, diagnosis-only and resolved fault history using production transitions. Bounded path analysis explores consistent fault combinations, reveals facts only at reached activities and reports partial coverage at scenario/result/work limits. Pure tests, integrated Chrome/no-learner-evidence checks, full build, fault projection/architecture and fault-story publication pass. Added course-story-faults:validate aggregate. Deployed/device/accessibility and broader MVP work remain open. See docs/course-stories.md.

Fault story conditions update 2026-10-30: diagnosed/resolved conditions now require exact bound activity/fault references at publication and runtime; missing or ambiguous facts deny positive and negative branches. Author fact/fault/Yes-No controls persist and validate in Chrome. Pure checks and real fault-story publication/simulation/navigation rehearsal pass, including unknown reference and missing-history rejection. Build/architecture and existing story/store regressions pass. Local fault preview/path exploration remains next. See docs/course-stories.md.

Story fault projection update 2026-10-30: server facts now derive diagnosed/resolved booleans from the same selected completed attempt as certification, validated against published fault IDs and release/policy/model binding. Missing/corrupt/foreign history and incomplete/invalidated selected attempts yield no fault facts. Pure best/latest and negative tests plus PostgreSQL real completion/missing-history checks pass; build, architecture and story/policy/path/store regressions pass. Condition schema, author controls and branch journeys remain next. See docs/course-stories.md.

Diagnosis evidence update 2026-10-30: authoritative simulation state and completion payload now retain diagnosedFaultIds separately from resolvedFaultIds. Successful diagnosis records once; failed resolution preserves diagnosis without resolution/credential. Legacy state derives prior diagnosis only from resolved faults or persisted RESOLUTION stage. Pure engine, semantic/fault PostgreSQL, build/architecture, author Chrome and published-story regressions pass. E6-T25 condition schema, selected-attempt projection, author controls and diagnostics remain next. See docs/course-stories.md.

Removal publication update 2026-10-30: removed-replacement successor rehearsal passes with explicit null mapping, retained scoring, renewed reviews, remapped learner inspection/actions and new credential. Original release/hash/model binding/credential remain exact. Aggregate draft-simulation:validate includes the mode. Next explicit backlog gap is E6-T25 diagnosis/fault-outcome story conditions; current story facts expose completion, passing, score and attempts only. Deployed/device fidelity and broader MVP work remain open. See docs/model-exploration.md.

Unused component removal update 2026-10-30: explicit null mapping removes unused simulation component definitions and initial-state keys atomically. Step, fault and hotspot references block removal; no scoring/text/activity deletion is inferred. Author UI supports removal with exact confirmation count. Pure guards, restricted-runtime DB/HTTP rollback/retry, Chrome confirmation/cancellation, build/architecture and expanded publication regression pass. Removal-specific successor publication, multiple-model authoring and deployed/device fidelity remain open. See docs/model-exploration.md.

Additional replacement components update 2026-10-30: explicit mapping permits extra target components, adding selection-only initial defaults without new steps, faults, scores or certification requirements. Mapping UI discloses additions; pure, restricted-runtime DB/HTTP and Chrome checks pass. Expanded-model successor publication completes reviewed learner actions and issues a credential while original release evidence remains unchanged. Build passes. Component removal/merging, multiple-model authoring and deployed/device fidelity remain open. See docs/model-exploration.md.

No-code component mapping update 2026-10-30: approved component lookup and labeled target selects now support explicit replacement mapping. Missing/duplicate mappings reject, selection clears mapping, late responses are fenced, and retry/focus/cancellation pass Chrome. Restricted-runtime lookup/HTTP tests pass. Changed-ID successor publication verifies new reviews, remapped inspection/actions, credential issuance and unchanged original evidence; compatible-ID regression also passes. Full build/architecture pass. Added/removed/merged components, multiple models and deployed/device fidelity remain open. See docs/model-exploration.md.

Explicit component mapping update 2026-10-30: replacement API accepts complete one-to-one from/to mapping validated against database manifests. Shared nonmutating remapper updates component definitions, initial states, step/fault actions and hotspots while preserving text, scores and identities. Mapping participates in retry signature and atomic audit; target transform validation and renewed reviews remain required. Pure mapping, restricted-runtime DB/HTTP, build, architecture, author Chrome and compatible successor publication pass. Mapping UI and changed-ID learner publication remain next; additions/removals/merges are not inferred. See docs/model-exploration.md.

Model replacement publication update 2026-10-30: added successor-draft/review/replacement/publication/learner acceptance. Replacement invalidates prior approvals; renewed reviews publish new model binding with preserved activity IDs. New learner inspection/private access and scored completion issue one new credential; old release/hash/model binding/credential remain exactly unchanged and model access is release-specific. Local controlled-storage rehearsal passes and is included in draft-simulation:validate. Different-geometry fidelity, component remapping and deployed/device acceptance remain open. See docs/model-exploration.md.

Compatible model replacement update 2026-10-30: author picker remains available with simulations and supports confirmed replacement preserving component IDs, activities and scoring. Previous database manifest/hash and approved replacement component set are checked; incompatible transforms and forged draft mapping reject. Atomic audit/revision returns course to DRAFT; concurrent retry and later-edit preservation pass. Build, restricted-runtime DB/HTTP, author Chrome, architecture, course-review HTTP and mixed inspection publication regressions pass. Arbitrary component remapping and deployed/device fidelity remain open. See docs/model-exploration.md.

Standalone model binding update 2026-10-30: authors can bind an approved model without creating a simulation. Shared transactional revision/approval validation, atomic audit and idempotent replay preserve existing content and later edits. Author picker supports confirmation, cancellation, interrupted retry and focus. Full build, restricted-runtime binding/HTTP, integrated author Chrome, architecture, course-review HTTP and standalone inspection publication regressions pass. Existing-model replacement and deployed/device acceptance remain open. See docs/model-exploration.md.

Model exploration publication update 2026-10-30: enabled valid viewer/hotspot publication with component revalidation against the actual approved model before artifact creation. Forged draft components reject without artifacts/runtime/release/events. Mixed scored-course and inspection-only saved-draft/review/private-delivery/acknowledgement journeys pass; passive review creates no scored attempts/credentials. Build/schema/architecture, restricted access, actual-renderer/author Chrome and ordinary/media regressions pass. Standalone model selection UI and deployed/device acceptance remain open. See docs/model-exploration.md.

Learner model inspection update 2026-10-30: text/hotspot view and optional private 3D load now support local highlighting, explicit review, reload/fallback and renderer disposal on navigation/sign-out. Actual GLB/Babylon Chrome verifies highlighting, zero score/no simulation requests, review retry and late/denied response handling; 768px screenshot inspected. Added missing author/learner lazy-runtime routes. Build/architecture and learner/media/story regressions pass. Approved-model publication verification remains next; exploration gate retained. See docs/model-exploration.md.

Model inspection access update 2026-10-30: authenticated enrollment/activity inspection returns bounded content after immutable published model/version/hash/component and story checks. Explicit review uses the same validation; concurrent retries yield one acknowledgement, no simulation attempt or inspection-only credential. Restricted-role database/HTTP, build, architecture and media/enrollment regressions pass; fixture read grants are restored. Learner 3D UI and publication acceptance remain next, with exploration publication still gated. See docs/model-exploration.md.

Model exploration authoring update 2026-10-30: strict bounded viewer/hotspot overview and component-explanation contract plus no-code module creation/editing are implemented. Unknown/duplicate components and action fields reject; author Chrome covers creation/save, validation, removal/cancel and focus. Passive 3D inspection no longer incorrectly requires simulation attempt/evidence policy. Full build/schema/architecture pass. Learner rendering/acknowledgement and approved-model publication acceptance remain open; EXPLORATION_DELIVERY_UNAVAILABLE gates these types. See docs/model-exploration.md.

Interactive catalog update 2026-10-30: guided procedure, manipulation and assembly now have runtime bindings, learner launch, scored certification/story classification, requalification and catalog disclosure. Bound simulation type selector preserves IDs and uses existing action/step/scoring/equivalent-path authoring. Build/schema/architecture and author/learner Chrome pass; PostgreSQL verifies each type through publication/actions/credential, including story and branch cases and scored disclosures. Standalone viewer/hotspot and physical assembly fidelity remain open. See docs/activity-authoring.md.

Media CSP integration update 2026-10-30: real response-header review found Azure Blob image/video URLs blocked by inherited self-only directives. Added explicit Azure Blob img-src/media-src in normal and managed-auth policies, retaining script/frame restrictions. Chrome through the actual API verifies Azure sources permitted and unrelated origins blocked with auth on/off; probes resolve locally. API build and auth/HTTP regressions pass. Actual Azure streaming/codecs/device acceptance remains open. See docs/media-activities.md.

Media publication update 2026-10-30: enabled validated image/video publication after saved-draft/review/release/private-delivery/acknowledgement integration passed. Approval loss blocks publication; media hashes and activity IDs survive release creation; media review alone cannot issue a credential, while required scored simulation plus media yields one credential without release mutation. Build, media/schema/architecture, restricted-role media, author/learner Chrome, story publication and ordinary publication checks pass. Local controlled-service evidence is not Azure streaming/device/accessibility acceptance. See docs/media-activities.md.

Approved-media authoring update 2026-10-30: author-only paged asset listing and module pickers add image/video activities, edit descriptions/transcripts and confirm same-type binding replacement through existing autosave. Chrome verifies paging, inert filenames, creation/save, focus and replacement cancellation; restricted-role database verifies 51 assets over two pages and tenant isolation; HTTP role/query/method checks, full build and architecture pass. Full media publication/delivery acceptance remains next; publication gate retained. See docs/media-activities.md.

Learner media update 2026-10-30: image/video controls now load private URLs on demand, display inert descriptions/transcripts, recover failed links and dispose media on navigation/sign-out. Explicit acknowledgement rechecks publication binding and approval, records one event under concurrent retries, and cannot award a media-only credential. Build, architecture, controlled media/ordinary learner/story Chrome and restricted-role database checks pass. Actual streaming/device acceptance, author picker and full publication remain open; media gate retained. See docs/media-activities.md.

Private media endpoint update 2026-10-30: authenticated enrollment/activity media GET now resolves published version/hash, approved tenant asset/type and current story access before issuing a five-minute URL. Restricted-role PostgreSQL/HTTP verifies image/video projection, ownership/lifecycle/hash/type/storage denials without signing, account/candidate access, no-store and safe failures; no learning evidence is created. Build, HTTP and architecture pass. Synthetic fixture uses restored bootstrap-equivalent story read grant; Azure streaming, author selection, learner rendering and acknowledgement remain open and media publication stays gated. See docs/media-activities.md.

Media activity foundation update 2026-10-30: added private asset-version bindings, approved source/MIME validation, image descriptions and video transcripts. Publication independently collects media references and locks approved tenant asset versions; missing or mismatched assets reject without release/runtime/event writes. Build, pure media/schema, architecture, PostgreSQL negative publication and ordinary publication/learning regressions pass. MEDIA_DELIVERY_UNAVAILABLE keeps image/video draft-only until private endpoint, author selection, learner rendering and acknowledgement integration are verified. See docs/media-activities.md.

Activity structure update 2026-10-30: added downward activity movement and confirmed removal of unreferenced draft activities, with stable IDs and focus restoration. Removal guards story node/condition references, certification requirements, required/update modules and simulation bindings. Integrated Chrome verifies persisted order, boundaries, cancellation/removal, focus and story-only/required-activity guards; web build and architecture pass. Broader media/activity catalog and simulation binding replacement remain open. See docs/activity-authoring.md.

Story publication update 2026-10-30: valid stories can now publish after normal reviews and validation. Added versioned-policy requirement and real saved-draft/review/publication/simulation/HTTP-terminal rehearsal with immutable release and credential preservation. Required-activity bypass and legacy policy reject without release/runtime/publication-event rows. Build, pure story/path/schema, architecture, separate author/learner Chrome, ordinary publication and simulation lifecycle regressions pass. Local fixture administrator/controlled-provider evidence is not deployed or one-browser end-to-end acceptance. See docs/course-stories.md; remaining diagnosis/fault conditions and broader MVP work stay open.

Story restart update 2026-10-30: confirmed retry-terminal restart now atomically advances navigation revision with an immutable receipt and audit, retaining assessment history and attempt rules. Restricted-runtime PostgreSQL/HTTP checks verify rollback, concurrent replay, one audit, strict confirmation, success-terminal rejection and old-restart non-rewind. Controlled learner Chrome verifies cancellation and interrupted-response retry; full build/story/architecture checks pass. Real publication-to-player acceptance remains next and the publication gate stays enabled. See docs/course-stories.md.

Story path diagnostics update 2026-10-30: author Check story paths explores representative completed-result cases through production transitions, introduces facts only at reachable activities, and reports blocked routes/unreached choices/terminal outcomes. Caps of 128 scenarios, 128 results and 4096 node visits produce explicit partial reporting. Pure tests cover semantics/nonmutation/limits; integrated author Chrome, build and architecture pass after restoring an editor file affected by a default-encoding write failure. This is hypothetical aggregate evidence, not score attainability or all learner histories. Publication journey and delivery gate removal remain next. See docs/course-stories.md.

No-code story authoring update 2026-10-30: draft editor creates sequential stories from stable course activities and edits mission/nodes/choices/conditions/outcomes with shared validation, guarded removal, focus and existing autosave. Local preview uses production story transitions with synthetic result facts, invalidates on edits and sends no learner requests. Integrated author Chrome verifies creation/cancellation, cycle and condition errors, terminal traversal, node guards/focus and saved content; build/story/architecture checks pass. 768px layout inspected. Automatic path diagnostics and full publication journey remain pending; delivery gate retained. See docs/course-stories.md.

Learner story UI update 2026-10-30: enrollment exposes hasStory only; player reads server current-node projection, shows mission/choices/current activity, distinguishes terminal outcome from certification, preserves interrupted request keys, refreshes conflicts and fences late sign-out responses. Controlled Chrome covers inert text, current activity, retry/conflict/focus/access cleanup; 768px full-layout screenshot inspected. Existing learner/enrollment/build/architecture regressions pass. Author UI/path diagnostics and real-server publication journey remain pending; publication stays blocked. See docs/course-stories.md.

Story activity-access update 2026-10-30: shared transaction gate now covers reading acknowledgement, assessment start/get/submit, simulation launcher/direct session start and model resume/actions. Current node, server-fact prerequisites, owner and exact release binding are rechecked; enrollment locks serialize against choices. Restricted-runtime assessment/read fixture and PostgreSQL --story-access model rehearsal pass; non-story assessment/model regressions, build and architecture pass. Reference files/text are not gated and no new evidence is awarded. Story UI/path diagnostics and publication acceptance remain open. See docs/course-stories.md.

Story HTTP update 2026-10-30: added authenticated GET enrollment story and POST choice routes with strict JSON/header inputs, no-store projections, safe errors and exact store replay/conflict handling. Shared account/organization and candidate learning-access checks precede enrollment ownership. Restricted-runtime HTTP/store fixture and generic HTTP/candidate regressions pass; localhost sandbox denial resolved with permitted rerun. Activity launch/acknowledgement/resume gates and author/learner interfaces remain pending; story publication stays blocked. See docs/course-stories.md.

Durable story store update 2026-10-30: tenant-RLS positions and request receipts now persist enrollment/release-bound navigation with exact revision checks, serialized choices, authoritative fact gates, atomic audit and non-rewinding replay. Runtime receipts are read/insert only. Restricted-role PostgreSQL covers concurrency, rollback, ownership, lifecycle, terminal outcomes and no credentials; full build/architecture pass. Tests use directly seeded synthetic story release/evidence while publication remains disabled. HTTP, activity gating and author/learner UI remain open. See docs/course-stories.md.

Story evidence update 2026-10-30: shared deterministic best/latest attempt selection between certification and story facts; extracted existing scoped assessment/simulation/reading evidence loader. New tenant-transaction helper derives release/policy from owned ACTIVE enrollment and PUBLISHED release. Pure parity/binding/corrupt-evidence tests and PostgreSQL ownership/suspension/invalidation plus assessment regression pass. Initial concurrent fixture migration deadlock resolved by sequential reruns; incorrect enrollment join corrected. Durable story position, UI and launch gating remain open and story publication stays disabled. See docs/course-stories.md.

Course story foundation update 2026-10-30: added strict bounded mission/node/choice/outcome contract, recorded-activity conditions, pure projection/transition functions and required-activity dominance checks across all success paths. Publication derives requirements from policy activities/modules and keeps story-bearing courses draft-only until persistence/player integration exists. Contract/build/schema/publication/architecture checks pass locally. No author UI, durable story session or learner navigation is claimed complete. See docs/course-stories.md for integration sequence and limitations.

Simulation identity validation update 2026-10-30: fixed ineffective Set.add duplicate checks for model/components/steps/faults and publication manifest IDs. Malformed successor lists return findings instead of crashing graph traversal. Pure tests reproduce prior acceptance, verify rejection/nonmutation, and exercise publication validation. PostgreSQL duplicate-step rehearsal proves no release/runtime/publication-event writes, then restored valid draft completes learner/credential lifecycle. Build/schema/branch/author Chrome/architecture checks pass locally. Full narrative story/choice authoring and deployed acceptance remain open. See docs/simulation-authoring.md.

Author 3D preview update 2026-10-30: saved approved draft models now load through a revision/tenant/role/approval-gated private GLB endpoint and lazy Babylon viewport. Local accepted actions/reset update geometry without learner evidence; edits/sign-out/removal fence or dispose preview. Restricted-runtime endpoint, actual-renderer Chrome, author/learner regressions, build and architecture passed locally. Visual inspection found and fixed a glow-overlay rendering defect using material selection; synthetic fixture screenshot inspected. Endpoint and browser checks are separate controlled rehearsals, not deployed acceptance. Narrative choices and broader MVP gates remain open. See docs/simulation-authoring.md.

Visual procedure graph update 2026-10-30: shared-definition graph shows steps, successor arrows, preconditions, faults and start/required/end markers with keyboard navigation and full text outline. Transition editing rejects cycles/duplicates and confirms removals, updates terminals, invalidates preview and uses existing validation/autosave. Chrome verifies editing/reachability/focus plus existing regressions; 768px and 360px content-frame renders inspected with local overflow checks. Build/branch/architecture pass. Narrative story choices, 3D author viewport and deployed/physical-device acceptance remain open. See docs/simulation-authoring.md.

Approved-model action validation update 2026-10-30: author preview and scenario-path checks now validate model identity/component set, transform bounds/snapping and initial pose through the learner normalization function. Publication rechecks the current approved database manifest under shared lock before artifacts/runtime writes; editable manifest limits cannot bypass it. Pure/Chrome checks pass; PostgreSQL negative publication leaves no release/runtime/event rows and valid restoration completes learning/issuance. Build/publication/semantic-action/model/schema/architecture regressions pass locally. Visual 3D author preview, physical fidelity and deployed acceptance remain open. See docs/simulation-authoring.md.

Learner semantic-action update 2026-10-30: all nine editor action types now pass through HTTP, transport, authoritative simulation/fault evaluation and keyboard controls with optional values/references and bounded transforms. Navigation/hints remain non-scoring unless required. Replay identity includes value/reference; forged fields and untransportable definitions are rejected. Published fixture covers all types, semantic faults, completion/credential and resume; HTTP/Chrome/model-contract/schema/build checks pass locally. Model-aware range/snap publication validation and deployed acceptance remain open. See docs/simulation-authoring.md.

Scenario-path diagnostics update 2026-10-30: author preview now checks typed equality cases through production transitions, starting with configured initial values. Reports identify blocked/missing/below-threshold outcomes and steps/faults not reached; constant effects and fault resolution are included. Work is bounded to 128 cases/4096 actions with explicit partial reporting. Pure tests cover both caps, coverage, score and nonmutation; Chrome covers report refresh/safe rendering/no learner requests. Build/schema/architecture pass. This is correct-action author analysis, not every learner mistake, model geometry validation or deployed acceptance. See docs/simulation-authoring.md.

Simulation variables and branches update 2026-10-30: typed initial variables, step/fault assignments, preconditions, branch destination and common completion controls are implemented. Shared engine selects a unique matching successor after effects/fault resolution; invalid/ambiguous rules block validation and unmatched transitions preserve input state. Alternative paths require equivalent instructions. Pure/Chrome tests cover both routes and scores; published PostgreSQL branch rehearsal verifies persistence, issuance/replay/lifecycle. Build/schema/architecture/fault regressions pass. Full visual story/learner-choice graph, comprehensive every-path tooling and deployed acceptance remain open. See docs/simulation-authoring.md.

Simulation creation update 2026-10-30: author-only approved-model paging and confirmed initial simulation creation now connect to the editor. Server derives binding/hash/components from the approved tenant model and atomically adds draft content plus audit under revision/idempotency checks. Starter instructions/scoring require author completion. Restricted-runtime database/HTTP tests cover pagination, approval loss, tenant denial, rollback, concurrent retries and later-edit preservation; controlled Chrome covers selection/cancellation/retry/editor focus. Build, schema, architecture, HTTP and publication regressions pass. Full branching/variables, existing-binding replacement and deployed acceptance remain open. See docs/simulation-authoring.md.

Simulation structural authoring update 2026-10-30: existing bound drafts now support step insertion, fault creation and confirmed removal with reference cleanup, dependency guards and focus restoration. New entries require equivalent instructions and start at zero points; model identity and explicit maximum score are preserved. Shared validation now rejects blank/malformed/unknown fault instructions before publication. Chrome saves and completes a newly authored sequence, tests cancellation/dependency blocking and removal cleanup. Build, schema, architecture, course publication and fault PostgreSQL checks pass locally. Initial creation/approved-model selection, full branching/variables and deployed acceptance remain open. See docs/simulation-authoring.md.

Simulation fault invalidation update 2026-10-30: published INVALIDATE_SESSION now atomically terminates failed fault actions with session/attempt, action and audit evidence. Prior score and geometry are retained; no completion or credential is issued. Author controls and preview expose the rule. Build, schema, architecture, author Chrome, release-session Chrome, model contract and normal/fault PostgreSQL checks pass. Fault checks cover rollback, concurrent retries, changed payload/foreign owner denial, terminal resume and cooldown. PostgreSQL uses the fixture administrator connection and controlled storage; deployed and restricted-runtime acceptance remain open. Full creation/binding/branching and broader MVP gates remain open. See docs/simulation-fault-invalidation.md.

2026-10-30 E6 simulation increment: existing bound procedure/fault editing and validated deterministic local preview are implemented and locally tested. Full creation/binding/graph authoring, branching and INVALIDATE_SESSION runtime behavior remain open. See `docs/simulation-authoring.md`.

2026-10-30 E6 assessment-editor increment: mixed-question authoring, reorder/removal, ordered-sequence editing and actual signed-in visibility are locally verified. Full no-code simulation/branch authoring remains open; see `docs/assessment-authoring.md`.

2026-10-30 catalog disclosure increment: published revision/certification requirements and matching versioned consent snapshots are locally verified. Existing legacy consent is preserved. Candidate analytics and deployed journey acceptance remain open; see `docs/course-availability.md`.

2026-10-30 personal-wallet sharing increment: owner-controlled sharing, copy link and independently decoded QR are locally verified without active training/membership. See `docs/personal-wallet.md`; deployed and physical-device acceptance remain open.

2026-10-30 historical wallet increment: owner-only cross-issuer historical read access and wallet page are locally verified; independent sharing/QR controls and deployed acceptance remain open. See `docs/personal-wallet.md`.

2026-10-30 issuer availability increment: published-release visibility/disclosure administration is implemented and locally verified. See `docs/course-availability.md`; broader catalog and deployed acceptance gates remain open.

2026-10-30 candidate browser increment: explicit consent/enrollment, safe return-to-course hints, active cross-issuer training navigation and learner deep-link regression are locally verified. See `docs/candidate-enrollment.md` and `tasks/evidence-registry.md`. Historical cross-issuer wallet, issuer availability UI and live journey acceptance remain open.

Source of truth: `docs/medical-device-training-platform-solution-design.md` version 0.31, dated 2026-10-22.

Status convention: every item starts unchecked. A task is not complete until its acceptance criteria and verification evidence are recorded. IDs are stable and should be used in commits, test names, decision records, and release evidence.

Hierarchy: **Epic → Feature → User Story → Implementation Tasks**.

2026-10-30 E9/E10 suppression increment: operator review/release now preserves historical records, requires exact revision and confirmation, records atomic audit evidence, and safely re-suppresses on new bounce evidence. Local database and invitation-worker checks pass; see `docs/email-suppression-review.md`. Provider-wide policy and live production acceptance remain open, so the broader epic gates remain unchecked.

2026-10-30 E9/E10 increment: delivery-report dead-letter inspection/replay now has an authenticated operator CLI, tenant filtering, exact snapshots, durable audits and local failure/retry evidence. See `docs/email-report-recovery.md` and `tasks/evidence-registry.md`. This does not close the broader notification or operational acceptance items: suppression review/release and live Azure recovery validation remain open.

## How to use this backlog

This file is the technical implementation backlog. It contains the work required to build, test, operate, and prove the product.

- **Decisions that need human approval:** [Decision Register](decisions.md)
- **Implementation sequence and checkpoints:** [Implementation Plan](plan.md)
- **Requirement-by-requirement reconciliation:** [Requirements Audit](requirements-audit.md)
- **Chief architect standup review:** [Architecture Audit](standup-architecture-audit.md)

Decision IDs such as `DEC-001` are not technical tasks. They identify choices that must be approved before dependent implementation becomes fixed. E0 is the decision and pilot-control lane; E1–E10 are the technical delivery lanes. E0 fixture, evidence, and test-preparation tasks remain technical enablement work and are clearly identified within that lane.

### Backlog lanes

| Lane | Location | Purpose | Completion signal |
|---|---|---|---|
| **Decision lane** | [decisions.md](decisions.md), linked from E0 | Resolve product, legal, architecture, platform, cost, privacy, accessibility, and pilot choices | Approved decision record with owner, rationale, effective scope, and evidence requirements |
| **Technical lane** | E0 technical enablement and Epics E1–E10 below | Build and verify the approved behavior | Acceptance criteria, verification evidence, dependencies, and scope are complete |

### Reading order

1. Read [decisions.md](decisions.md) for choices that can change scope or architecture.
2. Read [plan.md](plan.md) for dependency order and vertical delivery checkpoints.
3. Work through the technical backlog in Epic order.
4. Use [requirements-audit.md](requirements-audit.md) to prove every source requirement has coverage.
5. Use [standup-architecture-audit.md](standup-architecture-audit.md) for go/no-go and stop conditions.

Each implementation-task checklist is scoped by the acceptance criteria, verification, dependencies, and size directly below its parent story. This keeps the backlog detailed without duplicating the same criteria on every subtask.

## Global acceptance rules

- All tenant-owned records, blobs, jobs, search records, events, and audit records carry an organization boundary.
- AI output, reconstructed models, drafts, simulations, assessment rules, and certification policies are never active or published without the required human review.
- Published releases, model versions, simulation definitions, assessment versions, policies, attempts, credential events, and evidence are immutable.
- The client never writes a score, pass result, completion result, or credential status as authoritative truth.
- Every long-running operation is durable, asynchronous, bounded, idempotent, observable, and has an explicit terminal failure state.
- Every certification-critical 3D activity has a text, keyboard, or reduced-complexity equivalent that measures the same competency.
- MVP credential language always says organization-issued platform certification or online-verifiable credential record; it does not imply accreditation, licensure, or portable cryptographic proof.

## Non-negotiable design guardrails

Always preserve:

- Tenant isolation in API, database, storage, retrieval, jobs, events, audit, and projections.
- Versioning for anything that can affect certification and human approval before AI-generated content becomes active.
- Schema validation for all AI and simulation output, source citations/reviewer history, and audit events for administrative/credential mutations.
- Unit, integration, end-to-end, security, accessibility, responsive, and device/3D tests appropriate to the changed behavior.

Require an explicit decision before changing:

- Database schema or RLS/tenant-context rules; credential lifecycle or public verification meaning; release/version/requalification behavior; AI provider/deployment or retrieval boundary; model/runtime/physics adapter; source rights/retention/deletion; accessibility target/equivalent path; public discovery; API/webhook contracts; or any MVP out-of-scope area.

Never allow:

- Client-authoritative pass/score/completion, unreviewed AI/model/simulation/policy publication, raw source/public private storage, cross-tenant retrieval, arbitrary AI/simulation code, unsupported input to count as successful ingestion, silent historical mutation, or a claim that the MVP credential is a license/accreditation/portable offline proof.

## Epic E0 — Product, technical decisions, and pilot controls

Outcome: all customer promises, fixtures, boundaries, provider choices, rights, retention, device, accessibility, and pilot economics are explicit before implementation can create irreversible assumptions.

### E0 work split

| Work type | Task IDs | How to manage it |
|---|---|---|
| **Decision closure** | E0-T01–E0-T04, E0-T09–E0-T25, E0-T29–E0-T33 | Track the choice in the [Decision Register](decisions.md). Do not mark the decision complete from a code change alone. |
| **Technical enablement** | E0-T05–E0-T08, E0-T26–E0-T28 | Build fixtures, evidence mapping, and release-gate controls. These are technical tasks and require normal implementation evidence. |

The decision-closure items are intentionally visible in the hierarchy because they gate the technical work. Their authoritative owner, options, approval state, and closure evidence are maintained in [decisions.md](decisions.md).

### Feature E0-F1 — MVP boundary and intended use

#### Story E0-S1 — Freeze the MVP promise and non-goals

As a product owner, I want an approved MVP boundary so the team can build and sell only what the design supports.

Tasks:

- [ ] E0-T01 Record the MVP promise: online, English, Azure-first, browser-based, organization-issued product-training certification, with an approximately five-organization initial pilot-sizing assumption but no product or architectural organization cap, no PHI, LLM-assisted PDF/handbook-to-training conversion as a core workflow, and 3D modeling/interaction as a core workflow.
- [ ] E0-T02 Record non-goals: offline delivery, native apps, onsite scheduling/sign-off, patient data, ATS/job marketplace, LMS replacement, regulatory approval, VR/AR, multiplayer, and automatic AI publication.
- [ ] E0-T03 Define approved product language for certification, verification, intended use, expiration, revocation, supersession, and learner sharing.
- [ ] E0-T04 Add scope-change review rules that require a new phase decision for PHI, accreditation, offline credentials, ATS, full LMS, SSO/SCIM, or customer-specific model training.

Acceptance criteria:

- [ ] The scope statement and non-goal list are approved and linked from the product UI copy and release checklist.
- [ ] The approved scope explicitly identifies LLM-assisted PDF/handbook conversion and 3D modeling/interaction as MVP pillars, while treating the initial organization count as pilot sizing rather than a product limit.
- [ ] All credential-facing screens use the approved intended-use wording and do not imply licensing or regulatory recognition.
- [ ] A proposed out-of-scope request is routed to a documented scope decision instead of being silently implemented.

Verification: product-owner decision record, copy review, and a scope-boundary test/ADR review.
Dependencies: None. Scope: S.

#### Story E0-S2 — Establish the synthetic reference pilot fixture

As an implementation team, I want one repeatable device fixture so every technical spike and end-to-end gate uses the same evidence.

Tasks:

- [x] E0-T05 Create one synthetic or rights-cleared product story with a PDF/manual, existing GLB, supported image set, supported video, component list, procedure, fault, assessment, and expected credential.
- [x] E0-T06 Store fixture metadata, source hashes, expected page/time/frame citations, model component IDs, scale/orientation, required interactions, and expected scoring outcomes.
- [x] E0-T07 Create good, incomplete, corrupt, unsupported, conflicting-source, prompt-injection, and low-quality reconstruction variants.
- [ ] E0-T08 Package fixtures so local, CI, staging, browser, worker, and restore tests can consume them without production data.

Acceptance criteria:

- [x] One PDF, one GLB, one image set, and one video are available with rights status and stable hashes.
- [x] The fixture describes the expected author, learner, verifier, and operator outcomes and the exact evidence each gate must produce.
- [x] Negative fixtures trigger documented failures rather than being treated as successful processing.

Verification: `node tools/validate-reference-fixture.mjs` and `node tools/dry-run-reference-import.mjs` pass; clean-checkout/local-CI execution remains part of E0-T08.
Dependencies: E0-S1. Scope: M.

Implementation evidence for E0-T05–E0-T07: `fixtures/reference/fixture.json`, `tools/create-reference-fixture.py`, `tools/validate-reference-fixture.mjs`, and `node tools/validate-reference-fixture.mjs` passing. `node tools/dry-run-reference-import.mjs` now proves the deterministic fixture import rehearsal; E0-T08 remains open until clean-checkout/local-CI consumption and staging/worker/browser/restore integration are proven.

#### Story E0-S3 — Define device, browser, accessibility, and equivalent-path policy

As a pilot owner, I want named supported devices and accessibility rules so 3D claims are measurable and fair.

Tasks:

- [ ] E0-T09 Define the supported matrix: latest two Chrome, Edge, and Firefox versions on supported desktop operating systems; latest two supported iOS/iPadOS Safari versions; and latest two supported Android Chrome versions.
- [ ] E0-T10 Confirm WebGL2 as the minimum 3D capability, WebGPU as optional, and the target 30 FPS/device budget and 5-second approved-model interactivity target.
- [ ] E0-T11 Confirm WCAG 2.2 AA for non-3D surfaces and define the text/keyboard/reduced-complexity equivalence test for certification-critical activities.
- [ ] E0-T12 Define the test network, viewport classes (Compact, Standard, Wide), reduced-motion behavior, zoom/text-scaling expectations, and screen-reader checks.

Acceptance criteria:

- [ ] The device matrix is versioned and referenced by browser and 3D CI tests.
- [ ] Every certification-critical reference activity has an approved equivalent-path design before it is allowed into a certification policy.
- [ ] A device that cannot meet the 3D budget receives a usable reduced-complexity or equivalent path, not a silent failure.

Verification: signed device/accessibility decision, browser matrix smoke run, and accessibility test protocol.
Dependencies: E0-S2. Scope: S.

### Feature E0-F2 — Provider, architecture, rights, and data decisions

#### Story E0-S4 — Resolve implementation spikes and provider choices

As an architect, I want provider choices tested against the fixture so adapters are selected on evidence rather than assumption.

Tasks:

- [ ] E0-T13 Compare Babylon.js and Three.js on the reference GLB, component selection, manipulation, mobile performance, accessibility, and context-loss recovery; select the runtime.
- [ ] E0-T14 Compare AliceVision/Meshroom and COLMAP on the same image/video-derived inputs; evaluate quality, component mapping, operator effort, cost, processing time, licensing, and GLB readiness.
- [ ] E0-T15 Select the approved Azure AI deployment/region/model/API version, OCR/transcription path, retrieval baseline, token limits, and provider terms.
- [ ] E0-T16 Confirm PostgreSQL full-text plus `pgvector` for the pilot and define measured triggers for Azure AI Search.
- [ ] E0-T17 Define the named Azure US East/Southeast region, service availability preflight, restore region, network posture, and data-processing boundary.

Acceptance criteria:

- [ ] Each spike has a repeatable report, fixture, owner, decision, and revisit trigger.
- [ ] The selected providers fit the port contracts and do not leak provider types into domain code.
- [ ] Unsupported or unproven provider behavior is not represented as an MVP guarantee.

Verification: spike reports, architecture decision records, license review, and service-availability preflight.
Dependencies: E0-S2, E0-S3. Scope: L.

#### Story E0-S5 — Establish source rights, no-PHI, retention, and takedown policy

As an organization administrator, I want explicit rights and content-handling controls so uploaded material can be processed safely.

Tasks:

- [ ] E0-T18 Define the per-asset rights attestation fields: owner/licensor, permitted use, derivative permission, uploader, timestamp, source, and takedown contact.
- [ ] E0-T19 Define no-PHI customer acknowledgement, screening/quarantine behavior, uncertainty handling, and the statement that the platform is not HIPAA-ready.
- [ ] E0-T20 Define archive, disable, quarantine, suppression, tombstone, retention, export, and exceptional legal/security purge states; do not implement normal destructive deletion.
- [ ] E0-T21 Define dependency impact handling when an asset is quarantined or taken down and identify affected drafts, releases, credentials, and discovery projections.
- [ ] E0-T32 Produce the per-entity retention matrix and legal-hold rules for source assets, derived artifacts, releases, attempts, credentials, audit events, notifications, webhooks, usage, backups, and projections.

Acceptance criteria:

- [ ] No source can enter processing or publication without rights status and required no-PHI controls.
- [ ] A takedown quarantines source and derived assets, blocks future publication/discovery, and produces an auditable dependency report.
- [ ] Historical release and credential evidence remains addressable unless an operator-approved exceptional purge procedure is used.

Verification: policy review, negative fixture tests, takedown rehearsal, and retention/deletion decision record.
Dependencies: E0-S1, E0-S2. Scope: M.

### Feature E0-F3 — Pilot economics, quotas, and evidence model

#### Story E0-S6 — Define workload model, budget, quotas, and usage meters

As a platform operator, I want bounded usage controls so five organizations can use the MVP without unplanned cost or abuse.

Tasks:

- [ ] E0-T22 Create the workload model for organizations, authors, learners, source files, PDF pages, video minutes, reconstruction jobs, AI jobs, published courses, 3D minutes, and verification traffic.
- [ ] E0-T23 Define organization quotas for uploads, storage, AI generations/tokens, reconstruction, concurrent jobs, discovery searches, inquiries, public verification, and webhooks.
- [ ] E0-T24 Define token, compute, storage, egress, support, and learner cost meters with deduplication keys and reconciliation rules.
- [ ] E0-T25 Define budget thresholds, alerts, pause behavior for non-critical processing, and the measured criteria for changing topology.
- [ ] E0-T29 Implement the approved ≤15-minute pilot RPO target, record backup configuration, and document any explicit risk exception if Azure service availability or cost prevents the target.
- [ ] E0-T30 Define the pilot rate-limit design: application-level limiting for low-risk UI traffic and short-lived atomic PostgreSQL counters for verification, discovery, uploads, AI, reconstruction, and inquiries; do not add a distributed limiter until measured bottleneck evidence exists.
- [ ] E0-T31 Define approved artifact caching/egress rules: cache only approved public or learner-delivery artifacts, use short-lived URLs, use model LOD variants, and prevent repeated full-asset downloads.
- [ ] E0-T33 Map the exact quota matrix: source file size/count, PDF pages, video duration, concurrent jobs, AI generations by organization/operation/rolling period, reconstruction reruns, storage, verification by IP and credential ID, discovery by user/organization, inquiries by requester/recipient, and webhook volume by subscription/global retry budget.

Acceptance criteria:

- [ ] Every cost-intensive operation has a quota check, idempotency key, retry limit, usage record, and operator-visible outcome.
- [ ] A usage replay cannot double-count cost or quota consumption.
- [ ] Pilot budget and alert thresholds are approved before customer content is loaded.

Verification: usage-meter unit/integration tests, quota-denial tests, and a five-organization cost model.
Dependencies: E0-S2. Scope: M.

#### Story E0-S7 — Define evidence classification and release gate contract

As a delivery team, I want a shared evidence vocabulary so stakeholders can distinguish designed, spike-proven, implemented, pilot-validated, and released behavior.

Tasks:

- [ ] E0-T26 Define evidence classifications and required artifacts for each classification.
- [ ] E0-T27 Map each MVP acceptance item to an owner, fixture/test, dashboard, decision record, or runbook artifact.
- [ ] E0-T28 Define the stop conditions for tenant bypass, client-authoritative certification, unreviewed content/model publication, inaccessible certification paths, unbounded cost, and scope expansion.

Acceptance criteria:

- [ ] A capability cannot be called implemented or pilot-validated based only on an endpoint, worker run, model load, or generated text.
- [ ] Every Epic has named exit evidence and a checkpoint review.
- [ ] Release review blocks the pilot when any honest-MVP condition is missing.

Verification: traceability review and release-gate checklist walkthrough.
Dependencies: E0-S1, E0-S6. Scope: S.

## Epic E1 — Repository, delivery, and platform foundation

Outcome: the team can build, test, deploy, observe, migrate, and operate the system consistently across local, shared development, staging, and production-like environments.

### Feature E1-F1 — Monorepo, packages, local workflow, and test harness

#### Story E1-S1 — Create the modular monorepo and dependency boundaries

As a developer, I want a predictable monorepo so web, API, worker, domain, contracts, runtime, UI, database, and infrastructure code evolve together without forbidden coupling.

Tasks:

- [ ] E1-T01 Create `pnpm` workspace and task runner with `apps/web`, `apps/api`, `apps/worker`, `packages/domain`, `packages/contracts`, `packages/db`, `packages/ai-gateway`, `packages/simulation-schema`, `packages/model-runtime`, `packages/ui`, `packages/telemetry`, `infra/bicep`, and test fixture directories.
- [ ] E1-T02 Add TypeScript configuration, linting, formatting, package ownership, dependency policy, and architecture-import rules.
- [ ] E1-T03 Add architecture tests that fail when domain packages import Azure SDKs, React, Babylon.js, database clients, HTTP framework types, or provider AI types.
- [ ] E1-T04 Add provider-neutral ports for asset processing, AI, simulation, policy evaluation, private object storage, jobs, and notifications.

Acceptance criteria:

- [ ] Web, API, worker, and domain packages build independently and share only approved contracts/services.
- [ ] Forbidden imports fail CI with an actionable error.
- [ ] Every provider adapter has a local deterministic test double.

Verification: clean install, build, architecture test, and package-boundary review.
Dependencies: E0-S4. Scope: M.

#### Story E1-S2 — Provide documented local development and synthetic fixtures

As a new developer, I want one documented command path so I can run the safe fixture workflow without manual database editing.

Tasks:

- [ ] E1-T05 Implement documented `pnpm install`, `dev`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `infra:validate`, and `db:migrate` commands.
- [ ] E1-T06 Add local configuration from a safe `.env.example`; reject missing production-like settings and never commit secrets.
- [ ] E1-T07 Add synthetic fixture loading, reset, versioning, and cleanup for local and CI environments.
- [ ] E1-T08 Add Testcontainers or equivalent integration doubles for PostgreSQL, Service Bus behavior, Blob, identity claims, and email/webhook adapters where required.

Acceptance criteria:

- [ ] A clean checkout runs the reference fixture workflow using documented commands.
- [ ] Local fixtures contain no production source, real learner data, or secrets.
- [ ] Fixture reset is deterministic and does not delete outside the test environment.

Verification: clean-checkout smoke test and developer setup runbook.
Dependencies: E0-S2, E1-S1. Scope: M.

#### Story E1-S3 — Establish automated test layers and generated API clients

As a team, I want fast and realistic test layers so contract drift and regressions are detected before deployment.

Tasks:

- [ ] E1-T09 Configure unit, integration, contract, security, browser, 3D fixture, accessibility, visual-regression, and end-to-end test projects.
- [ ] E1-T10 Generate TypeScript clients from OpenAPI and require API changes to update schemas, clients, contract tests, and changelog entries together.
- [ ] E1-T11 Add baseline test data for five organizations, multiple memberships, versioned courses, credentials, jobs, outbox events, and discovery projections.
- [ ] E1-T37 Add a contract suite for every internal port and production adapter covering deterministic doubles, retryable/terminal/unauthorized failures, idempotency, duplicate delivery, version compatibility, and safe correlation/tenant/job/release telemetry.

Acceptance criteria:

- [ ] CI runs typecheck, lint, unit, contract, dependency, container, and infrastructure validation stages.
- [ ] A breaking API schema change fails generated-client or contract tests.
- [ ] Test data proves users can belong to multiple organizations and that historical release records remain immutable.

Verification: CI run from a clean commit and intentional contract-break test.
Dependencies: E1-S1, E1-S2. Scope: M.

### Feature E1-F2 — Azure infrastructure, environments, and secrets

#### Story E1-S4 — Provision isolated environments with Bicep

As an operator, I want repeatable Azure environments so development, staging, and production have separate data and credentials.

Tasks:

- [ ] E1-T12 Create Bicep modules for resource groups, Static Web Apps, Container Apps environment/apps/jobs, Container Registry, PostgreSQL Flexible Server, Storage, Service Bus, Entra configuration, AI resources/deployments, email, Key Vault, Application Insights, Log Analytics, and optional Search.
- [ ] E1-T38 Encode the pilot topology explicitly: one Static Web Apps application, one API application, one CPU worker family, separately controlled GPU-capable reconstruction capacity only when needed, one PostgreSQL server, one private Blob account, one Service Bus namespace, one Key Vault, and one telemetry workspace per environment.
- [ ] E1-T13 Define environment parameter files for local/shared development, staging/acceptance, and production with separate databases, containers, AI resources/deployments, credentials, and telemetry.
- [ ] E1-T14 Add service-availability and configuration preflight checks for region, model deployment, quotas, private/public endpoint choices, and restore region.
- [ ] E1-T15 Add network/ingress controls: HTTPS, explicit CORS, API-only public application ingress, storage/database non-public access, managed identity, worker egress restrictions, queue visibility, dead-letter, and graceful drain.

Acceptance criteria:

- [ ] A clean environment can be provisioned and smoke-tested without manual database editing.
- [ ] Production rejects wildcard CORS, public storage, unapproved AI deployments, missing retention/quota settings, and disabled audit logging.
- [ ] Production source content cannot be copied to lower environments without explicit redaction/approval.

Verification: Bicep validation, deployment smoke test, network check, and environment-isolation review.
Dependencies: E0-S4, E0-S5. Scope: L.

#### Story E1-S5 — Manage secrets and managed identities safely

As an operator, I want secrets protected and rotatable so credentials are not exposed in code, containers, logs, or client bundles.

Tasks:

- [ ] E1-T16 Configure managed identities for API, worker, and deployment access where supported.
- [ ] E1-T17 Store provider keys, database credentials, webhook secrets, email credentials, signing material, and export keys in Key Vault.
- [ ] E1-T18 Implement startup configuration validation and fail-closed behavior for missing/invalid production values.
- [ ] E1-T19 Implement overlapping secret rotation and test database, webhook, credential verification, email, and export access during rotation.

Acceptance criteria:

- [ ] No secret is committed, embedded in a client bundle/container, or printed in startup logs.
- [ ] Rotation preserves service continuity where overlap is required and records owner, resources tested, and old-secret disablement.
- [ ] A missing required production secret prevents readiness without leaking the secret name/value in public responses.

Verification: secret scan, Key Vault integration test, rotation rehearsal, and readiness test.
Dependencies: E1-S4. Scope: M.

### Feature E1-F3 — Database, API contract, telemetry, and web foundation

#### Story E1-S6 — Create the physical database and migration discipline

As a developer, I want a secure, versioned PostgreSQL foundation so relational invariants and release history are enforced from the first production migration.

Tasks:

- [ ] E1-T20 Create migration runner with lowercase naming, UUIDv7/opaque IDs, UTC `timestamptz`, explicit units, status constraints, foreign keys, and expand-and-contract rules.
- [ ] E1-T21 Create initial tables/columns for identity, tenancy, assets, jobs, knowledge, models, courses, learning, certification, discovery, notifications, usage, outbox, webhooks, and audit evidence.
- [ ] E1-T22 Add constraints and indexes for active membership, role-assignment uniqueness, version uniqueness, immutable/published rows, credential/public-ID uniqueness, simulation action idempotency/sequence, score bounds, job retries, usage deduplication, outbox uniqueness, and webhook delivery.
- [ ] E1-T23 Create separate migration/maintenance role and non-owner runtime role; document connection-pool transaction reset requirements.
- [ ] E1-T36 Define one SQL naming convention, version every persisted JSON document, support explicitly approved prior schema versions, preserve release schema/hash metadata, and add measured `EXPLAIN`/index/partition criteria before adding physical tuning complexity.
- [ ] E1-T39 Materialize the core-record contract as explicit relational columns for identity, ownership, scope, lifecycle, versioning, retention, approval, hashes, timestamps, lineage, audit, and deduplication; keep flexible JSON only for validated extensible configuration/provider reports.

Acceptance criteria:

- [ ] Migrations apply to an empty database and upgrade a representative prior version.
- [ ] Duplicate credentials/actions/usage/outbox events and invalid scores/lifecycle transitions are rejected.
- [ ] No destructive migration is coupled to the first deployment that depends on it.

Verification: migration tests, constraint tests, rollback/forward-compatibility test, and schema review.
Dependencies: E1-S4, E1-S1. Scope: L.

#### Story E1-S7 — Expose stable versioned API contracts

As an API consumer, I want a small versioned REST surface with predictable errors and pagination so integrations and web clients remain stable.

Tasks:

- [ ] E1-T24 Define `/v1` OpenAPI conventions, opaque IDs, cursor pagination, stable sort/tie-breakers, correlation IDs, safe error envelope, and request validation.
- [ ] E1-T25 Implement idempotency storage for mutating endpoints: actor, scope, key, request hash, response status/body, bounded retention, and conflict on body mismatch.
- [ ] E1-T26 Define authorization-derived organization scope; reject client-supplied organization scope not supported by the authenticated resource.
- [ ] E1-T27 Add API documentation for asynchronous durable job IDs, terminal states, retryable/terminal errors, and operator-sensitive operations.

Acceptance criteria:

- [ ] All public API errors use a safe machine-readable code, user-safe message, details, and correlation ID.
- [ ] Reusing an idempotency key with the same body returns the original result; a different body returns conflict.
- [ ] Cursor pagination is stable and avoids offset pagination for high-volume append-only lists.

Verification: OpenAPI lint, generated-client build, idempotency contract tests, and error-redaction test.
Dependencies: E1-S6. Scope: M.

#### Story E1-S8 — Add correlation-aware health, telemetry, and operational baselines

As an operator, I want safe telemetry and separate health signals so I can detect failures without exposing customer content.

Tasks:

- [ ] E1-T28 Add structured logs/traces/metrics with request, job, correlation, tenant, release, course-version, and actor identifiers where safe.
- [ ] E1-T29 Implement separate liveness and readiness checks; liveness must not depend on downstream services and readiness checks required database/messaging access without secrets.
- [ ] E1-T30 Add Application Insights/Log Analytics dashboards for API health, latency, database connections, queue age, worker status, errors, and cost/usage IDs.
- [ ] E1-T31 Apply sensitive-data redaction: no raw source, full prompts/completions, assessment answers, token values, private contact details, or credential private data by default.

Acceptance criteria:

- [ ] Every async job and certification request can be correlated across API, database, queue, worker, and outbox logs.
- [ ] Dashboards show normal and failed states for API, jobs, AI, storage, credential issuance, notifications, webhooks, and usage.
- [ ] Redaction tests prove prohibited payloads do not appear in logs or telemetry.

Verification: telemetry integration test, dashboard review, redaction test, and readiness/liveness probe test.
Dependencies: E1-S4, E1-S6, E1-S7. Scope: M.

#### Story E1-S9 — Build the shared accessible UI system and application shell

As a user, I want consistent, calm, accessible surfaces so organization and learner workflows behave predictably.

Tasks:

- [ ] E1-T32 Create light-first design tokens for typography, colors, spacing, shapes, elevation, motion, focus, and icons; pair status colors with labels/icons/patterns.
- [ ] E1-T33 Build shared components for loading, processing, needs-review, ready, blocked, failed, expired, revoked, permission-denied, empty, offline-not-supported, dialogs, forms, status announcements, and recovery actions.
- [ ] E1-T34 Create responsive Compact/Standard/Wide layout primitives and organization/learner route shells with persistent organization/product context.
- [ ] E1-T35 Add CSP, output encoding, frame/embedding policy, safe token handling without long-lived local storage tokens, and dependency checks.

Acceptance criteria:

- [ ] Shared components meet keyboard, focus, label, contrast, semantic status, reduced-motion, and screen-reader baseline tests.
- [ ] Every feature team can render all required state classes without inventing incompatible status semantics.
- [ ] Organization branding can override only logo/name/accent tokens and cannot alter focus, contrast, error, issuer, or status meaning.

Verification: Storybook/component tests, axe checks, keyboard test, responsive snapshots, and security-header test.
Dependencies: E0-S3, E1-S1. Scope: M.

## Epic E2 — Identity, organizations, tenancy, and authorization

Outcome: persistent personal accounts, multiple organization memberships, scoped roles, invitation flow, organization switching, and database-enforced tenant isolation work together without data leakage.

### Feature E2-F1 — Personal identity and account lifecycle

Verification increment (2026-10-30): founder creation and invitation acceptance require signed verified-email evidence; membership reactivation and all new credential paths require an active recipient account with unexpired observed evidence. Automatic completion preserves progress when blocked, and scheduled requalification waits without consuming retries. E2-T03 has local implementation evidence; real provider API-token claims and deployed acceptance remain open. See `docs/verified-email-enforcement.md`.

Security increment (2026-10-30): audited operator account lock/unlock and shared active-account checks across the administrative CLIs are locally verified, including reciprocal locking and preserved memberships. E2-T04 remains open for provider security-event integration and deployed stronger operator controls/MFA. See `docs/account-security.md`.

Implementation evidence (2026-10-30): persistent personal profile and issuer-bound external identity mapping, organization-independent account API/page, current signed verification projection and existing-account lock checks on private HTTP requests are locally implemented and verified. E2-T02 has application persistence evidence; complete E2-S1 still requires managed External ID registration/PKCE/recovery/renewal, full verified-email gating, security-event/lock administration and deployed acceptance. Explicit linking remains unimplemented; email matches do not merge accounts. See `docs/personal-account-foundation.md`.

#### Story E2-S1 — Create and secure a personal learner account

As a learner, I want to create and sign into a personal account so I can retain progress and credentials across organizations.

Tasks:

- [ ] E2-T01 Integrate Entra External ID Authorization Code + PKCE, email/password, verified email, supported password recovery, issuer/audience/signature/expiry/nonce validation, and safe sign-out/token renewal.
- [ ] E2-T02 Create `User` and `ExternalIdentity` mapping with application profile fields separate from authentication identity.
- [ ] E2-T03 Enforce verified email before organization membership or credential receipt.
- [ ] E2-T04 Add account lock/security event handling and platform-operator MFA/stronger-control requirements where available.

Acceptance criteria:

- [ ] A learner can self-register, verify email, sign in, recover a password through the provider, and resume a session safely.
- [ ] Unverified users cannot accept an organization invitation or receive a credential.
- [ ] Access tokens are not stored long-term in browser local storage and invalid tokens fail safely.

Verification: Entra integration test, browser auth E2E, token-claim tests, and security review.
Dependencies: E1-S5, E1-S7. Scope: M.

#### Story E2-S2 — Link duplicate identities explicitly

As a user who already has an account, I want an explicit account-linking flow so invitations never silently merge identities.

Tasks:

- [ ] E2-T05 Detect a matching invitation/account condition without exposing account existence to an attacker.
- [ ] E2-T06 Implement authenticated account-linking confirmation, audit record, conflict handling, and rollback-safe transaction.
- [ ] E2-T07 Reject automatic merges when provider subject, verified email, or ownership evidence does not match.

Acceptance criteria:

- [ ] Duplicate identity candidates require authenticated user confirmation.
- [ ] A failed or abandoned link does not change membership, credentials, or personal profile ownership.
- [ ] Linking and rejection events are audited without logging raw invitation tokens.

Verification: account-linking unit/E2E tests and invitation privacy review.
Dependencies: E2-S1, E2-S3. Scope: S.

### Feature E2-F2 — Organizations, memberships, invitations, and context

#### Story E2-S3 — Create an organization and manage memberships

As an organization owner/admin, I want to create an organization and manage members so the platform has an issuer tenant boundary.

Tasks:

- [ ] E2-T08 Implement organization creation, issuer identity, profile, branding, settings, active/suspended states, and audit events.
- [ ] E2-T09 Implement membership states, one active membership per user/organization, invite/removal/deactivation, and stale-membership handling.
- [ ] E2-T10 Implement organization list and active-organization context selection for users with multiple memberships.
- [ ] E2-T11 Record organization switching and administrative mutations with actor, scope, timestamp, and correlation ID.

Acceptance criteria:

- [ ] A user can belong to two organizations, switch context, and see only the active organization’s resources.
- [ ] Removing or suspending membership immediately blocks private operations while preserving personal credentials.
- [ ] All member/context changes create appropriate audit events.

Verification: multi-tenant browser E2E, membership constraint test, and audit review.
Dependencies: E2-S1, E1-S6. Scope: M.

Implementation evidence (2026-10-30): organization creation/founder administrator assignment, active-context selection, member role/status administration and invitation flows are locally implemented and verified. Administrator profile editing includes display name, description and HTTPS website with revision checks, durable audit and a browser settings page. Operator CLI suspension/reactivation now has exact lifecycle revisions, reasoned atomic audit, private-access fencing and preserved-history tests; see `docs/organization-lifecycle.md` and `evidence-registry.md`. E2-T08 remains open for branding and additional settings. Live invitation identity/email and deployed acceptance remain open.

#### Story E2-S4 — Invite a user with a secure, scoped, single-use token

As an organization administrator, I want to invite a user to a specific organization and role so access is controlled.

Tasks:

- [ ] E2-T12 Implement invitation creation with hashed token, organization, role, inviter, expiry, intended email, status, and audit record.
- [ ] E2-T13 Send invitation through the notification adapter without putting the raw token in URL query fields, logs, analytics, or referrers; use POST body acceptance.
- [ ] E2-T14 Implement accept flow requiring authentication or matching account creation, email verification, explicit organization/role confirmation, and one transaction for membership activation.
- [ ] E2-T15 Implement expired, used, revoked, wrong-organization, wrong-role, and replay-safe generic failures.

Acceptance criteria:

- [ ] A valid invitation creates/activates exactly one membership and cannot be reused.
- [ ] Expired, invalid, or already-used tokens fail without revealing whether a user or organization exists.
- [ ] Acceptance records the inviter, accepter, role, organization, timestamps, and correlation ID.

Verification: invitation unit/integration/E2E tests, raw-token log scan, and concurrent-acceptance test.
Dependencies: E2-S1, E2-S3, E1-S1 notification port, E1-S6 outbox contract; E9-S4 provides delivery later. Scope: M.

Implementation evidence (2026-10-30): internal invitation persistence/service and controlled database mutations are locally tested, including hashed tokens, role/email/scope checks, expiry/revocation, concurrent acceptance and audit rollback. Signed-token identity verification, strict HTTP preview/acceptance and browser confirmation are also locally verified. Administrator creation/list/revocation UI is also locally verified. Invitation email leasing, retry, operator recovery and status projection are locally verified with a controlled sender. E2-S4 remains open for live Entra verification-claim issuance, configured production email transport/delivery controls and deployed acceptance; see the latest evidence-registry entry.

### Feature E2-F3 — Roles, policy actions, and tenant isolation

#### Story E2-S5 — Enforce named scoped authorization actions

As a platform, I want policy-action authorization instead of scattered role checks so permissions remain auditable and consistent.

Tasks:

- [ ] E2-T16 Define platform, organization, product, course, learner, employer, and operator roles and scopes from the design matrix.
- [ ] E2-T17 Implement named actions such as `course.publish`, `credential.revoke`, `discovery.search`, `asset.process`, `review.approve`, `member.manage`, and `export.create`.
- [ ] E2-T18 Add authorization checks to API, worker, repository, storage, retrieval, and operator paths; return safe deny codes and audit sensitive denies.
- [ ] E2-T19 Implement reviewer/publisher separation and the no-sole-approval rule for safety-sensitive/certification-critical content, with explicit exception record where allowed.

Acceptance criteria:

- [ ] Each operation in the authorization matrix passes/denies correctly for every listed role and resource scope.
- [ ] A user’s membership in one organization never grants access to another organization’s resources.
- [ ] Unauthorized operations do not reveal private resource existence and sensitive denies are audited.

Verification: authorization matrix tests, route/service/repository tests, and reviewer/publisher E2E.
Dependencies: E2-S3, E1-S7. Scope: L.

#### Story E2-S6 — Enforce tenant isolation in PostgreSQL and all downstream paths

As a security owner, I want database-enforced tenant isolation so a missed repository filter cannot expose another tenant.

Tasks:

- [ ] E2-T20 Create RLS policies on tenant-owned tables with deny-by-default transaction-local tenant context.
- [ ] E2-T21 Use a runtime database role that does not own tenant tables and cannot bypass RLS; keep migrations/maintenance separate.
- [ ] E2-T22 Propagate validated tenant context into Blob keys, upload sessions, jobs, retrieval/chunks, notifications, webhooks, audit, and usage meters.
- [ ] E2-T23 Reset pooled connection context on commit, rollback, timeout, and return; test connection reuse across organizations.
- [ ] E2-T24 Create adversarial tests that deliberately remove application repository filters and attempt cross-tenant reads/writes through API, worker, storage, jobs, and retrieval.

Acceptance criteria:

- [ ] Missing/malformed tenant context returns no tenant rows rather than falling back to unfiltered data.
- [ ] Cross-tenant API, Blob URL, worker-job, and retrieval tests fail safely even with repository filters removed.
- [ ] Discovery uses only a separate privacy-safe projection and never disables RLS on source tables.

Verification: PostgreSQL RLS adversarial suite, pooled-connection reuse test, storage/job/retrieval isolation tests.
Dependencies: E1-S6, E2-S5. Scope: L.

#### Story E2-S7 — Build organization setup, member administration, and permission states

As an organization administrator, I want clear setup and member screens so I know what is ready, blocked, or restricted.

Tasks:

- [ ] E2-T25 Build organization setup screen with empty, loading, success, invalid-invite, no-membership, and organization-switching states.
- [ ] E2-T26 Build member/invitation list with role assignment, revoke, suspend, resend, and safe permission-denied states.
- [ ] E2-T27 Show active organization/product context persistently in authoring surfaces and prevent accidental cross-tenant edits.

Acceptance criteria:

- [ ] Admin can invite, resend, revoke, assign permitted roles, and remove/suspend members within scope.
- [ ] Users with no membership see a safe setup state and cannot access tenant data.
- [ ] Permission failures show a recovery/action path without leaking resource existence.

Verification: responsive browser E2E, accessibility checks, and role-matrix screenshots.
Dependencies: E2-S3, E2-S4, E2-S5, E1-S9. Scope: M.

## Epic E3 — Asset ingestion and asynchronous processing foundation

Outcome: organizations can upload private source material, attest rights, pass security checks, track durable processing, and receive reviewable PDF/model outputs with safe failures.

### Feature E3-F1 — Products, source versions, and private upload

#### Story E3-S1 — Create product and product-version workspaces

As an organization user, I want a product workspace so sources, models, courses, and releases are grouped by the device being trained.

Tasks:

- [ ] E3-T01 Implement Product and ProductVersion records with organization ownership, issuer scope, status, version identifiers, audit fields, and immutable release references.
- [ ] E3-T02 Build product list/detail screens with empty, loading, success, archived/disabled, and permission-denied states.
- [ ] E3-T03 Enforce product ownership and cross-tenant isolation in API, repository, storage, and authoring context.

Acceptance criteria:

- [ ] An authorized user can create a product and product version and select it for asset/course work.
- [ ] Product changes affecting published content create a new version or explicit migration decision.
- [ ] Product context is visible in authoring and learner-facing certification scope.

Verification: product API/UI tests, tenant isolation test, and version immutability test.
Dependencies: E2-S5, E2-S6. Scope: S.

#### Story E3-S2 — Upload a source through a scoped resumable private session

As an organization user, I want to upload PDF, image, video, and model files directly to private storage with progress and retry.

Tasks:

- [ ] E3-T04 Implement upload-session creation with tenant, product, source type, limits, expected object key, expiry, and short-lived user-delegation URL.
- [ ] E3-T05 Implement direct Blob upload with progress, cancel, resume/retry, checksum, MIME/type, byte, page/frame/duration/polygon/texture limits, and upload timeout handling.
- [ ] E3-T06 Implement completion endpoint that verifies object key, size, SHA-256, MIME, tenant, expiry, and session ownership before creating immutable AssetVersion.
- [ ] E3-T07 Keep originals private and expose only scoped short-lived read URLs; never expose Blob containers directly.

Acceptance criteria:

- [ ] A valid fixture upload reaches `READY_FOR_SCAN` without proxying large bytes through the API.
- [ ] Interrupted uploads can resume/retry or fail with a useful recoverable state.
- [ ] Wrong checksum, object key, MIME, size, expired session, or tenant fails closed and creates no publishable asset.

Verification: Blob integration test, checksum/expiry/tenant tests, browser upload E2E, and URL-scope test.
Dependencies: E3-S1, E1-S5, E1-S6. Scope: L.

### Feature E3-F2 — File security, rights, quarantine, and lifecycle

#### Story E3-S3 — Screen and quarantine uploaded content

As a platform operator, I want unsafe or prohibited content quarantined before processing so workers are not exposed to untrusted files.

Tasks:

- [ ] E3-T08 Implement malware scan, archive path-traversal/zip-bomb checks, MIME sniffing, active-content stripping/rejection, external-reference/SSRF prevention, and parser sandbox limits.
- [ ] E3-T09 Add PHI/prohibited-content screening and quarantine-on-uncertainty with customer-facing no-PHI explanation.
- [ ] E3-T10 Add explicit lifecycle states: `UPLOADING`, `READY_FOR_SCAN`, `QUARANTINED`, `SCAN_FAILED`, `READY_FOR_PROCESSING`, `PROCESSING`, `PROCESSING_FAILED`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `RETIRED`.
- [ ] E3-T11 Prevent quarantined, scan-failed, processing-failed, unsupported, or rights-failed assets from retrieval, authoring references, or publication.

Acceptance criteria:

- [ ] Corrupt, oversized, malware, prohibited, external-reference, and uncertain inputs fail closed with visible reason codes.
- [ ] The original asset remains immutable and each reprocess creates a new derived version/artifact.
- [ ] Asset status cannot be advanced to approved without all required scan, rights, and review conditions.

Verification: malicious-file fixtures, archive/SSRF tests, lifecycle transition tests, and quarantine UI test.
Dependencies: E3-S2, E0-S5. Scope: L.

#### Story E3-S4 — Record rights attestations and takedown dependencies

As a rights owner or operator, I want source rights and takedown actions recorded so downstream use can be stopped without rewriting historical evidence.

Tasks:

- [ ] E3-T12 Build rights-attestation capture and immutable history with owner/licensor, use scope, derivative permission, uploader, timestamp, and status.
- [ ] E3-T13 Implement takedown/quarantine endpoint with authorized action, reason, scope, effective time, and audit event.
- [ ] E3-T14 Find dependent drafts, AI artifacts, knowledge chunks, models, courses, releases, discovery records, and pending jobs.
- [ ] E3-T15 Apply archive/suppression/tombstone behavior and generate operator/issuer impact report; do not physically delete normal evidence.

Acceptance criteria:

- [ ] No asset can be used in a new release when rights are missing, withdrawn, or quarantined.
- [ ] Takedown identifies affected downstream artifacts and prevents future processing/publication/discovery.
- [ ] Historical evidence remains internally auditable and the takedown decision is exportable.

Verification: rights/takedown integration test, dependency report fixture, and audit/export review.
Dependencies: E3-S3, E6-S5 planned release manifest, E7-S6 planned evidence export. Scope: M.

### Feature E3-F3 — Durable job orchestration

#### Story E3-S5 — Track processing jobs with bounded retries and dead letters

As an operator, I want every heavy operation to have durable status and safe retry behavior so failures are recoverable.

Tasks:

- [ ] E3-T16 Implement ProcessingJob with type, tenant, input/output IDs, code/adapter version, idempotency key, correlation ID, status, attempt count, timeout, next retry, error classification, and operator metadata.
- [ ] E3-T17 Create Service Bus queues/topics for scan, document/media extraction, model normalization/reconstruction/quality, indexing, AI generation, thumbnails, notifications, email, and webhook delivery.
- [ ] E3-T18 Implement default three-attempt exponential backoff/jitter, per-job timeout/input/concurrency limits, graceful shutdown, visibility timeout, and dead-letter action.
- [ ] E3-T19 Classify deterministic validation/rights/malware/unsupported failures as terminal and provider/network/capacity failures as retryable.
- [ ] E3-T20 Implement operator retry only for classified retryable failures after recording original hash, job version, actor, reason, and audit event.
- [ ] E3-T32 Require every asset adapter to implement `inspect`, `canProcess`, and `process` and return a common envelope containing adapter/version, input and output IDs, status, warnings, metrics, and failure classification; never overwrite prior artifacts.
- [ ] E3-T33 Make job messages server-created and integrity-protected with job ID, tenant ID, artifact IDs, and operation type; have workers re-check referenced records, tenant context, rights, and lifecycle before acting.

Acceptance criteria:

- [ ] Jobs resume safely after worker restart and never create duplicate artifacts or chargeable usage.
- [ ] Terminal failures are reviewable and are not retried automatically.
- [ ] A dead-letter job has enough metadata for safe diagnosis and a documented operator action.

Verification: worker crash/restart test, retry/dead-letter integration test, duplicate-delivery test, and operator audit review.
Dependencies: E1-S4, E1-S8, E1-S6. Scope: L.

Personal Azure update (2026-10-24): browser OAuth token smoke, live upload/status, controlled worker restart, outbox replay, private Blob denial, tamper dead-lettering, DLQ recovery, and a positive operator-eligible retry are evidenced. The retryable failure was replayed through the inline retry form and returned to `SUCCEEDED`/`REVIEW`; terminal validation failures remain non-retryable and correctly show `CONTACT_OPERATOR`.

Current evidence: `apps/worker/src/job-runner.ts` and `tests/doubles/deterministic-adapters.mjs` pass `pnpm jobs:validate`, covering success, duplicate suppression after completion, active lease ownership/expiry recovery, checksum and unsupported-input quarantine, quarantine-provider failure recovery, storage-read retry classification, retry-then-success, dead-letter exhaustion, stale-worker completion rejection, review-outcome persistence, and blob-key tenant rejection. `packages/db/src/job-store.ts` and `tools/check-postgres-job-store.mjs` pass `pnpm db:validate` against local PostgreSQL for idempotency, atomic leases, retry scheduling, stale-worker protection, and outcomes, but broader tenant coverage remains open. `apps/worker/src/messaging/azure-service-bus-dispatcher.ts` and `tools/check-service-bus-dispatcher.mjs` pass the server-created, tenant-scoped, correlated, HMAC-integrity message contract, and the deployed worker now proves live settlement through the Azure smoke publisher. `apps/api/src/job-status-service.ts`, `apps/api/src/job-status-http.ts`, `apps/api/src/entra-authenticator.ts`, `packages/db/src/organization-membership-store.ts`, and `apps/api/src/entrypoint.ts`, with `pnpm job-status:validate`, `pnpm job-status-service:validate`, `pnpm api:validate`, and `pnpm entra:validate`, prove tenant-scoped status projection, retry eligibility, operator audit, outbox requeue, next-action guidance, JWT validation, server-side active-membership resolution, authentication boundary, operator-role enforcement, explicit retry routing, CORS allowlisting, request limits, security headers, and the API runtime wiring. `Dockerfile.api` builds successfully and the API template has previously deployed successfully. The Entra registration, live `HTTP/2 200` API health check, Azure membership table creation, and pilot membership seed (`MEMBERSHIP_OK`) are evidenced; real-token smoke, browser status UI, worker crash/restart, and full application integration remain open.

#### Story E3-S6 — Show author-facing processing progress and recovery

As an author, I want to know what is happening and what I can do next while a source processes.

Tasks:

- [ ] E3-T21 Implement job-status API with durable ID, stage, progress where available, warnings, terminal state, retry eligibility, and next action.
- [ ] E3-T22 Build asset library rows showing type, version, processing stage, quality outcome, rights status, and next action without requiring a detail page.
- [ ] E3-T23 Add clear recovery actions for retryable failure, replace input, provide rights, request review, and contact administrator.

Acceptance criteria:

- [ ] No asset is left as an indefinite spinner or appears publishable after failure.
- [ ] Author can distinguish processing, needs review, blocked, failed, approved, rejected, and retired.
- [ ] Refresh/browser suspension preserves status and a retry action does not duplicate work.

Verification: UI state matrix test, job-status E2E, and failure-mode visual regression.
Dependencies: E3-S5, E1-S9. Scope: S.

### Feature E3-F4 — PDF and existing-model processing

#### Story E3-S7 — Extract a searchable, page-cited PDF

As an author, I want a PDF/manual converted into page-linked source chunks so I can ground course content and review citations.

Tasks:

- [ ] E3-T24 Implement deterministic text extraction first, OCR fallback for scanned/layout-heavy pages within configured limits, and table/image artifact links.
- [ ] E3-T25 Store page/section/span references, extraction warnings, source hashes, OCR quality, normalized terminology, and artifact lineage.
- [ ] E3-T26 Fail explicitly for unsupported encryption, too many pages, poor quality, oversized/decompressed input, or missing extractable content.
- [ ] E3-T27 Build source inspection/citation viewer with page navigation and authorized-only access.

Acceptance criteria:

- [ ] Reference PDF produces searchable chunks with correct page citations and visible extraction warnings.
- [ ] A scanned PDF uses OCR only within limits and reports quality/uncertainty.
- [ ] Failed or quarantined PDF cannot enter retrieval or publication.

Verification: PDF fixture extraction test, OCR negative fixtures, citation-page E2E, and source-access authorization test.
Dependencies: E3-S3, E3-S5. Scope: M.

Current evidence: `tools/extract-reference-pdf.py` produces six searchable, page-cited chunks for AIC-001 and writes `output/fixture-import/aic-001-document-extraction.json`. This is a deterministic extraction rehearsal only; OCR fallback, table/image artifact handling, quarantine integration, retrieval indexing, and authorized source viewing remain open.

#### Story E3-S8 — Normalize and review an existing GLB/glTF model

As an author, I want an existing model turned into a browser-ready approved model with stable components.

Tasks:

- [ ] E3-T28 Implement GLB/glTF inspection, named conversion adapters only where licensed, unit/axis/origin normalization, texture/material validation, optimized variants, and model manifest generation.
- [ ] E3-T29 Create stable component IDs, selection keys, tags, bounding boxes, interaction metadata, and source mapping.
- [ ] E3-T30 Generate thumbnail, manifest, component map, browser-performance report, memory/triangle/texture metrics, and quality warnings.
- [ ] E3-T31 Build human model-quality review with approve/reject/needs-repair decisions, reviewer, rationale, and audit record.

Acceptance criteria:

- [ ] Reference GLB loads in the approved runtime and all required components have stable IDs.
- [ ] A model with missing mapping, invalid assets, excessive budget, or unsafe external references is blocked from approval.
- [ ] Reprocessing creates a new ModelVersion and never mutates a released model.

Verification: model normalization tests, manifest/schema tests, visual/performance report, and reviewer E2E.
Dependencies: E3-S3, E3-S5, E0-S4. Scope: L.

Current evidence: `packages/model-runtime/src/glb-manifest.ts`, `packages/model-runtime/src/browser.ts`, and `tools/validate-reference-model.mjs` produce and validate a compiled `model-manifest.v1` for AIC-001 with stable component IDs, node paths, interaction capabilities, interaction volumes, permitted transform rules, canonical meter/Y normalization, mesh/material/triangle counts, source hash, and malformed-header rejection. Babylon.js loading, material/hash validation, bounded transforms, and private release/session adapters are now implemented locally; optimized variants, deployed release population, performance measurement on named devices, and review workflow remain open.

## Epic E4 — Browser 3D runtime and semantic interaction

Outcome: an approved model can be loaded as a lazy browser feature, viewed and manipulated through accessible semantic controls, and connected to the API without the client becoming authoritative.

Implementation update 2026-10-24: the learner activity now uses a pinned/bundled Babylon.js GLB adapter and has real-browser screenshot/AX evidence for visible loading, component selection, deterministic transforms, authoritative action feedback, and local foreground Chromium/Edge measurements of 38–61 FPS with 48–539 ms loads. The shared `packages/model-runtime` manifest validator is used by the Babylon adapter; publication now snapshots the approved model metadata, materializes hash-verified release-owned full/mobile/reduced artifacts and immutable release JSON, and records a release-bound manifest; bound asset delivery includes sanitized equivalent-path metadata, asset delivery and action validation resolve only that immutable release binding, and the API exposes an idempotent release-bound session-start seam plus durable tenant-scoped model-session mutation. Enrollment/attempt/policy binding, actor-bound idempotency, active-release fencing, server-side declarative simulation score/completion projection, authoritative procedure-step/fault projection, DevTools context-loss recovery, and an emulated touch/viewport performance and semantic-completion matrix are implemented locally; remaining E4 closure work is physical named-device/Safari traces, a newly populated deployed release, and pilot sign-off.

Current implementation evidence: E4 now includes release/model-bound manifest metadata, shared manifest validation for materials/textures/interaction volumes/transform rules, WebGL2 fit/rotate/zoom/selection and deterministic transform rendering, context-loss/disposal cleanup, reduced-complexity UI controls, browser action idempotency/resume contracts, authenticated fail-closed model binding, session-scoped bearer forwarding for bound asset/action/resume requests, immutable release-owned model/variant and release-manifest artifacts with source/destination hash verification, PostgreSQL-backed private asset/session adapters, authenticated actor-bound idempotent session start, enrollment/attempt/policy authorization and active-release fencing, server-side declarative simulation transitions with preconditions, score deltas, completion, replay protection, and safe procedure-step/fault/allowed-action projection, authenticated semantic-action/resume HTTP seams, an explicit Chrome/Edge/Safari/Firefox browser baseline and device matrix/scene budget, real-browser accessibility interaction evidence, and a headless three-profile browser/screenshot regression harness. Local visual/memory/mobile/context-loss regression evidence is green; deployed model/release population, named physical-device traces, Firefox execution evidence, and pilot acceptance remain open.

### Feature E4-F1 — Runtime boundary and model manifest

Latest foreground browser evidence: Chrome `155.0.8059.86` and Edge `156.0.4314.42` desktop/mobile-sized profiles passed with Chrome 59–60 FPS / 166–193 ms loads and Edge 60–61 FPS / 524–607 ms loads, zero canvas drift, and approved full/mobile variant selection. Remaining closure gates are named physical-device traces, Firefox execution evidence, deployed release population, and pilot acceptance.

Current-build rerun: Chrome recorded 59–60 FPS with 180–218 ms loads and Edge recorded 58–61 FPS with 513–685 ms loads; approved full/mobile variants and zero canvas drift remained verified.

Network-profile rerun: the foreground harness now applies the versioned `pilot-baseline` latency/throughput profile through a local proxy; Chrome recorded 60 FPS with 318–334 ms loads and Edge 60–61 FPS with 307–322 ms loads across desktop/iOS-sized/Android-sized profiles, all within the 30 FPS/5-second budget and with zero visual drift.

Real PostgreSQL E4 integration now passes through generated AIC-001 publication, release-bound variant metadata, enrollment/attempt/policy joins, authoritative completion, idempotent replay, and resume via `pnpm e4:postgres:validate`; this also fixed the partial-index conflict target in session start.

Latest accessibility-matrix rerun: Chrome recorded 59–60 FPS with 169–203 ms loads and Edge recorded 36–61 FPS with 183–580 ms loads; keyboard/touch activation, live accessibility roles, approved full/mobile variants, semantic completion, and zero canvas drift remained verified.

#### Story E4-S1 — Load an approved model manifest in the selected runtime

As a learner, I want an approved model to load reliably so I can inspect the device in a course activity.

Tasks:

- [x] E4-T01 Implement lazy-loaded `packages/model-runtime` with the selected Babylon.js/GLB runtime behind the manifest contract.
- [x] E4-T02 Implement manifest validation for model version, hashes, stable components, materials, textures, interaction volumes, and supported runtime schema.
- [x] E4-T03 Implement camera framing, unit/axis normalization, fit-to-view, reset, disposal, private scoped asset loading, and cache rules.
- [x] E4-T04 Handle missing/corrupt model, expired URL, unsupported capability, WebGL context loss, and reduced-complexity fallback states.

Acceptance criteria:

- [ ] Approved reference model loads on named desktop and mobile profiles with a useful loading/error state.
- [ ] A model outside the approved manifest or release binding cannot be loaded for certification.
- [ ] The 3D feature is not loaded on text-only routes.

Verification: browser matrix E2E, manifest contract tests, context-loss test, and load-performance trace.
Dependencies: E3-S8, E0-S3, E0-S4, E1-S9. Scope: M.

#### Story E4-S2 — Provide consistent component selection and manipulation

As a learner, I want to select and manipulate required components using mouse, touch, and keyboard-equivalent controls.

Tasks:

- [x] E4-T05 Implement non-color-only selection/highlight, component list, semantic IDs, reset, rotate/pan/zoom/fit controls, and selection feedback.
- [x] E4-T06 Implement deterministic permitted transforms, snap targets, bounding/proximity predicates, and reset transforms rather than arbitrary physics.
- [x] E4-T07 Implement touch targets, keyboard equivalents where applicable, first-use hint, current procedure text outside canvas, and accessible status announcements.
- [x] E4-T08 Prevent the runtime from accepting arbitrary scores, completion flags, transforms, or state transitions as authoritative data.

Acceptance criteria:

- [ ] Required reference components can be selected and manipulated on named profiles.
- [ ] Learner can understand the active step, allowed action, accepted/rejected result, fault, and score effect outside the canvas.
- [ ] Runtime emits semantic commands/events only; score and completion come from the server.

Verification: scripted semantic-action test, keyboard/touch test, screen-reader status test, and forged-score test.
Dependencies: E4-S1. Scope: L.

### Feature E4-F2 — Runtime/API semantic contract

#### Story E4-S3 — Send semantic actions to a server-authoritative session

As a learner, I want accepted interactions to persist and rejected interactions to explain the next valid action.

Tasks:

- [x] E4-T09 Implement `ModelRuntime` and `SemanticActionClient` contracts with approved state projection and action result types.
- [x] E4-T10 Add action UI states for accepted, invalid precondition, stale sequence, expired session, unknown component, version mismatch, and retryable network failure.
- [x] E4-T11 Preserve pending/resumable UI state without replaying an action twice; display server-authoritative state after reconnect.

Acceptance criteria:

- [ ] Accepted actions update the runtime only from server response and preserve sequence.
- [ ] Duplicate/stale/expired/version-mismatched actions do not change authoritative state.
- [ ] Network recovery provides retry/resume without creating duplicate evidence.

Verification: API/runtime contract tests, offline-not-supported/recovery browser test, and duplicate-action E2E.
Dependencies: E4-S2, E7-S3. Scope: M.

### Feature E4-F3 — Performance, accessibility, and 3D regression

#### Story E4-S4 — Meet the named device budget and provide an equivalent path

As an eligible learner, I want to complete the competency even if my device cannot render the full scene.

Tasks:

- [x] E4-T12 Generate approved mobile/reduced model variants and enforce scene budgets for triangles, textures, memory, load time, and frame rate. `tools/generate-model-variants.mjs` applies component-preserving triangle retention to larger meshes, emits per-variant manifests and an optimization report, and keeps the current three-triangle fixture at its safe geometry floor.
- [x] E4-T13 Implement text/reduced-complexity interaction path with equivalent instructions, action choices, outcome, scoring, hints, and feedback.
- [x] E4-T14 Add performance telemetry and clear fallback reason without exposing unnecessary device data.
- [x] E4-T15 Add fixed GLB screenshot, semantic-action, visual, memory, FPS, context-loss, and mobile regression suites.

Acceptance criteria:

- [ ] Approved reference scene maintains at least 30 FPS on the named mobile device and becomes interactive within 5 seconds under the test network.
- [ ] A device failing the budget is routed to an equivalent path that can satisfy the same policy competency.
- [ ] Visual and regression tests detect missing components, camera errors, and state/render divergence.

Verification: device-matrix run, performance trace, equivalent-path assessment, and visual-regression report.
Dependencies: E0-S3, E4-S1, E4-S2. Scope: L.

## Epic E5 — PDF knowledge, retrieval, AI authoring, and content governance

Outcome: approved source material becomes traceable, tenant-scoped, schema-valid draft course content, assessment proposals, simulation proposals, and reviewable conversational changes.

### Feature E5-F1 — Knowledge normalization and retrieval

#### Story E5-S1 — Index tenant-scoped source knowledge with citations

As an author, I want source retrieval to return only approved chunks for the selected product/version with traceable citations.

Tasks:

- [ ] E5-T01 Chunk extracted PDF content and linked tables/images with source version, product, page/time/frame, hash, rights, approval, and tenant metadata.
- [ ] E5-T02 Generate embeddings and PostgreSQL full-text/`pgvector` indexes with configuration version and tenant/product/source filters.
- [ ] E5-T03 Implement retrieval query logging with redacted metadata, source-chunk IDs, rank, configuration version, and no raw sensitive content by default.
- [ ] E5-T04 Add cache keys scoped by tenant, source hash, embedding/retrieval configuration, and compatible versions; prevent cross-tenant cache reuse.
- [ ] E5-T05 Define measured migration trigger to Azure AI Search if corpus size, hybrid ranking, or permission filtering requires it.
- [ ] E5-T28 Run full-text and vector retrieval in parallel, combine results with deterministic versioned weights, bound the returned set, block generation or mark it incomplete while an index is stale/rebuilding, and validate every citation ID/span against the named source version.

Acceptance criteria:

- [ ] Retrieval never returns quarantined, unapproved, retired, wrong-tenant, wrong-product, or wrong-source-version chunks.
- [ ] Every returned chunk can be opened by an authorized reviewer at its source page/time/frame.
- [ ] Retrieval tests pass when application filters are deliberately weakened because the tenant boundary remains enforced.

Verification: retrieval relevance/citation tests, cross-tenant red-team test, cache-isolation test, and query-plan review.
Dependencies: E3-S7, E2-S6, E1-S6. Scope: L.

### Feature E5-F2 — Provider-neutral AI gateway

#### Story E5-S2 — Generate structured AI results through an approved gateway

As an author, I want AI assistance without coupling product logic to a provider or allowing arbitrary code.

Tasks:

- [ ] E5-T06 Implement the gateway operations: extract document, summarize source, generate course/assessment/simulation draft, suggest component metadata, answer author question, and generate citations.
- [ ] E5-T07 Require tenant, actor, draft/release context, source IDs, retrieval configuration, output schema, prompt version, model deployment/API version, token budget, idempotency key, and correlation ID.
- [ ] E5-T08 Validate structured JSON/Zod/JSON Schema output, safety/filter result, citations, warnings, usage metrics, and schema version before returning `AiResult`.
- [ ] E5-T09 Reject invalid JSON/schema, unsupported claims, executable code, arbitrary tool use, unapproved provider, missing tenant, and budget violations.
- [ ] E5-T10 Store redacted AI-run metadata, model/prompt/retrieval versions, usage, validation, safety, and reviewer linkage without logging full sensitive prompts/completions by default.

Acceptance criteria:

- [ ] Provider response objects do not escape the gateway or appear in domain packages.
- [ ] A provider outage or quota failure is a classified retryable failure, never an empty/fake success or unsafe fallback.
- [ ] The gateway refuses executable simulation code and unstructured mutations.

Verification: mocked-provider contract tests, schema/security tests, failure-classification tests, and architecture import test.
Dependencies: E0-S4, E1-S1, E1-S8, E2-S6. Scope: L.

### Feature E5-F3 — Source-grounded draft generation

#### Story E5-S3 — Generate a cited course, assessment, and simulation draft

As an author, I want a first draft grounded in source material so I can correct it efficiently without treating AI output as final.

Tasks:

- [ ] E5-T11 Implement staged pipeline: extraction, normalization, retrieval, generation, schema validation, citation/conflict checks, safety/policy checks, and review storage.
- [ ] E5-T12 Generate typed draft modules, rich text/instructions, media/transcript blocks, activity proposals, assessments, simulation definitions, warnings, and source citations.
- [ ] E5-T13 Mark every generated block with AI-draft origin, source chunk/page/time references, model/prompt version, generation timestamp, validation status, reviewer status, original text, and edit diff.
- [ ] E5-T14 Block publication for missing citations, unsupported claims, missing model components, source conflict, safety warnings, schema errors, and invalid policy references.
- [ ] E5-T15 Allow explicit author designation of authoritative source when documents conflict and store the rationale.

Acceptance criteria:

- [ ] Reference PDF produces a reviewable draft with citations and measurable warnings.
- [ ] Every certification-relevant generated block is traceable to a source or explicit author rationale.
- [ ] Conflicting/missing evidence blocks automatic publication and cannot be silently resolved by recency/confidence.

Verification: reference fixture generation, citation support test, conflict fixture, unsafe-instruction red team, and reviewer usability run.
Dependencies: E5-S1, E5-S2, E3-S8. Scope: L.

#### Story E5-S4 — Let authors edit AI drafts without losing work

As an author, I want generated content separated from my edits so I can compare, correct, reject, or regenerate safely.

Tasks:

- [ ] E5-T16 Store immutable AI proposal and separate mutable draft revision with block-level origin and diff.
- [ ] E5-T17 Add accept, edit, reject, regenerate, and citation-open actions with explicit confirmation for regeneration.
- [ ] E5-T18 Enforce draft revision/optimistic-concurrency tokens and preserve edits when AI generation fails or another author saves.

Acceptance criteria:

- [ ] AI regeneration never overwrites author edits without explicit action.
- [ ] A stale revision produces compare/reload/separate-draft choices, not silent overwrite.
- [ ] Reviewers can see generated versus edited content and source evidence in one surface.

Verification: concurrent-edit test, regenerate-failure test, diff UI test, and autosave recovery test.
Dependencies: E5-S3, E6-S1. Scope: M.

### Feature E5-F4 — Conversational authoring and evaluation controls

#### Story E5-S5 — Propose structured changes through a conversational assistant

As an author, I want to ask for a course change in plain language while retaining an auditable no-code draft as the canonical representation.

Tasks:

- [ ] E5-T19 Bind each authoring session/message to organization, product, course draft, revision, actor, and allowed source scope.
- [ ] E5-T20 Implement asynchronous message jobs returning `202 Accepted` with durable IDs and clear proposal status; never imply the change was applied.
- [ ] E5-T21 Generate structured patch proposals with citations, warnings, affected blocks, expected revision, and schema validation.
- [ ] E5-T22 Implement explicit proposal apply/reject with rechecked revision, permission, citation, schema, and publication-impact rules.
- [ ] E5-T23 Reject requests to publish, issue credentials, change policy outside permissions, execute code, access another tenant/course, or directly mutate without apply.
- [ ] E5-T29 Support explicit assistant results for explanation/cited answer, structured patch, clarification request, and unsafe/unsupported warning; never represent a proposal as applied.
- [ ] E5-T30 Require explicit structured author action before removing citations/warnings or applying bulk changes, and show affected records before confirmation.

Acceptance criteria:

- [ ] A natural-language request produces a reviewable structured proposal, not raw JSON/code or direct mutation.
- [ ] Applying a proposal is a separate idempotent action that cannot overwrite a newer revision.
- [ ] Conversation history and proposal decisions are auditable without exposing source content across tenants.

Verification: conversational authoring E2E, prompt-injection/cross-tenant tests, stale-revision apply test, and audit review.
Dependencies: E5-S2, E5-S4, E2-S5. Scope: L.

#### Story E5-S6 — Evaluate AI safety, quality, latency, and cost before promotion

As a product and safety owner, I want every model/prompt change evaluated on a fixed set so speed never overrides trust.

Tasks:

- [ ] E5-T24 Version evaluation fixtures, prompt/template, model deployment, retrieval configuration, output schema, and policy.
- [ ] E5-T25 Measure schema validity, claim-level citation support, source coverage, conflict warnings, unsafe-procedure rate, prompt injection resistance, cross-tenant isolation, reviewer correction effort, latency, tokens, and cost.
- [ ] E5-T26 Add red-team cases for conflicting manuals, unsupported instructions, missing citations, injected instructions, cross-tenant retrieval, and executable-code requests.
- [ ] E5-T27 Gate model/prompt/deployment promotion on safety and correctness results; permit exceptions only through signed architecture decision with limited scope.

Acceptance criteria:

- [ ] Failed safety/citation/tenant evaluations block promotion regardless of speed or cost.
- [ ] Reviewer acceptance/minor-edit/major-edit/rejection/regeneration and minutes-to-publish are measurable.
- [ ] Production run records have enough redacted metadata to reproduce a review decision.

Verification: evaluation report, promotion-block test, usage dashboard, and architecture exception review.
Dependencies: E5-S2, E5-S3, E0-S7. Scope: M.

## Epic E6 — No-code course, story, simulation authoring, review, and publication

Outcome: a non-engineering organization author can create, preview, validate, review, and publish a complete immutable course release with a reproducible manifest.

### Feature E6-F1 — Course hierarchy and no-code editor

#### Story E6-S1 — Create courses, modules, activities, and story paths

As an author, I want safe structured building blocks so I can assemble a product course without engineering.

Tasks:

- [ ] E6-T01 Implement Organization → Product → Course → CourseVersion → Module → Activity → block/3D/simulation/assessment hierarchy.
- [ ] E6-T02 Implement supported activity types: rich text/source-linked instructions, image, video/transcript, 3D viewer, hotspot, guided procedure, manipulation, assembly/disassembly, fault troubleshooting, multiple-choice, multi-select, ordered-step, and simulation outcome.
- [ ] E6-T03 Implement story-based mission, ordered/branched nodes, consequences, terminal outcomes, prerequisites, bounded graph validation, and learner-visible purpose/requirements.
- [ ] E6-T04 Build no-code UI to add/reorder activities, bind approved assets/models/components/simulations/assessments, configure instructions/hints/scoring, and show AI origin/citations/reviewer status.
- [ ] E6-T25 Restrict branch conditions to recorded platform facts such as completion, score threshold, diagnosis, fault outcome, or retry state; reject arbitrary JavaScript/private-table queries, unreachable nodes, unbounded loops, and branches that bypass certification-critical activities.

Acceptance criteria:

- [ ] An author can create a course from the supported catalog without editing raw JSON.
- [ ] Every story path is reachable, bounded, previewable, and has a terminal outcome.
- [ ] Only approved assets and valid references can be bound to a draft.

Verification: no-code editor E2E, schema tests, branch coverage test, and accessibility/visual review.
Dependencies: E3-S7, E3-S8, E5-S3. Scope: L.

#### Story E6-S2 — Autosave drafts with concurrency and revision history

As an author, I want durable revision history so refreshes, concurrent authors, and AI regeneration cannot destroy work.

Tasks:

- [ ] E6-T05 Implement draft autosave debounce, last-saved timestamp, revision number, optimistic-concurrency token, and durable undo/redo at draft transaction/revision level.
- [ ] E6-T06 Implement stale-save conflict with compare, reload, or separate-draft options.
- [ ] E6-T07 Preserve draft snapshot for preview and record actor/revision/change history.

Acceptance criteria:

- [ ] Browser refresh, temporary network loss, or worker failure preserves the last acknowledged draft.
- [ ] Concurrent stale saves never silently overwrite another author’s change.
- [ ] Preview uses a durable draft snapshot and cannot create credential evidence.

Verification: concurrent browser test, stale-token API test, autosave failure/recovery test, and revision audit review.
Dependencies: E6-S1, E5-S4, E1-S7. Scope: M.

### Feature E6-F2 — Declarative simulation authoring and validation

#### Story E6-S3 — Configure a deterministic simulation without code

As a reviewer, I want to define components, states, procedures, faults, scoring, and accessibility outcomes as data rather than scripts.

Tasks:

- [ ] E6-T08 Define versioned simulation schema for model version, stable component IDs, initial state, variables, interaction volumes, transforms, states, procedure steps, preconditions, actions, hints, faults, diagnosis, resolution, failure rules, scoring, completion, and equivalent instructions.
- [ ] E6-T09 Build simulation editor with model viewport, component list, state graph/procedure timeline, fault editor, score/hint controls, test controls, and validation panel.
- [ ] E6-T10 Reject arbitrary JavaScript, generated code, unbounded scripts, invalid component references, illegal transitions, unreachable faults, score bounds violations, unsafe actions, and missing equivalent paths.
- [ ] E6-T11 Add deterministic preview/test execution with reset and expected result comparison.

Acceptance criteria:

- [ ] A reviewer can configure the reference component interaction, assembly/procedure, injected fault, diagnosis, remediation, and scoring.
- [ ] Invalid or unsafe schema cannot be saved as publishable or executed by the browser.
- [ ] Simulation definition binds to exact model version and stable component IDs.

Verification: schema/property tests, invalid-graph fixtures, deterministic replay test, and editor E2E.
Dependencies: E4-S2, E4-S4, E6-S1. Scope: L.

#### Story E6-S4 — Validate course, simulation, assessment, accessibility, and source readiness

As a reviewer, I want a single validation report so I know what blocks publication and how to fix it.

Tasks:

- [ ] E6-T12 Implement validation for metadata, approved assets, model manifest, activity schemas, source citations, AI status, conflicting warnings, story reachability, assessment pass/fail rules, model mappings, score bounds, policy references, and equivalent paths.
- [ ] E6-T13 Classify findings as blocking/error, warning, needs-review, or informational with stable codes and paths.
- [ ] E6-T14 Show validation rail, source/AI warnings, simulation result, branch coverage, and recovery guidance in the authoring UI.

Acceptance criteria:

- [ ] Publication is disabled while any blocking safety, rights, citation, conflict, schema, model, policy, or accessibility issue remains.
- [ ] Every finding identifies the affected block/path and actionable resolution.
- [ ] Validation is re-runnable and produces the same result for the same version/configuration.

Verification: validation fixtures, publish-block test, warning-resolution E2E, and deterministic report test.
Dependencies: E6-S1, E6-S3, E5-S3. Scope: M.

### Feature E6-F3 — Review, publication, immutable releases, and reproducibility

#### Story E6-S5 — Review content with separate author, reviewer, and publisher decisions

As a subject-matter reviewer, I want to approve source/model/content and record evidence before a publisher releases it.

Tasks:

- [ ] E6-T15 Implement review decisions for source, model, AI block, simulation, assessment, and course version with approve/reject/needs-changes, rationale, actor, timestamp, and revision.
- [ ] E6-T16 Enforce required reviewer/publisher roles, no author-alone safety approval, explicit non-safety exception, and publication readiness confirmation.
- [ ] E6-T17 Build review UI with citations, warnings, generated-vs-edited diff, model quality, simulation test result, and all decision history.

Acceptance criteria:

- [ ] A safety-sensitive/certification-critical course cannot be approved and published by an author acting alone.
- [ ] Reviewer can trace each required block to source/evidence and record rationale for exceptions.
- [ ] Published release contains all approvals and actor identities needed for audit.

Verification: role-separation E2E, approval audit test, and review evidence inspection.
Dependencies: E2-S5, E5-S4, E6-S4. Scope: M.

#### Story E6-S6 — Publish an immutable release manifest

As a publisher, I want a reproducible release snapshot so a credential can be explained and replayed after drafts change or are retired.

Tasks:

- [ ] E6-T18 Create release manifest with exact IDs/hashes for source asset versions, chunks/citations, model binary/manifest/components, simulation, activity content, assessments, policy, AI blocks, prompt/template versions, and review decisions.
- [ ] E6-T19 Copy/version referenced binaries into release-owned immutable Blob prefix and store manifest in PostgreSQL plus immutable JSON artifact.
- [ ] E6-T20 Verify all artifacts and SHA-256 hashes before the publish transaction; create transactional outbox event in the same transaction.
- [ ] E6-T21 Publish/retire/supersede lifecycle with no in-place edits; ensure new enrollments use active version and existing learners remain bound unless explicit migration policy applies.

Acceptance criteria:

- [ ] Publish commits only when all referenced artifacts exist, are approved, and hash-verify.
- [ ] Published content, model, simulation, assessment, policy, and manifest cannot be edited by draft APIs.
- [ ] A historical release can be rehydrated/rendered after draft source retirement.
- [ ] Duplicate publish requests are idempotent and do not create multiple releases/outbox events.

Verification: publish transaction test, hash/immutability test, artifact-retirement replay test, and outbox uniqueness test.
Dependencies: E6-S4, E6-S5, E1-S6. Scope: L.

#### Story E6-S7 — Preview the complete learner path without issuing evidence

As an author/reviewer, I want to preview every course path so defects are found before publication.

Tasks:

- [ ] E6-T22 Implement preview mode for text/media/3D/simulation/assessment/story branches with reset and test data.
- [ ] E6-T23 Clearly label preview state and block credential issuance, public verification, discovery projection, and certification evidence.
- [ ] E6-T24 Add path coverage report for required modules, branches, faults, retry states, accessibility equivalent, loading/error/permission states, and terminal outcomes.

Acceptance criteria:

- [ ] Reviewer can exercise every branch and see requirements remaining, accepted/rejected actions, and expected result.
- [ ] No preview action creates an enrollment attempt, accepted certification action, credential, or public record.
- [ ] Preview findings feed the validation report and are required before publication.

Verification: preview isolation test, branch coverage test, and browser E2E.
Dependencies: E6-S3, E6-S4, E6-S6. Scope: M.

## Epic E7 — Learning delivery, assessment, certification, and verification

Outcome: an independent or organization-assigned learner can access the right release, preserve progress, complete validated activities, receive deterministic pass/fail results, and obtain one current online-verifiable credential.

### Feature E7-F1 — Catalog, access modes, enrollment, and candidate journey

#### Story E7-S1 — Offer private, public, and unlisted courses

As an issuer, I want controlled course visibility so I can assign internally, share a direct link, or publish a public candidate course.

Tasks:

- [ ] E7-T01 Implement private, public, and unlisted access modes with issuer rules, prerequisites, intended audience, product scope, cost designation (`free-in-MVP`), issuer statement, and enrollment permissions.
- [ ] E7-T02 Build catalog/course-detail UI with requirements, estimated effort, issuer, scope, version, intended use, accessibility path, and enrollment action.
- [ ] E7-T03 Ensure public/unlisted candidate enrollment does not require joining the issuing organization as an employee.
- [ ] E7-T04 Measure course visit, account creation, enrollment, start, completion, pass, share, and discovery opt-in without exposing recruiting decisions to unauthorized users.

Acceptance criteria:

- [ ] Private courses are inaccessible outside assigned/authorized scope; public courses are catalog-visible; unlisted courses require direct access.
- [ ] An independent learner can enroll with a personal account and retain credentials across organizations.
- [ ] Enrollment clearly states issuer, scope, requirements, intended use, and sharing/discovery are separate choices.

Verification: access-control API/browser tests, candidate journey E2E, and privacy analytics review.
Dependencies: E2-S1, E6-S6. Scope: M.

#### Story E7-S2 — Create, resume, and manage enrollment

As a learner, I want a durable enrollment so I can resume after refresh, suspension, or recoverable network failure.

Tasks:

- [ ] E7-T05 Implement Enrollment bound to learner, issuing organization, course release, access mode, status, assignment/source, timestamps, and migration policy.
- [ ] E7-T06 Implement create/resume/cancel/complete states and authorization for learner/issuer views.
- [ ] E7-T07 Preserve exact release binding for existing learners when a new course version is published unless the issuer explicitly migrates/requalifies.
- [ ] E7-T08 Add learner course overview and recovery states for unavailable/retired/restricted releases.

Acceptance criteria:

- [ ] Refresh, browser suspension, token renewal, and recoverable network failure preserve enrollment/progress.
- [ ] A new release never silently changes an existing enrollment’s release.
- [ ] Learner sees remaining requirements and a clear next action.

Verification: enrollment transaction tests, refresh/recovery E2E, version-binding test, and permission test.
Dependencies: E7-S1, E6-S6. Scope: M.

### Feature E7-F2 — Learner player and semantic progress

#### Story E7-S3 — Complete text, media, and informational activities

As a learner, I want a clear mobile-first course player that records meaningful activity without claiming passive viewing is competency.

Tasks:

- [ ] E7-T09 Build learner player with objective, instructions, activity area, requirements remaining, progress save state, hints, captions/transcripts, and no autoplay in certification-critical flows.
- [ ] E7-T10 Implement semantic events for opened/completed, video threshold, component selected, procedure attempted/completed, fault identified, assessment submitted, hint used, attempt started/completed, and course completed.
- [ ] E7-T11 Store append-only ProgressEvent plus aggregated current progress; classify informational, interaction, scored assessment, server-authoritative simulation, and human-review evidence.
- [ ] E7-T12 Ensure passive open/watch events cannot alone satisfy certification policy.

Acceptance criteria:

- [ ] Learner can navigate and resume text/media activities on supported mobile and desktop profiles.
- [ ] Progress is durable and append-only events are not duplicated on replay.
- [ ] UI distinguishes progress from evidence and never represents opening/watching alone as competency.

Verification: player browser E2E, progress replay test, captions/transcript test, and policy evidence classification test.
Dependencies: E7-S2, E1-S9. Scope: M.

#### Story E7-S4 — Complete a guided interactive activity with accessible feedback

As a learner, I want instructions, accepted/rejected action feedback, hints, and remediation in plain language.

Tasks:

- [ ] E7-T13 Implement guided procedure/assembly/troubleshooting activity presentation bound to approved release artifacts.
- [ ] E7-T14 Add text outside canvas for current step, allowed action, precondition, fault, score effect, hint, retry, pause, and restart according to policy.
- [ ] E7-T15 Add screen-reader status announcements, focus management, reduced motion, touch/keyboard controls, and equivalent path entry.

Acceptance criteria:

- [ ] Learner can identify what happened, what remains, and what action is allowed without relying on color or canvas-only feedback.
- [ ] A rejected action does not advance progress and explains recovery.
- [ ] Hints/pause/restart follow issuer policy and their score effects are visible.

Verification: keyboard/screen-reader test, rejected-action E2E, mobile touch test, and visual state review.
Dependencies: E4-S2, E4-S3, E7-S3. Scope: M.

### Feature E7-F3 — Server-authoritative simulation

#### Story E7-S5 — Start a bound, expiring simulation session

As a learner, I want a simulation session bound to my enrollment and attempt so evidence cannot be moved across releases or learners.

Tasks:

- [ ] E7-T16 Implement `SimulationSession` creation bound to learner, enrollment, course release, activity, scenario version, model version, attempt, policy context, expiration, nonce, next sequence, and status.
- [ ] E7-T17 Implement start endpoint with idempotency key and response containing only opaque session ID, redacted state, allowed actions, expiry, and version references.
- [ ] E7-T18 Enforce active release/policy, inactivity expiration, learner ownership, attempt status, and session resume rules.

Acceptance criteria:

- [ ] Starting the same request with the same idempotency key returns one session; a session cannot be bound to another attempt/release.
- [ ] Expired/inactive/invalid sessions cannot accept actions or complete certification.
- [ ] The response contains no secret that allows client signing or result fabrication.

Verification: session API contract, binding/expiry tests, idempotency test, and authorization matrix test.
Dependencies: E6-S3, E7-S2, E1-S7. Scope: M.

#### Story E7-S6 — Apply semantic actions with sequence, nonce, and replay protection

As a platform, I want only valid server-accepted actions to affect simulation state and score.

Tasks:

- [ ] E7-T19 Implement semantic actions: select component, attach/remove component, advance/complete step, request hint, choose diagnosis, resolve fault, restart, and complete session.
- [ ] E7-T20 Validate action type, component ID, precondition, release/scenario/policy version, session ownership, nonce, monotonic sequence, client action ID, idempotency key, and state transition.
- [ ] E7-T21 Apply action and append accepted/rejected trace with row lock or optimistic version check, score delta, redacted state, next allowed actions, and feedback in one transaction.
- [ ] E7-T22 Reject arbitrary transforms, scores, pass flags, old action streams, duplicate action IDs, stale sequences, wrong attempts, and invalid transitions without state changes.

Acceptance criteria:

- [ ] Repeating an identical accepted action sequence produces identical state and score.
- [ ] Duplicate/stale/forged actions do not advance state or create evidence.
- [ ] Concurrent actions cannot advance one session twice or corrupt sequence/state.

Verification: deterministic replay, tamper, stale/duplicate, concurrency, and transaction rollback tests.
Dependencies: E7-S5, E6-S3, E2-S6. Scope: L.

#### Story E7-S7 — Complete and evaluate a simulation from server state

As a learner, I want the platform to evaluate the session I actually completed rather than trusting a browser completion flag.

Tasks:

- [ ] E7-T23 Implement complete endpoint as a request to evaluate server-held session state, not a client assertion.
- [ ] E7-T24 Derive outcome, score, required actions, faults, remediation, and policy evidence from accepted transitions.
- [ ] E7-T25 Store immutable simulation outcome/attempt evidence and prevent completion after invalidation, expiration, version mismatch, or unsafe failure.

Acceptance criteria:

- [ ] Client cannot submit `passed=true` or an arbitrary action list to receive a pass.
- [ ] Completion result is deterministic from immutable session/definition/policy versions and accepted action trace.
- [ ] An unsafe action follows the declarative failure rule and cannot silently become a pass.

Verification: forged-result E2E, historical replay, unsafe-action fixture, and outcome persistence test.
Dependencies: E7-S6, E7-S8. Scope: M.

### Feature E7-F4 — Assessment, policy evaluation, retries, and remediation

#### Story E7-S8 — Configure and evaluate versioned certification policy

As an issuer, I want to configure certification requirements so the platform evaluates each organization’s standard consistently.

Tasks:

- [ ] E7-T26 Implement CertificationPolicy with required modules/activities, mandatory scored assessment or server-authoritative simulation, thresholds, score rules, attempt limits, cooldown, best/latest result, repeated-failure review, duration/expiration, requalification, and visibility/discovery defaults.
- [ ] E7-T27 Validate safe ranges, required evidence, policy references, version, issuer scope, and policy/release binding.
- [ ] E7-T28 Implement pure policy evaluator independent of API/database/provider and return pass/fail, missing requirements, retry eligibility, and evidence references.
- [ ] E7-T29 Freeze policy version in each published release and prohibit historical policy mutation.

Acceptance criteria:

- [ ] A policy cannot pass with only passive activity; it requires at least one scored assessment or server-authoritative simulation.
- [ ] Same immutable evidence and policy produce same result.
- [ ] Policy edits create a new version/release relationship and cannot rewrite past credentials.

Verification: policy unit/property tests, invalid-policy fixtures, release binding test, and evaluator replay test.
Dependencies: E6-S4, E6-S6, E7-S7. Scope: L.

#### Story E7-S9 — Submit immutable assessments with retries and cooldowns

As a learner, I want clear assessment results and retry rules so I know how to remediate a failure.

Tasks:

- [ ] E7-T30 Implement attempt states: in-progress, submitted/pass, submitted/fail, abandoned, invalidated; bind to exact release/activity/assessment/policy versions.
- [ ] E7-T31 Store answers/scoring inputs server-side, validate question/answer schema, calculate score from immutable assessment, and enforce score bounds.
- [ ] E7-T32 Implement idempotent submit, attempt limits, cooldown timers, manual reset for authorized reviewer, invalidation reason, and remaining-requirements response.
- [ ] E7-T33 Build assessment result UI with score where allowed, demonstrated/missed competencies, pass/fail, retry eligibility, remediation, and credential status.
- [ ] E7-T50 Store immutable assessment version, question/answer definitions, competency mappings, scoring rules, and any randomized-bank configuration required by the release.

Acceptance criteria:

- [ ] Every submitted attempt is retained and immutable; duplicate submit returns original result.
- [ ] Attempt cannot submit before start, after invalidation, or after wrong release/policy binding.
- [ ] Learner sees exact remaining requirements and next action after pass/fail/invalidated/abandoned states.

Verification: assessment API/unit/E2E, concurrent submit test, cooldown/limit test, and answer privacy test.
Dependencies: E7-S8, E7-S3, E1-S7. Scope: L.

### Feature E7-F5 — Credential issuance, lifecycle, wallet, and online verification

#### Story E7-S10 — Issue exactly one credential from a passing result

As a learner, I want a credential created when I meet the issuer’s policy so my achievement is durable and shareable.

Tasks:

- [ ] E7-T34 Implement atomic transaction: passing policy evaluation, one credential, issue event, audit/evidence references, and outbox event.
- [ ] E7-T35 Enforce uniqueness over learner, release manifest, policy version, qualification identity; handle concurrent completion and retries.
- [ ] E7-T36 Store learner, issuer, course/version, product/version, policy version, issue/expiration, status, opaque public ID hash, lineage, and intended-use metadata.
- [ ] E7-T37 Add credential-issued notification request after commit without making email delivery part of certification transaction.

Acceptance criteria:

- [ ] A passing learner receives exactly one credential even under concurrent/repeated submissions.
- [ ] A failed learner receives no credential and receives retry/remediation information.
- [ ] Credential references immutable release, policy, attempt, review, and evidence records.

Verification: concurrency/idempotency test, transaction rollback test, duplicate constraint test, and evidence inspection.
Dependencies: E7-S8, E7-S9, E6-S6. Scope: L.

#### Story E7-S11 — Manage expiration, revocation, supersession, and requalification

As an issuer, I want credential lifecycle actions to preserve history and clearly affect current status.

Tasks:

- [ ] E7-T38 Implement status derivation from UTC expiration plus event stream and scheduled expiration marking.
- [ ] E7-T39 Implement authorized revoke with reason/actor, supersede with replacement lineage, correction with new credential, and irreversible revoked/superseded states.
- [ ] E7-T40 Implement course-version change decisions: retain, update module, retake, supersede, or future-only; never silently invalidate.
- [ ] E7-T41 Notify affected learners after commit and record credential event/outbox/audit history.
- [ ] E7-T49 Classify content changes as cosmetic, instructional, assessment, simulation/behavior, or certification-policy changes; require the issuer’s documented requalification decision and learner communication for changes that affect competency meaning.

Acceptance criteria:

- [ ] Verification shows expired/revoked/superseded status even if scheduled jobs were missed.
- [ ] Revoked/superseded credentials cannot reactivate or be rewritten.
- [ ] New release/requalification behavior is explicit and historical credentials remain bound to their original release.

Verification: lifecycle state-transition tests, clock/expiration test, revocation/supersession E2E, and requalification scenario.
Dependencies: E7-S10, E6-S6. Scope: M.

#### Story E7-S12 — Provide credential wallet, public verification, QR/URL, and intended-use copy

As a learner or verifier, I want a minimal credential view that is easy to share and does not expose private evidence.

Tasks:

- [ ] E7-T42 Build learner credential wallet with issuer, scope, product/version, issue/expiration, status, verification URL/QR, sharing controls, and evidence/credential history where permitted.
- [ ] E7-T43 Generate unguessable non-sequential public verification ID and QR URL only; never encode email, answers, private organization data, or sequential credential IDs.
- [ ] E7-T44 Build unauthenticated rate-limited verification page returning issuer-approved public fields, current status, verification timestamp, and intended-use statement.
- [ ] E7-T45 Exclude assessment answers, source files, internal IDs, private contact fields, and unrelated tenant data; add enumeration/timing protection.

Acceptance criteria:

- [ ] A verifier can open a URL or scan QR without an account and see current issuer-scoped status.
- [ ] Public verification never exposes private source, learner, assessment, or tenant data.
- [ ] Verification resolves expiration/revocation/supersession at read time and is rate-limited.

Verification: public verification API/browser test, QR decode test, enumeration/timing test, and redaction review.
Dependencies: E7-S10, E7-S11, E1-S7. Scope: M.

#### Story E7-S13 — Export reproducible certification evidence

As an issuer, I want an evidence bundle so a credential and course result can be reviewed or restored without changing historical facts.

Tasks:

- [ ] E7-T46 Implement asynchronous organization/credential evidence export with release manifest, completion summary, assessment/simulation result, accepted action trace summary, credential events, approvals, audit trail, hashes, and retention classification.
- [ ] E7-T47 Protect export access, redact learner/private data according to caller scope, provide durable job status, and avoid including source binaries unless policy permits.
- [ ] E7-T48 Test export after draft asset retirement and after database/blob restore.

Acceptance criteria:

- [ ] Authorized issuer can export evidence for a credential/release; unauthorized users cannot.
- [ ] Export can explain what release/policy/evidence produced the credential without relying on mutable draft data.
- [ ] Export job is retryable/idempotent and does not expose secrets or unrelated tenant content.

Verification: export E2E, scope/redaction test, restore replay test, and hash verification.
Dependencies: E6-S6, E7-S10, E1-S8. Scope: M.

## Epic E8 — Image/video reconstruction adapters and quality gates

Outcome: supported image and video profiles enter the same asynchronous asset contract, produce candidate models plus measurable reports, and never bypass human review or the existing-GLB fallback.

### Feature E8-F1 — Supported image reconstruction

#### Story E8-S1 — Process a supported image set into a reviewable candidate

As an author, I want clear image requirements and a candidate model so I know whether image capture is sufficient for training use.

Tasks:

- [ ] E8-T01 Implement published profile: 20–100 overlapping photos, one stationary object, full object visible, diffuse lighting, no people, no dominant transparent/reflective surfaces, isolated background, known scale reference.
- [ ] E8-T02 Implement image inspection/coverage/scale validation and explicit reason codes for unsupported MIME, too many/few images, insufficient coverage, unknown scale, poor lighting, and provider unavailability.
- [ ] E8-T03 Run the selected multi-view adapter, create candidate GLB/texture/bounding box/scale/component map, and record adapter/version/input/output hashes.
- [ ] E8-T04 Expose uncertainty and require human review before model approval or scored use.

Acceptance criteria:

- [ ] Named supported image fixture produces a candidate model plus quality report.
- [ ] Poor/unsupported image fixture fails visibly or becomes review-rejected and cannot publish.
- [ ] Candidate does not become authoritative geometry until reviewer approval passes all configured gates.

Verification: image fixture job E2E, negative-profile test, quality report review, and publication-block test.
Dependencies: E3-S2, E3-S5, E0-S4. Scope: L.

### Feature E8-F2 — Supported video extraction and reconstruction

#### Story E8-S2 — Convert a supported video into frames, transcript, and candidate model

As an author, I want controlled video processing so an orbit/walkthrough can become reviewable evidence without treating a transcript as automatic truth.

Tasks:

- [ ] E8-T05 Publish video profile: continuous orbit/walkthrough, stationary object, 1080p+, stable camera movement, adequate lighting, no scene cuts/people blocking, clear start/end metadata.
- [ ] E8-T06 Implement isolated FFmpeg metadata/keyframe extraction with limits for duration, codec, frame count, CPU, memory, wall clock, and storage.
- [ ] E8-T07 Integrate approved transcription adapter for audio and retain time spans; mark transcript/frame content as evidence candidates.
- [ ] E8-T08 Feed selected frames into the reconstruction adapter and produce candidate GLB, keyframes, transcript, coverage/quality report, and reviewer state.

Acceptance criteria:

- [ ] Named supported video fixture produces a candidate model, selected frames, transcript where audio exists, and quality report.
- [ ] Unsupported codec, duration, scene cuts, blocked views, or low coverage produce explicit failure/rejection.
- [ ] Written authoritative sources and reviewer decisions control conflicts; transcript does not silently override them.

Verification: video fixture E2E, codec/limit tests, transcript citation test, and conflict-resolution review.
Dependencies: E3-S2, E3-S5, E8-S1, E0-S4. Scope: L.

### Feature E8-F3 — Quality, approval, licensing, and cost controls

#### Story E8-S3 — Approve or reject a reconstructed model against objective gates

As a reviewer, I want quality reports and comparison views so I can decide whether a candidate is safe for the intended activity.

Tasks:

- [ ] E8-T09 Compute completeness/coverage, scale, geometry integrity, component identity, texture/material boundaries, browser scene budget, frame rate, memory, and intended-activity suitability.
- [ ] E8-T10 Build candidate comparison/review with source views, model views, warnings, reviewer decision, rationale, and required repairs.
- [ ] E8-T11 Allow approved candidate promotion to a new ModelVersion without mutating source or released versions; preserve manual GLB fallback.

Acceptance criteria:

- [ ] Every named fixture has a measurable pass/reject outcome and reviewer record.
- [ ] A candidate cannot enter a published certification release until component identity, scale, interaction boundaries, and intended behavior pass.
- [ ] Existing approved GLB remains usable if reconstruction is unavailable or rejected.

Verification: quality threshold tests, reviewer E2E, candidate-to-release publish block, and fallback test.
Dependencies: E8-S1, E8-S2, E3-S8, E6-S5. Scope: M.

#### Story E8-S4 — Control reconstruction licensing, quotas, retries, and usage

As an operator, I want reconstruction bounded and legally reviewable so a failed adapter cannot create runaway cost or rights risk.

Tasks:

- [ ] E8-T12 Produce SBOM/license/notice review for reconstruction code, model weights, datasets, codecs, physics/runtime, loaders, and transitive packages.
- [ ] E8-T13 Apply organization/job concurrency, quota, maximum input, retry, GPU scale-to-zero, and operator approval controls.
- [ ] E8-T14 Meter input bytes, frames, duration, worker time, GPU time, output bytes, retries, and reviewer effort with deduplication.

Acceptance criteria:

- [ ] A license or rights failure quarantines the adapter/asset and blocks affected publication.
- [ ] Reconstruction cannot retry indefinitely or run outside quota.
- [ ] Actual fixture cost and processing time are visible per job/organization/course.

Verification: license report, quota/abuse tests, usage reconciliation, and cost dashboard review.
Dependencies: E0-S5, E0-S6, E3-S5. Scope: M.

## Epic E9 — Discovery, notifications, reporting, exports, and webhooks

Outcome: optional trust surfaces work without becoming required for training or certification, and all downstream effects are durable, redacted, retryable, and observable.

### Feature E9-F1 — Opt-in learner discovery and privacy projection

#### Story E9-S1 — Let a learner control discoverability

As a learner, I want discoverability off by default and independently controllable so enrollment never exposes my profile.

Tasks:

- [ ] E9-T01 Implement DiscoverabilityProfile with opt-in status, display/preferred name, approximate area, skills/product experience, availability/summary, visible certifications, and organization visibility rules.
- [ ] E9-T02 Build privacy settings with clear explanation, preview, enable/disable, withdrawal, active inquiries, block/report, and projection refresh state.
- [ ] E9-T03 Ensure enrollment, credential issuance, sharing, and verification never implicitly enable discovery.
- [ ] E9-T04 On disable/withdrawal, invalidate or suppress projection and pending requests within documented lag; preserve issuer evidence.

Acceptance criteria:

- [ ] Discoverability defaults off and a non-opted-in learner never appears in search.
- [ ] Exact address/lat-long is never stored or queried; only coarse normalized area is used.
- [ ] Turning discoverability off removes the profile from future results and updates pending-request availability.

Verification: privacy settings E2E, projection-lag test, non-opt-in negative test, and data-model review.
Dependencies: E7-S10, E2-S1, E0-S5. Scope: M.

#### Story E9-S2 — Search opt-in learners with bounded privacy-safe results

As an authorized employer viewer, I want to search by certification/product/competency/approximate area without receiving private contact details or enabling enumeration.

Tasks:

- [ ] E9-T05 Create separate `DiscoverableCredentialProjection` containing only opted-in, active credential summaries and permitted profile fields.
- [ ] E9-T06 Implement authenticated organization discovery permission, certification/product/competency/coarse-area filters, bounded result count, minimum-result/suppression policy, cursor pagination, and current-status recheck.
- [ ] E9-T07 Add rate limits, atomic counters, anti-scraping controls, no bulk export, safe empty/error responses, and timing/identifier enumeration protection.
- [ ] E9-T08 Remove expired/revoked/superseded credentials from active projection and prevent stale credentials from appearing active.

Acceptance criteria:

- [ ] Only authorized organizations can search and only opted-in learners with active matching credentials appear.
- [ ] Search never reveals whether a particular hidden individual has a credential through result/error/timing behavior.
- [ ] Results contain no private email/phone, exact location, source data, assessment answers, or unrelated tenant content.

Verification: discovery authorization/privacy/rate-limit tests, projection status test, enumeration test, and abuse test.
Dependencies: E9-S1, E7-S11, E2-S5, E2-S6. Scope: L.

### Feature E9-F2 — Consent-based employer inquiries

#### Story E9-S3 — Send and manage a consent-based contact request

As an employer viewer, I want to send a short inquiry and as a learner I want to accept, decline, block, report, or ignore it.

Tasks:

- [ ] E9-T09 Implement EmployerInquiry with sender/recipient organization, projected learner, message, status, expiry, block/report, consent channel, credential recheck fields, and audit history.
- [ ] E9-T10 Require authenticated permitted organization member, bounded message, current credential/status recheck at create and accept, and no private contact disclosure before acceptance.
- [ ] E9-T11 Implement learner accept/decline/block/ignore, employer cancel/report, expiration, withdrawal, revoked-credential unavailable state, and notification events.
- [ ] E9-T12 Build inquiry UI with privacy explanation, safe message display, status, recovery, and permission states.

Acceptance criteria:

- [ ] Inquiry requires explicit learner consent before exposing permitted contact/messaging channel.
- [ ] Expired, withdrawn, blocked, revoked, or unavailable inquiries cannot be accepted as active contact.
- [ ] Search/inquiry abuse is rate-limited, auditable, and has no bulk export path.

Verification: inquiry lifecycle E2E, status recheck race test, block/report/rate-limit tests, and redaction review.
Dependencies: E9-S2, E9-S1, E9-S4. Scope: M.

### Feature E9-F3 — Notifications and transactional email

#### Story E9-S4 — Deliver in-app and email notifications from durable events

As a user, I want useful notifications for invitations, processing, assignments, credentials, and consent requests without transaction failures being hidden.

Tasks:

- [ ] E9-T13 Implement Notification and EmailDelivery from outbox/domain events for invitations, processing complete/fail/review, assignment/enrollment, credential issue/expiry/revoke/supersede, and inquiry received/accepted/declined/expired/blocked.
- [ ] E9-T14 Build in-app notification history, read state, safe links, event ID, template version, and preference handling.
- [ ] E9-T15 Integrate Azure Communication Services Email or approved adapter with verified domain, SPF/DKIM/DMARC, bounce/suppression, rate limits, template versioning, and unsubscribe policy for non-security reminders.
- [ ] E9-T16 Keep messages at-least-once, deduplicate by durable event ID, redact source/answers/private contact/evidence, and never require email success for the source-of-truth transaction.
- [ ] E9-T37 Keep versioned notification templates outside business logic; support read/dismiss without erasing audit events, localization-ready structure, accessible rendered links, and a post-commit credential notification only after verification can read the new state.

Acceptance criteria:

- [ ] Underlying enrollment, credential, inquiry, and processing transactions commit even if email provider is down.
- [ ] Retries do not duplicate in-app notifications or create uncontrolled duplicate email effects.
- [ ] Security/invitation/credential/consent messages remain transactional; only non-critical reminders are preference-controlled.

Verification: outbox/notification integration tests, provider failure/retry test, template/redaction test, and bounce/suppression test.

Dependencies: E1-S8, E7-S10, E9-S3. Scope: L.

### Feature E9-F4 — Organization reporting and business analytics

#### Story E9-S5 — View completion, certification, assessment, failure, and version dashboards

As an organization administrator, I want to understand learner outcomes and content health so I can operate and improve training.

Tasks:

- [ ] E9-T17 Build dashboards for enrolled/active/completed/failed/overdue/expired learners, certification status by course/version, scores/attempts, failed steps/faults, completion-time ranges, drop-off, AI review status, model/course history, and credential lifecycle.
- [ ] E9-T18 Use append-only semantic events plus aggregate tables/materialized views; do not build dashboards from raw browser telemetry.
- [ ] E9-T19 Apply tenant/role scoping, privacy minimization, cursor pagination, date/version filters, and export-safe views.
- [ ] E9-T20 Add diagnosis dimensions to distinguish product defects, content difficulty, simulation friction, and learner support needs without recording unnecessary camera/microphone/motion data.

Acceptance criteria:

- [ ] Authorized organization roles can view required metrics only for their scope.
- [ ] Dashboard values reconcile to source-of-truth enrollments, attempts, credentials, events, and usage meters.
- [ ] Reporting does not expose unrelated tenants or unnecessary learner surveillance data.

Verification: dashboard fixture reconciliation, authorization tests, query-plan test, and privacy review.
Dependencies: E7-S3, E7-S9, E7-S11, E1-S8. Scope: L.

#### Story E9-S6 — Measure pilot business value and cost per certification

As a product owner, I want baseline and pilot metrics so expansion decisions consider trust, outcomes, time, and cost together.

Tasks:

- [ ] E9-T21 Capture organization baseline: trainer count/hours, learner count, assignment-to-certification time, source preparation, review effort, and internal labor rate.
- [ ] E9-T22 Measure author/reviewer time, AI acceptance/edit/rejection/citation rates, model processing/approval/fallback, learner start/resume/completion/pass/retry/abandonment, support contacts, verification, requalification, and Azure/provider cost.
- [ ] E9-T23 Calculate directional economic contribution: avoided live-training cost minus platform processing/support cost minus organization author/reviewer time.
- [ ] E9-T24 Report provisional goals: at least 30% lower median onboarding time, first publishable draft within two business days excluding review wait, no engineering intervention on PDF/GLB fixture, and zero credential/tenant-integrity failures.

Acceptance criteria:

- [ ] Every pilot organization has a baseline and attributable source-to-certification measurements.
- [ ] Dashboards distinguish product defects from content difficulty and show review/cost/support burden.
- [ ] Expansion/go-no-go uses security, integrity, accessibility, trust, outcome, and cost together.

Verification: pilot KPI dashboard, cost reconciliation, baseline review, and go/no-go report.
Dependencies: E0-S6, E7-S10, E9-S5. Scope: M.

### Feature E9-F5 — Customer API, exports, audit, and webhooks

#### Story E9-S7 — Expose the small versioned integration API

As an organization integrator, I want a documented REST API so I can connect core learner, enrollment, credential, job, export, audit, and usage workflows without internal database access.

Tasks:

- [ ] E9-T25 Implement OAuth 2.0 client-credentials integration authorization with organization scope and no exposure of internal database IDs.
- [ ] E9-T26 Document stable `/v1` endpoints for identity/orgs, products/assets, courses/publishing, learning/certification, discovery/inquiries, notifications, exports, audit, usage, and permitted job retry.
- [ ] E9-T27 Enforce idempotency, cursor pagination, durable async request IDs, scope, safe errors, and no raw source/answers/private contact data in responses.
- [ ] E9-T28 Add OpenAPI examples, generated clients, integration contract tests, changelog, and backward-compatibility policy.

Acceptance criteria:

- [ ] An approved integration can perform only documented organization-scoped operations.
- [ ] Export, deletion/tombstone, takedown, audit, usage, and job-retry requests expose progress and terminal failure states where asynchronous.
- [ ] A job retry cannot bypass quarantine, rights, tenant, or publication checks.

Verification: OAuth scope tests, OpenAPI contract tests, integration-client E2E, and sensitive-field redaction test.
Dependencies: E1-S7, E2-S5, E7-S13. Scope: L.

#### Story E9-S8 — Deliver signed, retryable, replay-safe webhooks

As an organization integrator, I want dependable event delivery with verification and history so downstream systems can react safely.

Tasks:

- [ ] E9-T29 Implement webhook subscriptions with HTTPS-only destination validation, SSRF/private-network blocking, secret rotation with overlap, event filters, and organization scope.
- [ ] E9-T30 Implement initial events: learner.created/updated, membership.created/removed, enrollment.created/completed, assessment.attempt.completed, credential.issued/expired/revoked/superseded, plus processing/course events approved in the MVP decision.
- [ ] E9-T31 Create signed envelope with HMAC-SHA-256 over exact UTF-8 body, signature version, timestamp, unique event/delivery IDs, schema version, occurred time, and redacted data.
- [ ] E9-T32 Implement at-least-once retry/backoff, delivery history, dead-letter state, replay/reissue, idempotent outbox, and customer verification/replay guidance.
- [ ] E9-T36 Define event compatibility rules for additive fields, schema-version changes, deprecated events, consumer tolerance, projection rebuilds, backfills, and safe replay; test old/new consumers against representative envelopes.

Acceptance criteria:

- [ ] Credential/source-of-truth transactions write the outbox row atomically before webhook delivery.
- [ ] Receivers can verify signature, reject stale/replayed delivery, deduplicate event/delivery IDs, and safely replay.
- [ ] Webhook worker cannot reach private-network destinations or leak source/answers/private fields.

Verification: signature/replay/SSRF tests, delivery retry/dead-letter test, rotation test, and customer-visible history E2E.
Dependencies: E1-S6, E1-S8, E7-S10. Scope: L.

#### Story E9-S9 — Support organization export and privacy-safe deletion requests

As an organization or learner, I want controlled export and lifecycle requests so data handling is transparent without silently deleting evidence.

Tasks:

- [ ] E9-T33 Implement organization export request/job/status/download with tenant-scoped content, audit, usage, courses, assets metadata, releases, learners within permitted scope, and retention classification.
- [ ] E9-T34 Implement learner deletion/support-review request, discoverability removal, pending-job cancellation, projection suppression, source tombstone references, and record of what immutable evidence cannot be removed.
- [ ] E9-T35 Add restore-safe tombstone/deletion replay and exceptional purge approval/hold review path for operator-only legal/security cases.

Acceptance criteria:

- [ ] Export is asynchronous, authorized, redacted, idempotent, and does not include unrelated tenant data or secrets.
- [ ] Normal product flows archive/suppress/tombstone rather than physically deleting release, attempt, credential, audit, or evidence records.
- [ ] Deletion/tombstone status is re-applied after restore and discovery is disabled promptly.

Verification: export/deletion E2E, scope/redaction test, restore replay test, and operator approval audit.
Dependencies: E0-S5, E2-S6, E7-S13. Scope: L.

## Epic E10 — Pilot hardening, operations, recovery, and go/no-go

Outcome: the platform is safe to expose to five organizations only after security, recovery, accessibility, performance, cost, support, and business evidence meet the design gates.

### Feature E10-F1 — Threat model, security, and dependency assurance

#### Story E10-S1 — Test the complete threat model and close findings

As a security owner, I want adversarial evidence across every trust boundary before external pilot use.

Tasks:

- [ ] E10-T01 Run threat-model review for tenant leakage, forged certification, unsafe AI, malicious uploads, prompt injection, discovery abuse, cost exhaustion, rights takedown, and credential disputes.
- [ ] E10-T02 Run tenant/API/Blob/job/retrieval RLS tests, authorization matrix, object URL expiry, upload malware/quarantine, rate-limit, credential tamper, webhook replay, and notification redaction tests.
- [ ] E10-T03 Run dependency/container vulnerability scans, SBOM/license allowlist checks, parser/model/codec review, and manual penetration test.
- [ ] E10-T04 Close or risk-accept findings with owner, scope, expiry, compensating control, and evidence; no exception may weaken tenant isolation, review, credential integrity, or no-PHI boundary.

Acceptance criteria:

- [ ] No open critical tenant, credential-integrity, secret, public-storage, arbitrary-code, or unsafe-publication finding remains.
- [ ] Security findings have reproducible evidence and remediation/risk-acceptance records.
- [ ] Dependency review covers transitive packages, runtimes, physics, codecs, reconstruction code, model weights, and notices.

Verification: security report, penetration-test closure, SBOM, and release security sign-off.
Dependencies: E2-S6, E5-S6, E7-S12, E8-S4, E9-S2, E9-S8. Scope: L.

### Feature E10-F2 — Accessibility, visual quality, and responsive validation

#### Story E10-S2 — Validate every primary journey and screen state

As a learner, author, reviewer, verifier, employer viewer, or operator, I want complete states and accessible recovery so the system is usable beyond the happy path.

Tasks:

- [ ] E10-T05 Run axe-compatible checks and manual keyboard/screen-reader checks for organization setup, assets, AI review, course builder, simulation editor, learner player, assessment/result, credential wallet/verification, discovery/inquiry, and operator tools.
- [ ] E10-T06 Run visual regression for shell, review, builder, player, credential page, loading/empty/error/permission/offline-not-supported/processing/expired/revoked states and Compact/Standard/Wide breakpoints.
- [ ] E10-T07 Validate captions/transcripts, zoom/text scaling, reduced motion/high contrast, touch targets, focus, status announcements, and equivalent path for every certification-critical 3D activity.
- [ ] E10-T08 Validate destructive action confirmations with consequence summary for publish, retire, revoke, takedown, archive, suppression, and exceptional purge.

Acceptance criteria:

- [ ] Non-3D surfaces meet the approved accessibility target and no critical journey is keyboard- or screen-reader-blocked.
- [ ] Certification-critical instructions, errors, completion, and score effects are not conveyed only by canvas/color/animation.
- [ ] Every major surface implements empty, loading, success, failure/recovery, and permission/privacy states.

Verification: accessibility report, screen-reader protocol, visual baseline review, and device/browser E2E.
Dependencies: E1-S9, E4-S4, E7-S4, E9-S3. Scope: L.

### Feature E10-F3 — Performance, reliability, and scale validation

#### Story E10-S3 — Meet pilot nonfunctional targets

As a pilot owner, I want measured reliability and performance so capacity claims are honest.

Tasks:

- [ ] E10-T09 Load test five organizations and low-thousands of learners across metadata reads/writes, uploads, jobs, retrieval, learner sessions, simulation actions, assessments, credentials, verification, discovery, and webhooks.
- [ ] E10-T10 Measure 99.5% monthly availability target, p95 normal API latency under 500ms excluding job submission, job ID within 2s, progress durability, duplicate credential prevention, queue age, and error rates.
- [ ] E10-T11 Validate RPO/RTO against the approved pilot decision, including database, Blob, secrets, queue/outbox, projections, verification, and deletion replay.
- [ ] E10-T12 Confirm scale-to-zero/bounded workers, database connection limits, worker drain, autoscaling, and no always-on expensive GPU.
- [ ] E10-T29 Document measured scale triggers and actions for PostgreSQL retrieval/session contention, queue volume, worker concurrency, AI quota, storage/egress, discovery traffic, and module/service extraction; keep the pilot topology unchanged until a trigger is met.

Acceptance criteria:

- [ ] Test report shows pilot capacity without architectural redesign and identifies bottlenecks/triggers.
- [ ] No acknowledged assessment/credential result is lost and duplicate submissions create one result.
- [ ] Performance targets and any exceptions are approved before pilot claims are made.

Verification: load test, latency/availability report, failure injection, and capacity decision record.
Dependencies: E1-S4, E3-S5, E7-S6, E7-S10. Scope: L.

### Feature E10-F4 — Observability, backup/restore, and operational runbooks

#### Story E10-S4 — Operate queues, jobs, providers, credentials, and abuse safely

As a platform operator, I want operational views and safe tools so support does not require unrestricted data access.

Tasks:

- [ ] E10-T13 Build operator views for API health/latency, queue age/dead letters, AI latency/errors/tokens/cost, asset success by type, reconstruction failures, publication failures, webhooks, email, credential anomalies, storage growth, and largest tenants.
- [ ] E10-T14 Add alerts for API availability/errors, DB exhaustion, queue/dead-letter growth, provider failures, authorization denial spikes, upload failures, credential issuance errors, and login/inquiry abuse.
- [ ] E10-T15 Build operator-only support actions: retry classified jobs, inspect safe metadata/correlation IDs, rebuild projections, reissue webhook, lock account/org, and export audit bundle.
- [ ] E10-T16 Enforce time-bound audited privileged access; operators do not have routine unrestricted source-content access.

Acceptance criteria:

- [ ] Every support action records operator, reason, target, original input/version, outcome, and correlation ID.
- [ ] Dashboards and alerts distinguish retryable failures, terminal failures, trust incidents, cost spikes, and content/rights issues.
- [ ] Operator surface cannot bypass RLS, rights quarantine, publication validation, or credential lifecycle.

Verification: operator RBAC tests, alert simulation, support-action audit test, and safe-metadata review.
Dependencies: E1-S8, E3-S5, E7-S11, E9-S8. Scope: M.

#### Story E10-S5 — Rehearse backup, restore, replay, and incident runbooks

As an operator, I want tested recovery procedures so a failure does not invalidate evidence or leave downstream systems inconsistent.

Tasks:

- [ ] E10-T17 Configure PostgreSQL PITR/backups, Blob versioning/soft delete, immutable release retention/WORM where required, Service Bus dead-letter/replay, Key Vault recovery, and telemetry retention.
- [ ] E10-T18 Run restore to isolated environment, verify schema/migrations/secrets/artifacts, rebuild retrieval/discovery projections, replay outbox/deletion/tombstone work, and validate pre/post-incident credentials.
- [ ] E10-T19 Write/test runbooks for AI outage/quota, poisoned job, backlog/deployment drain, credential dispute, rights takedown, tenant incident, cost spike, and data restore.
- [ ] E10-T20 Record RPO/RTO, missing artifact behavior, customer communication decision, escalation owner/channel, safe stop, access boundary, and exit evidence.

Acceptance criteria:

- [ ] A credential issued before the incident and one issued after recovery verify correctly.
- [ ] Outbox and deletion replay do not duplicate notifications, webhooks, usage, projections, or customer effects.
- [ ] Every runbook names owner, escalation, safe stop, data boundary, recovery evidence, and closure condition.

Verification: restore rehearsal report, replay/idempotency tests, runbook exercise, and RPO/RTO sign-off.
Dependencies: E1-S4, E1-S6, E7-S12, E9-S9. Scope: L.

### Feature E10-F5 — Deployment, rollout, support, and pilot admission

#### Story E10-S6 — Deploy and roll back safely

As an operator, I want non-destructive rollout and rollback so certification evidence is never reinterpreted by a failed deployment.

Tasks:

- [ ] E10-T21 Implement CI/CD order: install lockfile, typecheck, lint/format, unit/contract, build containers, dependency/container scan, backward-compatible migration, staging deploy, smoke/E2E, approval, production revision.
- [ ] E10-T22 Implement readiness checks, non-serving revision, bounded traffic/cohort shift, observation of errors/latency/queue/credential/cost, graceful drain, and immediate application rollback.
- [ ] E10-T23 Use expand-and-contract migrations and forward-compatible recovery; never destructive database rollback for a deployed certification-affecting change.
- [ ] E10-T24 Record release/build/configuration/feature-flag versions; require owner, purpose, default, creation, expiry/removal, and rollback for flags.

Acceptance criteria:

- [ ] A revision cannot receive traffic when readiness, migration, or contract compatibility checks fail.
- [ ] Application rollback does not rewrite or reinterpret existing releases, attempts, credentials, or events.
- [ ] Feature flags cannot bypass RLS, rights quarantine, publication validation, policy, or accessibility requirements.

Verification: deployment pipeline run, rollback drill, migration compatibility test, and flag-policy test.
Dependencies: E1-S4, E1-S6, E1-S7, E10-S3. Scope: L.

#### Story E10-S7 — Onboard pilot organizations and run the go/no-go review

As a pilot team, I want a controlled onboarding and evidence review so only prepared organizations use the MVP.

Tasks:

- [ ] E10-T25 Create onboarding checklist for authorized admin/reviewer/publisher, rights/no-PHI attestation, representative product/model, policy/scope/expiration, device matrix, human review, controlled learner cohort, baseline, discovery opt-in, and escalation path.
- [ ] E10-T26 Link every MVP acceptance checklist item to implementation, test, fixture, dashboard, runbook, decision record, or pilot result.
- [ ] E10-T27 Conduct E0–E10 checkpoint review and classify each capability as designed, spike-proven, implemented, pilot-validated, or released.
- [ ] E10-T28 Obtain product, security, accessibility, operations, business, and organization owner approval; record pilot restrictions and stop conditions.

Acceptance criteria:

- [ ] All eight honest-MVP conditions pass: PDF/GLB thin slice, image/video contract, anti-fabrication, immutable evidence, equivalent paths, tenant/deletion/rights/verification evidence, intended-use understanding, and measured cost.
- [ ] Pilot organization understands credential meaning and assumes responsibility for source, policy, scope, and quality-system use.
- [ ] The go/no-go decision names approved organizations, quotas, fixtures, devices, owners, support channel, and rollback/stop actions.

Verification: signed pilot readiness packet, acceptance checklist audit, controlled pilot run, and go/no-go record.
Dependencies: E10-S1, E10-S2, E10-S3, E10-S4, E10-S5, E9-S6. Scope: L.

## Cross-epic completion checkpoints

### Checkpoint A — Foundation and tenant safety

- [ ] E0 decisions, fixtures, rights, accessibility, budget, and evidence model are approved.
- [ ] E1 clean environment, migrations, CI, telemetry, secrets, and UI foundation pass.
- [ ] E2 personal account, invitation, multiple membership, authorization, and adversarial RLS tests pass.

Verification evidence: decision records, clean deploy, CI run, identity E2E, RLS adversarial report, and security review.

### Checkpoint B — Content authoring slice

- [ ] E3 PDF and existing GLB fixtures process asynchronously to reviewable outputs with explicit failure behavior.
- [ ] E4 reference model runs on named devices with semantic controls and equivalent path.
- [ ] E5 produces a cited, schema-valid, draft-only AI course with conflict and safety gates.
- [ ] E6 author can edit, preview, review, validate, and publish an immutable release without engineering.

Verification evidence: fixture run, model report, AI evaluation, authoring recording, publication manifest, and hash replay.

### Checkpoint C — Certification slice

- [ ] E7 independent learner enrolls, resumes, completes required activity and assessment, and receives one credential.
- [ ] Server rejects stale, duplicate, replayed, forged, wrong-version, and concurrent certification actions.
- [ ] Public verification returns current redacted status and QR/URL works.

Verification evidence: end-to-end learner run, tamper/concurrency report, credential event lineage, verification test, and evidence export.

### Checkpoint D — All ingestion paths

- [ ] E8 supported image fixture and video fixture produce reviewable candidate models or explicit safe rejection.
- [ ] Quality reports cover coverage, scale, component mapping, materials, device budget, cost, license, and reviewer decision.
- [ ] Existing-model fallback remains available and unchanged.

Verification evidence: same-fixture comparison, adapter reports, SBOM, cost report, and publish-block/fallback test.

### Checkpoint E — Pilot surfaces

- [ ] E9 discovery is opt-in, bounded, current-status aware, consent-based, and abuse-resistant.
- [ ] Notifications are durable/redacted/retryable; email failure cannot fail source-of-truth transactions.
- [ ] Dashboards, exports, webhooks, usage meters, and audit views reconcile to source-of-truth records.

Verification evidence: privacy/abuse report, notification/replay report, dashboard reconciliation, export, and webhook signature report.

### Checkpoint F — Pilot ready

- [ ] E10 security, accessibility, visual, device, performance, restore, cost, support, deployment, and runbook evidence passes.
- [ ] Every MVP acceptance item has linked evidence and an owner.
- [ ] Product may be sold as a pilot only after go/no-go approval; otherwise it remains a prototype/technical demonstration.

Verification evidence: pilot readiness packet and signed go/no-go record.

## Explicit future-phase parking lot

The following are intentionally not MVP backlog scope. Each requires a new product/architecture decision and evidence plan before work begins:

- [ ] FUTURE-01 Enterprise SSO/SAML and SCIM-style provisioning.
- [ ] FUTURE-02 Advanced residency, customer-managed keys, SOC 2 readiness, and higher-availability/disaster-recovery commitments.
- [ ] FUTURE-03 Azure AI Search or separate retrieval/session stores when measured triggers are met.
- [ ] FUTURE-04 Richer physics, multiplayer instructor sessions, collaboration, haptics, VR/AR, digital twins, and sensors.
- [ ] FUTURE-05 Portable digital credentials, wallets, issuer keys, accreditation, endorsements, and offline verification.
- [ ] FUTURE-06 Full employer integrations, job postings, applications, interviews, ATS, or marketplace features.
- [ ] FUTURE-07 Billing/subscriptions, learner-paid premium certifications, white-label, partner networks, other industries, and localization.
- [ ] FUTURE-08 Customer-specific fine-tuning/model training only after curated data, evaluation, privacy, and cost review.
- [ ] FUTURE-09 Native mobile applications and offline course delivery.
- [ ] FUTURE-10 Instructor/evaluator human-review workflows and customer quality-system integrations beyond issuer evidence export.

## Design traceability index

This index is the completeness check from the source document to the backlog. A design section is covered when its required behavior is represented by one or more backlog IDs and its acceptance evidence appears in the relevant Epic/checkpoint.

| Design area | Backlog coverage |
|---|---|
| Product intent, success definition, hard constraints, out of scope | E0-S1, E0-S2, E0-S3, E0-S7, E10-S7 |
| Capability map and build order | Plan dependency table; E0–E10 ordering |
| Azure architecture, monorepo, modular monolith, adapters | E0-S4, E1-S1, E1-S4, E1-S6, E5-S2, E10-S6 |
| Identity and organization membership | E2-S1–S4, E2-S7 |
| Roles and authorization matrix | E2-S5, E2-S6, E2-S7 |
| Tenant isolation and RLS | E2-S6, E10-S1 |
| Blob storage, private URLs, source versions | E3-S1–S4 |
| Job queues, retry/dead-letter/idempotency | E3-S5–S6, E10-S4 |
| PDF/manual extraction and citations | E3-S7, E5-S1, E5-S3 |
| Existing GLB normalization and review | E3-S8, E4-S1–S4 |
| Image/video supported profiles and reconstruction | E8-S1–S4 |
| 3D runtime, model manifests, component interaction, performance | E0-S3–S4, E4-S1–S4 |
| Simulation schema, state machine, scoring, faults, accessibility | E6-S3–S4, E7-S5–S7 |
| AI gateway, RAG, structured drafts, citations, safety, evaluation | E5-S1–S6 |
| No-code course/story authoring and concurrency | E6-S1–S4, E6-S7 |
| Review, approval, publication, immutable versions, release snapshot | E6-S5–S7, E7-S8 |
| Catalog, private/public/unlisted access, candidate flow | E7-S1–S2 |
| Learner progress and semantic events | E7-S3–S4 |
| Assessment attempts, policy, retries, cooldown, remediation | E7-S8–S9 |
| Credential issue, expiration, revocation, supersession, verification, QR | E7-S10–S13 |
| Evidence export, retention, deletion/takedown | E0-S5, E3-S4, E7-S13, E9-S9, E10-S5 |
| Discovery, projection, privacy, search, inquiry | E9-S1–S3 |
| Notifications, email, outbox, redaction, retries | E9-S4 |
| Organization reporting, analytics, business value | E9-S5–S6 |
| REST API, OAuth integration, webhooks | E1-S7, E9-S7–S8 |
| Security/privacy/threat model | E0-S5, E2-S6, E5-S6, E8-S4, E10-S1 |
| UX visual system, screen states, accessibility, responsive behavior | E1-S9, E4-S4, E7-S3–S4, E10-S2 |
| NFR, performance, scale, cost | E0-S6, E4-S4, E8-S4, E9-S6, E10-S3 |
| Deployment, configuration, CI/CD, rollback | E1-S4–S5, E10-S6 |
| Observability, support tools, alerts, runbooks | E1-S8, E10-S4–S5 |
| Backup/restore and replay | E7-S13, E9-S9, E10-S5 |
| Pilot operating model and acceptance checklist | E0-S7, E9-S6, E10-S7, Checkpoints A–F |
| Event envelope evolution, compatibility, replay, and backfill | E9-S8, E10-S5 |
| Medical-device content-change classification and requalification | E7-S11, E10-S7 |
| Pilot rate limiting, caching, egress, and scale-trigger simplicity | E0-S6, E4-S4, E9-S2, E10-S3 |

## Final completeness rule

The backlog is complete for the design when every item in the source document’s MVP acceptance checklist has a passing evidence link, every source-to-credential path has been exercised with the named fixtures, every security/privacy/versioning invariant has automated coverage, every screen has all required states, and E10-S7 records the pilot decision. Until then, unchecked work remains open even if the happy-path demo works.



