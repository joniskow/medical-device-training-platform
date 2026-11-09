# Certification API completion and acceptance

The certification integration contract is version 0.2.0. It extends the existing learner API and generated client; it does not create a second backend. Course review/save/publication, assignments, reading acknowledgment, assessment start/read/submission, credential issuance/list/sharing/revocation/supersession and anonymous verification now have typed generated methods. Independent email verification start/complete/revoke methods are also typed, using the signed account identity without requiring an organization. Mutation retries remain explicit. The server owns immutable release bindings, private assessment answers, eligibility and exactly-once issuance.

## Run focused local validation

Build contracts, API and api-client using the workspace build. Then run, serially when sharing PostgreSQL:

```powershell
node tools/check-certification-api-client.mjs
node tools/check-prepared-certification-acceptance.mjs
node tools/check-assessment-sessions.mjs
node tools/check-credentials.mjs
node tools/check-requalification-credentials.mjs
node tools/check-e4-postgres-session.mjs --runtime-role --semantic-actions
```

The first check runs the generated client against the production HTTP handler with controlled service dependencies. It checks route/status compatibility, idempotency headers, revision conflicts, lifecycle payloads, anonymous verification and generated OpenAPI drift. The second verifies acceptance-runner orchestration and fail-closed configuration against controlled transport. Neither proves hosted identity/storage/provider acceptance.

The next three checks use PostgreSQL and cover private answers, replay/concurrency, tampering, cooldowns, limits, expiration, eligibility, issuance atomicity, tenant isolation, revocation/supersession and historical credential behavior. The final check must use the runtime role and exercises published procedure/fault actions and their durable progress/credential effects. A role granting error must be repaired in environment provisioning, never bypassed by test-time grants or owner connections.

## Prepared staging draft acceptance

`tools/run-prepared-certification-acceptance.mjs` is a staging runner starting from a prepared draft. It performs independent review/publication, organization assignment, reading, procedure/fault actions, assessment, concurrent identical replay, exactly-once issuance and minimal anonymous verification. This is deliberately narrower than TC-10: source upload/extraction/rights approval, actual AI generation, candidate self-enrollment, real Blob/Service Bus evidence and qualified content acceptance remain separate requirements.

Prerequisites:

- A disposable staging organization and prepared draft with approved sources/model, valid certification policy, required reading, procedure/fault sequence and assessment. Public verification must be permitted.
- Three distinct active account identities and fresh API access tokens. The learner must have verified email. The author needs author and organization_admin/operator permissions for assignment; the independent reviewer needs reviewer and publisher permissions. Server authorization remains authoritative.
- A private scenario file with reviewed action/answer inputs. Do not commit tokens or assessment answers. Keep tokens only in the process environment under `CERTIFICATION_AUTHOR_TOKEN`, `CERTIFICATION_REVIEWER_TOKEN`, `CERTIFICATION_LEARNER_TOKEN`.
- Read and understand that this runner publishes staging content, assigns a learner, records results, issues a credential and enables its public verification consent. Use dedicated acceptance accounts/content.

Example scenario shape (replace every identifier/action/answer with the prepared staging course data):

```json
{
  "schemaVersion": "prepared-certification-acceptance.v1",
  "baseUrl": "https://your-staging-host.example",
  "organizationId": "your-staging-organization",
  "courseVersionId": "your-draft-version",
  "reviewTargets": [
    {"targetType":"COURSE","targetId":"your-draft-version"},
    {"targetType":"AI_DRAFT","targetId":"your-ai-run"},
    {"targetType":"MODEL","targetId":"your-model-version"},
    {"targetType":"SIMULATION","targetId":"your-simulation-definition"},
    {"targetType":"ASSESSMENT","targetId":"your-assessment-definition"},
    {"targetType":"POLICY","targetId":"your-policy"}
  ],
  "activities": [
    {"moduleIndex":0,"activityIndex":0,"kind":"reading"},
    {"moduleIndex":0,"activityIndex":1,"kind":"model","actions":[
      {"type":"select_component","componentId":"your-component"},
      {"type":"diagnose_fault","value":"your-reviewed-diagnosis"},
      {"type":"resolve_fault","value":"your-reviewed-resolution"}
    ]},
    {"moduleIndex":0,"activityIndex":2,"kind":"assessment","answers":[
      {"questionId":"your-question","selectedOptionIds":["your-answer-option"]}
    ]}
  ]
}
```

Activity indices address the published enrollment projection, avoiding assumptions about publication-generated IDs. Supply all required actions in order; the server decides whether the procedure/fault and certification requirements pass. Keep the same generated action ID for concurrent replay. The runner rejects missing role tokens, repeated token values, repeated account identities, unverified learner accounts, insecure destination origins, missing required review target categories and missing reading/model/assessment activity categories. Requests have a 30-second timeout; credential pagination is bounded and repeated cursors fail closed. The CLI accepts HTTPS origins only.

```powershell
node tools/run-prepared-certification-acceptance.mjs private-staging-scenario.json prepared-certification-evidence.json
```

The evidence records scenario SHA-256, step completion times, revision/release hash, result and explicit excluded scope. It never includes access tokens, account identities, assessment answers, raw response bodies or public credential handles. Failure remains a failed result, with a safe error code. Each invocation is a new acceptance intent, so use a fresh prepared draft rather than replaying an already-published run blindly.

## Remaining technical completion evidence

TC-10 is not complete: execute the full hosted source-to-credential/candidate-enrollment journey with distinct real identities, actual configured AI, private Blob delivery, Service Bus transport and qualified approved representative artifacts. The prepared runner cannot substitute for these steps.

TC-11 has strong local component evidence, but the complete adversarial matrix still needs hosted replay against the release candidate and account-lock/current-membership behavior. Record current runtime grants and RLS posture. The initial runtime-role procedure rehearsal exposed `permission denied for table simulation_sessions`. The shared runtime grant matrix was reconciled through `grantRuntimeDomainTables`; the root agent reran the restricted semantic-actions rehearsal successfully, including durable completion and credential issuance. Keep provisioning reconciliation in the baseline rather than granting ad hoc privileges inside tests.

TC-12 is partial: the core certification surface is typed and checked. Full author content-domain schemas, all administration/operator/discovery/integration methods, job capabilities, machine authentication/scopes/rotation and a complete compatibility policy remain open. Existing opaque course-content documents continue to be validated by the domain server. Do not interpret this contract expansion as full platform contract completion.
