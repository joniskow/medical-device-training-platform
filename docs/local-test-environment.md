# Disposable local integration environment

This environment is for automated engineering checks only. Production application delivery remains in Azure; this does not create a local customer setup flow or callback.

Install pinned dependencies and build first:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
node tools/local-test-environment.mjs up
node tools/technical-validation.mjs --profile database
node tools/technical-validation.mjs --profile integration
node tools/local-test-environment.mjs down
```

The bootstrap owns exactly the Docker Compose project `medical-device-technical-test`, using [the existing local compose file](../infra/local/docker-compose.yml). It provisions PostgreSQL 16 and Azurite, waits for readiness, applies the application's migration function and reconciles the production runtime domain grant matrix. It verifies non-superuser/non-bypass-RLS runtime and outbox roles. No seed of real identities/accounts is performed. Existing regression checks create their own synthetic records.

The current test scripts require loopback ports 54329 and 10000–10002; some hardcode the local URLs. The wrapper refuses running containers from another Compose project on those ports. Stop such containers through their owning workflow if their use is complete; do not delete their volumes. The wrapper refuses `NODE_ENV=production`, accepts no external database URL and never changes a cloud resource.

`down` stops/removes only this project's containers/network and preserves its volumes. A complete disposable reset is explicit:

```powershell
node tools/local-test-environment.mjs reset --confirm-project medical-device-technical-test
```

Before deleting anything, reset verifies every project-labeled volume against the exact names `medical-device-technical-test_postgres-data` and `medical-device-technical-test_azurite-data`, and checks their Compose ownership labels. Foreign, extra or duplicate volumes abort reset. No filesystem directory is recursively deleted. Reset recreates services and reapplies migrations after removal; it never silently resets another project.

Safety regression: `node tools/check-local-test-environment.mjs`. Manifest runner regression: `node tools/check-technical-validation.mjs`.

The bootstrap wrapper could not be executed in this restricted agent environment: Docker calls spawned under Node were blocked and outside-sandbox permission was denied. Direct Docker checks and all 20 database/three integration tests passed against the separately provisioned local infrastructure. Fresh named bootstrap/reset/recreate and the complete Linux CI run still require execution in a permitted environment. They must not be marked accepted from the guard unit test alone.
# Hybrid retrieval database

The compose environment additionally provides a separate digest-pinned PostgreSQL 16/pgvector service on loopback port 54339 with its own `postgres-vector-data` volume. The bootstrap applies the same migrations and restricted runtime grants there. The plain PostgreSQL regression database remains on 54329. [Hybrid retrieval checks](../tools/check-hybrid-retrieval.mjs) require the extension service and fail if it is absent; they never silently skip vector behavior. The guarded reset includes this exact named test-project volume in its ownership checks.
