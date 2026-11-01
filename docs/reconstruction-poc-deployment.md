# Reconstruction POC deployment

## Decision

The POC uses operator-assisted reconstruction from photo sets only. The server generates a candidate and quality report; an author prepares it; a separate reviewer approves or rejects it before scored use. Video and single-image generation remain out of the POC acceptance path.

## Azure assets

- Subscription: `MTraining` (`e30f800a-473e-4040-9622-6ea38413c991`)
- Resource group: `rg-medical-device-personal`
- Worker: `mdt-personal-worker`, revision `mdt-personal-worker--0000023`
- Worker image: `mdtpersonalacr01.azurecr.io/worker:personal-20261031-photo-reconstruction2`
- API: `mdt-personal-api`, revision `mdt-personal-api--0000026`
- API image: `mdtpersonalacr01.azurecr.io/api:personal-20261031-photo-reconstruction1`
- API URL: `https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io`

The worker is configured for one reconstruction at a time with 4 CPU and 8 GiB memory. Its reconstruction runtime is `/opt/reconstruction-runtime/bin/python`, its OpenMVS directory is `/opt/openmvs`, and its working directory is `/tmp/reconstruction`. Blob storage and queue/database secrets remain managed by Azure identity and Key Vault; no secrets are stored in the image or workspace.

## Azure API flow

The complete authenticated handoff is:

1. `POST /api/v1/organizations/{organizationId}/assets/upload-sessions` once per photo.
2. `PUT /api/v1/upload-sessions/{uploadSessionId}/content`, then `POST /api/v1/upload-sessions/{uploadSessionId}/complete` for each photo.
3. After source processing, review and rights attestation, `POST /api/v1/reconstructions` with 20–100 approved source references.
4. Poll `GET /api/v1/reconstructions/{jobId}` or `GET /api/v1/jobs/{jobId}` until the durable job reaches `REVIEW_REQUIRED`.
5. Retrieve the private `candidate` and `quality` routes from the reconstruction detail and open the candidate in the Babylon workbench.

The worker revision targeted by the current source changes adds a required headless Blender stage between photogrammetry and artifact publication. It imports the reconstructed GLB, exports a self-contained GLB, records Blender input/output hashes and version in `quality.json`, validates the exported candidate, and stores it privately. The currently deployed revision listed above predates that Blender stage and must not be described as completing it.

## Validation evidence

The worker image completed an actual 48-photo run with all 48 views registered. The output candidate was private/self-contained and had 176,844 triangles, 115,322 vertices, zero degenerate triangles, zero non-manifold edges, and `REVIEW_REQUIRED` status. The run retained the required uncertainty flags: scale and component mapping were not verified.

The live worker emitted `worker_started`; the live API emitted `api_started`; and the public API health endpoint returned HTTP 200. The API exposes multi-view reconstruction mode through `RECONSTRUCTION_MODES=multi-view`.

## POC acceptance checklist

1. Upload or select one approved photo set through the authenticated browser UI.
2. Create a multi-view reconstruction request and observe the durable job reach `REVIEW_REQUIRED`.
3. Author compares the candidate, records scale/orientation/component mapping, and prepares the candidate.
4. A different reviewer inspects the prepared candidate and quality report and records approval or rejection.
5. Bind one approved model to one pilot course and verify the learner can load it without public Blob access.
6. Record runtime, failure, and cost observations for the chosen photo-set profile.

## Rollback

Container Apps keeps prior revisions. Roll back by restoring the previous worker image/revision and previous API image/revision; do not delete private candidate artifacts or database lineage. The worker can also be disabled by removing `RECONSTRUCTION_MODES` from the API configuration while keeping existing review records intact.

## Open decisions before broader use

- Obtain written OpenMVS AGPL/license review for the intended distribution and hosting model.
- Set acceptance thresholds for scale, orientation, component mapping, coverage, and dimensional error on real device captures.
- Decide whether the POC remains CPU-only or adds a GPU worker after measuring queue time and Azure cost.
- Define how a reviewer compares multiple candidates and what evidence is required before scored use.
