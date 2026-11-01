# Verified email before membership and credential issuance

The API trusts only the validated access token's explicit boolean `email_verified=true` and valid email claim. Its verification expiry comes from that token's signed `exp` claim. Profile text, HTTP body fields, login-name claims and historical display names cannot establish verification.

## Application behavior

- Creating an organization through the API requires a currently verified email before granting founder membership. Invitation acceptance already requires the intended verified email and explicit organization/role consent.
- Administrator reactivation of a membership requires the recipient to have an ACTIVE personal profile and unexpired verification evidence. The recipient can open `/account` without an active organization membership, then sign in with a verified email before the administrator retries.
- Every new credential passes the shared `issueCredentialInTransaction` check, covering manual issuance, assessment completion, simulation completion, reading acknowledgement and scheduled requalification. Missing, expired or locked account evidence prevents issuance. Existing credentials and public verification are not revoked by verification expiry.
- Automatic completion retains earned progress when verification is unavailable. Manual issuance returns `CREDENTIAL_EMAIL_VERIFICATION_REQUIRED` with guidance to create the personal profile, sign in with verified email, and retry. The learner page links to My account.
- Scheduled requalification remains PENDING with `CREDENTIAL_EMAIL_VERIFICATION_REQUIRED` and a one-hour next check, without consuming processing retry attempts. This is a wait for user identity evidence, not a successful issuance or terminal processing failure. The learner may retry issuance directly after refreshing verification instead of waiting for the scheduler.

## Persistence and trust boundary

`personal_accounts.verified_until` records only the expiry of observed signed verification evidence; no email address or token is stored there. On authenticated API/account requests, `observe_account_verification` matches the full issuer/tenant/subject identity mapping and updates only an ACTIVE account. Missing verification clears the evidence. Unmapped identities cannot update another account, and expired evidence becomes unavailable.

The runtime can execute narrow fixed-search-path functions, with PUBLIC execution revoked, but has no direct personal-account table write grant. `has_verified_account` takes a share lock on the account row through the credential transaction so account lock/verification changes serialize with issuance. User context is transaction-local. These internal database functions trust the authenticated backend; they are not public token-verification endpoints.

Evidence expires with the token. Background issuance therefore requires a recent verified sign-in; it must not interpret a past account visit as permanent verification. Provider security events and managed token renewal are still separate work. A provider configuration that does not emit the required signed verification evidence fails closed; deploy only after confirming the real API-token claims.

## Rollout and tests

Apply migrations and bootstrap runtime EXECUTE grants for `observe_account_verification(text,text,text,timestamptz)` and `has_verified_account(text)`. Existing learner profiles need a verified sign-in before new credentials or member reactivation; no blanket backfill marks legacy users verified. Controlled infrastructure membership seeding remains an administrative fixture/provisioning path, not an end-user bypass route.

Local tests cover signed expiry projection, missing/expired/withdrawn verification, wrong-issuer denial, missing and locked accounts, strict HTTP body fields, unverified founder denial, blocked reactivation, retained completion progress, manual 403, successful verified retry and scheduled waiting/resumption. Credential, selected-module requalification and real PostgreSQL simulation regressions use explicit synthetic verification fixtures. Those fixtures refuse to overwrite existing accounts and restore temporary function grants. Live Entra verification claims, provider registration/recovery and deployed acceptance remain outstanding.
