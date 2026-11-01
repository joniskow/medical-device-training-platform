import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  const page = await fetch(`http://127.0.0.1:${port}/learner/model?preview=1`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AIC-001 model activity/);
  const textOnlyPage = await fetch(`http://127.0.0.1:${port}/author/jobs`);
  assert.equal(textOnlyPage.status, 200);
  assert.doesNotMatch(await textOnlyPage.text(), /learner\/model-player\.js/);
  const player = await fetch(`http://127.0.0.1:${port}/learner/model-player.js`);
  assert.equal(player.status, 200);
  assert.match(await player.text(), /Babylon|SceneLoader/);
  const contract = await fetch(`http://127.0.0.1:${port}/learner/model-contract.js`);
  assert.equal(contract.status, 200);
  assert.match(await contract.text(), /BrowserSemanticActionClient/);
  const manifestResponse = await fetch(`http://127.0.0.1:${port}/learner/model-manifest.json`);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.releaseBindingId, "releasebind_aic001_preview_v1");
  assert.equal(manifest.textureCount, 0);
  const modelResponse = await fetch(`http://127.0.0.1:${port}/learner/model/aurora-infusion-controller.glb`);
  const model = Buffer.from(await modelResponse.arrayBuffer());
  assert.equal(createHash("sha256").update(model).digest("hex"), manifest.sourceHash);
  for (const variantId of ["mobile", "reduced"]) {
    const variantManifestResponse = await fetch(`http://127.0.0.1:${port}/learner/model-manifest.${variantId}.json`);
    assert.equal(variantManifestResponse.status, 200);
    const variantManifest = await variantManifestResponse.json();
    const variantResponse = await fetch(`http://127.0.0.1:${port}/learner/model/aurora-infusion-controller.${variantId}.glb`);
    assert.equal(variantResponse.status, 200);
    const variant = Buffer.from(await variantResponse.arrayBuffer());
    assert.equal(createHash("sha256").update(variant).digest("hex"), variantManifest.sourceHash);
    assert.equal(variantManifest.variant.variantId, variantId);
  }
  const report = await (await fetch(`http://127.0.0.1:${port}/learner/model/optimization-report.json`)).json();
  assert.equal(report.variants.length, 2);
  console.log("Model runtime page passed: static preview, canonical/optimized manifest hashes, variant assets, and browser runtime assets are available.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
