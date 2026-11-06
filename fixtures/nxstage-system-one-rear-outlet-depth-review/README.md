# NxStage recessed rear connector visual review

The supplied rear photograph (`output/nxstage-system-one-photos/20261020_131259.jpg`) shows an unused recessed connector left of the pole. This candidate replaces the previous flat approximation with four shallow modeled walls and a recessed surface. Dimensions, contact markings and the surrounding panel remain estimates; small printed labels are omitted. The detail is fixed and does not simulate an electrical connection. `connector-preview.png` shows an angled browser render.

Run `node tools/build-nxstage-rear-outlet-depth-study.mjs` to reproduce it in `output/nxstage-rear-outlet-depth-study`. The GLB, manifest and scene share SHA-256 `613a9b96a53f2f4384757aa838ef2ced04cd9aec16e98a17ed6e1edd86bb6a8c` and version `preview:nxstage-rear-outlet-depth-study-v1`. The earlier flat connector candidate remains available.

The model/scene contract, desktop interaction suite and emulated-phone interaction suite passed. Geometry inspection confirmed each of the four fixed walls has depth and no interaction target.
