# Reusing lesson narration

Hosted lesson renders now reuse unchanged raw speech across jobs, retries, rough cuts, final renders and scene revisions within the same organization and course version. Changing one scene's narration requests new speech for that scene; a visual or callout edit retains its narration. The worker still decodes, normalizes and measures every reused recording and applies current scene timing and review requirements.

The private object cache lives under `{organizationId}/derived/lesson-speech/{encodeURIComponent(courseVersionId)}/{inputHash}.json`. The input hash includes exact transcript, effective delivery controls, requested voice, locale, Azure Speech endpoint, cache revision and audio profile version. Object keys contain no transcript. Cached bytes are size bounded and checked against their saved SHA-256, content type, duration, voice and provider. Synthetic providers cannot populate or satisfy this cache. An unavailable, missing or invalid cache regenerates narration; a cache write failure does not discard valid new speech.

Set worker environment variable `LESSON_SPEECH_CACHE_REVISION` to a new value when changing provider/model behavior without changing the endpoint, or when deliberately refreshing all speech. Its default is `azure-speech-v1`. Published outputs retain lease-specific keys and fenced completion. Lease/cancellation checks run around cache access and synthesis. Cache reuse does not approve a recording or bypass current source/rights validation. Job narration evidence includes `reused`; job metrics report `narrationCacheHits` and `narrationSyntheses`.

Production storage automatically registers these objects as `LESSON_RENDER` retention resources, binding their ancestry to referenced assets in the saved course version. Existing source withdrawal suppression, legal holds, administrator-approved retention policies, tombstone/purge and write-receipt reconciliation therefore cover cached narration. Original ancestry remains attached if later course edits remove a source. Cache objects are reusable private derivatives, not published asset versions. Superseded keys require the existing explicit retention policy and scheduling workflow; this change does not invent an automatic deletion period. Concurrent misses can synthesize the same input twice; there is no distributed lock. Identical synthesis inputs share a key safely, and corrupt/incomplete writes are treated as misses.

Existing local composition caching in [the renderer](../apps/worker/src/lesson-render-job.ts) remains available for repeated renders into the same output directory. Hosted jobs still use temporary composition directories, so this change saves speech calls; it does not claim durable reuse of complete encoded scenes. No provider calls or cloud deployment are needed to verify the cache behavior.

Run the focused regression after building the worker:

```powershell
node tools/check-lesson-speech-cache.mjs
node tools/check-hosted-lesson-efficiency.mjs
node tools/check-lesson-speech-retention.mjs
```

These prove reuse across fresh wrapper instances, input invalidation, tenant/course/provider isolation, corrupted-byte recovery, cache-outage fallback, lease denial and synthetic-provider rejection using in-memory storage and provider doubles. The hosted test exercises the real job wrapper with a transport-only renderer double: repeating a two-scene render makes no additional speech requests, editing one scene makes one request, metrics/evidence reflect reuse and current source-rights checks still run. Media quality and deployed Blob transport remain separate acceptance checks.

With the documented disposable PostgreSQL/Azurite test services running, `node tools/check-retention-resources.mjs` verifies actual speech-cache resource classification/source ancestry, persisted ancestry after course edits, withdrawal suppression, explicit policy/tombstone/purge and denial of cache resurrection. This check passed locally; it is not Azure deployment evidence.
