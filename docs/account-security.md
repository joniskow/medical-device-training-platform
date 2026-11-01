# Personal account lock and unlock

`tools/manage-account-status.mjs` provides platform-operator inspection and reasoned lock/unlock. It changes application access state, not identity-provider credentials. Profile, external identity, memberships and historical training/credential records are retained.

## Prerequisites and rollout

Build with `pnpm build`. Configure `OPERATOR_ACCESS_TOKEN`, `DATABASE_URL`, `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE`, `ENTRA_OPENID_CONFIGURATION_URL`, and optional `ENTRA_ISSUER`/`ENTRA_ROLES_CLAIM` through the approved secret mechanism. Do not pass tokens in CLI arguments or logs.

The signed token must carry the platform operator role, and its issuer-bound personal profile must be ACTIVE. Create operator profiles through `/account` before enabling these tools. The runtime needs EXECUTE on `access_personal_account(text,text,text,text,text,integer,text)` and `administer_personal_account(text,text,text,integer,text,text,text)`, not direct table writes. A locked operator cannot inspect or change other accounts. Another active authorized operator is required for recovery; this command cannot bootstrap an operator, override the provider, or change the caller's own status.

The same active-profile gate now protects organization lifecycle, email suppression review and delivery-report recovery CLIs. Their existing organization-membership requirements also remain in force. Personal-account administration is platform-scoped and reveals only the target user ID, status and revision; it does not list profiles, expose email addresses or read private content.

## Inspect and change

Use a user ID from an authorized incident record. Verify the target and current revision:

```text
node tools/manage-account-status.mjs inspect <user-id>
node tools/manage-account-status.mjs set <user-id> LOCKED <revision> <request-id> "Security investigation" --confirm
node tools/manage-account-status.mjs set <user-id> ACTIVE <new-revision> <new-request-id> "Incident resolved" --confirm
```

Reasons are audited; keep them concise and free of tokens or sensitive personal details. Status, revision increment and actor/reason audit commit atomically. Profile revision changes also invalidate an old status preview. Concurrent retries produce one mutation, changed payloads under the same request ID fail, and stale revisions require reinspection. A replayed successful request returns current state without undoing later changes.

The database rechecks that the operator's account is active in the same transaction as the mutation. Status administration is serialized so two operators cannot both lock one another using stale authorization. The shared CLI gate separately validates the signed token's role and issuer-bound account mapping before any administrative action.

## Verify and recover

After locking, inspect status and verify that a new private API request is rejected. A locked operator must also be rejected by the administrative CLI gate. After resolving the incident, re-inspect and explicitly unlock with the current revision. Unlock restores eligibility for existing permissions; it does not grant memberships, roles, course access or extra attempts.

Account locks do not recall requests already authorized, stop all worker activity, invalidate previously issued private asset URLs, revoke provider sessions or alter public credential verification. Those require their corresponding incident actions. Accounts without an application profile cannot be locked through this tool; complete onboarding first or use provider-side containment. MFA/stronger operator authentication and automatic provider security-event ingestion remain deployment work, not guarantees of this CLI.

`pnpm account-security:validate` verifies signed role/issuer/expiry checks, missing and locked operator profiles, self-change/confirmation denial, restricted SQL access, concurrent retries, reciprocal operator locking, rollback, stale operator/revision rejection, non-reverting replay, retained memberships/identities and private HTTP lock enforcement. These are local tests with synthetic identities; no live identity-provider or account state was changed.
