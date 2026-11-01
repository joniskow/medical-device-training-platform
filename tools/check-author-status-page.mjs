import assert from "node:assert/strict";
import { createJobStatusHttpServer } from "../apps/api/dist/job-status-http.js";

const server = createJobStatusHttpServer({
  staticRoot: "apps/web/dist",
  authenticator: { authenticate: async () => null },
  organizationContextResolver: { resolveActiveOrganizations: async () => [] },
  statusService: { get: async () => null, retry: async () => null }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const page = await fetch(`http://127.0.0.1:${port}/author/jobs`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Source processing/);
  assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  const script = await fetch(`http://127.0.0.1:${port}/author/job-status.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /Bearer/);
  console.log("Author status screen passed: static page, same-origin script, protected API client, and CSP.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
