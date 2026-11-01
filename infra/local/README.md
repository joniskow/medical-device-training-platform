# Local infrastructure

Docker is optional for normal VS Code development. The default local tests use deterministic in-memory doubles. Use this harness when we need integration fidelity with PostgreSQL migrations or Azure Blob-compatible behavior.

The local harness provides PostgreSQL and Azurite. Service Bus, Azure AI, email, webhooks, identity claims, and heavy asset processing use deterministic in-memory doubles until their provider adapters are implemented.

## Commands

```text
pnpm dev:infra
pnpm dev:infra:down
```

The database is exposed only on `127.0.0.1:54329`. Azurite exposes local Blob, Queue, and Table endpoints on ports `10000`–`10002`. The emulator skips API-version validation because the current Azure Blob SDK can send a newer request version than the pinned emulator; this is local-emulator compatibility only and does not weaken production Azure validation. The credentials are local development values only and must never be reused in shared or production environments.
