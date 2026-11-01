# Single-image candidate experiment

This local CPU path uses the official [TripoSR inference and extraction implementation](https://github.com/VAST-AI-Research/TripoSR/blob/107cefdc244c39106fa830359024f6a2f1c78871/run.py). It produces a colored surface hypothesis from one photograph. It cannot establish unseen shape, metric dimensions, component boundaries, readable labels or mechanical behavior. Increasing extraction resolution does not recover evidence absent from the image. This is a baseline to evaluate, not a claim that TripoSR is the most accurate available engine or that a particular device is reproduced accurately.

Code revision `107cefdc244c39106fa830359024f6a2f1c78871`, model revision `5b521936b01fbe1890f6f9baed0254ab6351c04a`, official checkpoint SHA-256 `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`. The checkpoint hash is taken from the publisher's [LFS metadata](https://huggingface.co/stabilityai/TripoSR/blob/5b521936b01fbe1890f6f9baed0254ab6351c04a/model.ckpt). The official project describes MIT licensing for code and weights. The pinned marching-cubes dependency is built from its real CPU implementation, not replaced with a geometry stub. Dependency versions and asset hashes are recorded per candidate. This CPU experiment accommodates the local Windows/AMD hardware without claiming CUDA acceleration.

The isolated image uses Python 3.11.11 and CPU PyTorch 2.6.0. TripoSR's Transformers 4.35.0 APIs are retained. The separate PyCOLMAP environment is unchanged. Original dependency/source licenses remain in the image. Model/configuration files are downloaded from the official public repositories during setup; user media is not uploaded. Inference is intended to run with `--network none`, a read-only asset mount, restricted CPU/memory and a 900-second subprocess timeout. Public asset download is a separate operation with network access. A model/tokenizer revision change fails setup rather than silently changing inference.

Input admission supports one PNG/JPEG/WebP, 25 MiB maximum, 256–4096 pixels per dimension, no animation. An existing alpha mask is preserved, including in automatic mode, rather than segmented again. `--background provided-alpha` additionally requires a supplied mask. Opaque images use U2Net for an automatic foreground mask requiring visual review. Empty, tiny and edge-clipped foregrounds are rejected. The full-size `foreground.png` is retained so missing tubing, transparent covers or small parts can be identified before trusting the result. Cropping, 85% foreground framing and gray compositing follow the upstream conditioning convention. The network conditions on 512 pixels; a higher-resolution source cannot make fine labels trustworthy.

Outputs include original input hash, normalized input/mask hashes, preprocessing bounds, engine/assets/dependency versions, settings, inference log, raw GLB, self-contained `candidate-private.glb` and `quality.json`. Failures leave a terminal rejected report. Output directories must be new. Geometry packaging checks finite vertices, indexed triangles, degeneracy, edge topology, bounds, size and external resources. Vertex colors are retained; no texture or surface-detail accuracy is implied by their presence. Only a redundant identity scene transform is removed for preparation compatibility; nonidentity transforms fail export.

The existing local author workbench opens the matching GLB/report, displays single-image warnings and supports measured scale, orientation, explicit component regions and pivots. The prepared manifest retains `single-image-generative-hypothesis` and false verification flags even after scale normalization. Those warnings survive real worker/database/API import and appear in model review. Preparation evidence is author-supplied; it is not server-verified source lineage, dimensional acceptance or independent approval. Generated orbit views are never counted as additional source photographs.

## Local commands

Run from the repository root. Docker must be running. Setup downloads roughly 1.7 GB of TripoSR weights plus background-removal assets and dependencies.

```powershell
docker build -f tools/reconstruction/Dockerfile.single-image -t medical-device-reconstruction:single-image tools/reconstruction
$assetRoot = (New-Item -ItemType Directory -Force output/triposr-assets).FullName
$checkRoot = (Resolve-Path tools/reconstruction).Path
docker run --rm --memory 6g --cpus 4 --mount "type=bind,source=$assetRoot,target=/assets" --mount "type=bind,source=$checkRoot,target=/checks,readonly" --entrypoint python medical-device-reconstruction:single-image /checks/single_image_assets.py --assets /assets

node tools/reconstruction/capture-aurora.mjs output/single-image-capture --single-image
$photoPath = (Resolve-Path output/single-image-capture/images/view-003.png).Path
$runRoot = (Resolve-Path output).Path
docker run --rm --network none --memory 8g --cpus 4 --mount "type=bind,source=$assetRoot,target=/assets,readonly" --mount "type=bind,source=$checkRoot,target=/checks,readonly" --mount "type=bind,source=$photoPath,target=/input/source.png,readonly" --mount "type=bind,source=$runRoot,target=/runs" medical-device-reconstruction:single-image --image /input/source.png --output /runs/aurora-single-image-example --assets /assets
node tools/reconstruction/preview-candidate.mjs output/aurora-single-image-example
```

Use a new run name for each candidate. Review `foreground.png`, `input.png`, the source photograph and the generated surface together. Prefer measured, overlapping photographs or video frames when available. See [the quantitative multi-view benchmark](reconstruction-accuracy.md); its millimeter results must never be attributed to this single-image path. Durable server job submission, source lineage, candidate comparison, deployment, real device validation and any scored-use acceptance remain separate work.

Checks: `check_single_image.py` tests silhouette/hole preservation and rejects missing/clipped/empty/tiny masks. `check-candidate-preparation.mjs` tests uncertainty retention from both GLB metadata and the report-driven preparation input. Actual Chrome and worker/PostgreSQL/HTTP checks verify visible warnings and persistence through export/import. An actual engine run, browser render and human fidelity inspection are additionally required; unit checks alone do not establish successful reconstruction.

## Actual local run, 2026-10-31

The clean oblique original-material Aurora image completed real offline CPU inference in 66.79 seconds including foreground processing, producing 158,788 triangles, 79,527 vertices and a 4,133,952-byte self-contained vertex-colored GLB. Candidate SHA-256 `fb951429c7a3c59fa8c54a1b5946efaf3ad0a327a9e27ec8d1c226067b469ef3`. Artifacts: `output/aurora-single-image-clean-01/`. Actual Chrome rendered the mesh and prepared it in the author workbench. The material declaration was made explicit because an implicit Babylon default material otherwise disagreed with the manifest and prevented preparation preview. The official Z-up engine convention is suggested in the orientation controls and used by the raw preview; device orientation still requires confirmation. Four cardinal views supplement the older arbitrarily named front/back snapshots.

Visual inspection found recognizable housing, panel, button colors, handle and cover, but rounded/distorted openings, cover edges and small controls. There are 24 position-welded boundary edges and eight non-manifold edges. `fidelity-review.json` explicitly records `deviceFidelityAccepted=false`, no dimensional measurement and no independent human approval. The hidden back has no photographic evidence. This result does not satisfy the user's maximum-accuracy requirement by itself; additional evidence and stronger reconstruction/validation remain necessary.

The earlier front-on noise-textured photogrammetry input also produced a real 108,900-triangle candidate at `output/aurora-single-image-01/`, retained as a comparison. It exposed the original implicit-material preview failure; it is not the corrected preparation acceptance artifact. The clean-image experiment changes view and appearance together, so no isolated causal or quantitative accuracy gain is claimed.
