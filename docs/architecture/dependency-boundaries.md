# Dependency Boundaries

These boundaries implement the modular-monolith direction in the solution design.

## Allowed direction

```text
apps/web      -> packages/ui, contracts, model-runtime
apps/api      -> domain, contracts, db, telemetry, provider adapters
apps/worker   -> domain, contracts, db, telemetry, provider adapters
packages/ui   -> contracts
packages/model-runtime -> contracts, simulation-schema
packages/db  -> contracts
packages/ai-gateway -> contracts
packages/domain -> contracts, simulation-schema
packages/telemetry -> contracts
```

## Forbidden imports

- `packages/domain` must not import React, browser runtime packages, Azure SDKs, database clients, HTTP framework types, or provider AI types.
- `packages/contracts` and `packages/simulation-schema` must remain infrastructure-free.
- Provider SDKs belong only in adapter implementations behind the approved ports.
- The browser sends semantic actions and approved manifests; it does not own certification truth, scores, pass/fail state, or credential status.

These rules are enforced by architecture tests before E1 is complete.
