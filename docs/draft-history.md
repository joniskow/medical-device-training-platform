# Durable draft history

Draft editing and AI generation already record before/after snapshots in tenant audit events. Simulation creation and model binding/replacement now do so as well, with revision and nextRevision. Existing older events without snapshots remain audit evidence but are not offered as restorable history; no snapshot is fabricated.

The store lists 50 metadata rows per page, newest nextRevision first, with an exclusive numeric cursor. Rows include event type, actor, timestamp and before/after revision numbers, not course content. Restoration accepts a recorded event and before/after side, current revision, reason and idempotency key. It locks the current course, requires DRAFT or IN_REVIEW, reads only an eligible event for the same tenant/course, restores the trusted snapshot as a new DRAFT revision and records another atomic before/after audit. Restoring the before side of that restoration provides redo. Source provenance is restored with the snapshot; immutable successor lineage is retained from the current course. Publication revalidates current assets, policy and reviews.

Author-only GET/POST /api/v1/course-versions/{id}/history exposes listing/restoration. POST requires JSON, confirmed:true, reason and an idempotency header; arbitrary content fields reject. GET permits only a single positive beforeRevision cursor. Normal account/organization access resolution and no-store responses apply.

Restricted-runtime PostgreSQL and HTTP checks cover pagination, tenant/course separation, stale and immutable versions, exact undo/redo, audit failure rollback, concurrent identical restoration, changed-key-body conflict, retention of later edits, successor lineage, authentication/roles, strict query/body/confirmation and response caching. Binding regression verifies a model-selection snapshot can be undone. Full build, API build and architecture pass.

The author history/compare/restore UI remains unfinished. Snapshot selection and consequence confirmation should be reviewable before exposing undo/redo controls. Historical source/model approval is not revived by restoration. This local evidence does not establish deployed acceptance or completion of E6-T05 through E6-T07.


## Author comparison and restoration

Saved draft history is now available in the author editor. Authors load/paginate metadata, choose a change and its before/after snapshot, then compare changed sections with the current saved content. Each changed section offers current/selected values in expandable inert-text details. A reason and explicit confirmation are required. Restoration reloads the saved draft and returns keyboard focus to its title; an interrupted response retains the request identity for retry. New edits invalidate comparison and block restore until saved/discarded and compared again. Current editor/session identity and connected-element checks fence stale responses.

GET history with eventId and side returns a read-only comparison of the current revision/status/content and the exact selected snapshot, preserving current successor lineage just as restore does. Mixed paging/detail queries reject. Author and tenant access checks apply before reading snapshots; responses remain no-store.

Full build and architecture pass. Restricted-runtime database/HTTP tests verify exact read-only comparison, author/tenant denial and strict query shape. Integrated Chrome verifies inert actor labels, visible section differences, stale-comparison invalidation, missing-reason/cancellation guards, interrupted retry identity and reloaded title focus. The draft-history:validate aggregate includes author Chrome. This is separate local service/browser evidence; deployed and full accessibility acceptance remain open.


## Unsaved conflict comparison

The author editor now compares the originally loaded snapshot, current unsaved edits and latest saved course through the existing authenticated course GET. Changed top-level sections show all three values as inert text and distinguish local, saved and overlapping changes. Object key order is normalized for comparison. This is read-only: it does not merge or submit content, clear recovery data or unblock a stale save. Authors can retain/copy their edits or confirm discard and reload to adopt the saved revision.

Comparison captures editor/session identity, revision and edit generation. New edits clear displayed comparisons; responses made stale by editing, saving, navigation or sign-out are ignored. Failed reads preserve local edits and allow retry. Successful comparison focuses its heading. A matching-content result explains that reload adopts the latest revision.

Web build, architecture checks and integrated Chrome pass. Browser checks cover three-way values and overlap labels, inert markup, focus, no writes/recovery mutation, fetch failure, editing during the request, cancellation/confirmation of reload, matching content and late sign-out responses. This completes the local compare/reload increment for E6-T06; no automatic merge or separate-draft fork is implemented. Deployed multi-browser and accessibility acceptance remain open.
