# Azure development environment

This project uses a dedicated Azure resource group for development and deployment experiments. The subscription and resource group were verified in the Azure portal on 2026-10-22.

| Setting | Value |
|---|---|
| Subscription | Microsoft Azure Sponsorship |
| Subscription ID | `8e95a112-23a5-40e8-97a4-285380a1438e` |
| Tenant | Kumo Partners (`7d46aa07-85c8-4b7a-81d3-320765424537`) |
| Primary region | East US |
| Restore region | US Southeast, subject to service preflight |
| Development resource group | `rg-medical-device-dev` |
| Resource-group tag | `project=medical-device-training` |

## Cost and safety posture

- Keep this resource group isolated from existing Kumo workloads.
- Prefer free, consumption, burstable, or development SKUs while the pilot is being built.
- Do not create GPU, dedicated AI capacity, or production-scale database capacity until the associated spike or deployment gate requires it. The pilot private-network path is now provisioned because the background-processing and data-boundary slice requires it.
- Do not place passwords, API keys, SAS tokens, connection strings, or browser session data in this repository.
- Use managed identity and Key Vault for deployed services; use local environment variables for developer-only credentials.
- Tag every created resource with `project=medical-device-training`, `environment=dev`, and an owner/cost-center tag when the deployment template is added.

## Current status

The dedicated resource group and the first two low-cost development resources are provisioned:

- `mdtdevstorage01`: Standard locally redundant Blob Storage in East US, hot tier, TLS 1.2, blob/container soft delete set to 7 days, public network access disabled, anonymous blob access disabled, and Microsoft-managed keys.
- `mdt-dev-sb-01`: Basic Service Bus namespace in East US, minimum TLS 1.2, local authentication disabled, and public connectivity. Basic was selected for cost; private connectivity requires Premium and is therefore a production/topology gate rather than a pilot-dev default. The `asset-processing` queue is provisioned with a 1 GB limit, 10 delivery attempts, 14-day message lifetime, and partitioning disabled.

The repository contains the versioned worker foundation templates at `infra/azure/worker-foundation.bicep` and `infra/azure/worker-foundation.arm.json`, which create a 30-day minimum-retention Log Analytics workspace, Container Apps environment, user-assigned worker identity, and the Service Bus sender/receiver plus Blob data role assignments. The corrected template was successfully deployed as `CustomDeployment-20261022125627`. The deployed foundation resources are `mdt-dev-logs`, `mdt-dev-aca-env`, and `mdt-dev-worker-id`; the worker identity has the intended Blob and Service Bus data roles. The worker image is defined by `Dockerfile.worker` and uses managed identity for Service Bus and Blob access.

The private data foundation was successfully deployed as `data-foundation-centralus-20261022` from `infra/azure/data-foundation.bicep`/`data-foundation.arm.json`, using `location=centralus` and `environmentName=devcentral`. PostgreSQL provisioning was restricted for this Sponsorship subscription in East US, so Central US was selected after service-capability preflight. The follow-up deployment `data-foundation-centralus-20261022-runtime-secrets` also succeeded. The deployment created `mdt-devcentral-pg` (Ready, PostgreSQL 16, Standard_B1ms, 32 GB, public access disabled), database `medical_device`, Key Vault `mdtdevcentralkv01` (public access disabled), VNet `mdt-devcentral-vnet`, private Blob and Key Vault endpoints, private DNS links, and the VNet-integrated Container Apps environment `mdt-devcentral-aca-private`. The PostgreSQL administrator password, non-owner runtime password, and Service Bus signing secret are generated during deployment and stored only in Key Vault; none is stored in this repository.

The worker now contains a clearly labeled pilot processor, private Blob container initialization, database migration/runtime-role bootstrap, and a one-shot Azure smoke publisher. The compact worker source was uploaded to Cloud Shell, built in ACR as `mdtdevacr01.azurecr.io/worker:pilot-20261022-stage3`, and deployed to the private Container App `mdt-devcentral-worker` (revision `mdt-devcentral-worker--0000004`). The deployment also added a protected `postgres-outbox-password` secret so the dedicated `medical_device_outbox_publisher` role can see and publish the transactional outbox without weakening forced RLS. The live smoke publisher passed: the test job reached `SUCCEEDED`, the outbox reached `PUBLISHED`, and the Service Bus queue returned to zero active messages. Worker restart/replay and dead-letter recovery evidence remain open. Azure OpenAI/Foundry model deployment will be provisioned only after the AI provider/region/model preflight and decision are recorded; the PDF/handbook-to-training capability remains a core MVP requirement.

The subscription ID is configuration metadata, not a credential. Keep it in deployment parameters or the signed-in Azure context rather than embedding it in application runtime secrets.

The API runtime is packaged by `Dockerfile.api` and the Entra-aware Container Apps deployment is defined in `infra/azure/api-foundation.bicep`. The template creates a separate API managed identity with ACR-pull, Key Vault-secret, and Blob data access, uses the private PostgreSQL hostname and existing runtime-password secret, exposes only HTTPS ingress, and keeps the pilot at zero-to-one replicas for cost control. The `Medical Device Training API` Entra registration is single-tenant with audience `api://22da2477-5ca4-4e1e-bc8f-cc7c960aa787` and enabled `operator`/`learner` roles. The API now uses Entra for signed identity proof and the application database for active organization membership; a custom organization claim is not required or trusted as the tenant boundary. The updated image `mdtdevacr01.azurecr.io/api:pilot-20261022-membership1` is deployed as `mdt-devcentral-api`, whose public health endpoint returned `HTTP/2 200` on 2026-10-22. The Azure membership table was created and the signed-in pilot user was seeded into `org_fixture`; the worker log reported `MEMBERSHIP_OK`, and the worker template was restored afterward. A live user-token smoke was attempted from Cloud Shell but was blocked after successful sign-in by the tenant's Conditional Access restriction on device-code authentication. No client secret is used or stored; the remaining path is a normal browser-based Azure CLI login or an administrator-approved authentication method.

## Account correction: canonical personal Azure destination

The canonical deployment is now the personal Azure account rather than Kumo Partners:

| Setting | Value |
|---|---|
| Tenant | `joniskowgmail.onmicrosoft.com` (`491266a6-1f7f-419f-9da1-1a600c27cc2f`) |
| Subscription | `MTraining` (`e30f800a-473e-4040-9622-6ea38413c991`) |
| Resource group | `rg-medical-device-personal` |
| Region | Central US |
| Personal API | `mdt-personal-api` |
| Personal worker | `mdt-personal-worker` |
| Personal Entra app | `Medical Device Training API (Personal)` |

The personal worker and API were smoke-verified. The personal worker uses its explicit user-assigned identity client ID, the corrected Service Bus receiver role, private PostgreSQL, Key Vault, private Blob Storage, and the personal queue. The API image `mdtpersonalacr01.azurecr.io/api:personal-20261023-inline2` (digest `sha256:f179bca5e8c1701f6078443c5907e7627ac601d38eca8ddd3fac745d487b84fa`) is deployed as revision `mdt-personal-api--0000014` with 100% traffic on the latest revision; the worker image `mdtpersonalacr01.azurecr.io/worker:personal-20261023-retry-fix` (digest `sha256:099684baf7505e8eb0c420f203c46720d6b765f435638a502fac7cdf6736242d`) is deployed as revision `mdt-personal-worker--0000017` with `STORAGE_CONTAINER_NAME=source-assets`. The browser OAuth harness completed a live PDF upload, visibly progressed through `RETRY_SCHEDULED` to `DEAD_LETTERED` under explicit retryable failure injection, and then completed the inline operator retry to `SUCCEEDED`/`REVIEW` with the expected pilot-review warning. A worker revision restart was rehearsed. During the live Blob upload rehearsal, temporary CORS/IP allowances were used; they were cleared afterward and final storage verification returned `publicNetworkAccess=Disabled`, `defaultAction=Allow`, `ipRules=[]`, and CORS `[]`. Kumo cleanup was limited to the project-tagged medical resource group `rg-medical-device-dev` and the medical API app registration created during this build. Final Cloud Shell verification returned `group exists=false`; unrelated Kumo resource group `rg-kosign-dev` remained present. Azure Home/Recent can continue to show cached links and is not authoritative for current resource existence.

## Local implementation continuation — 2026-10-23

The repository now contains the next documented local slices: forced RLS across the tenant domain tables, idempotent pilot-membership bootstrap, authenticated upload sessions with private Blob/user-delegation SAS and bounded reads, asset scan/quarantine lifecycle handling, browser job status, reproducible PDF extraction with optional OCR, tenant-scoped cited retrieval, source-grounded AI draft persistence, retry-message identity validation, and an accessible inline operator-retry form. Validate them with `pnpm tenant:validate`, `pnpm membership:validate`, `pnpm storage:validate`, `pnpm api:extended-validate`, `pnpm worker:validate`, `pnpm recovery:validate`, `pnpm document:extract`, `pnpm document:import`, and `pnpm source:validate`. These commands are local/fixture evidence; they do not replace deployment, live private-network, real-token, or recovery rehearsal evidence. The API `operator` app-role assignment is present, the inline retry form is deployed, and the positive operator-retry rehearsal is complete. The next work is the remaining E0/E5/E10 sign-offs and broader backlog delivery.
