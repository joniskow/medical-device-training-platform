# NxStage lower-connector clearance review

This candidate extends `fixtures/nxstage-system-one-round-stop-review`. The earlier model's lower connector tubing and yellow clip intersected the closed cabinet door. This study shifts the connector strip, fittings, tubing and clip together by 6.5 mm toward the cabinet interior, preserving their relative positions. The offset is an estimate, not a device measurement.

The expanded Blender clearance check includes the connector assembly: it finds the earlier overlap at the closed position and finds none in this candidate across 25 sampled lower-door positions or 101 sampled tub positions. The office Chrome suite passed, including direct touch on lower-panel GO and STOP, upper-vent dragging, doors, keyboard and touch. These checks do not establish continuous clearance or clinical operation.

To preview, set `NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-connector-review'` and run `node tools/serve-nxstage-interaction-office.mjs`. This isolated review does not replace the shared application model; the upper cartridge compartment remains simplified.
