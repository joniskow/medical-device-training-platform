# Durable multi-view and video reconstruction

The saved reconstruction workflow now runs multi-view photo sets and videos through the actual CPU PyCOLMAP/OpenMVS pipeline. Each result goes through private artifact delivery, source comparison, measured preparation and review-required GLB import with server-checked source/report linkage. The native adapter always selects the high-detail profile, disables estimated ROI/cropping/tower assumptions and retains the earlier texture seam correction fix.

Photo jobs accept 20–100 distinct approved images. Video jobs accept one approved H.264 MP4 or VP8/VP9 WebM, decode it fully, sample 20–100 full-resolution frames and use the same reconstruction pipeline. The review gallery's 640-pixel thumbnails are never engine inputs. Eight evenly spaced full-resolution video frames are stored privately with their original frame hashes/timestamps; photo preparation loads up to eight evenly distributed original photographs. These become matching reference images in the workbench, which checks their hashes against the engine report.

The worker validates the full-resolution capture profile, high-detail geometry/texture settings, final bundle adjustment, recovered camera count/centers, nonzero camera baseline, reprojection threshold and video frame-to-input/time correspondence. It verifies video-view PNG dimensions/hashes against the original engine inputs. Candidate/report/view paths are bound to the job attempt and lease generation. Frame delivery uses `/api/v1/reconstructions/{id}/views?index=0` through `7`, with content-role authorization, tenant/source checks, bounded reads, checksums and no-store. Malformed indexes, tampered bytes and withdrawn source rights are denied.

## Camera refinement and benchmark evidence

Fresh integration testing exposed a pose regression despite the same source/calibration/detail settings: the initial 48-view job had 3.73 mm reference-camera RMSE and 1.32 mm mean reconstructed-surface error. Reprojection error and camera-registration success alone did not expose the dimensional consequence. That candidate is retained at output/photogrammetry-workflow/multi-view/.

A controlled camera probe starts from the same reconstructed sparse model and evaluates alternatives after modelling. Reference poses are used only to score results, never as optimizer inputs. Results in output/sfm-refinement-01/refinement.json:

| Adjustment | Camera RMSE |
|---|---:|
| Incremental result | 3.69 mm |
| Final ordinary bundle adjustment | 0.78 mm |
| Final soft-L1 bundle adjustment | 0.48 mm |
| Final Cauchy bundle adjustment | 0.27 mm |

The pipeline now performs a bounded final Cauchy adjustment of camera poses/points before undistortion and dense reconstruction, using [PyCOLMAP 4.0.1's documented API](https://colmap.github.io/legacy/4.0/pycolmap/pycolmap.html#pycolmap.bundle_adjustment). Known intrinsics remain fixed; otherwise focal/distortion parameters are estimated and principal point remains fixed. Loss scale, solver limits, pre/post reprojection and the revised SfM profile are recorded. Cached runs from a different SfM profile cannot resume silently. The probe's original pipeline snapshot and provenance hashes are retained alongside its sparse models.

Fresh full dense runs with that adjustment, followed by independent exact sampled nearest-triangle auditing:

| Calibrated synthetic input | Photos | Video |
|---|---:|---:|
| Registered cameras | 48/48 | 24/24 |
| Candidate triangles | 502,001 | 416,087 |
| GLB bytes | 16,096,888 | 13,424,636 |
| Reference-camera RMSE | 0.27 mm | 0.48 mm |
| Reconstructed-to-reference mean | 0.54 mm | 0.72 mm |
| Observed reference coverage within 2 mm | 90.2% | 85.9% |
| Observed reference p95 distance | 7.95 mm | 10.26 mm |

These surface results come from separate fresh runs; feature/mapping scheduling can vary. The controlled camera probe isolates the effect of refinement on one sparse model. Thin/occluded regions remain incomplete: the means do not establish full-device dimensional fidelity. The earlier independent 48-view benchmark's 0.56 mm mean/90.4% coverage remains valid historical evidence, not a universal guarantee.

The source images are synthetic Aurora renders with seeded surface detail for feature matching. The clip is generated from those renders. Tests use known renderer intrinsics restricted to the recorded image/clip hashes, with no reference geometry or camera poses supplied to the engine. Real device photography and the production default's estimated-camera performance still require separate fidelity acceptance. The API does not yet accept per-request camera calibration. Source measurements, orientation, actual component segmentation, pivots and independent review remain necessary.

## Runtime and checks

Worker configuration supports separate single-image and photogrammetry Python environments. Native photo capability requires PHOTOGRAMMETRY_PYTHON, PHOTOGRAMMETRY_OPENMVS_DIR and RECONSTRUCTION_SCRIPTS_DIR. Video capability additionally requires both PHOTOGRAMMETRY_FFMPEG and PHOTOGRAMMETRY_FFPROBE. Partial video configuration fails startup. RECONSTRUCTION_WORK_DIR selects an isolated temporary root. Local tests can use an offline, read-only-source Docker video decoder followed by the Windows native reconstruction tools. The API's RECONSTRUCTION_MODES must match the provisioned worker capabilities; its default remains disabled.

Fixed argument lists avoid shell input. Process timeout/output limits kill the complete owned process tree before temporary-input cleanup; a direct process-tree test verifies that a child does not survive timeout. The existing one-at-a-time reconstruction worker limit remains. Full profile capacity and production isolation still need acceptance in a provisioned worker image. Explicit local benchmark retention preserves logs, sparse camera/point models and output hashes; application jobs retain private candidate/report/view artifacts instead of host paths.

```powershell
pnpm photogrammetry:validate
pnpm photogrammetry:benchmark:photos
pnpm photogrammetry:benchmark:video
```

The first command builds all affected packages and runs the single-image regressions, analytical/native-adapter/process/configuration checks, restricted PostgreSQL/HTTP/import checks using generated fixtures, and Chrome for photo/video preparation. Benchmark commands perform fresh actual inference using the fixed synthetic calibration. They require the existing local PostgreSQL, isolated Python runtime, checksum-verified OpenMVS 2.4.0 tools, media-worker Docker image and recorded capture fixtures. They must not be repurposed as calibration for customer photographs. Output folders are output/photogrammetry-refined/multi-view/ and video/. The pre-refinement runs remain in output/photogrammetry-workflow/.

Actual engine runs, private HTTP delivery, eight video PNGs, textured preparation/import linkage and withdrawal/tamper denial pass locally. Chrome renders both actual models and opens eight matching references. UI state transitions use fixture HTTP; source bytes/models are real generated artifacts. Storage is an in-memory port fixture, and test tenants are removed afterward. Azure Blob/Service Bus transport, runtime packaging/deployment, original-source withdrawal propagation through published releases, candidate comparison, real-device fidelity and end-to-end course/learner acceptance remain unfinished. OpenMVS's recorded AGPL license/production engine decision remains open. No live configuration or approval changed.
