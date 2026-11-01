# Reconstruction accuracy requirements and benchmark

The [durable photo/video workflow](photogrammetry-workflow.md) now retains recovered cameras and supports auditing after temporary engine files are cleaned. Fresh integration runs exposed a pose regression, addressed by a final Cauchy bundle adjustment evaluated independently of reference geometry. Its calibrated 48-view dense result has 0.54 mm mean surface error and 90.2% observed coverage within 2 mm; the refined video result has 0.72 mm mean and 85.9% coverage. Thin/occluded gaps remain. These are separate synthetic experiments, not real-device acceptance or guarantees about individual points.

The user explicitly requested maximum accuracy from an image. Geometric fidelity, metric scale, component shape and evidence for hidden surfaces are required review concerns. Camera registration, a plausible rendering or a low reprojection error do not establish those properties. A single photograph does not observe invisible geometry; any single-image hypothesis must retain uncertainty and cannot silently become an exact scored-device model. The photogrammetry engine requires multiple overlapping views. A separate [local single-image hypothesis path](single-image-reconstruction.md) now runs actual TripoSR inference and preparation; its dimensional/device fidelity is not accepted and its integration into durable server jobs remains unfinished.

## Reference audit

`tools/reconstruction/measure_accuracy.py` measures actual reconstructed geometry against a known synthetic reference GLB. It aligns coordinate systems by a similarity transform fitted to known camera centers after reconstruction. It does not deform the reconstructed shape or fit its geometry to the reference. Source poses and geometry are not supplied to SfM. The reference capture includes the actual inverse Babylon import-root transform and projection intrinsics, avoiding assumptions about handedness. Re-rendered reference images matched the original 48 engine inputs byte-for-byte.

The audit uses seeded area-weighted samples and exact nearest-triangle distances in both directions. Search acceleration groups triangles by radius and expands centroid-neighbor queries until the remaining-distance bound proves the nearest triangle has been found. Analytical distance checks, random comparisons against exhaustive search, similarity recovery and ray-based visibility checks pass in `check_accuracy.py`.

Both all-surface and visible-surface reference coverage are retained. Visibility is tested against reference geometry from the actual source cameras with ray/triangle occlusion checks, including back-face rejection. This separates surfaces that the photographs can observe from buried or hidden reference faces. Component metrics measure reference component proximity to the entire reconstructed surface, not correctness of component segmentation or mechanical operation. Finite sample metrics do not prove every surface point.

Results are written beside each reconstruction in `accuracy.json`. The report includes camera alignment error, mean/p95/max sampled surface distances, coverage within 1/2/5 mm, and individual control-panel/cover/sensor metrics. It is benchmark evidence, not a production accuracy threshold or issuer approval.

## Findings from the initial image reconstruction

For the original 48-photo run, reconstructed-to-reference mean distance was approximately 1.62 mm and p95 3.58 mm. This alone hid missing geometry. Visible-reference-to-reconstruction mean distance was approximately 4.19 mm and p95 23.63 mm. The visible safety-cover reference had only about 29% of samples within 2 mm, versus about 78% for the control panel. These results do not meet the intended fidelity objective.

Inspection found that OpenMVS's default estimated-region crop removed 10,588 dense points in that run. Default tower-mode assumptions and automatic cropping are inappropriate hidden assumptions for small device components. New runs explicitly disable estimated ROI, ROI cropping and tower mode. The high-detail profile retains source-image resolution up to the admitted 4096-pixel dimension limit instead of forcing the earlier 1536-pixel undistortion ceiling. These changes must be judged by measured fidelity rather than triangle count.

Optional `--camera-calibration` accepts known pinhole intrinsics and records their hash. It fixes those parameters during reconstruction. The supplied Aurora calibration is for the synthetic renderer only, not a real camera. Metric scale still requires an external measured reference. Resume rejects a calibration or geometry-profile mismatch rather than silently reusing depth maps generated with different cropping/resizing assumptions.

A calibrated higher-resolution run retaining the old crop produced a denser mesh but still missed substantial safety-cover geometry. That intermediate result is kept at `output/aurora-reconstruction-calibrated-high/`; it is not presented as a successful accuracy fix.

The separate full-resolution, uncropped run completed at `output/aurora-reconstruction-accuracy-full/`, producing a 16 MB, 500,187-triangle GLB. Actual Chrome rendering passed. Reference auditing measured:

| Metric | Initial photo run | Full-resolution uncropped calibrated run |
|---|---:|---:|
| Reconstructed-to-reference mean | 1.62 mm | 0.56 mm |
| Reconstructed-to-reference p95 | 3.58 mm | 2.69 mm |
| Observed reference coverage within 2 mm | 54.5% | 90.4% |
| Observed control-panel coverage within 2 mm | 77.8% | 99.3% |
| Observed safety-cover coverage within 2 mm | 29.4% | 85.5% |
| Observed sensor coverage within 2 mm | 57.4% | 90.6% |

This is a measured improvement across the combined configuration changes, not proof that every change independently caused the gain. Some observed reference regions remain far from the reconstructed surface (overall observed-reference p95 about 7.94 mm, maximum sampled distance about 31.1 mm). Hidden geometry, real camera calibration, actual component segmentation, mechanical pivots and customer-image accuracy remain unproven. No exact-model or certification acceptance is claimed. Native logs report about 2.3 GB peak memory for the high-detail dense stage; this is an offline desktop benchmark, not acceptance inside the current CPU worker's smaller test memory limit.

Example command (requires a capture with known cameras and a reference model):

```powershell
output/reconstruction-runtime/Scripts/python.exe tools/reconstruction/measure_accuracy.py --run output/aurora-reconstruction-01 --capture output/reconstruction-accuracy-capture/capture.json --reference fixtures/aurora-training/aurora-training.glb
```

The same tool audits the video benchmark with the explicit synthetic source frame-rate correspondence `--video-fps 4`. Customer photography needs appropriate measured references and validation data; these synthetic camera correspondences cannot be assumed for it. Target dimensional tolerances must ultimately be defined per device/component and intended activity rather than inferred from a generic model-quality score.
