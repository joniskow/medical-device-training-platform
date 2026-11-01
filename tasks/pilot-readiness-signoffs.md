# Pilot readiness sign-offs

This file turns the approved requirements into an executable configuration gate. The baseline invariants are implemented in `config/pilot-readiness.json` and checked by `pnpm pilot:validate`.

## Implemented baseline

- Personal Azure is the deployment boundary.
- Azure OpenAI/Microsoft Foundry is the only AI provider boundary.
- PostgreSQL full-text plus `pgvector` is the pilot retrieval baseline.
- WebGL2 is required; WebGPU is optional.
- Approved model interactivity target is five seconds and the frame-rate target is 30 FPS.
- Non-3D surfaces target WCAG 2.2 AA and every certification-critical 3D activity requires an equivalent path.
- No-PHI, rights-attestation, discovery-off-by-default, online-only verification, and non-licensure credential boundaries are enforced as configuration invariants.
- Pilot RPO is 15 minutes.

## Still requires explicit owner approval or measured evidence

- Exact AI deployment, region, model, API version, OCR/transcription path, and token limits.
- Versioned browser/OS/device profiles.
- Source retention duration and legal-hold owner.
- Numerical budget, concurrency, token, and alert thresholds.
- Restore region and restore rehearsal.
- Issuer-facing credential wording.

## Closed readiness values

The 2026-10-31 readiness closure records the following pilot defaults:

- AI OCR uses the worker-local Poppler/Tesseract English path (`worker-local-poppler-tesseract-english-v1`). Audio transcription is explicitly disabled for this pilot; no transcription capability is advertised.
- Supported browser/device classes are Windows 11 desktop Chrome and Edge, iOS/iPadOS Safari, and Android Chrome, each on the latest two browser versions and using the WebGL2 baseline. The existing E4 matrix remains the evidence record for physical-device rehearsal; this config records the support target.
- Source and derived training material retention is 365 days by default. Legal holds override normal retention and are owned by the security/privacy/legal owner role.
- Pilot economics are capped at $500/month, four concurrent jobs, 4,000 AI tokens per run, with operator alerting at 80% of the monthly budget. Cost-intensive work remains idempotent, metered, bounded, and pausable.
- The restore region is `southeastus`, paired with the East US primary boundary and the existing 15-minute RPO target.
- Issuer copy is: “This credential is an organization-issued platform certification for completion of {courseTitle} training. It is not a professional license, accreditation, regulatory approval, or portable cryptographic credential.”

`pnpm pilot:validate -- --strict` is the executable closure gate. Physical-device rehearsal, restore rehearsal, and legal/issuer review evidence remain separate acceptance evidence and must not be inferred from the presence of configuration values.
