# Local stakeholder demo

For presentations, use the [Azure-hosted demo](https://mdt-personal-demo.bluebeach-5048303a.centralus.azurecontainerapps.io/demo?model=nxstage-review) and its [walkthrough and deployment record](azure-demo-deployment-2026-11-10.md). The hosted demo uses Azure Foundry motion generation and private Azure Blob storage. The optional local development runtime below uses a separate free provider.

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

## Free motion-video demo

The creator's **Generate motion video (free)** action uses the official [Lightricks LTX-2.5 Space](https://huggingface.co/spaces/Lightricks/LTX-2.5) on Hugging Face ZeroGPU. It submits the background text prompt only, adds fixed-camera environmental motion instructions, downloads the result from the same Space, and normalizes the actual video to the scene profile using the installed FFmpeg tools. Background audio is removed; narration generation remains separate.

No account, provider key, paid credits, or Azure deployment is needed for this demo. Free GPU queues and quotas apply. Failure is shown explicitly; the demo does not retry a generation automatically or switch to a billed provider. Azure motion generation remains an alternative if the free service is unsuitable.

**Use generated motion sample** replays the free clip already generated for this workspace, without requesting a new render. It is available when `output/free-generated-background.mp4` exists. The sample is separate from live prompt generation. The local server retains that sample and up to two new previews in memory. Restarting clears new previews, while the prepared sample is loaded again from disk. Cancelling the browser wait does not cancel an already submitted render.

The browser verifies the MP4 hash and video profile, plays it behind the separate interactive model, and provides pause/resume. The initial prepared backdrop remains a still image until a generated video or the motion sample is selected. Outputs remain review-required demo content, not a published clinical course.

Checks: `node tools/check-free-demo-video-provider.mjs`, `node tools/check-demo-background-generation.mjs`, and `node tools/check-demo-background-browser.mjs`. Those checks use test providers. The completed free render and decoded frame differences are separate integration evidence.
