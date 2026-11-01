import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createPostgresUploadSessionStore, applyProcessingJobMigration } from "../packages/db/dist/index.js";
import { createAzureBlobStorage } from "../packages/storage/dist/index.js";
import { createUploadSessionService } from "../apps/api/dist/upload-session-service.js";

const adminPool = new Pool({ connectionString: "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device" });
const runtimePool = new Pool({ connectionString: "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device" });
const connectionString = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";
const storage = createAzureBlobStorage({ connectionString, containerName: "upload-session-check", allowHttp: true, maxReadBytes: 1024 * 1024 });
const store = createPostgresUploadSessionStore(runtimePool);
const service = createUploadSessionService({ store, storage, uploadTtlSeconds: 300 });
const tenant = { organizationId: "org_upload_check", actorId: "user_upload_check", correlationId: "corr_upload_check" };
const otherTenant = { organizationId: "org_other_upload_check", actorId: "user_other_upload_check", correlationId: "corr_other_upload_check" };
const bytes = Uint8Array.from(Buffer.from("safe fixture upload"));
const sha256 = createHash("sha256").update(bytes).digest("hex");

try {
  await applyProcessingJobMigration(adminPool);
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE upload_sessions, assets, asset_versions TO local_runtime");
  await storage.ensureContainers();
  const created = await service.create(tenant, {
    sourceType: "pdf",
    fileName: "manual.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256,
    actorId: tenant.actorId
  });
  assert.match(created.uploadUrl, /sig=/);
  await storage.putObject({ blobKey: created.session.blobKey, bytes, contentType: "application/pdf" });
  const completed = await service.complete(tenant, created.session.uploadSessionId, {
    blobKey: created.session.blobKey,
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256
  });
  assert.equal(completed?.assetVersion.state, "READY_FOR_SCAN");
  assert.equal((await service.get(otherTenant, created.session.uploadSessionId)), null);
  assert.equal(await service.complete(otherTenant, created.session.uploadSessionId, {
    blobKey: created.session.blobKey,
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    sha256
  }), null);
  console.log("Upload session passed: scoped SAS, bounded checksum verification, immutable READY_FOR_SCAN asset, and cross-tenant isolation.");
} finally {
  await runtimePool.end();
  await adminPool.end();
}
