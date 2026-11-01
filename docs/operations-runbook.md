# Operations runbook

This is the pilot operating procedure for incidents involving the API, worker, queues, source processing, publication, credentials, and provider dependencies. It is intentionally metadata-first: operators use correlation IDs and safe projections, not unrestricted source-content access.

## 1. Triage and correlation IDs

Start with the timestamp, environment, route or job type, and the `X-Correlation-Id` response header. If a request supplied `X-Correlation-Id`, the same value must appear in the response, tenant context, job envelope, and Service Bus message properties. If it was absent or invalid, the API generates a `corr:<UUID>` value and returns it.

Search dashboards by correlation ID, then narrow by job ID, release/build, failure class, and error code. Do not paste source text, prompts, tokens, SAS URLs, answer keys, or PHI into tickets. Record the operator, reason, target, observed state, action, and outcome in the incident record.

Classify the event before acting:

- `RETRYABLE`: transient provider, network, lease, or capacity failure. Retry only after the dependency is healthy.
- `TERMINAL` / `VALIDATION` / `UNSUPPORTED_INPUT`: do not retry blindly; preserve the failure and correct the input or configuration.
- `UNAUTHORIZED` / integrity failure: stop replay, preserve the message and audit evidence, and escalate as a trust incident.
- rights, quarantine, publication, credential, or tenant-boundary issue: safe-stop the affected flow and escalate to the content/security owner.

## 2. Queue and dead-letter recovery

1. Open the Queue Recovery dashboard and record active count, oldest age, retry rate, dead-letter delta, and representative correlation IDs.
2. Check worker health, database capacity, Blob reachability, Service Bus access, and the provider status before replaying anything.
3. For a normal failed job, use the authenticated operator retry route `POST /api/v1/jobs/{jobId}/retry` with a concise reason. The server checks tenant scope, operator role, retry eligibility, and idempotency; the action is audited.
4. For a dead-lettered message, do not edit or delete the message in the portal. Verify the signed envelope, message ID, tenant ID, correlation ID, job record, source hash/lifecycle, and current rights/approval state. Replay through the controlled operator recovery path so the original message and audit trail remain available.
5. If the message is malformed, has an invalid signature, mismatched tenant/correlation fields, or references unavailable content, leave it dead-lettered and escalate. Never bypass HMAC, RLS, quarantine, publication validation, or credential lifecycle checks.
6. After recovery, confirm the job reaches `SUCCEEDED`/`REVIEW` or an intentional terminal state, the queue age returns to baseline, and no duplicate artifact, notification, webhook, usage event, or credential was created.

Safe stop conditions: growing dead letters, repeated integrity failures, cross-tenant lookup, duplicate side effects, unknown release binding, rights withdrawal, or a credential-affecting inconsistency. Freeze the affected job type or deployment and escalate rather than increasing retries.

## 3. Deployment rollback

1. Declare the incident and capture the current build, configuration, feature flags, migration version, active revision, traffic split, queue age, and correlation IDs.
2. Stop new publication and other certification-affecting changes. Do not rewrite releases, attempts, credentials, events, or source evidence.
3. Drain or pause workers for the affected job type. Let in-flight leases finish where safe; otherwise allow lease expiry and verify fencing before replay.
4. Shift application traffic to the last known-good compatible revision. Roll back application/container/configuration state only; never run a destructive database rollback against deployed certification data.
5. If a schema change is involved, use the expand-and-contract recovery path: keep the forward-compatible schema, disable the new reader/writer behind its flag, and run the documented compatibility check.
6. Verify readiness, `/healthz`, authenticated status, tenant isolation, queue settlement, private artifact access, and one end-to-end smoke path before restoring traffic.
7. Reconcile jobs, outbox rows, audit events, credentials, webhooks, and notifications across the incident window. Record missing-artifact behavior and customer communication decisions.
8. Close only when error/latency/queue/credential/cost signals are back within pilot thresholds and the incident owner has attached recovery evidence.

Rollback is not complete merely because the old revision serves traffic. Existing immutable evidence must remain byte-for-byte and semantically unchanged, and all retried effects must be idempotent.

## 4. Required operator evidence

Every incident or support action records: operator identity, reason, target, original input/version, current state, correlation ID, action, outcome, timestamps, and escalation/closure owner. The operator view should expose safe metadata only and must not provide a routine path around RLS, rights quarantine, publication review, or credential lifecycle rules.

The dashboard and alert requirements are defined in [observability-contract.json](../config/observability-contract.json). Its status remains pending until the production telemetry sink and dashboard resources are wired and reconciled against source-of-truth records.
