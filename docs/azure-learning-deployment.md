# Azure learning services — 7 November 2026

Resource group: `rg-medical-device-personal`. This is the personal pilot deployment; clinical content still requires its normal source and publication reviews.

Live application: [administration workspace](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/admin). The combined learning and administration revision `mdt-personal-api--learning-admin` receives 100% of traffic. Previous API revisions are deactivated and retained for rollback. The final worker revision is healthy and was verified scaled to zero; queued work wakes it.

## Services and cost controls

| Service | Configuration |
| --- | --- |
| Application API | Consumption Container Apps, 0–1 replicas, 0.25 CPU / 0.5 GiB |
| Video provider | `mdt-personal-video`, Consumption, 0–1 replicas, 1 CPU / 2 GiB, one render at a time |
| Worker and antivirus | 0–1 replicas; worker 2 CPU / 4 GiB and colocated scanner 1 CPU / 2 GiB |
| Outbox publisher | Scheduled job every minute, 0.25 CPU / 0.5 GiB, exits after checking pending work |
| Text generation | Existing `mdtpersonalai01` / `training-draft`, GPT-4.1-mini, 4,000 output-token limit |
| Embeddings | Existing AI account / `training-embedding`, text-embedding-3-small, 1,536 dimensions; PostgreSQL vector 0.8.7 |
| Image generation | `mdtpersonalmedia01` / `training-background`, gpt-image-1-mini, GlobalStandard capacity 1; one low-quality image per render |
| Speech | `mdtpersonalspeech01`, F0; worker concurrency 1 |
| Existing database | Burstable Standard_B1ms, HA disabled |
| Existing registry and queue | Basic ACR and Basic Service Bus |
| Logging | 30-day retention; 0.1 GiB/day ingestion cap |

No GPU or provisioned AI throughput was added. AI calls remain usage billed; the free Speech tier has a monthly allowance and throttles. Existing database, storage, registry and network costs continue. The logging cap can suspend ingestion for the rest of the day and is not an account spending limit.

The lightweight publisher checks the database outbox every minute. The full worker scales on Service Bus and wakes hourly for background maintenance even when no jobs exist. Cooldown is 60 seconds. Queue-only scaling without a publisher would strand outbox work when no worker is running. After an idle period, allow approximately one minute plus scheduling and cold-start time before a new request begins processing. Maintenance such as idle notification and retention sweeps can wait up to an hour; maintenance also runs whenever the worker is active. The scanner refreshes definitions before starting, rejects stale definitions at startup, and must pass clean-file and antivirus-detection checks before the worker starts.

## HTTPS provider

`POST https://mdt-personal-video.bluebeach-5048303a.centralus.azurecontainerapps.io/generate`

This is a purpose-built implementation of the application's OpenMontage provider contract. It generates an empty background using Azure images and encodes a locked-camera MP4 with CPU FFmpeg. It is **not an installation of the upstream OpenMontage package or a general text-to-motion model**. `LOCKED_INTERACTIVE` is supported; `CINEMATIC` requests are rejected. Approved device geometry, procedural motion and review gates remain the application's responsibility.

`GET /healthz` is public. Generation requires bearer authentication. The worker is already configured with the endpoint and a Key Vault reference; no manual key entry is needed. Provider and Azure service keys remain in Key Vault, with service-specific managed identity access.

## Verified behavior

- Private Azure smoke job produced real course content, 1,536-dimensional embeddings, spoken audio and an MP4 background.
- Scanner startup regression covers refresh-before-start and failure to refresh. Real Azure startup probes accepted a clean fixture and detected the standard antivirus test fixture.
- Staged combined API returned HTTP 200 for `/healthz`, `/readyz` and `/admin`.
- Existing verified source content was backfilled: one source, three chunks indexed.
- Video-service tests cover authentication, request bounds, replay protection, conflicting requests, concurrency limits, unsupported cinematic requests, and actual JPEG-to-MP4 encode/decode.

The deployment retains the administration interface alongside the improved learning backend. Release image digests, promotion status, previous revisions and operator diagnostics are recorded in the local deployment release manifest. Rollback uses the recorded previous API revision and preserved configuration snapshots; schema rollback is not required for the additive vector migration.

Infrastructure and repeatable checks: [provider template](../infra/azure/openmontage-service.bicep), [private smoke job](../infra/azure/learning-smoke-job.bicep), [rollout preparation](../tools/prepare-azure-learning-rollout.ps1), [video service tests](../tools/check-openmontage-service.mjs), [scanner startup regression](../tools/check-scanner-startup.mjs).

The small [outbox publisher job](../infra/azure/outbox-pump-job.bicep) must remain scheduled when the worker minimum is zero. Its first two real scheduled executions succeeded. It uses the outbox database role and Service Bus sender identity; it never receives or processes source assets.
