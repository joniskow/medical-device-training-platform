# NxStage cabinet-clearance review

This isolated candidate builds on `fixtures/nxstage-system-one-clearance-review`. The broader check found that the lowered tub intersected a caster fork, and that the retracted tub overlapped rear service fittings that had been modeled inside the cabinet wall. The candidate shortens the upper ends of the four modeled caster forks while retaining their lower ends at the wheels, and moves the lower rear fittings, canister and associated cables 42 mm rearward so the service cover sits outside the rear wall. These positions and cable routes remain visual estimates, not measurements of the photographed device.

`tools/build-nxstage-cabinet-clearance-study.mjs` constructs this candidate without changing the preserved earlier model. `tools/check-nxstage-tub-clearance.py` checks 25 sampled door positions against the principal cabinet parts and 101 sampled tub positions against all other exported meshes. No mesh-surface intersections were found at those poses. This does not establish continuous clearance, detect complete containment, or validate physical dimensions. The office Chrome suite passed for the candidate's controls, doors, tub, touch and keyboard. `office-rear-cabinet-full.png` and `office-tub-partial.png` record the candidate views.

The upper cycler door still intersects the modeled fixed side rails during part of its travel. An expanded inspection of the other exported meshes found no additional door intersections at 25 sampled positions. The office Chrome check also pulls the door partly open and pushes it back by direct mouse drag from an oblique view. The mechanism and cartridge chamber are not established by the available photographs. Device treatment and fluid operation are not simulated.

To preview from the workspace:

```powershell
$env:NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-cabinet-review'
$env:NXSTAGE_OFFICE_REVIEW_PORT='4310'
node tools/serve-nxstage-interaction-office.mjs
```

Open `http://127.0.0.1:4310/demo?review=1`. The preview uses the generated walkthrough video under `output/generated/nxstage-doctors-office-walkthrough-v3/`.
