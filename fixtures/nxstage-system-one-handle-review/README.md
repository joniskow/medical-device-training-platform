# NxStage handle and door review

This isolated photo-informed candidate builds on `fixtures/nxstage-system-one-cabinet-review`. The supplied side photographs show a dark recessed guide at the door seam and a separate tapered handle arm. The earlier candidate represented both of those and an additional pair of full-height bars with angled mounts. This comparison removes the four additional, non-interactive bar and mount meshes; the recessed guides, articulated handle arms, crossbar and side fasteners remain. The closed front silhouette was compared with the supplied photographs. The actual hidden mechanism and the open configuration are not established, so this is an inference rather than a verified reconstruction.

`tools/build-nxstage-rail-comparison.mjs` builds this candidate from the preserved cabinet-review model. The upper-door inspection found no mesh-surface intersections with other exported meshes at 25 sampled door positions. The handle arm and door shell still report a shared boundary at some sampled handle positions, with a measured bounding-box overlap near 15 nanometers, consistent with coincident surfaces. The lower-door and tub checks passed at 25 and 101 sampled positions respectively. These checks do not prove continuous clearance or physical accuracy. The office Chrome suite passed, including direct partial pull and reverse push of the upper door, buttons, the lower door, tub, keyboard and touch.

`office-close-review.png` and `upper-partial.png` record the comparison views. The upper cartridge chamber remains simplified; treatment and fluid operation are not simulated. Earlier candidates and the shared asset remain unchanged.

To preview from the workspace:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-handle-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4310'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4310/demo?review=1`. The preview uses the generated walkthrough video under `output/generated/nxstage-doctors-office-walkthrough-v3/`.
