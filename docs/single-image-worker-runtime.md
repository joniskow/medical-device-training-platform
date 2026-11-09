# Production single-image worker packaging

Single-image reconstruction remains a review-required geometry hypothesis. Packaging does not establish dimensional accuracy, hidden-surface fidelity, clinical suitability, distribution rights or final acceptance.

## Isolated optional image target

The worker Dockerfile now has two release targets:

| Target | Capabilities | Runtime |
|---|---|---|
| `worker` (default) | Multi-view photos and video | Existing OpenMVS/PyCOLMAP/Blender runtime |
| `worker-single-image` | Single image, multi-view photos and video | The same worker plus a separate Python 3.11 TripoSR environment and offline model assets |

```powershell
docker build --file Dockerfile.worker --target worker-single-image --tag medical-device-worker:single-image-candidate .
```

The optional target builds PyTorch CPU 2.6.0 and the separately pinned single-image requirements without replacing the PyCOLMAP environment. TripoSR and torchmcubes check out exact reviewed commits. The existing downloader verifies fixed model/config/U2Net digests; DINO configuration downloads its exact revision rather than following `main`.

The build creates an engine manifest binding dependency versions, every TripoSR Python source hash and code revisions. Both the final target image and worker startup import native extensions, validate dependency versions, check imported code location, verify the complete source manifest and rehash the offline assets. Missing assets or a changed runtime fails startup before queue consumption. Inference runs offline under the existing non-root application user; code and weights are read-only. Native extension compatibility must still be proved by building and executing the exact image on the deployment architecture.

## Deployment order and capability routing

1. Obtain actual distribution/license review and record its evidence. The pinned TripoSR experiment and OpenMVS references do not establish that approval.
2. Build and scan the explicit `worker-single-image` target. Run a rights-cleared accepted capture through it, safe-rejection cases, process cancellation/crash/retry, private transport and model preparation. Record the immutable tested image digest and manifest hash.
3. Deploy that digest with `worker-app-foundation.bicep` parameter `singleImageEnabled=true`. This sets `RECONSTRUCTION_PYTHON=/opt/single-image/runtime/bin/python`, asset/code/manifest directories and `RECONSTRUCTION_MODES=single-image,multi-view,video`. The photogrammetry interpreter remains `/opt/reconstruction-runtime/bin/python`. Startup checks configured modes exactly match the initialized engines.
4. Complete rollout and drain workers that lack single-image capability before configuring the API `reconstructionModes` parameter to `single-image,multi-view,video`. All consumers of this shared queue must support its advertised modes. An old photo/video-only consumer must not race single-image jobs on the same queue.
5. Rehearse rollback by disabling new single-image API admissions first, draining single-image jobs, then rolling back the worker image/config together. Do not advertise a mode that no live worker can execute.

The original signed durable queue, source rights/hash checks, operational reservations, cancellation/fencing, private output and review-required state remain authoritative for every mode. No Docker socket or external inference sidecar is added to the production worker.

## Embedding and cost configuration

Worker IaC also requires `azureEmbeddingEndpoint`, `azureEmbeddingDeployment` and `azureEmbeddingModel` (`text-embedding-3-small` or `text-embedding-3-large`). Provision `azure-embedding-api-key` in the existing vault before deployment. The worker identity receives a secret-specific Key Vault reader assignment and the container receives a secret reference, never a plaintext Bicep parameter. The configured endpoint must be a root HTTPS Azure OpenAI resource and both services use the same approved 1,536-dimension embedding profile.

`sourceUsageRatesJson` defaults to `[]`: measured source units are retained but their monetary cost stays unknown. Supply reviewed versioned rate entries through the existing cost workflow; admission reservations remain separate planning bounds.

## Local verification and evidence limits

```powershell
node tools/check-single-image-runtime-configuration.mjs
node tools/check-single-image-packaging.mjs
node tools/check-photogrammetry-configuration.mjs
```

These checks passed locally. They cover feature/configuration admission, mode mismatch, preflight failure, pinned packaging structure and source/version manifest tampering without installing the inference engine. They do not prove a successful container build or a real capture/inference run. The local Azure CLI could not compile Bicep because its profile was inaccessible under sandbox permissions; compilation must be recorded separately. The exact optional image, native dependency scan, real provider/cloud transport, process-tree recovery and qualified fidelity review remain required acceptance evidence.
