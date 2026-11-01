import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const root = resolve(import.meta.dirname, "..");
const organizationId = "org_fixture";
const demoSubject = "demo-user";
const storageConnectionString = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";

function loadLocalEnv() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function configureLocalDefaults() {
  loadLocalEnv();
  process.env.APP_ENV = "demo";
  process.env.DATABASE_URL ??= "postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device";
  process.env.DATABASE_ADMIN_URL ??= "postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device";
  process.env.DATABASE_OUTBOX_URL ??= "postgresql://medical_device_outbox_publisher:local_outbox_only_change_me@127.0.0.1:54329/medical_device";
  process.env.AZURE_STORAGE_CONNECTION_STRING ??= storageConnectionString;
  process.env.STORAGE_CONTAINER_NAME ??= "source-assets";
  process.env.PDF_PYTHON ??= process.platform === "win32" ? "python" : "python3";
}

function hasCommand(command) {
  return spawnSync(command, ["-version"], { stdio: "ignore", windowsHide: true }).status === 0;
}

function imageDimensions(bytes, contentType) {
  if (contentType === "image/png" && bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (contentType === "image/webp" && bytes.length >= 30 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP") {
    const format = Buffer.from(bytes.subarray(12, 16)).toString();
    if (format === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (contentType === "image/jpeg" && bytes.length > 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      if (!length) break;
      offset += 2 + length;
    }
  }
  return { width: 1, height: 1 };
}

function createDemoImageProcessor(storage) {
  const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
  return {
    inspect: async request => ({ supported: request.sourceType === "image" && supported.has(request.contentType ?? "") && (request.sizeBytes ?? 0) <= 128 * 1024 * 1024, reasons: [] }),
    canProcess: async request => request.sourceType === "image" && supported.has(request.contentType ?? ""),
    async process(request, job) {
      const object = await storage.readObject({ blobKey: request.blobKey, maxBytes: 128 * 1024 * 1024 });
      const checksum = createHash("sha256").update(object.bytes).digest("hex");
      if (checksum !== request.sha256) throw new Error("CHECKSUM_MISMATCH");
      const dimensions = imageDimensions(Buffer.from(object.bytes), request.contentType ?? "");
      const prefix = `${job.tenant.organizationId}/derived/media/${encodeURIComponent(request.inputAssetVersionId)}/${request.sha256}`;
      const report = {
        schemaVersion: "media-inspection.v1",
        assetVersionId: request.inputAssetVersionId,
        sourceSha256: request.sha256,
        sourceType: "image",
        contentType: request.contentType,
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: 0,
        videoCodec: null,
        audioCodec: null,
        previewBlobKey: `${prefix}/preview.png`,
        decodeVerified: true,
        reconstructionPerformed: false,
        demoFallback: true
      };
      await storage.putObject({ blobKey: report.previewBlobKey, bytes: object.bytes, contentType: request.contentType });
      await storage.putObject({ blobKey: `${prefix}/inspection.json`, bytes: Buffer.from(JSON.stringify(report)), contentType: "application/json" });
      return {
        adapter: "demo-image-inspection",
        adapterVersion: "1",
        inputAssetVersionId: request.inputAssetVersionId,
        outputArtifactIds: [`${prefix}/inspection.json`, report.previewBlobKey],
        status: "REVIEW_REQUIRED",
        warnings: [{ code: "DEMO_IMAGE_REVIEW_REQUIRED", severity: "warning", message: "Local demo image inspection preserved the private original and measured its container. Review suitability and rights before publication." }],
        metrics: { durationMs: 1, inputBytes: object.bytes.length, outputBytes: object.bytes.length },
        details: report
      };
    }
  };
}

export async function startDemoServer({ port = Number(process.env.DEMO_PORT ?? 8787) } = {}) {
  configureLocalDefaults();
  const [db, storagePkg] = await Promise.all([
    import("../packages/db/dist/index.js"),
    import("../packages/storage/dist/index.js")
  ]);
  const { createJobStatusHttpServer } = await import("../apps/api/dist/job-status-http.js");
  const { createUploadSessionService } = await import("../apps/api/dist/upload-session-service.js");
  const { createMediaReviewService } = await import("../apps/api/dist/media-review-service.js");
  const { createMediaAssetService } = await import("../apps/api/dist/media-asset-service.js");
  const { createSourceGroundedDraftService, createDeterministicAiGateway } = await import("../packages/ai-gateway/dist/index.js");
  const { createBackgroundProcessingRuntime } = await import("../apps/worker/dist/worker-runtime.js");
  const { processAssetJob } = await import("../apps/worker/dist/job-runner.js");
  const { createPdfAssetProcessor } = await import("../apps/worker/dist/pdf-asset-processor.js");
  const { createMediaAssetProcessor } = await import("../apps/worker/dist/media-asset-processor.js");
  const { createGlbAssetProcessor } = await import("../apps/worker/dist/glb-asset-processor.js");
  const { createAssetProcessor } = await import("../apps/worker/dist/pilot-asset-processor.js");
  const { createDeterministicAssetScanner } = await import("../apps/worker/dist/asset-scanner.js");

  const adminPool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const runtimePool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  const publisherPool = new Pool({ connectionString: process.env.DATABASE_OUTBOX_URL });
  await db.applyProcessingJobMigration(adminPool);
  await adminPool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_chunks TO local_runtime");
  await adminPool.query("GRANT SELECT, INSERT, UPDATE ON course_review_decisions TO local_runtime");
  await adminPool.query("GRANT SELECT, INSERT ON ai_runs TO local_runtime");
  await adminPool.query("GRANT SELECT, UPDATE ON processing_job_outbox TO medical_device_outbox_publisher");
  const storage = storagePkg.createAzureBlobStorage({ connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING, containerName: process.env.STORAGE_CONTAINER_NAME, allowHttp: true, maxReadBytes: 128 * 1024 * 1024 });
  await storage.ensureContainers();

  const jobs = db.createPostgresJobStore(runtimePool);
  const outbox = db.createPostgresOutboxStore(publisherPool, { organizationId });
  const knowledge = db.createPostgresKnowledgeStore(runtimePool);
  const lifecycle = db.createPostgresAssetLifecycleStore(runtimePool);
  const scanner = createDeterministicAssetScanner();
  const pilot = createAssetProcessor();
  const localImage = createDemoImageProcessor(storage);
  const media = createMediaAssetProcessor({ storage, fallback: pilot });
  const mediaFallback = hasCommand("ffmpeg") && hasCommand("ffprobe") ? media : localImage;
  const glb = createGlbAssetProcessor({ storage, models: db.createModelImportStore(runtimePool), fallback: mediaFallback });
  const processor = createPdfAssetProcessor({ storage, knowledge, fallback: glb, python: process.env.PDF_PYTHON });
  const dispatcher = {
    async enqueue(message) {
      await processAssetJob({ jobStore: jobs, storage, processor, lifecycleStore: lifecycle, scanner, tenant: message.tenant, jobId: message.jobId, workerId: "demo-worker" });
      return { jobId: message.jobId };
    }
  };
  const runtime = createBackgroundProcessingRuntime({ outbox, dispatcher, workerId: "demo-publisher", publishIntervalMs: 250, consumer: { async close() {} }, onError: error => console.error("demo_worker_error", error) });

  const uploadSessionService = createUploadSessionService({ store: db.createPostgresUploadSessionStore(runtimePool), storage, jobStore: jobs, uploadTtlSeconds: 900, privateUpload: true });
  const courseReviewStore = db.createPostgresCourseReviewStore(runtimePool, { releaseArtifacts: storagePkg.createReleaseArtifactPublisher({ storage }) });
  const draftService = createSourceGroundedDraftService({ knowledge, gateway: createDeterministicAiGateway(), aiRuns: db.createPostgresAiRunStore(runtimePool), draftStore: courseReviewStore, promptVersion: "demo-course-draft.v1" });
  const demoPrincipals = {
    "Bearer demo": { subject: demoSubject, roles: ["operator", "organization_admin", "author", "reviewer", "publisher"] },
    "Bearer demo-author": { subject: "demo-author", roles: ["author"] },
    "Bearer demo-reviewer": { subject: "demo-reviewer", roles: ["reviewer", "publisher"] }
  };
  const authenticator = { async authenticate(request) {
    const principal = demoPrincipals[request.headers.authorization];
    return principal ? { ...principal, issuer: "local-demo", identityTenant: "local-demo", verifiedEmail: `${principal.subject}@example.test` } : null;
  } };
  const organizationContextResolver = { async resolveActiveOrganizations() { return [organizationId]; } };
  const server = createJobStatusHttpServer({
    staticRoot: resolve(root, "apps/web/dist"),
    statusService: { get: async (tenant, jobId) => jobs.get(tenant, jobId), retry: async (tenant, jobId, request) => jobs.retry(tenant, jobId, request) },
    authenticator,
    organizationContextResolver,
    uploadSessionService,
    knowledgeStore: knowledge,
    courseReviewStore,
    draftService,
    mediaAssetService: createMediaAssetService(runtimePool, storage, true),
    mediaReviewService: createMediaReviewService(runtimePool, storage),
    allowedOrigins: port > 0 ? [`http://127.0.0.1:${port}`] : []
  });
  await runtime.start();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveListen); });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const origin = `http://127.0.0.1:${actualPort}`;
  console.log(JSON.stringify({ event: "demo_started", origin, url: `${origin}/demo`, organizationId, processor: mediaFallback === media ? "ffmpeg-media-inspection" : "local-image-inspection" }));

  let closed = false;
  return { origin, url: `${origin}/demo`, server, async close() { if (closed) return; closed = true; await runtime.close(); await new Promise(resolveClose => server.close(resolveClose)); await Promise.all([adminPool.end(), runtimePool.end(), publisherPool.end()]); } };
}

if (import.meta.main) {
  const demo = await startDemoServer();
  const shutdown = async signal => { console.log(JSON.stringify({ event: "demo_stopping", signal })); await demo.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
