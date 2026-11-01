# Private course model delivery

The deployed API configuration enables same-origin authenticated model delivery. Author previews use the imported-model content endpoint. Learner descriptors return the release model-assets endpoint with `content=manifest` or `content=model`, preserving the selected variant.

Each learner content request rechecks active enrollment, published release, tenant, model identity and immutable release binding. The API reads private storage, validates manifest identity or model SHA-256, and returns bounded bytes with `Cache-Control: no-store`. Storage public access is not required. Browser author previews, simulation players and exploration activities attach application authentication and organization context only to relative API paths.

Validation: `pnpm build`, `pnpm architecture:test`, and `node tools/check-e4-postgres-session.mjs` passed on 2026-10-30. The integration check exercises a real PostgreSQL publication/enrollment and HTTP server with a storage double: authenticated model and manifest content, SHA-256, no-store, anonymous denial, and unassigned/foreign-tenant denial. This does not prove deployed browser rendering or private Azure Blob retrieval.

Azure build run: `cj12`, image `api:personal-20261030-private-model1`. Deployment and live acceptance are recorded in `tasks/current-delivery.md`.
