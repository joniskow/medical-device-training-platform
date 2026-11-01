# Private browser uploads

The deployed storage account disables public network access. Browser uploads now use an authenticated same-origin PUT to /api/v1/upload-sessions/:id/content. The API validates organization/author access, upload ownership, active state and expiry before streaming bytes to private Blob Storage.

The stream checks exact size and SHA-256, and rechecks session status at EOF. The Blob adapter stages bounded 4 MiB blocks with unique request block IDs and commits only after successful validation. A failed stream cannot replace a committed object. The existing completion endpoint independently verifies object metadata/checksum before creating the asset and processing job. No storage firewall or public-access change is needed. Direct SAS mode remains available for existing service consumers; the deployed API uses private upload mode.

Evidence: full workspace build, tools/check-private-upload.mjs (real HTTP and Azurite: multi-block transfer, owner/role/expiry checks, truncated/oversized/hash-mismatched data and producer interruption), tools/check-api-extended.mjs, architecture boundary checks. Live deployment acceptance is tracked in tasks/current-delivery.md.

Deployment: API image personal-20261030-upload2 (sha256:54071ba84f86905ee4907ddc2e1bd65b3d51d586f7efe57b4905d010e93e399f), revision mdt-personal-api--0000018, reports Healthy. No storage public-access settings were changed.

Live Chrome acceptance: private upload succeeded; job job_asset_process_assetv:a01dcfe1-a164-4e87-ac3f-5c32d99630bc completed SUCCEEDED / REVIEW on attempt 1. Source selection exposes three extracted passages. Created draft course:2698ce65-6377-42ae-bd48-aa79d56f4da4:v1 for synthetic reference-manual acceptance. Live generation acceptance is in progress.
