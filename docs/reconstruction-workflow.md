# Durable reconstruction requests

The author page now has a reconstruction panel behind explicit server configuration. It lists approved source media with derivative permission, saves a reconstruction request, shows progress and opens completed private model/report files in the preparation workbench. Single-image handoff also loads the matching original photograph. The author still supplies measured scale, orientation, component regions and pivots, then explicitly selects the prepared GLB for normal private upload and independent review.

Single-image, multi-view and video execution adapters are now connected locally. Native source/frame integrity, actual dense engines and author preparation are covered in the [photogrammetry workflow](photogrammetry-workflow.md). Provisioning/production acceptance still precede enablement. Successful execution is not device-accuracy acceptance; the [single-image fidelity findings](single-image-reconstruction.md) and [multi-view accuracy benchmark](reconstruction-accuracy.md) still apply.

## Source admission and execution

Requests use existing processing_jobs/processing_job_outbox records with type reconstruction.generate. Source admission, job/outbox and request audit are committed in one tenant transaction. Actor-scoped keys give repeat-safe requests; changed inputs cannot reuse a key. An organization advisory lock enforces two active requests during concurrent submission. Replaying a saved request returns its original record, including after source withdrawal; output delivery still checks current source usability.

The snapshot binds source version/checksum, private object key, size/type, approval audit and active derivative-rights attestation. Admission rejects unavailable/wrong-tenant sources, wrong hashes/types/counts/sizes, mixed nonempty product IDs and duplicate versions/content hashes. The worker validates the actual bytes and rechecks source/rights snapshots before and after processing/publication. Withdrawal during inference prevents candidate acceptance. Delivery and prepared import/approval recheck current evidence too.

Queue dispatch reads the persisted job type and separates reconstruction from upload processing. Existing lease fencing protects outcome commit; artifact paths include attempt/generation to prevent an expired worker overwriting accepted results. Reconstruction-capable workers process one message at a time. Receiver renewal is bounded at one hour; see the [Azure SDK option](https://learn.microsoft.com/en-us/javascript/api/@azure/service-bus/servicebusreceiveroptions#maxautolockrenewaldurationinms). Asset-only consumers retain their prior five-minute default.

The adapter creates a checked temporary directory, uses fixed operator-configured executable arguments without a shell, bounds process duration/output and rejects external/symlink results. Cleanup removes only that directory and, on failure, its uniquely named Docker container. The local Docker driver disables networking, mounts source/assets/scripts read-only and limits execution to four CPUs/eight GiB. A Python driver also exists for a provisioned worker image; environment configuration alone does not install its dependencies or provide container isolation.

The worker checks candidate geometry, hash/size/count, source-image hashes and report schema. Completion always requires review. Single-image uncertainty and false geometry/scale verification flags are imposed by the worker. Generated orbit views are not additional source photographs. Candidate, quality JSON and optional foreground/conditioning PNGs are stored as private checksum-bound artifacts. Authenticated tenant-scoped HTTP delivery has bounded reads, no-store and no object-key exposure.

Existing alpha masks are preserved instead of being segmented again. Import rejects a linked single-image preparation that attempts to remove its uncertainty flags. These checks pass alongside close/sign-out cleanup of automatically loaded private files.

## Prepared import linkage

The private report carries the server job ID/source references. Preparation retains the job ID, candidate/report/source hashes and uncertainty. The importer checks these against the completed job and current source approval/rights, stores a server-produced linkage receipt in the manifest and revalidates before approval. Manual/local candidates without a server job retain author-supplied evidence and receive no such receipt.

The receipt verifies the referenced candidate/report/source records. It does not prove arbitrary author-edited geometry is a faithful transformation, that measurements are correct, that regions identify physical parts or that the model is accurate. Independent review remains necessary. Propagating original reconstruction-source withdrawal through already published releases/learner artifacts remains unfinished and must be covered before production enablement.

## Configuration and verification

The API defaults to disabled: collection GET returns no enabled modes and the author panel stays hidden. RECONSTRUCTION_MODES must match a provisioned worker. Single-image configuration: RECONSTRUCTION_ASSETS_DIR, RECONSTRUCTION_SCRIPTS_DIR, optional RECONSTRUCTION_PYTHON (default python3) and RECONSTRUCTION_WORK_DIR. Native photo/video configuration is documented in the photogrammetry workflow. The normal deployed media-worker image lacks these reconstruction dependencies; dedicated packaging, capacity and live rollout remain unfinished. These tests did not change Azure configuration.

Routes: GET/POST /api/v1/reconstructions; GET /api/v1/reconstructions/sources; GET /api/v1/reconstructions/{id}; private candidate, quality, foreground and conditioning-image subresources. Creation requires an author role; reads require a content role. Request bodies contain mode and version/hash references, with an Idempotency-Key header. Client object keys, commands, approval flags or engine settings are rejected.

Run from the workspace root:

```powershell
pnpm reconstruction:validate
pnpm reconstruction:engine:validate
```

Prerequisites are local PostgreSQL/roles, Chrome and generated engine fixtures from [single-image setup](single-image-reconstruction.md). The engine check additionally needs the local Docker image/pinned assets. The first command builds affected packages and checks restricted-role DB/HTTP, atomic admission/outbox/audit, artifact tamper/revocation denial, prepared import linkage, queue routing and Chrome UI. It replays real engine output as a contract fixture. The second performs fresh actual offline CPU inference through the durable processor and the same prepared-import/denial checks.

Private storage is an in-memory port fixture; live Azure Blob/Service Bus transport and deployed browser acceptance are not proven here. Chrome uses fixture HTTP state transitions with real model/photo bytes. Fresh-engine artifacts/job evidence and the author screenshot are under output/reconstruction-workflow/. Test tenants and related DB rows are removed afterward. No live model approval or independent human acceptance is claimed.

Remaining: production engine packaging/deployment and cloud transport acceptance; source-dependency withdrawal propagation; candidate comparison and device-specific fidelity acceptance; actual course/model/learner integration with independent review.
