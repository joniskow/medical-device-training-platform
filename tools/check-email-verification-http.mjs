import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Pool } from 'pg';
import { applyProcessingJobMigration, createEmailVerificationStore } from '../packages/db/dist/index.js';
import { createEmailVerificationService, verificationIdentityKey } from '../apps/api/dist/email-verification-service.js';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';

const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? 'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device' });
const identity = { subject: `http-${randomUUID()}`, issuer: 'https://identity.test', identityTenant: 'test-tenant' };
const key = verificationIdentityKey(identity);
const email = `fixture-${randomUUID()}@example.test`;
let message;
let principal = { ...identity, roles: [], authenticationExpiresAt: new Date(Date.now() + 300000).toISOString() };
const service = createEmailVerificationService({ store: createEmailVerificationStore(pool), secret: 'x'.repeat(32), sender: { async sendVerification(input) { message = input; } } });
const server = createJobStatusHttpServer({ statusService: { async get() { return null; }, async retry() { return null; } }, authenticator: { async authenticate(request) { return request.headers.authorization === 'Bearer fixture' ? principal : null; } }, organizationContextResolver: { async resolveActiveOrganizations() { return []; } }, emailVerificationService: service });
try {
  await applyProcessingJobMigration(pool);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (action, body, authorization = 'Bearer fixture') => fetch(`${origin}/api/v1/account/email-verification/${action}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('start', { email }, 'bad')).status, 401);
  assert.equal((await post('start', { email, verified: true })).status, 422);
  let response = await post('start', { email }); assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const challenge = await response.json(); assert.equal('code' in challenge, false);
  assert.equal((await post('start', { email })).status, 429);
  assert.equal((await post('complete', { challengeId: challenge.challengeId, code: '000000' === message.code ? '999999' : '000000' })).status, 403);
  response = await post('complete', { challengeId: challenge.challengeId, code: message.code }); assert.equal(response.status, 200);
  const verified = await response.json(); assert.equal(verified.verified, true); assert.equal(verified.verificationExpiresAt, principal.authenticationExpiresAt);
  assert.equal((await post('complete', { challengeId: challenge.challengeId, code: message.code })).status, 403);
  assert.equal((await service.enrich(principal)).verifiedEmail, email);
  response = await post('revoke', { confirmed: true }); assert.equal(response.status, 200); assert.equal((await response.json()).verified, false);
  assert.equal((await service.enrich(principal)).verifiedEmail, undefined);
  principal = { ...principal, authenticationExpiresAt: 'invalid' };
  assert.equal((await post('start', { email })).status, 401);
  console.log('Email verification HTTP + PostgreSQL passed: auth, strict inputs, hidden code, resend limits, token-bound assurance, replay and revocation. Sender/identity are controlled fixtures.');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await pool.query('DELETE FROM email_verification_assurances WHERE identity_key=$1', [key]);
  await pool.query('DELETE FROM email_verification_challenges WHERE identity_key=$1', [key]);
  await pool.query('DELETE FROM email_verification_delivery_limits WHERE email_key=md5($1)', [email]);
  await pool.end();
}
