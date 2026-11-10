# Azure stakeholder demo

Open the [hosted creator demo](https://mdt-personal-demo.bluebeach-5048303a.centralus.azurecontainerapps.io/demo?model=nxstage-review). It runs independently of the developer computer.

## Walkthrough

1. Select the sample product photos and continue through the explicitly simulated conversion.
2. Inspect the prepared NxStage model. Wait for it to load, then select **Approve model for scene preview**.
3. Continue to generated content. Select **Use generated motion sample** for the most predictable presentation: this replays an actual Azure-generated clip without buying another render.
4. Watch the instructor walking behind the separate interactive model. Pause/resume the background, then interact with the model. Review the composite before approving the background.
5. Continue through course shaping and learner preview. Demo approval/publication state lives in the browser; this is not a production clinical release.

For a new background, use the Microsoft sign-in link and the configured demo operator account, then select **Generate Azure motion video**. This makes a billed Azure Foundry request. Background audio is removed; narration is a separate capability. Custom uploaded photos do not start a reconstruction job in this demo.

## Azure resources

Resource group: `rg-medical-device-personal`, subscription `e30f800a-473e-4040-9622-6ea38413c991`.

| Capability | Resource |
| --- | --- |
| Demo website, model assets, HTTP generation adapter, FFmpeg | Container App `mdt-personal-demo`, Central US |
| Runtime image | Azure Container Registry `mdtpersonalacr01`, repository `demo` |
| Prepared sample, generated MP4s, generation status | Private `demo-media` container in `mdtpersonalstorage01` |
| Runtime authentication to Blob, registry, and video model | Managed identity `mdt-personal-demo-id` |
| Video generation endpoint | Foundry account `mdtpersonalmotion01`, East US 2 |
| Video model deployment | `training-motion`, `Fal-LTX-2.5-Fast`, version `2026-11-02` |
| Operator sign-in | Existing Microsoft Entra browser/API registrations; hosted redirect URI registered |

The existing API, worker, PostgreSQL, Service Bus, Key Vault, private networking, monitoring, and text/image/speech services were inventoried in Azure. This deployment adds the hosted demo and motion model without replacing the production API or worker images. The older image-based video service remains separate from the new motion demo.

The hosted runtime makes no Hugging Face requests and needs no local server, Azurite, local FFmpeg, or developer credentials. Azure roles grant its identity Blob data access, registry pull, and Cognitive Services access. New generation/status/video routes require a valid Entra API token from the configured operator; the prepared replay sample is public through the application. Blob containers remain private.

**Provider boundary:** deployment, endpoint, authentication, and billing use Azure Foundry. Microsoft's [fal model documentation](https://learn.microsoft.com/en-us/azure/foundry/how-to/fal-ai-models/enable-fal-models) explains that fal inference runs outside Microsoft facilities under fal terms. This does not establish Microsoft-only inference processing or clinical suitability.

## Deployment and verification

Deployment `demo-20261110` succeeded on 2026-11-10. Ready revision: `mdt-personal-demo--jb0cqj0`.

Image: `mdtpersonalacr01.azurecr.io/demo@sha256:6f93c31f6c413b15327bf5e9868339e44d6760e98e0b1a41adba51382ca58381`.

The [Bicep template](../infra/azure/demo.bicep) defines the demo resources, model, roles, and runtime configuration. Build workspace dependencies first with `corepack pnpm build`, then run `node tools/build-azure-demo.mjs` and build its generated image context using Azure Container Registry. Deploy the template with the resulting immutable image digest and the existing Entra/operator IDs. On a new subscription the `Microsoft.CognitiveServices/Fal.EnableDeploy` preview feature must be registered; also register the resulting `/auth/redirect` URI on the browser app. Do not put credentials in parameters or Git.

Verified:

- One real Azure Foundry render completed; the normalized prepared sample and provenance are committed under [fixtures/demo-motion](../fixtures/demo-motion/). The model produces six seconds; the scene profile uses a three-second, 960×540, 30 fps segment.
- Live HTTPS health, Azure hosting configuration, sign-in configuration, sample SHA-256, and HTTP byte ranges passed. Anonymous billed generation returned HTTP 401.
- An isolated Chrome walkthrough loaded and approved the model, played the hosted sample behind it, and enabled background review. Decoded frame comparison found 2,788 changing pixels out of 14,400, confirming actual motion.
- All workspace type checks, source lint, focused provider/background/pipeline/browser tests, and all 14 infrastructure templates passed. Infrastructure compilation used pinned Bicep 0.49.2 without diagnostics.

The operator's interactive Microsoft sign-in and a new paid render initiated through that signed-in browser were not exercised. The real model request was verified separately using Entra authentication. Completed outputs and status persist in Azure Blob; unfinished in-process generations do not have worker recovery after a container restart. Cancelling browser polling does not cancel a provider render. Keep the page open while rendering; failed requests do not substitute a sample or automatically buy another render.
