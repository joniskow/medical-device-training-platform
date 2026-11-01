# Candidate preparation workbench

The [durable reconstruction workflow](reconstruction-workflow.md) now opens private candidates/reports and matching source photographs directly here. That path retains a reconstruction job ID for server-checked candidate/report/source linkage at import and approval. Local/manual files retain author-supplied evidence without a server linkage receipt. Neither path establishes physical device fidelity automatically.

The author upload section now has a lazily loaded **Prepare reconstruction candidate** workbench. It accepts a local single-surface reconstructed GLB and its matching `reconstruction-quality.v1` report. The candidate checksum must match the report. Supported source geometry is a static, untransformed, indexed triangle mesh with embedded textures; unsupported transformations, external images/buffers and malformed attribute/index bounds reject.

Authors can compare up to eight photographs whose content hashes occur in the source report, pick or enter two measurement points and a known distance, choose source up direction and yaw, and mark real component regions by brush or keyboard triangle IDs. Regions cannot overlap. Undo and clear support corrections. Each component has an explicit pivot. Unassigned geometry remains present and noninteractive.

Preparation applies the measured uniform scale, orientation correction and bounding-box centering to actual geometry, transforms normals, compacts each component's vertex/UV data and preserves source texture bytes. It retains all original triangles exactly once. Component geometry is placed relative to its pivot so rotation in the model runtime uses that authored pivot. It does not infer component identity, unseen geometry or clinical correctness from names.

The author must confirm preparation before preview/export. Changed measurements or region edits invalidate the preview and confirmation. The prepared preview uses the production Babylon adapter. **Use prepared GLB in upload form** selects a local file in the existing form; it does not upload, publish or approve automatically. The author then uses the normal private upload, processing and model-review flow.

Source candidate/report/image/video fingerprints, measurement reference, correction rationale, region sizes and pivot choices are embedded as author-supplied evidence. The importer preserves that evidence in the model manifest. The reviewer sees the measurement/reference/orientation/rationale and can inspect provenance fingerprints. Those assertions do not replace server-resolved original-source lineage; durable reconstruction-job integration is still required for that.

Textured import now computes embedded-image SHA-256 values and texture counts in model manifests. Private content remains checked against the whole-model checksum. Author preparation remains `approved:false`; only the review decision changes model status. The creator and latest interaction editor cannot approve the model themselves, even if their principal also has reviewer privileges. Approved models retain existing immutability rules.

## Verification

- `pnpm candidate-preparation:validate`: exact measured scale/orientation, pivot-preserved world geometry, transformed normals, texture/UV retention, deterministic output, remainder geometry, invalid/overlapping regions and unsupported resource rejection.
- `pnpm candidate-workbench:validate`: web/API/worker builds, isolated Chrome workflow, actual API lazy-module route, restricted-role PostgreSQL/worker/HTTP import of the browser-exported GLB, texture/evidence persistence, private content/tamper/tenant boundaries and separate reviewer enforcement. Requires local PostgreSQL/Chrome and the prior actual reconstruction fixture at `output/aurora-video-reconstruction-01/`.
- Existing GLB import, author model preview and model-route regressions pass.

Chrome exercises pointer marking, keyboard mapping, overlap rejection, undo, explicit handoff, responsive layout and sign-out cleanup. It renders the actual 96,205-triangle reconstruction as well as a tiny exact geometry fixture. The test regions/measurements are explicitly synthetic test choices; they do not certify the Aurora reconstruction's real component mapping or scale. Temporary database fixtures are removed after the checks.

Screenshot: `output/candidate-preparation/workbench.png`. This is local acceptance, not an Azure deployment or a live independent reviewer approval. Durable source selection/jobs, saved preparation sessions, source-to-candidate comparison storage, actual component fidelity/accuracy acceptance, production engine decision and live/device acceptance remain open.

User accuracy priority: dimensional fidelity must be measured against known references and component geometry. A single image cannot verify invisible surfaces; inferred geometry must retain uncertainty and must not be treated as exact scored-device geometry. The current synthetic benchmark is being extended with reference-only quantitative accuracy auditing; camera registration alone is insufficient.
