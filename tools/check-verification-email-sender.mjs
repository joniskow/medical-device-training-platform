import assert from 'node:assert/strict';
import { createAzureVerificationEmailSender } from '../apps/api/dist/verification-email-sender.js';
const requests = [];
const make = (fetchImpl) => createAzureVerificationEmailSender({ endpoint: 'https://test.communication.azure.com', senderAddress: 'sender@example.test', credential: { async getToken(scope) { assert.equal(scope, 'https://communication.azure.com/.default'); return { token: 'fixture', expiresOnTimestamp: Date.now() + 60000 }; } }, fetchImpl });
const sender = make(async (url, init) => { requests.push({ url: String(url), init }); return new Response(null, { status: 202 }); });
await sender.sendVerification({ email: 'recipient@example.test', code: '123456', expiresInMinutes: 10 });
assert.equal(requests.length, 1);
assert.equal(requests[0].url, 'https://test.communication.azure.com/emails:send?api-version=2023-03-31');
const body = JSON.parse(requests[0].init.body);
assert.equal(body.recipients.to[0].address, 'recipient@example.test');
assert.match(body.content.plainText, /123456/);
assert.equal(body.disableUserEngagementTracking, true);
assert.equal(requests[0].init.redirect, 'error');
await assert.rejects(() => make(async () => new Response(null, { status: 403 })).sendVerification({ email: 'recipient@example.test', code: '123456', expiresInMinutes: 10 }), /VERIFICATION_DELIVERY_UNAVAILABLE/);
await assert.rejects(() => sender.sendVerification({ email: 'recipient@example.test', code: 'bad', expiresInMinutes: 10 }), /VERIFICATION_MESSAGE_INVALID/);
for (const endpoint of ['http://test.communication.azure.com', 'https://evil.test', 'https://test.communication.azure.com/?key=secret', 'https://secret@test.communication.azure.com']) {
  assert.throws(() => createAzureVerificationEmailSender({ endpoint, senderAddress: 'sender@example.test', credential: { getToken() {} } }), /VERIFICATION_EMAIL_CONFIGURATION_INVALID/);
}
console.log('Azure verification sender passed: managed identity scope, pinned endpoint, safe message, rejected redirects/provider errors and invalid inputs.');
