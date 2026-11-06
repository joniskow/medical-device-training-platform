# Managed browser authentication

The author workspace links to `/signin`. The page obtains allowlisted public metadata from `/api/v1/auth/config`, initializes pinned `@azure/msal-browser` 5.27.0 with sessionStorage, and uses authorization-code redirect through the SDK. The old custom PKCE/token exchange and HTML registration IDs have been removed.

## Configuration and registration

Set `BROWSER_AUTH_ENABLED=true`, `ENTRA_TENANT_ID`, `BROWSER_AUTH_CLIENT_ID`, `BROWSER_AUTH_AUTHORITY`, `BROWSER_AUTH_API_SCOPE`, and `APPLICATION_ORIGIN`. See `.env.example`. The browser origin must exactly equal the configured application origin. Use the tenant UUID authority form for workforce Entra or the supported External ID CIAM hostname. Custom identity domains are not supported by the current configuration validator.

Register `${APPLICATION_ORIGIN}/auth/redirect` as a SPA redirect URI and `${APPLICATION_ORIGIN}/signin` as the permitted post-logout return URI. The bridge is a separate bundled script and does not initialize an application client, run application APIs or receive COOP headers. It allows only same-origin framing for silent authentication. A reverse proxy must preserve these headers and must not inject COOP on the bridge.

Configure the External ID user flow, allowed signup methods, password recovery, API permission/consent and signed verified-email claim at the identity provider. The UI delegates these functions to that provider; installing MSAL does not provision them. The API issuer/audience/discovery settings must match the registration. No client secret is sent to the browser.

## Session and failure behavior

Starting a new interactive sign-in clears the prior application bearer and organization selection. MSAL handles state/nonce/PKCE. The application also keeps a session epoch to reject a returned token after local sign-out or a later sign-in. The returned API access token must successfully call the account endpoint before it is stored for application use; an ID token is never substituted. The selected SDK account is recorded by homeAccountId. Provider messages, tokens and callback URLs are not rendered or logged by the application logger; a sanitized library error identifier may be logged for failed sign-in. An incomplete pending callback shows retry guidance. The application homepage returns to `/signin` so the SDK bridge's homepage fallback does not strand users on a missing route.

All existing page sign-out handlers clear private UI/application token state and route managed sessions to `/signout`, which calls provider logout for the recorded SDK account. Failure leaves local sign-out in effect and allows provider logout retry. An interrupted navigation does not prove the provider session ended. Legacy test sessions without a managed-account marker retain local-only sign-out.

Session readers re-read available sessionStorage so separate bundles do not retain a token removed by another module. Authenticated requests now call acquireTokenSilent for the recorded account and configured API scope. Concurrent requests share a renewal. Success updates only the bearer and preserves organization selection. Missing accounts, changed epochs, mismatched results and provider errors fail with sanitized sign-in guidance; they do not automatically redirect away from unsaved forms. The shared request helper restricts destinations to same-origin API paths, rejects redirects, and checks session/organization identity before sending and after receiving. It sends each operation once, leaving deliberate retry/idempotency handling to the existing page. Simulation transport is pinned to its initial session identity. Editor recovery and learner notice fences use stable session/organization identity rather than the rotating token.

## Evidence and remaining acceptance

`tools/check-managed-auth.mjs` bundles production authentication code against a controlled SDK double to check initialization/configuration, API-token validation, late callback rejection, selection clearing, sanitized errors and recorded-account logout. It does not test real Entra protocol behavior.

`tools/check-browser-auth-config.mjs` tests real local HTTP routing, the public allowlist, disabled configuration and bridge headers. `tools/check-signin-browser.mjs` loads the real bundled SDK in Chrome and checks configuration failure/retry and a compact viewport. Account and course-editor Chrome regressions pass. API/web builds and architecture checks pass.

Remaining: live provider signup/recovery/verification and sign-out, live redirect registration acceptance, deployment proxy checks, device/browser matrix and identity linking. No Azure identity settings were changed by this increment.

References: [MSAL v5 redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge), [v4-to-v5 migration](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/v4-migration).


Renewal evidence: the controlled SDK suite checks single-flight renewal, exact account/scope, mismatched account results, organization preservation, sign-out/context switching during renewal, no failure replay and destination restrictions. `tools/check-session-renewal-browser.mjs` connects the real account page and request helper to a controlled renewal module in Chrome, verifies fresh bearer use for reads/writes, and verifies that failed renewal sends no API request. The account, organization, settings, membership, invitation, assignment, learner and editor browser regressions pass; model contract checks cover the renewable transport wiring. These are local adapter/UI checks, not live refresh-token/iframe/provider acceptance.

Token acquisition follows [Microsoft's MSAL access-token guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/acquire-token).
