# Scene alternatives and targeted revision

The author scene editor exports the saved lesson, imports take manifests, compares matching videos and explicitly selects a reviewed take. Selection saves through the existing draft API and clears assembly, rough-cut acceptance and final review. Changed source identity, narration, evidence or shot specifications make the selection stale. Inspect complete motion and neighboring states; endpoint state strings are a conservative continuity check, not visual proof.

Generation currently runs through the developer command, using application-controlled composition of an approved image or video. It does not generate new device mechanics or automatically repair clinical content. A detail framing correction crops ten percent; review warnings and labels before selection. Other defects require correcting the shot/source first, which invalidates older takes.

1. Export the lesson using **Export current lesson for scene generation**.
2. Create a correction file such as `{"sceneId":"scene:one","framing":"detail","correction":{"atSeconds":5,"defect":"Label too small","requestedCorrection":"Increase framing detail"}}`. The timestamp uses the lesson timeline.
3. Supply approved local assets as `{"asset:one":{"path":"C:/approved/device.png","approved":true}}`, with the exact asset version from the lesson. Only use approved media from your organization's authorized export workflow.
4. Run `node tools/generate-lesson-scene-take.mjs lesson.json correction.json approved-assets.json output/scenes`. Build schema and worker packages first. Set `LESSON_FFMPEG` and `LESSON_FFPROBE` when binaries are outside PATH.
5. Import the emitted take manifest in the scene editor, load the matching MP4, compare every candidate against the same shot and evidence, then select explicitly. Retain the exported lesson file for further attempts: reservations are saved before generation and failed attempts remain charged.
6. Save the author draft, export the current lesson and generate a new rough cut. Final composition reuses selected visual files by hash, adding the unchanged narration, captions and callouts. Review the complete final assembly again.

The default budget is 12 attempts per lesson and three per scene, with hard ceilings of 48 and four. Imported manifests cannot raise the saved budget or remove consumed attempts. These are application attempt bounds, not a financial accounting system; do not run independent copies of a lesson as concurrent paid generation jobs. The controlled provider is local FFmpeg and incurs no paid model calls. Durable centralized paid-provider budgeting remains outside this increment.
