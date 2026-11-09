# Azure bug-fix deployment ? 8 November 2026

Destination: personal **MTraining** subscription, resource group `rg-medical-device-personal`, Central US. Application: [company workspace](https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io/admin).

## Release

The deployment adds the two fixes from the [bug audit](./bug-audit-2026-11-07.md). API failure projections redact historical exception text; worker outcomes and asset lifecycle transitions share the current job-generation fence and one PostgreSQL transaction. Stale workers cannot quarantine sources.

Newer administration/speech deployments appeared while the original rollout was interrupted. Image guards stopped the earlier candidate rollout before app changes. The final images are small, tested overlays on the actual latest serving images, preserving their UI, speech fixes, private configuration, scanner sidecar and scheduled outbox publisher. The API base is `admin-e2e-r9`; the worker base is `admin-speech-r7`.

| Component | Immutable image | Revision |
|---|---|---|
| API | `mdtpersonalacr01.azurecr.io/api@sha256:95139481b61750ad63b2fbbcef9d1388e3cb21beb05b549c59efbb03b775e797` | `mdt-personal-api--bugfix-1108`, 100% traffic |
| Worker | `mdtpersonalacr01.azurecr.io/worker@sha256:481cca18264fc53ed2090ed833679ad723b905b336e8dfc56830fea21ffaca59` | `mdt-personal-worker--bugfix-1108-idle`; same image as the verified warm revision `bugfix-1108` |
| Scanner sidecar | `mdtpersonalacr01.azurecr.io/scanner@sha256:10f72f0e9304ffaa458d0fa6d595af25b750fde9d19736c12d6c725578373daf` | Existing sidecar preserved |

ACR worker build `cj2b` and rebased API build `cj2e` succeeded, including focused in-image assertions. The API privacy build tests both lastFailure and outcome.failure, preserving retry eligibility and retry timing. The worker build verifies the completion binding and sanitized exceptions.

## Verification

- Private Azure PostgreSQL execution `mdt-personal-learning-smoke-fgkcwnl` succeeded: stale success, stale failure and stale quarantine all rejected; current-generation finalization remained available. Temporary rows were isolated by organization, withheld from the real queue and removed in cleanup.
- The first probe execution, `ck1uxwz`, failed because its own second fixture reused a Blob key. Correcting only fixture uniqueness made the rerun pass. No application check was relaxed.
- Worker revision `bugfix-1108` became Healthy, logged worker_started, and passed actual scanner clean-file and EICAR detection self-tests before API traffic promotion.
- Candidate and public main endpoints returned `/healthz` alive and `/readyz` ready. The administration page returned 200; an unauthenticated protected job request returned 401.
- API traffic is confirmed at 100% on `bugfix-1108`. Final worker revision bugfix-1108-idle is confirmed Healthy and ScaledToZero with zero replicas. Worker min/max replicas are restored to 0/1; existing Service Bus, hourly maintenance and minute outbox-publisher rules remain in place.
- Queue verification: zero active messages; the one pre-existing dead-letter message was preserved.
- The earlier full API/web release build `cj1v`, worker build `cj1w`, and Linux authentication verification build `cj26` succeeded. The latter runs the previously sandbox-blocked managed-auth and browser-auth checks. These cloud results resolve that environmental build limitation; they are separate from the historical local 105/106 evidence.
- The additive database migration execution `mdt-personal-migration-8bcy00l` succeeded. No database rollback, user-data deletion or credential/release rewrite was performed.

The unused standalone scanner created by the interrupted rollout was removed after verifying that the newer worker already had its own scanner sidecar. No GPU or additional always-on scanner remains from this release.

## Rollback and remaining acceptance

Previous API `mdt-personal-api--admin-e2e-r9` and worker `mdt-personal-worker--admin-speech-r7` revisions/images are retained. Roll back by restoring application images/configuration and API traffic, preserving the additive schema and immutable evidence. Local safe metadata snapshots are in `output/azure-release/api-rollback.json` and `worker-rollback.json`.

This establishes deployment, private PostgreSQL regression, scanner startup and HTTP readiness. It does not establish complete real-user certification, clinical/content/license approval, disaster recovery or physical-device acceptance. Those remain governed by the [technical execution record](../tasks/technical-execution.md).
