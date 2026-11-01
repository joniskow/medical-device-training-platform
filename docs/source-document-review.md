# Source document review

Reviewers can approve or reject processed source documents in the author source reader. POST /api/v1/knowledge-sources/:assetVersionId requires a reviewer role, explicit confirmation, source SHA-256, rationale and idempotency key. The database locks the version and parent asset, verifies tenant, allowed parent status, READY_FOR_REVIEW state and expected hash, then updates the version and records a SOURCE_REVIEW_DECISION audit event in one transaction. Replayed identical decisions return the original result; conflicting/revised requests reject. Approved/rejected decisions cannot be overwritten through this endpoint.

The reader presents extracted passages followed by rationale, confirmation and decision controls. Publication still independently requires approved source versions and a course reviewer other than its author. This feature does not waive those requirements.

Validation: full build; tools/check-source-review.mjs using restricted PostgreSQL role and real HTTP (role/confirmation/hash/tenant checks, concurrent replay, audit count and rejection); architecture boundaries. Live acceptance is tracked in tasks/current-delivery.md.

Live deployment: revision mdt-personal-api--0000019, image personal-20261030-source-review1 (sha256:f855c1be149cf7b1c78651cbb1af0bd6eed407b6c9046a09e9d8f260cbbfffb1), Healthy. Actual Chrome reviewer flow inspected all three synthetic manual passages and recorded approval with an automated acceptance rationale. UI reported Source approved. Decision recorded. Screenshot output/live-source-review-20261030.png. The course remains unpublished and still requires simulation evidence and independent course review.
