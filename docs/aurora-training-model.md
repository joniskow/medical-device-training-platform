# Detailed synthetic Aurora model

The additive `fixtures/aurora-training/aurora-training.glb` replaces the visual limitations of the tiny reference fixture for new authoring work. Existing fixture hashes and published releases are untouched. It has 1,228 triangles, 52 meshes and ten embedded PBR materials in approximately 88 KB. Geometry includes a rounded enclosure, rear shell, carry grip, feet, ventilation, captive fasteners, screen, three keys, indicators, line guides/tubing, sensor enclosure and a hinged frame with latch and hinge barrels.

The established AIC-C01 (control panel), AIC-C02 (safety cover) and AIC-C03 (line sensor) IDs are retained. Component roots contain multiple meshes. The safety cover root is located at its hinge; positive Y rotation opens it forward. Suggested movement is 0 to pi/2 in pi/12 steps. Geometry uses meters, Y up, right-handed coordinates and a centered bounding box. Buffers, normals and materials are embedded; no external assets are fetched.

Production Babylon rendering now resolves a unique component node and its descendant geometry, applies authoritative transforms to that root and highlights child meshes without replacing the source materials. Ambiguous or overlapping component assemblies fail. The camera near/far planes and zoom limits scale to the model bounds; previously the default one-meter near plane hid small devices.

The three control keys carry stable interaction-target metadata and bounded
4 mm local press depth. The Blender authoring scene includes short
press/release clips for visual review; the browser runtime handles pointer
capture, release, cancellation, and local feedback while semantic scoring stays
server-authoritative. The Chrome evidence exercises Prime, Ready, and Stop
independently.

Build: `pnpm aurora-model:build`. Verify: `pnpm aurora-model:validate` (requires local Chrome and permission to launch an isolated browser). Structural verification checks every triangle's indices, winding, nonzero area and normal length, bounds, component IDs, embedded buffers and manifest hash. Chrome loads the actual GLB through the production adapter, captures closed/open views, checks original material retention, whole-cover movement, stationary surrounding geometry, selection and console errors. Evidence is in `output/aurora-training/`.

Upload this as a new GLB through the existing private author workflow. Configure and review its imported interaction limits, then bind the approved model to the draft course. The generated manifest is local preview/authoring metadata, not an approved release. No live upload, approval, publication or clinical fidelity acceptance has been performed for this model.

This is an authored fictional training device. It does not reproduce a real manufacturer's geometry or prove image/video reconstruction. Reconstruction remains open and requires its own source set, adapter and quality acceptance. Existing reference images/video are schematic drawings and a static three-second clip; they do not supply multi-view geometry.

Media review and learner media delivery already have source code in this workspace. On 2026-10-31, restricted-role PostgreSQL/HTTP checks passed for media review (`tools/check-media-review.mjs`) and learner access (`tools/check-media-assets.mjs`). These establish permissions/hash/release boundaries, not deployed browser acceptance. The development database container `local-postgres-1` was started for these checks and remains running.
