import { assertProductionConfiguration } from '@medical-device/contracts';
import {readWebhookKeys} from '@medical-device/db';
import { createAzureBackgroundProcessingRuntime } from "./azure-runtime.js";
import {initializeReconstructionEngine} from './reconstruction-engine-configuration.js';
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
  const candidate=value&&typeof value==='object'?value as {name?:unknown;code?:unknown}:{};
  const safe=(item:unknown)=>typeof item==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(item)?item:undefined;
  // Provider exception messages may include source text, private URLs or tokens.
  return JSON.stringify({name:safe(candidate.name)??'WorkerError',code:safe(candidate.code)??'WORKER_RUNTIME_ERROR'});
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

assertProductionConfiguration('worker', process.env);
const processor = await loadProcessor();
const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}`;
const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim() || (() => {
  const host = required("POSTGRES_HOST");
  const database = process.env.POSTGRES_DATABASE?.trim() || "medical_device";
  const login = process.env.POSTGRES_RUNTIME_LOGIN?.trim() || "medical_device_runtime";
  const password = encodeURIComponent(required("POSTGRES_RUNTIME_PASSWORD"));
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
  const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL?.trim() || (() => {
    const host = required("POSTGRES_HOST");
    const database = process.env.POSTGRES_DATABASE?.trim() || "medical_device";
    const login = process.env.POSTGRES_ADMIN_LOGIN?.trim() || "mdtadmin";
    const password = encodeURIComponent(required("POSTGRES_ADMIN_PASSWORD"));
    return `postgresql://${encodeURIComponent(login)}:${password}@${host}:5432/${database}?sslmode=require`;
  })();
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
  operationalSecret:process.env.OPERATIONAL_KEY_SECRET?.trim(),
  webhookKeys:readWebhookKeys(process.env.WEBHOOK_KEYS_JSON),
  reconstructionEngine:await initializeReconstructionEngine(process.env),
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
