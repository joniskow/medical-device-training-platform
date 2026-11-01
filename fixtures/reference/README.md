# Aurora Infusion Controller reference fixture

Fixture ID: `AIC-001`  
Version: `1.0.0`  
Provenance: synthetic, generated for testing  
PHI: none

This fixture is the repeatable baseline for the platform's ingestion, AI-assisted authoring, existing-model rendering, semantic interaction, reconstruction comparison, assessment, credential, recovery, and tenant-isolation tests.

Positive assets include:

- `manual/aurora-infusion-controller-manual.pdf` - cited synthetic product manual.
- `model/aurora-infusion-controller.glb` - canonical existing model with three named component nodes.
- `images/*.png` - supported image set for reconstruction tests.
- `video/aic-priming-demo.mp4` - supported video fixture.

Negative variants are in `variants/` and must produce terminal rejection or a review-queue outcome. They must never count as successful ingestion.

## Commands

```text
pnpm fixture:create
pnpm fixture:validate
pnpm fixture:dry-run
pnpm document:extract
```

The generator uses fixed content and a fixed manifest timestamp so hashes remain stable across clean environments. The validator checks file hashes, media signatures, required semantic anchors, and negative-variant presence.

The manifest also records the expected author, learner, verifier, and operator outcomes, plus the evidence required at ingestion, authoring, simulation, and credential gates. Runtime processing is still unproven until the E3-E7 implementation path consumes this fixture.

`fixture:dry-run` verifies positive asset checksums/signatures, runs deterministic import jobs with tenant/idempotency/retry metadata, and classifies every negative variant as rejected or review-required. It is a fixture harness, not the production PDF/GLB worker.

`document:extract` runs the local deterministic text-extraction rehearsal and writes page-cited chunks to `output/fixture-import/aic-001-document-extraction.json`. It does not claim OCR, table/image interpretation, or the production Azure extraction adapter.
