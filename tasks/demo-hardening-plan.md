# Demo hardening plan — 2026-10-31

## Objective

Make the implemented PDF and image ingestion path runnable locally for a stakeholder demo without weakening production authentication, tenant scope, private storage, review-required states, or source-grounded authoring.

## Task list

### D1 — Local demo runtime

- [x] Add an explicit demo-only API/worker launcher using local PostgreSQL and Azurite.
- [x] Reuse the existing upload session, job/outbox, PDF extraction, media inspection, knowledge, and review stores.
- [x] Use a fixed local demo principal only when the launcher is invoked; production entrypoints remain unchanged and fail closed.

### D2 — Demo browser entry

- [x] Add a `/demo` page that visibly labels demo mode and automatically selects the fixture organization.
- [x] Preserve the existing upload, job status, source review, course draft, and media review UI.
- [x] Keep the normal `/author/jobs` Microsoft sign-in path unchanged.

### D3 — Demo verification

- [x] Provide a single documented command that starts local infrastructure, builds, and launches the demo.
- [x] Verify a real PDF reaches review-ready extraction and a real image reaches review-ready media inspection.
- [x] Verify the API, worker loop, private Azurite artifacts, and browser page are reachable together.

## Acceptance criteria

- [x] A stakeholder can open the local demo page without Entra configuration.
- [x] A PDF upload reaches `SUCCEEDED` / `REVIEW` and exposes extracted page-cited passages.
- [x] An image upload reaches `SUCCEEDED` / `REVIEW` and exposes a private preview/report through the existing review flow.
- [x] Production entrypoints still require their existing authentication and Azure messaging configuration.

## Verification

- `pnpm demo`
- Focused demo smoke check
- Full TypeScript build and typecheck
