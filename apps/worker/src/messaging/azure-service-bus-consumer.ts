import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AssetProcessorPort,
  AssetLifecyclePort,
  AssetScannerPort,
  JobEnvelope,
  JobStorePort,
  JobRecord,
  TenantContext,
  PrivateObjectStoragePort
} from "@medical-device/contracts";
import type {
  ProcessErrorArgs,
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusReceiver
} from "@azure/service-bus";
import { canonicalJobMessage } from "./azure-service-bus-dispatcher.js";
import { processAssetJob } from "../job-runner.js";

interface ScheduledJobDispatcher {
  enqueueAt<TPayload>(job: JobEnvelope<TPayload>, availableAt: string): Promise<{ jobId: string }>;
}

interface SignedJobBody {
  schemaVersion: "job-message.v1";
  envelope: JobEnvelope<unknown>;
  integrity: { algorithm: "HMAC-SHA256"; signature: string };
}

function asSignedJobBody(value: unknown): SignedJobBody {
  const body = typeof value === "string" ? JSON.parse(value) : value;
  if (!body || typeof body !== "object") throw new Error("INVALID_JOB_MESSAGE_BODY");
  const candidate = body as Partial<SignedJobBody>;
  if (candidate.schemaVersion !== "job-message.v1" || !candidate.envelope || !candidate.integrity) {
    throw new Error("INVALID_JOB_MESSAGE_SCHEMA");
  }
  if (candidate.integrity.algorithm !== "HMAC-SHA256" || typeof candidate.integrity.signature !== "string") {
    throw new Error("INVALID_JOB_MESSAGE_INTEGRITY");
  }
  return candidate as SignedJobBody;
}

function equalSignature(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function verifyAzureServiceBusJobMessage(message: Pick<ServiceBusReceivedMessage, "body" | "messageId" | "applicationProperties">, signingSecret: string): JobEnvelope<unknown> {
  if (signingSecret.length < 32) throw new Error("SERVICE_BUS_SIGNING_SECRET_TOO_SHORT");
  const body = asSignedJobBody(message.body);
  const expected = createHmac("sha256", signingSecret).update(canonicalJobMessage(body.envelope)).digest("hex");
  if (!equalSignature(expected, body.integrity.signature)) throw new Error("INVALID_JOB_MESSAGE_SIGNATURE");
  const expectedMessageIds = new Set([
    body.envelope.jobId,
    `${body.envelope.jobId}:retry:${body.envelope.attempt}`
  ]);
  const messageId = typeof message.messageId === "string" ? message.messageId : "";
  if (!expectedMessageIds.has(messageId)) throw new Error("INVALID_JOB_MESSAGE_ID");
  if (message.applicationProperties?.tenantId !== body.envelope.tenant.organizationId) throw new Error("INVALID_JOB_MESSAGE_TENANT");
  if (message.applicationProperties?.correlationId !== body.envelope.tenant.correlationId) throw new Error("INVALID_JOB_MESSAGE_CORRELATION");
  return body.envelope;
}

export type JobMessageHandlingResult = "COMPLETED" | "ABANDONED" | "DEAD_LETTERED";
type ReconstructionHandler=(input:{tenant:TenantContext;jobId:string;workerId:string})=>Promise<JobRecord<unknown>|null>;
type OpenMontageGenerationHandler=(input:{tenant:TenantContext;jobId:string;workerId:string})=>Promise<JobRecord<unknown>|null>;

export async function handleAzureServiceBusJobMessage(input: {
  message: Pick<ServiceBusReceivedMessage, "body" | "messageId" | "applicationProperties">;
  signingSecret: string;
  dispatcher?: ScheduledJobDispatcher;
  jobStore: JobStorePort;
  storage: PrivateObjectStoragePort;
  processor: AssetProcessorPort;
  lifecycleStore?: AssetLifecyclePort;
  scanner?: AssetScannerPort;
  workerId: string;
  processReconstruction?:ReconstructionHandler;
  processOpenMontageGeneration?:OpenMontageGenerationHandler;
  settle: {
    complete(): Promise<void>;
    abandon(): Promise<void>;
    deadLetter(reason: string): Promise<void>;
  };
}): Promise<JobMessageHandlingResult> {
  let envelope: JobEnvelope<unknown>;
  try {
    envelope = verifyAzureServiceBusJobMessage(input.message, input.signingSecret);
  } catch (error) {
    await input.settle.deadLetter(error instanceof Error ? error.message : "INVALID_JOB_MESSAGE");
    return "DEAD_LETTERED";
  }

  try {
    const stored=await input.jobStore.get(envelope.tenant,envelope.jobId);
    if(stored?.jobType==='reconstruction.generate'&&!input.processReconstruction){await input.settle.deadLetter('RECONSTRUCTION_ENGINE_UNAVAILABLE');return 'DEAD_LETTERED';}
    if(stored?.jobType==='openmontage.generate'&&!input.processOpenMontageGeneration){await input.settle.deadLetter('OPENMONTAGE_GENERATION_UNAVAILABLE');return 'DEAD_LETTERED';}
    const result = stored?.jobType==='reconstruction.generate'?await input.processReconstruction!({tenant:envelope.tenant,jobId:envelope.jobId,workerId:input.workerId}):stored?.jobType==='openmontage.generate'?await input.processOpenMontageGeneration!({tenant:envelope.tenant,jobId:envelope.jobId,workerId:input.workerId}):await processAssetJob({
      jobStore: input.jobStore,
      storage: input.storage,
      processor: input.processor,
      lifecycleStore: input.lifecycleStore,
      scanner: input.scanner,
      tenant: envelope.tenant,
      jobId: envelope.jobId,
      workerId: input.workerId
    });
    if (result?.state === "RETRY_SCHEDULED") {
      if (input.dispatcher?.enqueueAt) {
        await input.dispatcher.enqueueAt(envelope, result.availableAt);
        await input.settle.complete();
        return "COMPLETED";
      }
      await input.settle.abandon();
      return "ABANDONED";
    }
    await input.settle.complete();
    return "COMPLETED";
  } catch {
    await input.settle.abandon();
    return "ABANDONED";
  }
}

export interface AzureServiceBusWorkerOptions {
  client: ServiceBusClient;
  queueName: string;
  signingSecret: string;
  dispatcher?: ScheduledJobDispatcher;
  jobStore: JobStorePort;
  storage: PrivateObjectStoragePort;
  processor: AssetProcessorPort;
  lifecycleStore?: AssetLifecyclePort;
  scanner?: AssetScannerPort;
  workerId: string;
  processReconstruction?:ReconstructionHandler;
  processOpenMontageGeneration?:OpenMontageGenerationHandler;
  maxConcurrentCalls?: number;
  onError?: (error: ProcessErrorArgs) => Promise<void>;
}

export function createAzureServiceBusWorker(options: AzureServiceBusWorkerOptions): { close(): Promise<void> } {
  // Reconstruction may exceed the SDK's five-minute renewal default.
  // https://learn.microsoft.com/en-us/javascript/api/@azure/service-bus/servicebusreceiveroptions#maxautolockrenewaldurationinms
  const receiver: ServiceBusReceiver = options.client.createReceiver(options.queueName, { receiveMode: "peekLock",maxAutoLockRenewalDurationInMs:options.processReconstruction||options.processOpenMontageGeneration?3_600_000:300_000 });
  const subscription = receiver.subscribe({
    processMessage: async (message) => {
      await handleAzureServiceBusJobMessage({
        message,
        signingSecret: options.signingSecret,
        dispatcher: options.dispatcher,
        jobStore: options.jobStore,
        storage: options.storage,
        processor: options.processor,
        lifecycleStore: options.lifecycleStore,
        scanner: options.scanner,
        workerId: options.workerId,
        processReconstruction:options.processReconstruction,
        processOpenMontageGeneration:options.processOpenMontageGeneration,
        settle: {
          complete: () => receiver.completeMessage(message),
          abandon: () => receiver.abandonMessage(message),
          deadLetter: (reason) => receiver.deadLetterMessage(message, {
            deadLetterReason: "INVALID_JOB_MESSAGE",
            deadLetterErrorDescription: reason
          })
        }
      });
    },
    processError: async (args) => options.onError?.(args)
  }, {
    autoCompleteMessages: false,
    maxConcurrentCalls: options.maxConcurrentCalls ?? 2
  });

  return {
    async close() {
      await subscription.close();
      await receiver.close();
    }
  };
}
