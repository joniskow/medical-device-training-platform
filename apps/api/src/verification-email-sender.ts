import type { VerificationEmailSender } from './email-verification-service.js';

interface EmailCredential {
  getToken(scope: string, options?: { abortSignal?: AbortSignal }): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

/** ACS acceptance queues the email; it is not a claim of inbox delivery. */
export function createAzureVerificationEmailSender(options: {
  endpoint: string;
  senderAddress: string;
  credential: EmailCredential;
  fetchImpl?: typeof fetch;
}): VerificationEmailSender {
  let endpoint: URL;
  const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  try {
    endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.communication.azure.com') || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || !validEmail(options.senderAddress)) throw new Error();
  } catch { throw new Error('VERIFICATION_EMAIL_CONFIGURATION_INVALID'); }
  const url = new URL('/emails:send?api-version=2023-03-31', endpoint);
  return {
    async sendVerification(input) {
      if (!validEmail(input.email) || !/^\d{6}$/.test(input.code) || input.expiresInMinutes !== 10) throw new Error('VERIFICATION_MESSAGE_INVALID');
      const signal = AbortSignal.timeout(30_000);
      try {
        const token = await options.credential.getToken('https://communication.azure.com/.default', { abortSignal: signal });
        if (!token || token.expiresOnTimestamp <= Date.now()) throw new Error();
        const response = await (options.fetchImpl ?? fetch)(url, {
          method: 'POST', redirect: 'error', signal,
          headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ senderAddress: options.senderAddress, recipients: { to: [{ address: input.email }] }, content: {
            subject: 'Verify your training account email',
            plainText: `Your training account verification code is ${input.code}. It expires in 10 minutes. If you did not request this code, ignore this email.`
          }, disableUserEngagementTracking: true })
        });
        await response.body?.cancel();
        if (response.status !== 202) throw new Error();
      } catch { throw new Error('VERIFICATION_DELIVERY_UNAVAILABLE'); }
    }
  };
}
