# NxStage 17-slot vent review

This isolated candidate builds on `fixtures/nxstage-system-one-bowl-review`. It uses 17 front vent slots, counted in the supplied `20261020_130849.jpg` front view; the slot size, position and curvature are estimates. The slots remain decorative children of the moving upper door. The candidate's model, manifest and scene are hash-bound.

The office Chrome suite passed, including direct dragging from the recessed face, buttons, keyboard, touch, lower door and tub. Blender surface sampling found no upper-door/fixed-mesh intersections at 25 positions; the handle had only the intended pivot-fastener contacts at 101 positions. Sampling does not prove continuous clearance. The photo-informed shading is an estimate and the hidden cartridge compartment is simplified.

To preview, set `NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-vent-review'` and run `node tools/serve-nxstage-interaction-office.mjs`; the default local port is 4216. This is a review fixture and does not change the shared application model.
