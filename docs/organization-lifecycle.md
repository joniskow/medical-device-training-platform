# Organization suspension and reactivation

Operator account prerequisite (2026-10-30): the signed operator must have an ACTIVE personal profile. These commands use the shared account-status gate and reject missing, locked or conflicting identities before administrative work. Create the operator profile through `/account` before rollout. See [account security](account-security.md).

Use the operator command to change an organization's access status. Suspension prevents subsequent normal private API requests, organization selection and scoped-role resolution. It preserves memberships, roles, enrollments, progress, releases and credentials. It is not credential revocation, asset quarantine, data deletion or a complete infrastructure emergency stop.

## Access and inspection

Build with `pnpm build`. Configure these values through the approved environment/secret mechanism:

- `OPERATOR_ACCESS_TOKEN`: a signed, unexpired Entra API token with the platform `operator` role. Never place it in command arguments or logs.
- `RECOVERY_ORGANIZATION_ID`: the exact organization being administered.
- `DATABASE_URL`: the restricted runtime connection, with organization/membership reads and EXECUTE on `set_organization_status(text,integer,text,text,text,text)`. No direct organizations UPDATE grant is required.
- `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE`, `ENTRA_OPENID_CONFIGURATION_URL`, and optional `ENTRA_ISSUER`/`ENTRA_ROLES_CLAIM`.

The operator must retain an ACTIVE membership in the target organization. This administrative command deliberately allows that membership to inspect and reactivate a SUSPENDED organization; ordinary organization selection still excludes it. Suspended/removed operator memberships cannot use the command. The command does not grant memberships or operator roles.

Run:

```text
node tools/manage-organization-status.mjs inspect
```

Verify the returned organization ID, name, status and lifecycle revision against the incident record. A legacy seeded organization without an organization profile cannot use this command until its profile is provisioned through an approved migration.

## Change status

Use the inspected lifecycle revision and a unique request ID. Explain the incident or resolution without including secrets or sensitive personal information.

```text
node tools/manage-organization-status.mjs set SUSPENDED <revision> <request-id> "Incident investigation" --confirm
node tools/manage-organization-status.mjs set ACTIVE <new-revision> <new-request-id> "Incident resolved" --confirm
```

Status, revision and audit commit atomically. The audit includes actor, organization, previous/new status, previous revision, reason and correlation ID. The mutation serializes with member administration and profile changes. Concurrent duplicate requests produce one audit; a stale revision or a changed payload under a reused request ID fails. Retry the exact same request after an interrupted response, or inspect before making another deliberate change. An old successful request returns current state and never reapplies its old status.

After suspension, verify that private access fails and the organization disappears from normal context selection. After reactivation, verify that only still-active memberships regain their existing roles. Individually suspended or removed memberships remain blocked. Reactivation does not reset course progress or retry allowances.

## Scope and operational limits

- Requests already authorized or jobs already running are not recalled. Existing private asset URLs can remain usable until their expiry; use the relevant storage/incident procedure when immediate containment is required.
- Invitation send claims recheck active organization status. An invitation skipped while suspended is not automatically requeued on reactivation; create a new invitation deliberately when appropriate. Previously sent tokens remain subject to normal expiry, invitation state and current issuer/inviter eligibility.
- Public verification retains the credential's recorded status. Use the separate reasoned credential revocation workflow when evidence warrants revocation.
- Background retention, credential expiration and delivery-report processing are not disabled by this access-state command.
- The tool does not change provider configuration, network access, Azure roles or organization branding.

`pnpm organization-lifecycle:validate` runs the local restricted-runtime PostgreSQL/HTTP checks. They verify authorization callback denial, membership and tenant boundaries, confirmation, concurrent retries, rollback, stale/non-reverting replay, blocked normal access, restored access and byte-for-byte preserved synthetic history, plus continued public verification. Live Entra operator provisioning and deployed containment acceptance remain open.
