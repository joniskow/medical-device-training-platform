# Imported model review

The author upload area lists imported models with paging, component names/IDs, current status, and a private 3D preview. Preview fetches model bytes through the authenticated same-origin API and creates a temporary browser object URL; storage remains private. Preview resources are disposed when switching models, closing review, or changing account/organization.

GET /api/v1/model-imports lists tenant-scoped imports; GET /:id returns metadata; GET /:id/content checks active source/model/parent state and exact SHA-256 before returning bounded GLB bytes with no-store. No storage keys or direct private Blob URLs are exposed. POST /:id/review requires reviewer authorization, confirmation, hash, rationale and idempotency key. Model/source transitions and audit evidence commit atomically; identical concurrent requests produce one audit. Changed requests and stale/rejected models cannot overwrite approval. Noncanonical models cannot be approved through this path.

The browser requires a successful 3D preview before enabling an approval action. Approval exposes the model to existing course selectors; it does not create a simulation or grant a credential. Model interaction configuration, normalization/variants and learner/private course-preview delivery remain distinct unfinished work.

Evidence: full build; tools/check-glb-import.mjs uses restricted PostgreSQL plus real HTTP for private bytes, no-store, denied anonymous/foreign access, reviewer gate, hash conflict, approval and replay audit; architecture boundaries. Live acceptance is tracked in tasks/current-delivery.md.

Deployment submitted: API image personal-20261030-model-review1 digest sha256:361f137c6f026e81399483ef169ead007205e0630d704bcf646a14028f6abbec, revision mdt-personal-api--0000021. Live 3D preview and approval acceptance remain pending until the revision serves traffic.

Live preview on revision 21 did not render; no model was approved. The renderer now accepts authenticated byte input directly, avoiding a second object-URL fetch. It still validates the source hash and scene geometry. Safe preview error codes were added. Build passes; revision/tag model-review2 rollout is in progress. Confirm rendering before claiming this workflow complete.

Revision mdt-personal-api--0000022 is Healthy (personal-20261030-model-review2, digest sha256:a7060eba945457f1c82f923b922911c7ed593afaba5721f1373f79179595d55d). The byte-input renderer correction is deployed. Model remains unapproved pending successful live rendering.

Live acceptance: direct-byte preview rendered the three-triangle AIC-001 fixture and three mapped components. Runtime reported reduced complexity (performance target not passed). The model was approved with an explicit automated synthetic-test-only rationale that records the geometry/performance limitations. Browser reported Model approved. Review recorded. No clinical suitability was claimed. Course binding/simulation authoring remains next.
