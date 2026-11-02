# 3D fidelity and tactile interaction follow-up

Date: 2026-11-01

The existing backlog and plans are preserved in legacy encoding. This focused addendum targets the two remaining gaps called out by the current model evidence: the detailed Blender reconstruction is not dimensionally validated, and browser clicks currently select whole components without a realistic press affordance.

## Task F3D-1 — Make fidelity evidence explicit

- [x] Add bounded model/reconstruction provenance and uncertainty metadata to the Blender scene generator and browser manifest contract.
- [x] Ensure the UI distinguishes measured/reference-backed properties from visual assumptions.

Verification: typecheck/build, manifest validation, and review of generated source metadata.

## Task F3D-2 — Add realistic local press feedback

- [x] Support capability-gated pointer down/up press feedback with a bounded depth and no score mutation.
- [x] Preserve click selection, keyboard/component-list equivalence, authoritative action transport, and safe disposal/context-loss behavior.

Verification: browser runtime contract plus Chrome interaction check for pointer press/release, selection, keyboard path, and fallback behavior.

## Task F3D-3 — Reconcile the photo-grounded Blender scene

- [x] Add the missing upper accessory case/platform and its visible fasteners.
- [x] Match the photographed lower cart asymmetry with an offset service/control face, connector strip, and warning label.
- [x] Attach stable interaction metadata to the real-device front controls so later GLB export does not infer behavior from mesh names.
- [x] Author short Blender press/release clips on the tagged controls for visual review and export.
- [x] Harden pointer capture/cancellation so a drag that leaves a control cannot leave it visually stuck.

Verification: Blender source compiles, Blender 5.2.3 exports the runtime GLB and preview render, and the isolated Chrome check loads that exact hash. The browser evidence covers all four front-control press/release paths, cancellation, panel selection, camera framing, and console errors. The exported artifact contains 232 meshes, 77,730 triangles, 15 materials, and four named press targets.

## Task F3D-4 — Put the reconstruction on the demo path

- [x] Copy the NxStage GLB and manifest into the web demo build output.
- [x] Load the NxStage artifact, front-facing camera, and named control-panel selection when the sample photo reconstruction is approved.
- [x] Keep the existing Aurora learner/release route unchanged until a separate release-bound asset is approved.

Verification: web build succeeds and the exact NxStage GLB/manifest are present in `apps/web/dist/model`.

## Checkpoint

- [x] Browser build succeeds.
- [x] Existing model/session/reconstruction checks remain green.
- [x] The experience never claims dimensionally validated or clinically/manufacturing-accurate geometry without evidence.
- [x] Browser evidence records local press/release/cancel behavior with zero console errors.
