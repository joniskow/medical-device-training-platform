# NxStage round lower-panel STOP review

This isolated candidate extends `fixtures/nxstage-system-one-vent-conform-review`. The supplied open-cabinet photo `20261020_130843.jpg` shows a round red lower-panel button; the previous review used an octagon. This candidate makes both that button and its bezel round, retaining the red material and the separate `PF-C01-STOP` press target. Size and press travel are estimates. The green GO button and the octagonal red STOP on the upper cycler panel are unchanged.

The office Chrome suite passed, including direct touch on both magnified lower-panel buttons, the upper vent drag, doors, keyboard and other controls. `office-mobile-lower-magnified.png` records the revised button. The saved-model contract check passed for 17 vents, control targets, interlocks and scene hashes. These checks use browser emulation; they do not verify clinical operation or measured geometry.

To preview, set `NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-round-stop-review'` and run `node tools/serve-nxstage-interaction-office.mjs`. The upper cartridge chamber remains simplified; this fixture does not replace the shared application model.
