# Published fault failure rules

The author simulation editor offers REJECT_AND_REMAIN and INVALIDATE_SESSION for each existing fault. The shared deterministic engine applies the published rule to a semantic action that fails the active diagnosis/resolution requirement. Invalidation retains the prior score, advances the terminal sequence, prevents later completion, and rejects subsequent actions. Malformed envelopes, replayed actions and stale sequences do not trigger this rule.

The model-session service validates ownership, enrollment, release binding, sequence, component and transform bounds before evaluating simulation actions. Component selection used only for navigation, reset and hint requests do not constitute fault answers. Selection advances a fault when its current diagnosis/resolution expects selection, independently of the procedure step's action type.

On invalidation, one database transaction marks the session and attempt INVALIDATED, stores the terminal action response and writes SIMULATION_FAULT_INVALIDATED audit evidence. The failed transform is not applied, previous score remains historical, and no completion event or credential is created. Audit failure rolls back all writes. Identical concurrent requests return the same terminal response; changed payloads and other learners cannot replay it. Resume is denied. Existing published cooldown and attempt-allowance rules govern subsequent attempts; invalidation cannot grant a pass.

## Local verification

Run after installing workspace dependencies and starting the local fixture database:

```text
pnpm build
node tools/check-simulation-schema.mjs
node tools/check-e4-postgres-session.mjs --fault-invalidation
node tools/check-e4-postgres-session.mjs
node tools/check-course-editor-browser.mjs
node tools/check-e4-release-session-browser.mjs
node tools/check-model-player-contract.mjs
pnpm architecture:test
```

These checks passed on 2026-10-30. The fault PostgreSQL test publishes an actual fixture release, triggers a fault after a transform, completes selection-based diagnosis, and rejects an incorrect resolution. It checks rollback, stale requests, concurrent retries, owner/payload isolation, retained geometry/score, exactly one terminal action/audit, no credential/completion, denied resume and cooldown. The pure engine covers both rules, malformed/stale/replayed actions, terminal rejection and successful fault resolution. Chrome authoring checks rule changes and terminal preview with no learner API calls.

The PostgreSQL rehearsal uses the fixture administrator connection and controlled storage/authentication. It does not establish restricted-runtime fault acceptance, live identity-provider behavior, physical-device acceptance or Azure deployment readiness. Existing documentation entries predating this increment describe the earlier runtime gap. New simulation/model binding, step/fault creation, complete branching and broader MVP work remain outstanding.
