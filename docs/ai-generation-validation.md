# AI generation acceptance and input limits

The Azure gateway now accepts structured output only from one completed (`stop`) response. Length-limited, filtered/refused, tool-call, missing-finish and malformed responses produce explicit validation rejection and no draft output. Invalid generated JSON is not classified as a transient provider failure. Transport failures and HTTP 408/429/5xx remain retryable; other provider HTTP failures are terminal. Provider bodies and exception details are not copied into failure messages.

The selected retrieved passages and author instruction are no longer silently sliced. Instructions over 2,000 characters and prompts over the configured input-character budget (default 32,000) reject before a provider call. The character budget is an application bound, not an exact model-token estimate. The source service still retrieves at most 32 chunks; this change does not claim whole-document coverage or implement relevance-ranked context selection. Large source selections need narrowing until a coverage-aware retrieval workflow is implemented.

Valid nonnegative integer prompt/completion token counts are retained on accepted and rejected provider output. Missing/invalid usage is omitted rather than fabricated. AI-run persistence stores the rejection warning and metrics with null output. Failed/rejected results do not apply to the course. Completed output remains draft-only and still requires human review; the existing shallow schema check is not full course-schema or claim-level citation verification.

## Evidence

`pnpm build`, `pnpm architecture:test`, `node tools/check-ai-gateway.mjs`, `node tools/check-draft-generation-race.mjs` and `node tools/check-source-grounded-draft.mjs` pass. Gateway fixtures cover input limits/no provider call, complete/incomplete/refused/malformed responses, invalid usage, status classification and safe exceptions. The service fixture checks the full retrieved passage tail survives and rejected runs are recorded without applying a draft. The PostgreSQL fixture verifies rejected output stays null while token metrics and warning persist. Existing deterministic generation, source access/lifecycle and stale-revision tests pass. Provider responses are controlled test fixtures; no live Azure generation is claimed.

Provider response fields follow [Microsoft's chat-completion documentation](https://learn.microsoft.com/azure/ai-services/openai/how-to/chatgpt) and [Azure chat REST reference](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat).

## Remaining production AI work

Pin and evaluate the real Azure deployment/model/API version and OCR path; enforce the complete generated course/activity schema and exact source references; evaluate claim support, conflicting sources and prompt injection; implement coverage-aware retrieval and reviewable conversational proposals. Record latency/cost evaluations and deployed acceptance before treating AI authoring as complete.


## Provider-independent citation validation

The source-grounded draft service now validates every DRAFT result before recording or applying it, including deterministic or alternate provider implementations. Generated courses require a nonempty title, modules and typed activities within structural bounds. Course and each activity require nonempty citations that exactly match a retrieved passage locator, normalized with its authoritative asset-version ID. Nested citations (for example on assessment questions) are checked too. Changed pages, sections, character ranges, extra locator fields and foreign assets reject; object property order does not affect equality. Reported cited asset IDs are derived from validated references rather than copied from the provider or selected-source list.

Protected provenance/lineage and executable fields reject. Validation traversal has depth/work limits. A rejected result has no output or citations, preserves usage/provider metadata and warnings, and adds a stable validation warning/failure. It is recorded as REJECTED and never passed to saveGeneratedDraft. Prompt instructions now specify exact locators at course/activity level; the deterministic fixture supplies these references too.

`pnpm ai:validate` includes a new provider-independent service fixture covering successful application, missing/foreign/changed/nested references, structure and protected-field failures, input nonmutation and retained usage without saves. Full build, architecture and generation-race checks pass. The PostgreSQL source-generation fixture verifies forged references persist as REJECTED with null output and an AI_CITATION_INVALID warning.

This is exact reference validation, not proof that source text entails a claim, complete document coverage, or complete activity-specific schema validation. Citation requirements for individual factual sub-blocks, full generated assessments/simulation structure, claim-support evaluations and production deployment remain open. The existing publication validator remains a separate gate.


## Shared assessment and activity-catalog validation

Generated assessment activities now use validateAssessmentDefinition from the same schema package used for publication and server scoring. Single-choice, multi-select and ordered-step definitions must satisfy identifier, threshold, question/option, correct-answer, points, competency, rationale and citation rules before application. Duplicate assessment identifiers across modules reject, as do assessment definitions attached to non-assessment activities. Exact retrieved-locator checks still apply to every question citation after structural validation.

The generated activity type is checked against the publication catalog through a shared predicate. Unknown types reject instead of being saved for later failure. This does not claim validation of every media/model/simulation payload yet. The AI package now declares the schema workspace dependency; AI validation commands build dependencies first. The authoring prompt describes the required assessment shape.

AI/service tests accept all three assessment types and reject missing definitions, unknown answers, multiple single-choice answers, incomplete ordered sequences, invalid scores/points, missing rationale/competencies, duplicate question/assessment IDs and misplaced assessments. Rejected results are audited with no save call. Full build, architecture, existing assessment scoring/publication tests, stale-generation protection and PostgreSQL source-generation regression pass. Live provider generation and reviewer acceptance remain unverified.


## Generated simulation validation

Generated simulation definitions now pass the existing runtime validator before a DRAFT can be applied. Procedure graph, component actions, faults, scoring, completion and equivalent-path constraints therefore use the same rules as execution. Validation applies to any supplied simulation definition, including one not yet referenced by an activity. All six simulation-backed activity types require an exact definition ID shared by the activity, course binding and definition. Model version/hash must match the course model, and definition component IDs must occur in its manifest metadata.

Service fixtures accept simulation, simulation_outcome, fault_troubleshooting, guided_procedure, manipulation and assembly. Broken transitions, unknown fault components, absent equivalent instructions, invalid scoring and inconsistent definition/model/component bindings reject with no output or save. AI/service, full build, simulation schema/replay/publication, architecture, generation-race and PostgreSQL source-generation regression checks pass.

These checks establish internal draft consistency, not database approval or geometry fidelity of AI-supplied model metadata. Publication still verifies authoritative approved model records. Supplying trusted existing model context to generation, validating other activity payloads and evaluating source support for generated procedures remain open, alongside live provider acceptance.


## Approved bound-model context

Before calling a provider, generation resolves the draft's bound model using a new internal tenant-scoped store operation. It requires an APPROVED database model with a stored manifest, validates that manifest and source hash, and rejects a hash mismatch with the captured draft binding. Missing lookup support, withdrawn approval and stale binding fail before provider execution. The model metadata is included in the bounded prompt as data; storage paths and signed asset URLs are not returned by this operation.

The service retains the authoritative binding when generated content omits model metadata. Any supplied model must match the authoritative model exactly (ignoring object key order); invented models on unbound drafts and changed metadata reject with AI_MODEL_CONTEXT_INVALID before draft application. Simulation validation then checks the resulting authoritative model binding. Revision checking at save still protects intervening author edits. Model approval is a read-time snapshot here; publication independently rechecks current approval and model data.

Service fixtures check prompt context, preservation on omission, changed/unbound model rejection and no provider call for unavailable or stale bindings. Restricted-runtime PostgreSQL checks cover exact metadata, cross-tenant denial and withdrawn approval. Full build, AI/service, generation-race, architecture, source persistence and the broader draft-simulation/binding HTTP suite pass. Live provider generation, model action/geometry evaluation and remaining activity payloads are still open.


## Generated model inspection

Generated 3d_viewer and hotspot activities now use validateModelExploration before saving. They require a bound model context and validate overview length, hotspot count, known unique component references, titles and equivalent text. Extra action/scoring fields reject. Exploration payloads on other activity types reject as misplaced content. The prompt now describes this shape and prohibits inventing model inspection when no model is bound.

Service tests accept both inspection types and an overview-only viewer, and reject missing overview/text, empty hotspot activities, invented/duplicate components, score fields, misplaced payloads and unbound inspection. Rejections have no output/save. AI/service, full build, shared model-exploration/publication tests, architecture, generation-race and PostgreSQL source-generation regressions pass. These are controlled local tests; media payloads, complete generated story/policy validation, semantic claim evaluation and live provider acceptance remain open.


## Generated stories and certification policies

When generated content supplies a policy or story, the source service derives activity descriptors from the generated modules, assessment thresholds and simulation scoring, then reuses validCertificationPolicy. Invalid references, evidence requirements, attempt limits and thresholds reject before saving. A generated story requires a valid versioned policy. validateCourseStory receives activity IDs, requirements expanded from both required activities and required modules, and the exact simulation fault context. Cycles, nonexistent activities, unsupported facts and successful paths bypassing required learning reject.

Drafts without a policy/story may still be incomplete authoring drafts; this change does not fabricate issuer decisions for them. Supplied policy and story content must be internally valid, while human review/publication remains separate. Tests accept ordinary and module-required stories and reject missing/invalid policy, unknown references, invalid scoring/attempt/evidence settings, bypasses, cycles and unsupported condition facts without save/output. Full build, AI service, story, certification policy, generation-race, architecture and PostgreSQL source regression checks pass. Media validation, live generation and semantic claim support remain open.


## Generated image/video bindings

The service now collects bounded media asset-version references from generated image/video activities and resolves them through a tenant-scoped database operation. Only supported image/video MIME types on APPROVED versions whose parent asset is also APPROVED are returned. The result contains IDs and type metadata only, without storage keys or signed URLs. Missing lookup support or unmatched IDs supplies no approval, so validation rejects the media activity.

validateMediaActivity now runs before generated content can be saved. It enforces private asset binding, matching media type, bounded image description/video transcript and strict media fields; misplaced media payloads on other activity types reject. Course/activity citation checks still apply independently. Model/provider output cannot supply its own media approval metadata.

Service tests accept approved images/videos and reject foreign references, type mismatches, missing text, external URLs, inappropriate fields and misplaced bindings with no output/save. Restricted-runtime database tests check metadata shape, tenant isolation, quarantined versions, retired parents and malformed IDs. Full build, AI/service, existing media schema/access HTTP, generation-race, architecture and PostgreSQL source-generation regression checks pass.

Approval is checked at generation validation time and again independently at publication/delivery. This does not analyze image pixels, transcribe video or establish semantic support for generated descriptions. Providing a selectable trusted media context to the generation UI/prompt, production extraction/evaluation and live provider acceptance remain open.


## Explicit media selection for generation

The author generation form now offers an optional approved-media picker with pagination, inert filenames, deduplication and a maximum of 32 selected assets. Selection is cleared on course reload/change and sign-out; request/session/editor checks ignore late list responses. The generation request carries mediaAssetVersionIds separately from document sources. The HTTP contract rejects malformed, duplicate and oversized selections with 422.

The service validates selected IDs and resolves current approved metadata before provider execution. Missing/withdrawn selections fail before a provider call. The bounded prompt includes only selected asset IDs/types and explicitly says that metadata does not provide visual/audio evidence for descriptions or transcripts. Generated media references must be a subset of the selection, and approval is re-read before validation/save. No selection means generated media cannot be accepted. Existing document-only generation remains supported.

Full build and AI/service tests pass, including unselected-but-approved media rejection, missing approval and duplicate selections. Integrated Chrome covers inert names, paging, selected IDs in the generation request and sign-out cleanup. HTTP checks cover successful selection and invalid shapes/counts (422); generation-race, architecture and PostgreSQL source persistence regressions pass. These are controlled fixtures, not image understanding/transcription or live provider acceptance. Asynchronous generation/proposal workflows and production evaluation remain open.


## Retrieval coverage evidence

The existing retrieval query already interleaves passages by per-document rank. It now also returns each source's eligible passage count in the same query snapshot. Generation computes selected/total counts for every selected source, includes those counts in the bounded provider prompt and returns sourceCoverage in the response. Partial coverage adds SOURCE_CONTEXT_PARTIAL; unavailable or inconsistent totals add SOURCE_COVERAGE_UNKNOWN. These service-generated warnings cannot be removed by the provider, are stored with the AI run and appear through the existing author warning display. Oversized source selections now reject rather than silently dropping sources beyond 32.

Coverage means retrieved passage counts, not semantic coverage or claim support. All retrieved text must still fit the configured prompt limit without truncation. This does not add relevance ranking, multi-pass synthesis or full-document generation.

A PostgreSQL fixture with two 40-passage documents verifies the 32-passage budget selects 16 from each and persists both partial-coverage warnings. Service tests verify unknown coverage and oversized-selection rejection; Chrome verifies the author sees the counts. Full build, AI/service, generation-race, architecture and source database regressions pass. Production retrieval quality and live evaluation remain open.


## Instruction-aware passage ranking

Generation now passes the author's instruction to retrieval. PostgreSQL normalizes its words using the explicit English text-search configuration, quotes the resulting lexemes into an OR query and ranks passages with ts_rank_cd within each selected document. Interleaving by document rank remains intact, so a large matching document cannot remove the others from the 32-passage context. Stable creation-time/chunk-ID ties preserve deterministic selection. Empty, stopword-only or unmatched instructions retain the prior default order. Queries are parameterized and bounded at 2,000 characters; source eligibility and tenant filters remain unchanged. Coverage counts still describe all eligible passages rather than just matching passages.

The PostgreSQL fixture verifies a relevant passage at page 40 of each of two documents appears first, balanced selection, repeatability, stopword fallback, cross-tenant denial, SQL-looking input as plain query data and oversized query rejection. The service race fixture verifies instruction forwarding. Full build, AI tests, source database checks, generation-race and architecture pass.

This is lexical English ranking, not embeddings, semantic entailment or a production relevance benchmark. Ranking currently computes vectors over selected eligible chunks; large-corpus latency/index needs must be measured before claiming the pilot performance target. PostgreSQL behavior follows its [text-search function reference](https://www.postgresql.org/docs/current/functions-textsearch.html).


## Persisted input fingerprints

AI runs now have a nullable input_evidence JSON column populated for new runs with ai-input-evidence.v1. It records a canonical service-request hash, token budget, instruction hash, retrieval version, ordered passage IDs/asset IDs/source hashes/text and citation hashes, source coverage, bound-model identity/metadata hash and selected-media identity/types. Raw instruction, passage text, citation text and model details are not duplicated in this evidence. Existing historical runs remain null; no evidence is fabricated.

The request fingerprint includes source/input/settings/schema and prompt version, but excludes correlation IDs so equivalent retry inputs compare consistently. It fingerprints the service input, not the exact provider HTTP payload or provider internals, and does not enable replay without retained source/configuration/instruction material. Complete reproducibility and retention policy remain open.

Generation retrieval now returns authoritative stored source hashes and excludes knowledge chunks whose source_hash differs from the current asset-version sha256. Such stale extraction cannot silently provide the generation context. The guard applies to generation retrieval; the separate source-reader/search APIs are not claimed changed by this increment.

Unit checks verify stable key-order-independent fingerprints, source/instruction/citation/settings/model/media changes, metadata coverage and absence of raw private content. PostgreSQL verifies accepted and rejected AI-run evidence plus stale-chunk denial. Full build, AI/service, generation-race and architecture checks pass. source:validate includes the input-evidence check. The additive migration has been exercised locally; deployed migration and live provider evaluation remain open.
