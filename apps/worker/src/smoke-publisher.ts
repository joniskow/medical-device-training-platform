import { createHash } from "node:crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { Pool } from "pg";
import { createPostgresJobStore } from "@medical-device/db";
import type { AssetProcessingRequest, JobEnvelope, TenantContext } from "@medical-device/contracts";
import { createAzureBlobStorage } from "./storage/azure-blob-storage.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`SMOKE_CONFIGURATION_MISSING:${name}`);
  return value;
}

function runtimeDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const password = encodeURIComponent(required("POSTGRES_RUNTIME_PASSWORD"));
  return `postgresql://${encodeURIComponent(process.env.POSTGRES_RUNTIME_LOGIN?.trim() || "medical_device_runtime")}:${password}@${required("POSTGRES_HOST")}:5432/${process.env.POSTGRES_DATABASE?.trim() || "medical_device"}?sslmode=require`;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const jobId = `job_azure_smoke_${Date.now()}`;
const organizationId = "org_azure_smoke";
const tenant: TenantContext = { organizationId, correlationId: `corr_${jobId}` };
const bytes = Buffer.from(`%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\nmedical-device-worker-smoke:${jobId}\n`, "ascii");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const blobKey = `${organizationId}/smoke/${jobId}.pdf`;
const payload: AssetProcessingRequest = {
  inputAssetVersionId: `assetv_${jobId}`,
  sourceType: "pdf",
  blobKey,
  sha256
};
const job: JobEnvelope<AssetProcessingRequest> = {
  jobId,
  jobType: "asset.process",
  attempt: 1,
  maxAttempts: 2,
  idempotency: { key: `asset-process:${jobId}`, requestHash: sha256 },
  tenant,
  payload,
  inputAssetVersionId: payload.inputAssetVersionId,
  codeVersion: "azure-smoke"
};

const credential = new DefaultAzureCredential();
const pool = new Pool({ connectionString: runtimeDatabaseUrl() });
const storage = createAzureBlobStorage({
  accountUrl: required("STORAGE_ACCOUNT_URL"),
  credential,
  containerName: required("STORAGE_CONTAINER_NAME")
});

const stage = (name: string) => console.log(JSON.stringify({ event: "azure_worker_smoke_stage", stage: name }));

try {
  stage("storage_ensure_start");
  await storage.ensureContainers();
  stage("storage_ensure_done");
  stage("blob_upload_start");
  await storage.putObject({ blobKey, bytes, contentType: "application/pdf" });
  stage("blob_upload_done");
  stage("enqueue_start");
  await createPostgresJobStore(pool).enqueue(job);
  stage("enqueue_done");

  stage("poll_start");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await client.query<{ state: string; outbox_state: string | null; outcome: unknown }>(
        `SELECT j.state, o.state AS outbox_state, j.outcome
         FROM processing_jobs j
         LEFT JOIN processing_job_outbox o ON o.job_id = j.job_id
         WHERE j.job_id = $1`,
        [jobId]
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      if (attempt === 0 || row?.state === "SUCCEEDED" || row?.state === "FAILED" || row?.state === "DEAD_LETTERED") {
        console.log(JSON.stringify({ event: "azure_worker_smoke_poll", attempt, state: row?.state ?? null, outboxState: row?.outbox_state ?? null }));
      }
      if (row?.state === "SUCCEEDED" && row.outbox_state === "PUBLISHED") {
        console.log(JSON.stringify({ event: "azure_worker_smoke_passed", jobId, state: row.state, outboxState: row.outbox_state, outcomeStatus: (row.outcome as { status?: string } | null)?.status }));
        process.exitCode = 0;
        break;
      }
      if (["FAILED", "DEAD_LETTERED"].includes(row?.state ?? "")) {
        throw new Error(`AZURE_WORKER_SMOKE_FAILED:${row?.state}`);
      }
    } finally {
      client.release();
    }
    await sleep(2_000);
    if (attempt === 59) throw new Error("AZURE_WORKER_SMOKE_TIMEOUT");
  }
} finally {
  await pool.end();
}
