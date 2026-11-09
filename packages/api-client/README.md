# Training API client

Generated from the application's OpenAPI 3.1 contract. Works with JavaScript/TypeScript frameworks and Node 22+. The deployed browser app uses the same-origin Azure `/api/v1` API. No secret belongs in the frontend.

```ts
import {createTrainingClient, prepareModelAction, TrainingApiError} from '@medical-device/api-client';

const api = createTrainingClient({
  getAccessToken: () => auth.acquireApiAccessToken(), // Renew the explicitly selected Microsoft account.
  getContext: () => ({identity: auth.accountAndSessionEpoch, organizationId: auth.organizationId})
});
const organizations = await api.listOrganizations();
const selectionKey = crypto.randomUUID(); // Retain this key if the response is interrupted.
await api.selectOrganization(organizations.items[0].organizationId, selectionKey);
// Update your local selected organization only after the response succeeds.
const enrollments = await api.listEnrollments();
const course = await api.getEnrollment(enrollments.items[0].enrollmentId);
const activity = course.content.modules.flatMap(module => module.activities)
  .find(activity => activity.type === 'guided_procedure')!;
const session = await api.startActivity(course.enrollmentId, activity.activityId);
const asset = await api.getModelAsset(session.releaseId, session.modelVersionId);

// Obtain component IDs from the returned model manifest; this demonstrates the action lifecycle.
const action = prepareModelAction(session, session.state, {
  type: 'request_hint', stepId: session.state.activeStepId, source: 'KEYBOARD'
});
try {
  const result = await api.submitAction(session.sessionId, action);
  // HTTP 200 includes semantic rejection. Apply result.state and show result.feedback.
  if (result.status === 'accepted') console.log(result.nextSequence);
} catch (error) {
  if (error instanceof TrainingApiError) {
    console.error(error.code, error.correlationId, error.retryAfterSeconds);
    // Offer a retry using this SAME action; never make a new action ID for this intent.
  }
}
const restored = await api.resume(session, session.state.nextSequence);
const debrief = await api.getDebrief(session.sessionId);
```

The `auth` object above is supplied by your application. The Azure-hosted starter implements it with the existing Microsoft authentication code. An API access token is required; an ID token is not a substitute. `identity` changes on sign-out/account switch/session replacement but stays stable across access-token renewal. `organizationId` must also reflect the current context. The client fences late responses after either changes and accepts an `AbortSignal` on every method.

`TrainingApiError` preserves status, error code, safe message, correlation ID and Retry-After. `retryable` describes transport/HTTP recovery, not permission to automatically replay a mutation. The library never retries mutations automatically. Keep pending actions until a definitive result, disable competing actions, and clear private views after lost access. `stale_sequence` requires reconciling the returned server state; a changed intent gets a new action ID. An expired attempt requires an explicit restart through the learner workflow. The seven-step familiarization policy records results without issuing a credential.

Methods cover public auth metadata, account, organization contexts/selection, enrollment pages/details, activity launch, asset descriptor, actions, resume and debrief. `paths` and `components` expose generated OpenAPI types for additional direct `openapi-fetch` use. The model manifest remains versioned runtime data; validate it and the state before rendering. Fetch private model bytes only through the authenticated same-origin API route.

Build: `pnpm --filter @medical-device/contracts build` then `pnpm --filter @medical-device/api-client build`. Do not hand-edit `src/schema.ts` or `openapi.json`; edit `packages/contracts/src/learner-openapi.ts` and regenerate. This private package can be handed off as a `pnpm pack` tarball without publishing to a registry.


The 0.2.0 contract adds headless certification methods: course snapshot/save/review/publish,
assignment, reading acknowledgment, assessment start/resume/submission, credential list/issuance,
sharing, revocation/supersession and anonymous public verification. Review/publish, assessment
start, sharing and lifecycle changes require an explicit stable idempotency key. Draft saves
require the snapshot revision. A 409 requires reconciliation before a new intent; do not silently
replace its revision. Assessment answers contain only question and selected option identities.
The server resolves immutable answer keys, release policy and exactly-once credential eligibility.

Public verification never requests or forwards a bearer token or organization header. Other
methods continue to fence account/organization changes and never automatically replay mutations.
Server roles and independent-review rules remain authoritative; client types do not grant permission.
Course content remains a versioned domain document and must pass the existing server validators;
this contract does not claim complete coverage of every author/admin/operator/integration surface.

Run `node tools/check-certification-api-client.mjs` after building contracts, API and api-client.
This tests the generated client against the real HTTP handler with controlled service dependencies;
it is a compatibility test, not proof of a deployed identity/provider/storage journey.

Email possession verification uses `startEmailVerification`, `completeEmailVerification` and `revokeEmailVerification` on the current signed account, without an organization requirement. Starts are rate limited; the library never automatically retries them. Revocation may still return `verified: true` when a signed provider claim independently attests the email.
Every generated operation is available through `client.request(api => api.GET(...))` (or `POST`, `PUT`, etc.). This typed callback uses the same destination restriction, bearer acquisition, organization context, context-switch rejection and `TrainingApiError` handling as the convenience methods. Use it for lifecycle, reporting, webhook and render surfaces without creating a second transport.
