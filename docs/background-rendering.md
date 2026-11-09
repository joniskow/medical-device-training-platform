# Background rendering quality

The [OpenMontage provider](../services/openmontage/server.mjs) generates one empty environment image and encodes a locked-camera MP4. Prompt version `clean-plate.v2` specifies crop-safe negative space, perspective, lighting, materials and exclusion of people, device controls and text. The reviewed device remains a separate foreground asset. Camera descriptions guide generation; they do not establish calibrated geometry or validated alignment.

## Configure the service

The [Azure template](../infra/azure/openmontage-service.bicep) exposes these parameters and maps them to environment variables:

| Parameter | Environment variable | Default | Allowed values |
| --- | --- | --- | --- |
| `backgroundDefaultProfile` | `BACKGROUND_DEFAULT_PROFILE` | `draft` | `draft`, `final` |
| `backgroundFinalQuality` | `BACKGROUND_FINAL_QUALITY` | `medium` | `low`, `medium`, `high` |
| `backgroundStyle` | `BACKGROUND_STYLE` | `clinical` | `clinical`, `warm-learning`, `neutral-studio` |
| `backgroundCamera` | `BACKGROUND_CAMERA` | `eye-level` | `eye-level`, `seated`, `low-device` |

Existing worker requests inherit these service settings. Draft always requests low image quality. Final uses the configured final quality and a lower video compression setting (CRF 20 instead of 25). Azure supports low, medium and high quality and three image sizes on the GPT image models; check the deployed model's support before changing configuration. See the [Microsoft image API reference](https://learn.microsoft.com/en-us/azure/foundry/reference/rest/images-create-image).

Landscape, portrait and square requests select corresponding provider image sizes, then center-crop to the requested output dimensions. The service still generates exactly one image per accepted request. Existing duration, dimensions, concurrency, body-size and output-size limits apply to both profiles.

## Per-request service options

Authenticated direct callers of `/generate` may add the optional field below alongside the existing required generation fields:

```json
{
  "background": {
    "profile": "final",
    "style": "warm-learning",
    "camera": "seated"
  }
}
```

Omitted options inherit service defaults. Unknown fields or values fail validation before an image request is sent. Application authoring screens and stored generation contracts do not yet expose these per-request options; use service settings with the current worker.

Use a new generation ID to promote a draft to final. Reusing an ID with changed settings returns a conflict while that ID is in the existing 15-minute in-memory replay cache. Choose a draft composition through the existing review process before requesting a final. A final request regenerates the scene and can vary visually; this service does not implement image editing or guarantee exact preservation of the selected draft. Prompt quality and exclusions still require visual review before approval.

The service response includes `background` metadata: effective profile, image quality, style, camera, prompt version, image size, prompt SHA-256 and source-image SHA-256. The current worker extracts the existing provider and video fields; this additional service metadata is available to direct callers, and is not yet persisted by the worker. It contains no API keys or raw prompt. The cache remains process-local and bounded; a restart or expiry may cause regeneration.

## Local verification

Run `pnpm openmontage:service:validate` (or its underlying `node tools/check-openmontage-service.mjs`). The check covers validation, authentication, generation conflicts, concurrency, profile quality routing, style/camera prompt construction, aspect selection and real JPEG-to-MP4 encoding with local ffmpeg. Azure responses are fixtures; the check makes no paid image calls and does not establish production visual quality or latency.
