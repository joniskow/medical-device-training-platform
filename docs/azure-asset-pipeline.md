# Azure asset pipeline foundation

The asset pipeline uses private Blob Storage for source evidence and derived artifacts, Service Bus for asynchronous work, PostgreSQL for job and approval metadata, and managed identities for queue access. The infrastructure template is `infra/azure/asset-pipeline-foundation.bicep`.

## What the template creates

- Private, versioned Blob containers for sources, reconstruction artifacts, video plates, renders, published assets, and quarantine.
- Seven-day Blob and container soft-delete retention.
- A lifecycle policy that cools derived/current artifacts after the configured age and previous versions after a longer age. It does not delete historical releases.
- Durable Service Bus queues for asset processing, reconstruction, rendering, validation, and video-plate generation.
- Queue-scoped receiver and sender access for the worker identity. The API writes
  jobs and the transactional outbox in PostgreSQL; the worker is the only
  process that publishes the outbox message to Service Bus and sends retry
  messages, so the API does not need queue permissions.
- Deployment outputs for the container list, queue list, region, and storage endpoint.

The template assumes the existing private Storage Account, Service Bus namespace, and worker identity are already deployed by the existing data/worker foundation templates. It does not create an AI model deployment, GPU capacity, or a public storage endpoint.

## Validate

```powershell
pnpm infra:validate
az bicep build --file infra/azure/asset-pipeline-foundation.bicep --outfile output/asset-pipeline-foundation.json
```

## Deploy after service preflight

Use a parameter file or explicit command-line values. Do not commit passwords, tokens, connection strings, or deployment credentials.

```powershell
az deployment group create `
  --resource-group rg-medical-device-personal `
  --template-file infra/azure/asset-pipeline-foundation.bicep `
  --parameters `
    environmentName=personal `
    storageAccountName=mdtpersonalstorage01 `
    serviceBusNamespaceName=mdt-personal-sb-01 `
    workerIdentityName=mdt-personal-worker-id
```

The deployment is intentionally separate from application image deployment. Container images, database migrations, and the API/worker revisions must be promoted only after the infrastructure outputs and identity role assignments are verified.

## Runtime mapping

The current worker listens to `asset-processing` and dispatches durable jobs by persisted job type. The additional queues reserve explicit lanes for future reconstruction/rendering workers without requiring a queue rename or a storage-key convention change. Each worker must still enforce tenant prefixes, source hashes, bounded reads, retry classes, and review-required publication gates in application code.

The storage account remains private. Browser delivery must go through the authenticated API or a short-lived, scoped URL issued after the API rechecks tenant, release, approval, and hash bindings.

For reconstruction, the Azure API is the public product boundary: upload sessions accept the photo bytes, PostgreSQL records the durable job/outbox handoff, the worker consumes the signed queue message, photogrammetry and the configured headless Blender stage produce the private GLB plus quality report, and authenticated reconstruction artifact routes deliver the candidate to the Babylon workbench. The candidate remains `REVIEW_REQUIRED`; no queue or API path auto-approves it for scored use.

