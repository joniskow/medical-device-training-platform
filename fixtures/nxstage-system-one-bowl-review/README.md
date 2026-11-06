# NxStage front-bowl interaction review

This preserved, isolated review candidate extends the handle-gap model with an estimated concave upper-door front and photo-informed shading. Its geometry, lighting and hidden cartridge compartment have not been measured or verified against the physical device. It does not simulate treatment, electrical power, fluid operation or treatment settings.

The office Chrome interaction suite passed, including a direct partial drag from the recessed face, handle and upper-door movement, the lower door and tub, buttons, keyboard and touch. The upper-door and handle clearance checks sampled 25 and 101 positions respectively; the only detected handle contacts were its intended pivot fasteners. These checks do not prove continuous clearance or usability on physical devices. `office-close-review.png` records the office rendering.

To serve this candidate from the workspace:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-bowl-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4346'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4346/demo?review=1`. To package it, start the preview without `OFFICE_REVIEW_TEST`, then run `node tools/package-nxstage-interaction-review.mjs` with the same folder and port environment variables. `NXSTAGE_PACKAGE_FOLDER` selects the output location. The packaging tool checks that the served GLB matches the selected folder and that the model, scene and video hashes agree. This fixture is independent of the shared production and other review assets.

The separate model-viewer checks can use `tools/serve-nxstage-interaction-review.mjs` with `NXSTAGE_REVIEW_MODEL_FOLDER` set to this fixture. For the desktop check, set `NXSTAGE_CABINET_WINDOW_STUDY=1`: this candidate's cabinet opening covers GO when the door is closed. The desktop and phone-sized Chrome checks both passed with this model; they use browser emulation.

To compare it with the current application model, set `NXSTAGE_INTEGRATION_REVIEW_FOLDER='fixtures/nxstage-system-one-bowl-review'` and run `node tools/check-nxstage-interaction-integration.mjs`. Set `NXSTAGE_INTEGRATION_REPORT` to choose the report path. The comparison checks model/scene bindings, target changes, component transform changes and scene placement; it does not migrate lessons or persisted sessions.
