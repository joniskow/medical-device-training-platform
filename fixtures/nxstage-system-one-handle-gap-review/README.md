# NxStage handle-clearance review

This isolated candidate builds on `fixtures/nxstage-system-one-handle-review`. Each handle arm is offset 0.5 mm outward along the hinge axis to separate a nearly coincident arm and door-shell boundary. The offset is an approximate model adjustment, not a measured gap on the photographed device. The preserved earlier candidate can be used for comparison.

`tools/build-nxstage-handle-gap-study.mjs` constructs the candidate. Blender surface checks report no upper-door intersections with other exported meshes at 25 sampled door positions, and no handle intersections except each arm's contact with its pivot fastener at 101 sampled handle positions. At five sampled positions, both arms intersect their crossbar and fasteners as intended. The lower-door and tub checks passed at 25 and 101 sampled positions. These checks cannot establish continuous clearance or real-device geometry. The office Chrome suite passed for a direct handle lift and canceled drag with visible return, direct upper-door dragging, buttons, lower door and tub, keyboard and touch.

The hidden upper cartridge chamber and actual rail mechanism remain unverified. Device treatment and fluid operation are not simulated. `office-close-review.png` records the candidate in the office scene.

The office browser check also uses a synthetic pointer event to re-grab the handle during a canceled drag's return animation and confirms that it does not jump before the next drag. This is not a human usability study.

To preview from the workspace:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-handle-gap-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4310'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4310/demo?review=1`. The preview uses the generated walkthrough video under `output/generated/nxstage-doctors-office-walkthrough-v3/`.
