# NxStage interaction review model

This is an isolated, unmeasured visual reconstruction for review. It is separate from the shared interactive and cinematic assets. Its distinct preview model version, model manifest, and draft office scene are bound to the GLB hash. It has not been approved for production or clinical instruction.

The model contains the corrected cycler controls, upper handle and sliding door, lower cabinet and tub, PureFlow and warmer controls, and the rear switch. The curved front face and single row of vents are based on the supplied `20261020_130849.jpg` and `20261020_131018.jpg`; a fixed lower-cabinet housing is based on `20261020_130843.jpg` and `20261020_131015.jpg`. Rear perforations, louvers, and an external canister and tubing are based on `20261020_131259.jpg` and `20261020_131328.jpg`. Their dimensions and the tubing route are estimated, and the front's shading is illustrative. The warmer bars are an illustrative local preview response; electrical power, heating, fluid operation, treatment values, and the cartridge compartment are not simulated. The rear switch travel and on/off orientation, dimensions, and hidden surfaces remain estimates. The label shapes on the rear panel are intentionally unreadable.

To run the preserved model locally, install the workspace dependencies, build the model-runtime package, and run `node tools/serve-nxstage-interaction-review.mjs`. Open `http://127.0.0.1:4215/` (or set `NXSTAGE_REVIEW_PORT` before starting it). The server compiles the current player source and serves this fixture; it does not require the earlier candidate folders. The warmer response and focus buttons are local review features. The initial and reset views fit the complete device; **Fit model** fits it from the current angle. The focus shortcuts orient the view toward the front or rear of the chosen part. Focusing the lower panel while the cabinet is closed explains that part of the panel may be obscured; the visible controls remain accessible.

**Focus tub** looks down into the tub when it has been pulled out, and uses a front view when it is pushed in. `tub-open-review.png` records the open view; the empty container and its unmeasured travel are visual approximations.

To view the same preserved model in the office scene, build the contracts package and run `node tools/serve-nxstage-interaction-office.mjs`, then open `http://127.0.0.1:4216/` (or set `NXSTAGE_OFFICE_REVIEW_PORT`). This review serves the saved model and hash-bound scene, compiles the current demo source, and uses the supplied clinical draft image when it loads. It omits older static composite thumbnails because those show a different model. **Enlarge scene** and **Close view** retain the same live model state. After selecting **Interact with model**, **Explore model** allows rotation and zoom against a neutral backdrop; **Return to office** restores the aligned photo and camera without resetting the model.

For the office browser check, start both server and test with `OFFICE_REVIEW_TEST=1`, then run `node tools/check-nxstage-interaction-office-browser.mjs`. It covers switch and warmer controls, doors and tub including partial-position feedback, exploration and reset, phone-sized touch rotation and pinch zoom including cancellation, enlarged and close views, the visible photo, and the failed-photo fallback.

With the server running, `node tools/check-nxstage-interaction-review-transfer.mjs`, `node tools/check-nxstage-interaction-review-touch.mjs`, `node tools/check-nxstage-interaction-review-mobile.mjs`, and `node tools/check-nxstage-interaction-review-browser.mjs` verify transfer integrity and interaction behavior. The mobile check also verifies that switching from a tub drag to a pinch restores its previous position without submitting a movement. The browser checks use Chrome; the broader and mobile checks save review screenshots under `output/nxstage-interaction-review/`.

The authoring source is `blender/nxstage_system_one_interaction_review.py`. It expects the user's 20 source photographs in `output/nxstage-system-one-photos/`; those source files are not included in this fixture. It writes to the separate `nxstage-system-one-interaction-review` asset folder and saves a uniquely named Blender file. To rebuild without rendering, set `NXSTAGE_SKIP_RENDER=1` and run Blender from the workspace root with that script. `NXSTAGE_OUTPUT_ROOT` can redirect all generated output to a separate directory.

After rebuilding this fixture, run:

```text
pnpm --filter @medical-device/model-runtime build
pnpm --filter @medical-device/contracts build
node tools/build-nxstage-interaction-review.mjs
node tools/build-nxstage-interaction-review-scene.mjs
node tools/check-nxstage-interaction-review.mjs
```

The model builder updates only this review fixture by default. The scene builder checks the background video and cue bindings before updating this review scene; neither builder updates the shared release assets. The panel and rear screenshots document this candidate's appearance and are review evidence, not measured references.
