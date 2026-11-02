# Training-scene production

The training-scene manifest keeps the approved 3D foreground separate from optional video background production. Its `interaction` block declares whether the learner uses a passive composite, an interactive overlay, or a split layout, and each cue binds the video moment to a component or interaction target. The `TEXT_KEYBOARD` equivalent path is required for accessibility and for devices where WebGL is unavailable.

The `production` block records the pipeline and reviewed source references. Runtime scenes require `rightsReview: "APPROVED"`; a pending or missing review cannot pass the scene contract.

## OpenMontage handoff

Generate a bounded brief from the approved scene rather than asking a video model to recreate the device:

```text
pnpm openmontage:brief --scene-manifest apps/web/src/model/aurora-training-scene-manifest.json --prompt "Create a calm clinical training-room background with soft neutral light. Keep the device foreground unobstructed and do not add another device." --output output/openmontage-aurora-brief.json
```

Every brief automatically receives built-in instructions requiring photorealistic materials, maximum realism, and a first-person viewpoint from the user’s standpoint. Additional deployment-wide image-generation guidance can be applied with either `IMAGE_GENERATION_BASE_INSTRUCTIONS` or `IMAGE_GENERATION_BASE_INSTRUCTIONS_FILE`. Use only one. The scene-specific request is appended after the base guidance, and the combined prompt is what the brief stores and hashes for provenance. The CLI also accepts `--base-instructions` or `--base-instructions-file` for local runs.

For example:

```text
pnpm openmontage:brief --scene-manifest apps/web/src/model/aurora-training-scene-manifest.json --base-instructions-file config/image-generation-instructions.txt --prompt "Create a calm clinical training-room background." --output output/openmontage-aurora-brief.json
```

The brief locks the foreground model version, GLB hash, camera composition, duration, frame rate, and output dimensions. It tells the production pipeline to avoid occlusion and device replacement, and it carries source references plus the prompt hash for provenance. OpenMontage can then generate or assemble only the background layer; the approved device remains the browser-rendered foreground and continues to receive semantic interactions.

The handoff has three explicit stages:

1. Generate the brief with `pnpm openmontage:brief`.
2. Ingest the returned `.mp4`/`.webm` with its measured metadata. The command hashes the exact bytes and writes a `REVIEW_REQUIRED` artifact; it never marks the video approved:

   ```text
   pnpm openmontage:ingest --brief output/openmontage-aurora-brief.json --video output/openmontage/aurora-background.mp4 --asset-version-id assetv:openmontage:aurora-background:v1 --width 960 --height 540 --frame-rate 30 --duration-seconds 3 --output output/openmontage/aurora-background.artifact.json
   ```

3. After a human review of occlusion, continuity, rights, and device preservation, promote the artifact and produce a new scene manifest:

   ```text
   pnpm openmontage:approve --artifact output/openmontage/aurora-background.artifact.json --video output/openmontage/aurora-background.mp4 --reviewer-id reviewer-123 --review-ref review:openmontage:aurora-1 --scene-manifest apps/web/src/model/aurora-training-scene-manifest.json --approved-artifact output/openmontage/aurora-background.approved.json --scene-output output/openmontage/aurora-scene.approved.json
   ```

   Promotion fails unless the artifact is approved, its model identity and hash still match the scene, and its video profile matches the calibrated scene. OpenMontage output is therefore never silently swapped into a published lesson.

The current Aurora example uses the `MANUAL` pipeline in its checked-in scene manifest because no generated background has been reviewed or approved yet. The browser demo now validates the packaged scene manifest, model binding, and exact video bytes before loading the composite; it also takes the authored orbit camera and model transform from that manifest. When an OpenMontage result is actually produced, use the ingest/approval flow above and rerun `pnpm training-scene:validate` before publishing.

## NxStage office preview

The local NxStage preview uses an OpenMontage-rendered 960×540, 30 fps, 3-second office plate at `fixtures/nxstage-system-one/nxstage-office-background-openmontage.mp4`. The interactive GLB stays in the browser foreground; the video is muted, looping, and does not own any device geometry. The generated artifact is recorded as `REVIEW_REQUIRED` in the ignored local handoff output until a reviewer signs off on rights, continuity, and foreground occlusion.

## OpenMontage API handoff

The production handoff is tenant-scoped and follows the existing private upload/review workflow:

1. Upload the generated background through `POST /api/v1/organizations/:organizationId/assets/upload-sessions`, complete it, attach the required active derivative-rights attestation, and approve the video source through the existing media-review route.
2. Create a locked brief with `POST /api/v1/openmontage/briefs` using the approved scene manifest and requested background prompt. The API re-checks approved model/video hashes and rights before persisting the brief.
3. Generate the background with OpenMontage, upload that exact output, then call `POST /api/v1/openmontage/artifacts` with the brief id and uploaded asset metadata. The API verifies the asset hash, byte length, media type, and exact scene video profile before storing `REVIEW_REQUIRED`.
4. A reviewer calls `POST /api/v1/openmontage/artifacts/:artifactId/approve` with review evidence. Only this call creates the approved `training-scene.v1` manifest, binds the OpenMontage provenance, and exposes the author/reviewer video endpoint.
5. The web client in `apps/web/src/openmontage-client.ts` calls the same handoff operations and uses the returned `videoUrl`; it does not substitute an unreviewed or independently hosted video.

The API route is wired in `apps/api/src/entrypoint.ts`, persisted in tenant-isolated OpenMontage tables, and covered by `pnpm openmontage:api:validate`.
