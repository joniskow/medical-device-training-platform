# Local image and video reconstruction

Accuracy follow-up: `docs/reconstruction-accuracy.md` records a newer full-resolution/uncropped profile and quantitative component-level measurements. New source/camera/geometry-profile resume checks intentionally reject cached runs with incompatible or unrecorded cropping settings. Earlier successful resumes described below used the earlier engine profile; create a fresh run when moving to the accuracy-focused profile.

The workspace now has an actual CPU photogrammetry prototype at `tools/reconstruction/`. It runs PyCOLMAP 4.0.1 for camera recovery and sparse geometry, then the official OpenMVS 2.4.0 Windows CPU release for dense geometry, meshing and texturing. This is a local engine benchmark, not the deployed application's reconstruction job implementation or an approved production engine choice.

## Observed evidence, 2026-10-31

| Input | Registered views | Mean reprojection error | Triangles | Self-contained GLB | Open boundary edges |
|---|---:|---:|---:|---:|---:|
| 48 synthetic Aurora photos, two elevations | 48 / 48 | 0.311 px | 154,565 | 6,101,972 bytes | 31 |
| Synthetic orbit video, full-resolution extraction | 24 / 24 | 0.275 px | 96,205 | 4,144,164 bytes | 63 |

Both candidates contain one 2048-pixel texture atlas, zero detected degenerate triangles and zero detected non-manifold edges. Edge accounting welds positions rounded to six decimal places in the unscaled reconstruction coordinate system. These diagnostics do not establish surface completeness or training suitability. Successful stage wall-clock totals were approximately 152 seconds for photos and 73 seconds for video on this workstation; these exclude earlier failed texture experiments and preparation. Four CPU threads are requested for reconstruction. Target-device frame rate, full pipeline memory enforcement, deployment cost and pilot performance are not proven.

The source captures were rendered from the authored fictional Aurora GLB at 1920 x 1080 with seeded synthetic surface detail. `capture-aurora.mjs` renders 24 azimuths at each of two elevations. The original GLB and camera poses are not passed to the reconstruction engine. The video benchmark encodes the first orbit as H.264, extracts 24 full-resolution views in the network-disabled worker container, then runs the same engine. It is a controlled synthetic benchmark, not evidence for ordinary customer photography or clinical-device fidelity.

Evidence directories:

- `output/reconstruction-capture/`: source photos, capture hashes and synthetic orbit video.
- `output/aurora-reconstruction-01/`: photo reconstruction, quality report and front/back screenshots.
- `output/aurora-video-views/`: full-resolution video frames, original video hash and timestamps.
- `output/aurora-video-reconstruction-01/`: complete video reconstruction, quality report and screenshots.

The quality report records source image hashes, camera registration, stage times, candidate checksum/size/geometry/bounds, texture memory and release-blocking warnings. The newer video run also records pipeline/executable fingerprints and video-to-frame provenance. The first photo run began before executable fingerprints were added; its earlier stages have native version logs but do not have retroactively invented executable hashes.

## Running locally

Create the isolated Python environment and install `tools/reconstruction/requirements.txt`. The environment used here is `output/reconstruction-runtime/`. The official CPU OpenMVS ZIP is installed in `output/openmvs-v2.4.0/vc17/x64/Release/`; its release archive SHA-256 is `0c31660c15c9ebc4c106873cf67564d9570d404aef7a6403451da1b6178b2167`. Dependencies are not installed into the application's worker or global Python.

Capture a new synthetic benchmark:

```powershell
node tools/reconstruction/capture-aurora.mjs output/new-capture
```

Run reconstruction with a new output directory:

```powershell
output/reconstruction-runtime/Scripts/python.exe tools/reconstruction/reconstruct.py --images output/new-capture/images --output output/new-reconstruction --openmvs-dir output/openmvs-v2.4.0/vc17/x64/Release
```

Inspect the generated GLB through actual Babylon/Chrome rendering:

```powershell
node tools/reconstruction/preview-candidate.mjs output/new-reconstruction
```

`--resume` requires an existing terminal report and the same original source hashes; it reuses completed stages. `--rerun-texture` with `--resume` explicitly repeats texturing after a settings repair. This is a local prototype resume mechanism, not durable multi-worker lease/idempotency handling. Intermediate output integrity and engine/configuration compatibility need stronger fences before application integration. A new output directory is required for a normal run.

`video_views.py` requires FFmpeg and FFprobe. It accepts bounded H.264 MP4 or VP8/VP9 WebM, validates the stream profile and full decoding, and extracts 20-100 full-resolution frames with timestamps and hashes. It rejects fewer than 20 distinct byte hashes or insufficient temporal coverage. `reconstruct.py` checks the sibling `video-views.json` against the selected image hashes and preserves the video lineage in the reconstruction report. The 640-pixel media-review thumbnails are not substituted for these full-resolution inputs.

Input profile: 20-100 still images, stable single-camera dimensions after EXIF orientation, minimum 1080 pixels on the short axis, maximum 4096 on each axis, at most 25 MiB per image and 1 GiB total. The engine cannot automatically prove scene continuity, no people, suitable lighting, complete view coverage or a trustworthy scale reference from these checks.

## Texture repair and candidate limitations

OpenMVS's default global/local seam correction produced black and false-colored surface regions on the synthetic benchmark. Visual inspection caught this despite successful geometry checks. Disabling both corrections preserved source appearance. The pipeline now records these settings and always requires texture review. The failed photo result is retained as `candidate-seam-failed.glb` and `preview-seam-failed.png` for comparison.

Packaging embeds engine texture files into one GLB, removes local paths from texture names, rejects external buffer sources and texture paths outside the run directory, checks accessor/index bounds and finite positions, counts topology issues and rejects degenerate or oversized geometry. It does not invent component IDs or infer metric scale. The source's authoring components have not been recovered or segmented. The carry grip and fine features still require fidelity review, and the surfaces have open boundaries.

The report remains `REVIEW_REQUIRED`, with `approvedForScoredUse=false`. Warnings cover unknown scale/orientation, component mapping, completeness, texture review, boundary edges and pending engine-license review. Browser screenshot views are arbitrary oblique views of the reconstruction coordinates, not verified anatomical/device front/back orientation.

## Verification and remaining integration

`check_capture.py` exercises unsupported counts, duplicates, inconsistent dimensions, video source-evidence mismatch and resume source conflicts. `check_candidate.py` exercises real geometry measurement, local texture embedding, external resource/path rejection and corrupt accessor/header rejection. Both pass in the isolated environment. Actual image and video engine runs and actual Chrome rendering supplement those checks; no mocked geometry is used as engine acceptance.

The application still needs durable reconstruction requests/worker routing, approved-source resolution, usage/concurrency control, candidate storage and comparison UI, verified scale/orientation, component segmentation/mapping, model-import promotion and independent review. Existing manual GLB import remains available. No customer source, live database model, published release or Azure deployment was changed by this spike.

OpenMVS 2.4.0's source license is AGPL-3.0; its binaries and transitive dependencies require review before production distribution or network integration. The benchmark does not approve that choice. The planned AliceVision comparison and the full notices/SBOM remain outstanding.

Primary references: [PyCOLMAP API/install](https://colmap.github.io/pycolmap/index.html), [OpenMVS v2.4.0 release](https://github.com/cdcseacave/openMVS/releases/tag/v2.4.0), [OpenMVS license at v2.4.0](https://github.com/cdcseacave/openMVS/blob/v2.4.0/LICENSE), [OpenMVS import implementation](https://github.com/cdcseacave/openMVS/blob/v2.4.0/apps/InterfaceCOLMAP/InterfaceCOLMAP.cpp).
