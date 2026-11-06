# NxStage deeper-body review

This separate visual study extends the rear of the cycler, shelf and cabinet and inclines its front control fascia using the supplied side photographs and an approximate published System One width and depth. It also approximates the molded support and fixed dark side-guide areas visible in the side views, and the plugged-in rear lead visible in the rear photograph. The pull-out tub is longer, with enough travel to expose its rear rim, based on the open-cabinet photograph. The photographed unit itself has not been measured. The guide details, support, fascia angle, tub depth and travel, empty upper cartridge chamber, cable routes, rocker positions and motion remain estimates; this is not a clinical or manufacturing model. It does not replace the shared model or the earlier interaction review.

The cabinet door's narrower, left-offset viewing opening is estimated from a partly open-door photograph. In the modeled closed position, the lower arrows are visible through the opening and the GO and STOP controls are covered; the photo does not prove the exact closed-door visibility. Named controls remain available as preview shortcuts even when geometry is out of view. `cabinet-window-review.png` records the modeled closed view.

In the office review, selected parts retain a subtle highlight so the photographed control-panel colors remain visible after use. `office-selected-panel-review.png` records the selected panel in the close office view; hover and keyboard feedback remain available.

The GLB is uniformly scaled to an approximate 0.381 m cycler-shell width. The distance from the inclined fascia to the rear shell is approximately 0.456 m and the shell is approximately 0.407 m high; attachment extents are not included. The scene places the model at scale 1 and scales the virtual camera and scene translation together to preserve the prior projected composition; the camera is not calibrated against measured room geometry. Its model hash and version bind the scene to this GLB. `study.json` records the source GLB hash and the width reference.

To preview from the workspace, build the contracts and model-runtime packages, then run:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-depth-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4310'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4310/demo?review=1`. The review server uses the generated photoreal walkthrough video under `output/generated/nxstage-doctors-office-walkthrough-v3/`, which is not included in this fixture. `blender/nxstage_system_one_depth_study.py` with `NXSTAGE_TUB_DEPTH_STUDY=1`, `NXSTAGE_FASCIA_TILT_STUDY=1`, `NXSTAGE_CYCLER_BASE_STUDY=1`, `NXSTAGE_CYCLER_GUIDE_STUDY=1`, `NXSTAGE_CYCLER_CORD_STUDY=1` and `NXSTAGE_CABINET_WINDOW_STUDY=1`, `tools/build-nxstage-interaction-review.mjs`, and `tools/build-nxstage-metric-study.mjs` generate the underlying study; the complete source photo set and Blender Python environment are required. The original and adjusted scene, model, animation and interaction scaling are checked by `tools/check-nxstage-metric-study.mjs` with the corresponding input, output and scene environment variables. `tools/check-nxstage-depth-study.py` checks the principal spatial relationships of the normalized geometry.

The isolated metric study passed the office Chrome suite for buttons, doors, tub, keyboard, touch and interlocks. The normalized study also passed direct mouse and touch checks, including direct use of the rear rocker; `rear-review.png` records the rear lead and `tub-open-review.png` the open container. `open-side-review.png` records the preceding guide study's approximate raised-handle position. A Blender mesh check found no intersections between the housing and handle at 13 sampled hinge positions; continuous and real-world clearances remain unverified. These are browser-emulation checks, not physical device or usability testing.
