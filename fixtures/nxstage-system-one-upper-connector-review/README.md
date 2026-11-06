# NxStage upper connector visual review

This candidate builds on the lower-housing review. The supplied open-cabinet photographs show a yellow-ringed fitting above the red and light-colored fittings on the blue strip. The candidate adds a fixed visual approximation of that fitting and adjusts the strip's extent. The exact dimensions, fittings and connections are unmeasured; no plumbing behavior or connector interaction is modeled. `interior-final.png` shows the local browser render.

Run `node tools/build-nxstage-upper-connector-study.mjs` to reproduce the candidate in `output/nxstage-upper-connector-study`. The GLB, manifest and scene share SHA-256 `8e9d2d4783866b191dccc87131b7841776308580f9bda53b8f939a4bbb3cfbf4` and version `preview:nxstage-upper-connector-study-v1`. The prior lower-housing fixture remains available.

The model/scene contract and candidate browser interaction suite passed. No intersections were found at 91 sampled lower-door and 531 tub positions; these are discrete samples, not a continuous clearance proof. The upper cartridge chamber remains simplified; device operation and electrical power are not simulated.
