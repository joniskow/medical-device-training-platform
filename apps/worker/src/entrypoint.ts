import { createAzureBackgroundProcessingRuntime } from "./azure-runtime.js";
import {readReconstructionEngine} from './reconstruction-engine-configuration.js';
import type { AssetProcessorPort } from "@medical-device/contracts";
import { bootstrapPostgres } from "./postgres-bootstrap.js";
import {DefaultAzureCredential} from '@azure/identity';
import {createWorkerInvitationEmailOptions} from './invitation-email-configuration.js';
import {readEmailReportConfiguration} from './email-report-configuration.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`WORKER_CONFIGURATION_MISSING:${name}`);
  return value;
}

function describeRuntimeError(value: unknown): string {
  if (value instanceof Error) return `${value.name}:${value.message}`;
  if (value && typeof value === "object") {
    const candidate = value as { error?: unknown; code?: unknown; condition?: unknown; entityPath?: unknown };
    const nested = candidate.error instanceof Error
      ? `${candidate.error.name}:${candidate.error.message}`
      : candidate.error === undefined ? undefined : String(candidate.error);
    return JSON.stringify({
      error: nested,
      code: candidate.code,
      condition: candidate.condition,
      entityPath: candidate.entityPath
    });
  }
  return String(value);
}

async function loadProcessor(): Promise<AssetProcessorPort> {
  const modulePath = required("ASSET_PROCESSOR_MODULE");
  const loaded = await import(modulePath);
  const processor = typeof loaded.createAssetProcessor === "function"
    ? await loaded.createAssetProcessor()
    : loaded.default;
  if (!processor || typeof processor.inspect !== "function" || typeof processor.process !== "function") {
    throw new Error("WORKER_PROCESSOR_MODULE_INVALID");
  }
  return processor as AssetProcessorPort;
}

const processor = await loadProcessor();
const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}`;
const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim() || (() => {
  const host = required("POSTGRES_HOST");
  const database = process.env.POSTGRES_DATABASE?.trim() || "medical_device";
  const login = process.env.POSTGRES_RUNTIME_LOGIN?.trim() || "medical_device_runtime";
  const password = encodeURIComponent(required("POSTGRES_RUNTIME_PASSWORD"));
  return `postgresql://${encodeURIComponent(login)}:${password}@${host}:5432/${database}?sslmode=require`;
})();
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL?.trim() || (() => {
  const host = required("POSTGRES_HOST");
  const database = process.env.POSTGRES_DATABASE?.trim() || "medical_device";
  const login = process.env.POSTGRES_ADMIN_LOGIN?.trim() || "mdtadmin";
  const password = encodeURIComponent(required("POSTGRES_ADMIN_PASSWORD"));
  return `postgresql://${encodeURIComponent(login)}:${password}@${host}:5432/${database}?sslmode=require`;
})();
const outboxDatabaseUrl = process.env.DATABASE_OUTBOX_URL?.trim() || (() => {
  const host = required("POSTGRES_HOST");
  const database = process.env.POSTGRES_DATABASE?.trim() || "medical_device";
  const login = process.env.POSTGRES_OUTBOX_LOGIN?.trim() || "medical_device_outbox_publisher";
  const password = encodeURIComponent(required("POSTGRES_OUTBOX_PASSWORD"));
  return `postgresql://${encodeURIComponent(login)}:${password}@${host}:5432/${database}?sslmode=require`;
})();
if (process.env.RUN_DATABASE_MIGRATIONS === "true") {
  await bootstrapPostgres({
    adminDatabaseUrl,
    runtimeDatabaseUrl,
    runtimePassword: required("POSTGRES_RUNTIME_PASSWORD"),
    outboxPublisherPassword: required("POSTGRES_OUTBOX_PASSWORD"),
    ...(process.env.SEED_PILOT_MEMBERSHIP === "true" ? {
      pilotSubject: required("PILOT_SUBJECT"),
      pilotOrganizationId: required("PILOT_ORGANIZATION_ID"),
      ...(process.env.PILOT_ORGANIZATION_ROLES?.trim()?{pilotRoles:process.env.PILOT_ORGANIZATION_ROLES.split(',').map(role=>role.trim())}:{})
    } : {})
  });
}
const worker = createAzureBackgroundProcessingRuntime({
  invitationEmail:createWorkerInvitationEmailOptions(process.env,new DefaultAzureCredential()),
  emailReports:readEmailReportConfiguration(process.env),
  databaseUrl: runtimeDatabaseUrl,
  outboxDatabaseUrl,
  serviceBusNamespace: required("SERVICE_BUS_NAMESPACE"),
  storageAccountUrl: required("STORAGE_ACCOUNT_URL"),
  storageContainerName: required("STORAGE_CONTAINER_NAME"),
  serviceBusQueueName: process.env.SERVICE_BUS_QUEUE_NAME?.trim() || "asset-processing",
  signingSecret: required("SERVICE_BUS_SIGNING_SECRET"),
  workerId,
  processor,
  reconstructionEngine:readReconstructionEngine(process.env),
  maxConcurrentCalls: Number(process.env.WORKER_MAX_CONCURRENT_CALLS ?? 2),
  publishIntervalMs: Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 1_000),
  onError: async (error) => {
    console.error("worker_runtime_error", describeRuntimeError(error));
  }
});

await worker.ensureStorage();
await worker.runtime.start();
console.log(JSON.stringify({ event: "worker_started", workerId }));

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "worker_stopping", signal, workerId }));
  await worker.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
