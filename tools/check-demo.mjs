import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startDemoServer } from "./demo-server.mjs";

const demo = await startDemoServer({ port: 0 });
const headers = { authorization: "Bearer demo", "x-organization-id": "org_fixture" };
const root = resolve(import.meta.dirname, "..");

async function createUpload(bytes, fileName, contentType, sourceType) {
  const create = await fetch(`${demo.origin}/api/v1/organizations/org_fixture/assets/upload-sessions`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ sourceType, fileName, contentType, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
  });
  assert.equal(create.status, 201);
  const session = await create.json();
  const put = await fetch(`${demo.origin}${session.uploadUrl}`, { method: "PUT", headers: { ...headers, "content-type": contentType }, body: bytes });
  assert.equal(put.status, 200);
  const complete = await fetch(`${demo.origin}/api/v1/upload-sessions/${encodeURIComponent(session.uploadSessionId)}/complete`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ blobKey: session.blobKey, contentType, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
  });
  assert.equal(complete.status, 200);
  return (await complete.json()).processingJob.jobId;
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${demo.origin}/api/v1/jobs/${encodeURIComponent(jobId)}`, { headers });
    assert.equal(response.status, 200);
    const job = await response.json();
    if (["SUCCEEDED", "FAILED", "DEAD_LETTERED"].includes(job.state)) return job;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`DEMO_JOB_TIMEOUT:${jobId}`);
}

try {
  const pdf = await readFile(resolve(root, "fixtures/reference/manual/aurora-infusion-controller-manual.pdf"));
  const image = await readFile(resolve(root, "fixtures/reference/images/aic-overview.png"));
  const [pdfJobId, imageJobId] = await Promise.all([
    createUpload(pdf, "aurora-infusion-controller-manual.pdf", "application/pdf", "pdf"),
    createUpload(image, "aic-overview.png", "image/png", "image")
  ]);
  const [pdfJob, imageJob] = await Promise.all([waitForJob(pdfJobId), waitForJob(imageJobId)]);
  assert.equal(pdfJob.state, "SUCCEEDED");
  assert.equal(imageJob.state, "SUCCEEDED");
  assert.equal(pdfJob.outcome.status, "REVIEW_REQUIRED");
  assert.equal(imageJob.outcome.status, "REVIEW_REQUIRED");
  const sources = await fetch(`${demo.origin}/api/v1/knowledge-sources`, { headers });
  assert.equal(sources.status, 200);
  const sourcePage = await sources.json();
  assert.ok(sourcePage.items.some(item => item.fileName === "aurora-infusion-controller-manual.pdf" && item.chunkCount > 0));
  const media = await fetch(`${demo.origin}/api/v1/media-review`, { headers });
  assert.equal(media.status, 200);
  const mediaPage = await media.json();
  assert.ok(mediaPage.items.some(item => item.fileName === "aic-overview.png"));
  console.log("Demo smoke passed: real HTTP PDF/image uploads reached durable review-required jobs, PDF passages were indexed, and private image review was available.");
} finally {
  await demo.close();
}
