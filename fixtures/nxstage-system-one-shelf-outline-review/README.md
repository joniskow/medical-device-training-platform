# NxStage shelf-detail visual review

This candidate builds on `fixtures/nxstage-system-one-shelf-notch-review`. The supplied front photograph shows two shallow outlined pads near the front of the white shelf. The previous model placed its pads under the cycler support, where they could not be seen. This version moves them to the exposed front lip, narrows them to fit, and adds fine decorative outlines. Their dimensions, shape and position are estimates from the photograph, not measurements.

Generate the candidate with `node tools/build-nxstage-shelf-outline-study.mjs`. Its GLB, manifest and office scene share SHA-256 `57405b72f3b9185d7f7a209ad8d8a2aba032f9e3a6cc508202c944ca8804d19f` and model version `preview:nxstage-shelf-outline-v1`. The prior candidate remains separate. `shelf-final.png` captures a close view of the new detail.

The GLB and scene contract check passed. Blender surface checks found no unexpected intersections at 81 upper-door, 91 lower-door and 531 tub positions; the handle retained its expected pivot-fastener contacts at 101 positions. These are discrete samples, not continuous-clearance proofs. The office browser suite passed direct manipulation, named controls, keyboard and emulated touch. The application preview suite checks rendering, direct touch, partial tub drag, interlocks, warmer feedback and version isolation.

The application visual review at `/learner/model?preview=1&model=nxstage-review` uses this candidate. The upper cartridge compartment remains simplified, and treatment, temperature and electrical power are not simulated. This review is not a published lesson or a dimensional or clinical validation.

The sample creator screen also links to `/demo?model=nxstage-review`, where the model uses the matching review scene and photo-backed video. This option is labeled as a visual review, preserves custom narration, omits the unrelated demo lesson timer, and does not offer course publication. The cinematic path remains bound to its existing baked asset. The regular lesson and release-bound sessions are unchanged. The local application browser check covers these bindings and the illustrative warmer feedback.

The demo visual review includes an Explore mode that hides the room while users move the camera and focus on groups of controls. Returning restores the aligned room view. The application browser check exercises a direct button press in Explore mode and the return to the room; its phone interaction checks use emulated touch in the standalone model view.

The application browser check also loads the demo at 390 x 844 with emulated touch, enters Explore, opens the control-group list, focuses the left buttons, presses Volume Toggle on the model, and returns to the room. Responsive grid sizing was corrected so the model and controls fit the narrow card. This is browser emulation, not a physical-phone test.

On narrow screens, Explore reserves separate areas for the model, status, and two touch-sized scene actions. The emulated phone test checks that these areas do not overlap and still operates the Volume Toggle directly. The surrounding card can still shift horizontally during focus and needs further investigation.

The subsequent phone layout fix resolved the card shift described above: the background-generation panel now wraps its long status and fits its controls to the available width. The emulated-phone regression asserts the card has no horizontal overflow or scroll after focusing the model.

Demo Explore also provides close-ups for the cycler handle, upper door, lower cabinet door and PureFlow tub. The emulated phone test directly taps each moving part and verifies the cabinet must be open before focusing the tub. The close-up follows the lower door's angle.

The phone browser regression also opens the parts, exits and re-enters interaction, confirms the extended tub still blocks cabinet closure, then retracts and closes the parts. A stale blocked-action message previously masked feedback on the next hovered control; the runtime now clears it when moving to another target.

The separate candidate-review harness was updated to apply its intended front camera after the application acquired its own camera option. Its browser suite passed against this fixture with the cabinet-window setting, including full-model fit, door and handle dragging, presses and touch cancellation.
