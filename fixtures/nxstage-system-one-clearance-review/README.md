# NxStage tub-clearance review

This version is preserved for comparison. A broader check subsequently found tub intersections with a caster fork and rear fittings; see `fixtures/nxstage-system-one-cabinet-review` for the revised candidate.

This isolated candidate builds on `fixtures/nxstage-system-one-depth-review`. The earlier model's tub front and rim intersected the fixed lower controller at rest; its back rim also intersected that controller near the end of its travel. The candidate lowers the tub by approximately 14.6 mm and the cabinet floor by approximately 4.3 mm in the metric study. These are model adjustments, not measurements of the photographed device.

`tools/build-nxstage-tub-clearance-study.mjs` constructs the candidate from the preserved depth-review model. `tools/check-nxstage-tub-clearance.py` imports the result and checks mesh-surface intersections at 25 sampled lower-door positions and 101 sampled tub positions, including the fixed cabinet and controller. It does not prove continuous clearance or physical fidelity. The office Chrome suite also passed for the candidate's controls, doors, tub, touch and keyboard. `office-tub-partial.png` shows the partially extended tub in the office scene.

The previous depth-review model and the shared asset are unchanged. Its other limitations still apply: the upper cartridge chamber and partly obscured cable routing are approximate, and treatment or fluid operation is not simulated.

To preview this candidate from the workspace:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-clearance-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4310'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4310/demo?review=1`. The preview uses the generated walkthrough video under `output/generated/nxstage-doctors-office-walkthrough-v3/`.
