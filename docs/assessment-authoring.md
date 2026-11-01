# No-code assessment question editing

The author workspace supports adding single-choice, multiple-answer and ordered-step questions within an assessment, up to the existing 100-question schema limit. Each question has a labeled fieldset for its prompt, points, competencies, reviewer rationale, options and source citations. New questions retain selected source-document references and fresh stable IDs. Authors can move questions up/down and remove a question after confirmation; the last question cannot be removed.

Answer options can be added up to the schema limit of 20 or removed with confirmation while retaining at least two. Removal deletes the corresponding correct-answer reference. A removed sole correct choice must be replaced before publication; the existing production validation gate remains authoritative. Ordered-step controls display the stored correct sequence even if it differs from delivery-option order, move steps in both directions and preserve the complete answer sequence on edits. Reordering/removal preserves surviving question and option IDs. Added/moved question controls retain keyboard focus after rendering.

The changes use the existing draft autosave, revision conflict, recovery, audit and review/publication path. Incomplete questions can remain drafts but cannot pass the existing publication schema gates. Published releases remain immutable.

A related regression was found through focus testing: after the managed sign-in migration, the author page did not reveal its sections when loaded with a stored session. Startup now restores the signed-in author controls and sign-out continues to hide/clear them. This is presentation state only; API authorization remains enforced.

## Evidence

`tools/check-course-editor-browser.mjs` now checks actual workspace visibility before exercising controls, adds all three question types into one assessment, saves question ordering/deletion, cancels deletion, removes options and answer references, checks minimum counts, preserves imported ordered sequences, checks focus and retains citations. The actual saved mixed-question assessment is validated and scored using production assessment code. Existing autosave/pending-save, recovery/conflict, successor-draft and sign-out cases continue to pass. Full build, architecture, assessment schema/scoring and sign-in browser regressions pass locally.

The browser uses controlled API responses; these tests are not live Azure publication acceptance. Complete simulation/branch editors, asset binding UX, production conversational AI authoring and full accessibility/device acceptance remain open.
