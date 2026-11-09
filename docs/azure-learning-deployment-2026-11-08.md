# Azure learning deployment — November 8, 2026

Deployed to the existing MTraining subscription and `rg-medical-device-personal`. Source is on `main` in [GitHub](https://github.com/joniskow/medical-device-training-platform). Application: [training administration](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/admin).

## Release

- Learning: evidence planning, bounded module generation, teaching-before-assessment checks, exact source locators and explicit missing-evidence reports. Human review still establishes semantic support and applicability.
- Production: verified narration reuse scoped to tenant and course version, including retention handling.
- Backgrounds: composition/style/camera controls, aspect-aware image sizes and draft/final quality profiles. Background video repeats a still image.
- Azure Identity dependency patched; production dependency audit reported zero findings.

The final runtime source is commit `faab27c03beb81b257e56f9ed2e0f695fc0567a9`. ACR build `cj2s` succeeded, applying the compiled learning-budget patch to the previously built and verified release images.

| Component | Revision | Immutable image digest |
| --- | --- | --- |
| API | `mdt-personal-api--learning-faab27c` | `sha256:78852451640752c6538231a62f6026ea88192a4787df3f57a2ff888b8043dfc0` |
| Worker | `mdt-personal-worker--learning-faab27c` | `sha256:f11e752e3bfabffeb57e1369daa7e205c31cd8d9e7677295d3cb15cfe70eecf5` |
| Background | `mdt-personal-video--learning-63ee89c` | `sha256:f246025e98c8ff913edc4a3810551b5b3b57ed28d928d49487e56590f7806a2a` |

Registry: `mdtpersonalacr01.azurecr.io`. Existing scanner sidecar, secret references and scaling rules were preserved. Worker minimum replicas remains zero. API uses the existing configured model and a shared 4,000-token output ceiling. No new model deployment was provisioned.

Database migration execution `mdt-personal-migration-w0meext` succeeded. The scheduled outbox publisher was updated to the worker release image; successful executions were observed. Previous revisions and credential-free rollback snapshots were retained in local ignored deployment output.

## Verification and limitations

- Workspace build and typecheck passed before deployment. Pure, authentication, database and integration suites passed: 110 checks, including actual PostgreSQL, Azurite and FFmpeg checks. The final budget adjustment additionally passed gateway build, typecheck and staged-learning checks.
- API candidate health and readiness returned HTTP 200. Public administration returned 200 and a protected lesson-render route returned 401. Background health returned healthy.
- Live private database checks passed, including restricted grants and vector extension 0.8.7.
- The bounded live generation test `mdt-personal-learning-smoke-8gqne2x` failed with `AI_OUTPUT_INCOMPLETE`. Azure metrics showed one request using all 1,000 outline tokens. No narration/background generation calls followed. The final patch allocates 1,500 outline tokens within the same total ceiling and adds stage diagnostics. Another paid end-to-end run remains unverified pending approval.
- GitHub validation remains affected by historical secret-scan findings. Only explicitly approved exceptions for two exact public/local fixture values were added; further historical exceptions remain pending approval. No claim of green CI or fully verified live generation is made.
- Local disposable verification containers were stopped after checks; persistent test volumes were preserved.
