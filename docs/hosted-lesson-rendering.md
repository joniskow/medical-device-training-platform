# Hosted lesson rendering

The API and worker use the existing PostgreSQL job/outbox and signed queue workflow. No author-supplied filesystem path or asset map is production authority.

## Author API

All routes require authenticated organization membership with an authoring role. Mutations use the existing origin, rate and authorization controls.

```http
POST /api/v1/lesson-renders
Content-Type: application/json
Idempotency-Key: render-course-1-preview

{"courseVersionId":"course:1:v1","revision":4,"lessonId":"lesson:1","mode":"rough-cut"}
```

The response is `202` with `jobId` and state. Poll `GET /api/v1/lesson-renders/{jobId}`. Fetch authenticated private bytes through `GET /api/v1/lesson-renders/{jobId}/content?kind=video`, `kind=captions`, or `kind=manifest`. Status never returns the private source snapshot. Final artifacts expose a generated `assetVersionId` for the existing independent media/lesson review and publication process.

Use `POST /api/v1/lesson-renders/{jobId}/cancel` or `/retry`, with a JSON `reason`. Cancellation is terminal, records the actor/reason/correlation and invalidates the lease. Request a new idempotency key to start a deliberately new render. An identical successful admission replay returns the original job even after attachment advances the course revision. Reusing the key for different inputs fails.

The request binds the saved course revision and lesson ID. Every referenced source must have an approved asset version and active derivative rights, and no withdrawn/expired attestation. The store holds input locks, snapshots server-owned private keys/hashes, and atomically creates the job plus outbox. A rough cut invalidates old preview acceptance and final review. Final rendering requires acceptance of the current rough cut; it never constitutes independent final review.

## Runtime and boundaries

Configure the existing real speech provider and FFmpeg/FFprobe in the worker. Production configuration rejects fixture provider modes. Narration evidence persists the provider, voice, and script/delivery/audio hashes. Silent deterministic speech cannot satisfy the render path. Audio normalization measures actual decoded duration/loudness; timing and listening/factual review remain required.

Each job uses an isolated temporary directory, at most 64 source IDs, 128 MiB per input/output video and 256 MiB total source input. Captions are limited to 1 MiB. Existing lesson validation limits duration to 30–300 seconds and scenes to twelve. The worker has a 900-second lease and an 840-second internal deadline, plus the shared operational admission signal. Cancellation reaches FFmpeg and audio subprocesses. Reconstruction engine subprocesses also receive admission cancellation and terminate their process tree; this requires process-termination permissions in the deployed worker.

Media signatures select explicit image, MOV/WebM, WAV or MP3 parsers. FFmpeg and FFprobe allow only file/pipe protocols; MOV external data references and absolute paths are disabled. Playlists cannot choose network demuxers. Source bytes are checksum verified after private download.

The worker rechecks the original saved revision and rights before expensive processing, after rendering and inside fenced completion. The completion transaction registers the generated private video as `READY_FOR_REVIEW`, attaches the matching manifest, invalidates stale review, audits lineage, and marks the job successful together. Lease-specific object keys prevent stale attempts overwriting a winner. Interrupted attempts may leave unreferenced private objects under their job/lease prefix; operational retention must include those prefixes. They never become approved or anonymously delivered. Delivery rechecks current lesson identity and original sources/rights, and verifies video/captions/manifest hashes.

Local scene-take paths are explicitly rejected at admission and worker revalidation, including handcrafted durable jobs. Corrected clips now have an authenticated promotion bridge: upload the clip through normal private upload/scan/decode, obtain independent source approval and active derivative rights, then call `POST /api/v1/lesson-corrected-takes` with an `Idempotency-Key` header and JSON `{courseVersionId,revision,lessonId,sceneId,assetVersionId,sourceHash,reason}`. The server requires the exact saved scene duration from a successful hash-bound media inspection, verifies private tenant ownership and source review separation, and replaces the visual using the approved asset ID. Caller-supplied paths, decoder reports and durations are not accepted.

Promotion advances the course revision, preserves original source citations and source hash/review evidence, and audits the complete before/after state. It removes obsolete local take alternatives and prior sound bindings, invalidates direction/rough/final reviews, and marks dependent lesson variants stale for regeneration. It does not approve the corrected motion or final lesson: a fresh direction, preview and independent final review remain required. Instructional sounds require authoritative evidence; missing server-bound sound review fails closed. This implementation does not manufacture those approvals.

## Verification evidence

After building contracts/database/API/worker:

```powershell
node tools/check-hosted-lesson-render.mjs
node tools/check-hosted-lesson-http-routing.mjs
node tools/check-hosted-lesson-render-postgres.mjs
node tools/check-lesson-media-input.mjs
node tools/check-lesson-audio.mjs
node tools/check-ai-gateway.mjs
```

The PostgreSQL suite uses unique organization fixtures and cleans them up. It proves atomic outbox admission, stable replay, tenant denial, private integrity, rights withdrawal, edits during processing, queued/in-flight cancellation, retry, completed replay, lease fencing and handcrafted local-path denial. Corrected-take regressions cover missing independent review/decode, stale hashes, mismatched duration, cross-tenant denial, replay/conflict and parent/variant review invalidation. HTTP and signed queue routing are tested against the actual server/consumer with explicit test authentication/transport doubles.

To exercise the actual FFmpeg rough/final compositor and media streams:

```powershell
$env:LESSON_ENGINEERING_SIGNAL='1'
node tools/check-hosted-lesson-render-postgres.mjs --real-render
```

That run passed locally with an engineering tone, private in-memory transport and the real PostgreSQL store. It is **not spoken-narration or Azure cloud acceptance**. For spoken audio set `LESSON_RECORDED_FIXTURE` to a rights-cleared WAV and omit `LESSON_ENGINEERING_SIGNAL`. The local Windows System.Speech fallback had no usable voice in this environment. Actual Azure AI/Speech output, production Blob/Service Bus transport, representative long-manual retrieval, real rights-cleared photo/video captures, engine-image reproducibility and OpenMVS distribution/license approval remain unaccepted external evidence.

`check-reconstruction-process.mjs` exercises process-tree timeout and cancellation. Its existing descendant-termination assertion failed under the restricted local sandbox; the request to rerun with process-termination permissions was rejected. Do not mark process-tree recovery accepted from the source changes alone.
