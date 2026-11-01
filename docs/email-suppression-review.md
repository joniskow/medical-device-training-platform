# Review and release invitation-email suppression

Operator account prerequisite (2026-10-30): the signed operator must have an ACTIVE personal profile. These commands use the shared account-status gate and reject missing, locked or conflicting identities before administrative work. Create the operator profile through `/account` before rollout. See [account security](account-security.md).

Hard-bounce and provider-suppressed reports block new invitation send claims within the affected organization. Release is a deliberate operator action after investigating the delivery failure and confirming that delivery is appropriate. It does not change provider-side suppression, recipient consent, historical reports, or the status of previously skipped invitations. It does not send email.

Build with `pnpm build`. Configure `OPERATOR_ACCESS_TOKEN`, `RECOVERY_ORGANIZATION_ID`, `DATABASE_URL`, and the Entra settings described in [delivery-report recovery](email-report-recovery.md). Use the restricted runtime connection with SELECT on suppression records and EXECUTE on `release_email_suppression(text,integer,text,text,text,text)`; direct suppression UPDATE/DELETE is unnecessary. The signed token must carry platform operator authority and the operator must have active membership in the selected active organization.

1. Run `node tools/review-email-suppressions.mjs list`. Follow `nextCursor` using `list <after-recipient-hash>`. Records expose recipient digests, report reference, reason, revision and release time, without email addresses or provider diagnostics. Digests remain sensitive identifiers and are not anonymized public data. Use the report reference with authorized incident evidence to identify the affected mailbox; do not guess from the digest.
2. Investigate the failure and resolve its cause. Confirm consent and any applicable provider restriction through the approved operational process. Record a concise non-sensitive reason; avoid email addresses, tokens or raw diagnostics in arguments or audit text.
3. Release the exact reviewed revision:

   ```text
   node tools/review-email-suppressions.mjs release <recipient-hash> <revision> <request-id> "Mailbox issue resolved and consent verified" --confirm
   ```

4. Re-list to inspect current state. A non-null `releasedAt` means the local suppression was released. A response with `replayed:true` means the same action was recorded earlier; it does not guarantee suppression is currently released. New evidence can re-suppress it.

Release, revision increment and audit commit atomically. Changed evidence or another release invalidates an old revision. Retrying the same request ID and payload is safe; changing the payload under that ID fails. A new bounce/suppressed receipt restores suppression and advances the revision, including previously unseen historical evidence. Duplicate receipts do not restore suppression. Replaying an old release never clears newer evidence. Delivery status history and immutable report receipts are retained.

Release allows future eligible send claims. A message already recorded SUPPRESSED remains completed and is not automatically resent; an administrator must deliberately create a new invitation when appropriate. Claims already underway are not recalled. Organization-local release does not promise that ACS will deliver or remove its own restrictions, and it does not affect other organizations. Provider-wide policy remains a separate open decision.

Local PostgreSQL coverage in `tools/check-email-delivery-reports.mjs` exercises release confirmation, denied authorization, tenant boundaries, stale revisions, concurrent retries, rollback, preserved audit history, new claims after release, duplicate receipts, re-suppression and old-release replay. Live operator identity/provider acceptance remains outstanding.
