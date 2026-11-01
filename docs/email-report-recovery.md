# Email delivery-report recovery

Operator account prerequisite (2026-10-30): the signed operator must have an ACTIVE personal profile. These commands use the shared account-status gate and reject missing, locked or conflicting identities before administrative work. Create the operator profile through `/account` before rollout. See [account security](account-security.md).

This administrative CLI inspects the dedicated delivery-report dead-letter queue and reapplies a selected message through the normal tenant-bound report store. It does not send invitation emails or republish broker messages. Local validation is available through `pnpm email-reports:validate`; live Azure recovery acceptance remains outstanding.

## Prerequisites

Build with `pnpm build`. Supply configuration through the approved environment/secret mechanism:

- `OPERATOR_ACCESS_TOKEN`: a valid API-audience Entra token carrying the platform `operator` role. Never put this token in command arguments, logs, or the runbook.
- `RECOVERY_ORGANIZATION_ID`: the organization being recovered. The operator must have active membership in an active organization; authentication and membership are checked again after scanning.
- `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE`, `ENTRA_OPENID_CONFIGURATION_URL`; optional `ENTRA_ISSUER` and `ENTRA_ROLES_CLAIM`.
- `DATABASE_URL`: the restricted runtime connection; `DATABASE_OUTBOX_URL`: the control connection with only the required operation-to-organization routing projection.
- `EMAIL_REPORTS_ENABLED=true`, `EMAIL_REPORTS_SERVICE_BUS_NAMESPACE`, `EMAIL_REPORTS_QUEUE`, `ACS_EMAIL_RESOURCE_ID`, `ACS_EMAIL_SENDER_ADDRESS`. The report namespace must be separate from the asset-processing namespace.

DefaultAzureCredential supplies the Azure identity. That identity needs Service Bus Data Receiver on the report queue, including its dead-letter subqueue. Queue access is separate from the signed application operator authorization. Use controlled administrative access, not tenant end-user database or broker credentials.

## Inspect and replay

1. Diagnose and repair the original transient failure (for example, unavailable database or routing metadata).
2. Run `node tools/recover-email-reports.mjs list`. Follow the returned `nextCursor` with `list <after-sequence>` until null, even if a page contains no visible items. A page scans 20 broker messages and filters out messages that cannot be safely routed entirely to the selected organization.
3. Review the sequence number, snapshot, safe reason, report count and recoverable flag. Only retry exhaustion, broker maximum-delivery exhaustion and expired-message dead letters are eligible. Invalid, conflicting, mixed-tenant or unrouteable messages require investigation; this tool cannot override their validation.
4. Replay the exact inspected message, with a unique request ID and a concise reason containing no recipient address, secret or raw provider diagnostic:

   ```text
   node tools/recover-email-reports.mjs replay <sequence> <snapshot> <request-id> "Database connectivity restored" [max-scan]
   ```

5. Retain the request ID for audit lookup. Reinspect the queue and check the organization's delivery-status projection after completion. A delivered report indicates recipient-mail-server acceptance, not that the recipient opened the message.

The default scan bound is 200 messages; explicit bounds may be 20–10000. Replay temporarily locks scanned messages, including unrelated messages, and abandons all except the successfully completed target. Coordinate operators to avoid concurrent scans. Use the smallest practical bound. Long scans can lose broker locks; no claim of guaranteed renewal for pull-received messages is made. `EMAIL_RECOVERY_MESSAGE_UNAVAILABLE` can mean the target is locked, already consumed, or outside the scan bound. Reinspect before increasing the bound.

## Audit and failure semantics

The exact snapshot binds message sequence, message ID, dead-letter reason and normalized reports. Authorization and snapshot validation precede effects. A durable STARTED audit precedes report application; COMPLETED records successful application before broker acknowledgement. Therefore COMPLETED does not independently prove broker settlement.

Reports commit individually. A partial batch failure retains the message for retry; already committed receipts replay idempotently through the normal report store. A failed acknowledgement can likewise leave a fully applied message available again. Retry the same request ID, snapshot and reason for the same recovery attempt. Changing its snapshot or reason is rejected as `IDEMPOTENCY_KEY_REUSED`. A new, deliberately different recovery uses a new request ID.

Failures attempt to abandon held messages; lock-release failures are reported explicitly and may require waiting for broker lock expiry before reinspecting. No report validation, chronology rule, recipient match or suppression behavior is bypassed. Historical bounce evidence can still suppress future invitations. Suppression release is a separate workflow and is not provided by this CLI.

Local tests cover private pagination, the maximum sequence boundary, exact snapshots, multi-batch scans, authority loss, audit-before-effects, partial batches, failed application/acknowledgement, and lock release. PostgreSQL integration separately verifies report idempotency and audit concurrency, request conflicts and transaction rollback. These checks do not establish live Azure identity/RBAC or settlement acceptance.
