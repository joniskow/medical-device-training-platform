# Local stakeholder demo

The local demo is an explicitly opt-in convenience runtime for showing the implemented PDF and image ingestion path. It uses the existing PostgreSQL job/outbox stores, private Azurite Blob storage, PDF extraction, media inspection, source reader, and review UI. It does not change the production API or worker entrypoints.

## Start

From the workspace root:

```powershell
pnpm demo
```

Open the URL printed as `url` (normally `http://127.0.0.1:8787/demo`). The page is visibly labeled as demo mode and uses the local `org_fixture` organization. No Entra configuration is used.

Use the `Demo role` selector to keep the workflow role-separated: use `Author / uploader` to upload sources, create courses, and generate drafts; switch to `Reviewer / publisher` to approve sources and AI drafts and publish the immutable release. These are two fixed local principals, so the demo preserves the production separation-of-duties rule.

Upload the canonical fixture PDF at `fixtures/reference/manual/aurora-infusion-controller-manual.pdf` and one of the PNGs under `fixtures/reference/images/`. The PDF should reach `SUCCEEDED` / `REVIEW`; use `Show source documents` and `Read ...` to inspect page-cited passages. The image should reach `SUCCEEDED` / `REVIEW`; use `Show uploaded media`, open the item, and load its private preview.

The demo worker processes only `org_fixture` outbox jobs and runs inside the launcher process. PDF extraction uses the configured local Python interpreter. If FFmpeg is available, image processing uses the existing FFmpeg-backed media inspector; otherwise the launcher uses a demo-only image container/dimension check that preserves the original private bytes and clearly labels the fallback in the job warning.

The course draft, source review, AI-draft review, and release controls are available from the page. Switch roles before recording approvals or publishing; the reviewer identity must be different from the author identity.

## Verification

```powershell
pnpm demo:smoke
```

The smoke check uploads the canonical PDF and PNG through the real HTTP route, waits for both durable jobs to reach `SUCCEEDED`, verifies the extracted source passages and private media inspection report, and then shuts down the demo server.

Production `/author/jobs` remains Microsoft Entra-authenticated, and the production API/worker still require their normal Azure configuration.
