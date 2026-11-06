# NxStage surface-fitted vent review

This isolated candidate extends `fixtures/nxstage-system-one-vent-review`. Its 17 dark vent markings follow the estimated front housing instead of floating above or disappearing behind it. They are surface markings, not modeled openings, and their shape and depth are unmeasured. The markings remain attached to the moving upper door.

Blender ray checks found all 17 slot centers visible from the front, and sampled upper/lower portions of five slots remained visible near the surface. The upper-door and handle clearance checks sampled 25 and 101 positions; only the intended handle-pivot contacts remained. The office Chrome suite passed, including direct door dragging, buttons, keyboard and touch. These checks do not establish continuous clearance or physical-device usability.

With `OFFICE_REVIEW_TEST=1` on the server and `NXSTAGE_TEST_VENT_DRAG=1` on the office browser check, the test also starts a partial door drag directly on the central fitted vent marking from a close front-oblique view. This confirms that the decorative surface can pass picking through to the door in that view.

The separate desktop model-viewer check also pressed all eleven front-panel targets in a front-facing view. Each moved away from the camera while held, returned to its resting position and produced one accepted preview action. This checks direction and interaction feedback, not measured physical button travel.

`pressed-panel.png` records the Add Fluid button while held in that view; the photo-derived icon remains aligned and the viewer highlights the active control. Set `NXSTAGE_PRESS_SCREENSHOT` to a destination when running the desktop check to capture the same state again.

To preview, set `NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-vent-conform-review'` and run `node tools/serve-nxstage-interaction-office.mjs`; the default local port is 4216. This review does not replace the application model, and the hidden cartridge compartment remains simplified.

For the saved-model contract check, set `NXSTAGE_REVIEW_MODEL_FOLDER` to this fixture, `NXSTAGE_EXPECTED_MODEL_VERSION='preview:nxstage-vent-conform-v1'` and `NXSTAGE_EXPECTED_VENT_COUNT=17`, then run `node tools/check-nxstage-interaction-review.mjs`. The model/scene/video hashes, controls and interlocks were verified. A portable office review was also packaged and tested independently; it is generated under `output/nxstage-vent-conform-study/portable-review`.
