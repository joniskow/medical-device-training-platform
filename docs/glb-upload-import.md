# GLB upload and import

Browser upload accepts .glb files and sends model/gltf-binary even when the OS does not supply a MIME type. The deployed worker routes GLB sources through the real importer instead of the pilot smoke adapter.

The importer reads private bytes (64 MiB processing cap), verifies the source checksum/tenant path, builds a model manifest using the existing GLB parser, rejects external resources and invalid component IDs, saves the manifest privately, and persists a REVIEW_REQUIRED model and component records through the tenant-scoped database. The model ID derives from the immutable source asset version, so job retries preserve records and review state. Source bytes remain immutable; this path does not automatically approve a model.

Current supported inputs are self-contained component-tagged GLBs. General model component labeling, transform/interaction authoring, normalization and optimized variant generation remain incomplete in this import path. In particular, the existing manifest builder's coordinate metadata is not proof of normalized geometry. Reviewer UI and private model delivery must be completed before using imported models for certification simulations.

Checks: full build, architecture boundaries, tools/check-glb-import.mjs with real reference GLB and restricted database role. The fixture verifies three components, artifact persistence, repeat-safe import, review-only state and checksum/tenant rejection. Live deployment evidence is tracked in tasks/current-delivery.md.

Deployment prepared: worker personal-20261030-glb1 digest sha256:855e21a3706c613b1adeba92c4046bf3cda511fca7a48d767874834e059e201b; API personal-20261030-glb1 digest sha256:b6a01a89c029615cab14d1fafa4786a4b278bfb00543878bec18d4087a205d23. Worker revision mdt-personal-worker--0000019 is healthy. API revision mdt-personal-api--0000020 is activating; browser acceptance remains pending until it serves the new upload form.

Live acceptance: both revisions became Healthy. Browser uploaded the reference GLB and job job_asset_process_assetv:a0e6e14c-da26-4207-ba48-08d36a4775b6 completed SUCCEEDED / REVIEW on attempt 1 with MODEL_REVIEW_REQUIRED. Screenshot output/live-glb-import-20261030.png. Import is verified; model review UI, private delivery and course simulation acceptance remain open.
