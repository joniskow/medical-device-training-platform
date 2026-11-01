# Personal account foundation

`/account` provides an organization-independent personal display-name profile through GET/POST `/api/v1/account`. It uses the current bearer sign-in. This increment does not implement the Entra registration, Authorization Code + PKCE, password-recovery or token-renewal browser journey.

## Identity and ownership

The signed Entra authenticator supplies subject, validated issuer and configured/validated identity tenant. HTTP bodies cannot supply identity, email verification, roles or organization ownership. `personal_accounts` stores application profile, English locale, status, revision and timestamps. `external_identities` maps the complete issuer/tenant/provider-subject tuple to the application user. `personal_account_events` retains minimal creation/edit audit evidence without tokens or email addresses.

Initial account IDs preserve the existing authenticated subject used by membership, progress and credential records. Creating a profile does not rewrite those records or require organization membership. A subject already bound to a different issuer/tenant is rejected for both lookup and creation. Matching emails never merge accounts. Explicit identity linking and canonical ownership handling for linked identities remain unimplemented; do not insert additional mappings manually to simulate linking.

The current deployment accepts one configured Entra identity realm. Before rollout against existing data, verify that realm is the issuer/tenant that originally produced the legacy subject IDs. An issuer migration requires an explicit migration plan; unbound historical records cannot prove their original issuer by themselves. This feature is not authorization to change the configured identity realm.

Email verification in the profile response describes the current signed token's verified-email evidence. The application does not infer verification from a display name, email string or historical profile. Creating a personal profile is allowed before email verification; accepting invitations already requires it. Founder creation, membership reactivation and all new credential paths now enforce verification; see [verified-email enforcement](verified-email-enforcement.md). Live provider claim issuance remains open.

## Persistence and access

The runtime gets only EXECUTE on `access_personal_account(text,text,text,text,text,integer,text)` and no direct access to the new tables. The function has a fixed search path and PUBLIC execution revoked. Account/profile audit tables have forced user-scoped RLS. Identity mappings are private control data accessed through the function. Transactions set the user context locally and reset it on completion; no user context is derived from an arbitrary HTTP header.

Create/edit require explicit confirmation and stable request IDs. Concurrent duplicate creation produces one account and one creation event. Edits require the current revision. An old successful retry returns current state without reverting later edits; reused keys with changed payloads fail. Mutation and event persistence are atomic. Neither profile updates nor account creation modify published credential fields.

With `personalAccountStore` wired, authenticated private API requests check an existing account's status before organization resolution. LOCKED accounts fail closed; unavailable account storage also fails closed. Anonymous credential verification remains independent. Legacy identities without profiles can continue their existing flows until onboarding migration is complete. Operator CLI lock enforcement and audited lock/unlock administration are now implemented; see [account security](account-security.md). Provider security-event integration and stronger operator authentication remain outstanding, so complete account security lifecycle coverage is not claimed.

## Verification and remaining work

Run `pnpm personal-account:validate`. PostgreSQL/HTTP tests use signed synthetic identity tokens and verify organization-independent access, strict fields, issuer collision rejection, duplicate-email separation, current verification semantics, concurrent creation, revision conflicts, non-reverting retries, rollback, table/PUBLIC access denial and locked private API denial. Chrome tests verify consent, safe text, no organization header, interrupted retries, fresh edit identity, conflict reload, access-loss clearing and sign-out fencing. The rendered page is captured in `output/personal-account.png` for local visual review.

Remaining: managed provider registration/login/recovery/session renewal, explicit identity linking, deployed verified-email acceptance, provider security-event workflows and stronger operator controls, independent public/unlisted enrollment, a cross-organization personal credential wallet, deployed identity acceptance, and full accessibility testing. No live identity-provider configuration was changed.
