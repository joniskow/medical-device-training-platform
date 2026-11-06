# NxStage blue-tube clearance review

This isolated candidate extends `fixtures/nxstage-system-one-connector-review`. The earlier blue exterior tube intersected the cabinet door at its first three sampled positions. The lower part of the tube is shifted outward by up to 14 mm, with a gradual transition that leaves its upper end unchanged. The exact real tubing route is unmeasured, and the tube is not dynamically flexible.

The lower-door check compares the door with every other exported mesh at 25 sampled positions; this candidate produced no intersections. The tub check also passed at 101 sampled positions. A closed-position comparison found no new blue-tube intersections: its existing contact with the upper shelf remains. The office Chrome suite passed, including direct vent dragging, lower GO/STOP touch, doors, keyboard and touch. These checks are not continuous collision proof or physical-device testing.

To preview, set `NXSTAGE_OFFICE_REVIEW_FOLDER='fixtures/nxstage-system-one-blue-tube-review'` and run `node tools/serve-nxstage-interaction-office.mjs`. The model remains a review artifact; the upper cartridge chamber is simplified and treatment operation is not simulated.
