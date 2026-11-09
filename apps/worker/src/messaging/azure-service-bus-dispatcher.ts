import { createHmac } from "node:crypto";
import type { JobDispatcherPort, JobEnvelope } from "@medical-device/contracts";
import type { ServiceBusClient, ServiceBusMessage, ServiceBusSender } from "@azure/service-bus";

export interface AzureServiceBusDispatcherOptions {
  client: ServiceBusClient;
  queueName: string;
  signingSecret: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function canonicalJobMessage(job: JobEnvelope<unknown>): string {
  return canonicalize(job);
}

export function scheduledJobMessageId(job:JobEnvelope<unknown>):string {
  const deferral=job.operatorMetadata?.admissionDeferral;
  if(deferral!==undefined){
    if(typeof deferral!=='string'||!/^[a-f0-9-]{36}$/.test(deferral))throw Error('INVALID_ADMISSION_DEFERRAL');
    return `${job.jobId}:defer:${deferral}`;
  }
  return `${job.jobId}:retry:${job.attempt}`;
}

export function createAzureServiceBusDispatcher(options: AzureServiceBusDispatcherOptions): JobDispatcherPort & { enqueueAt<TPayload>(job: JobEnvelope<TPayload>, availableAt: string): Promise<{ jobId: string }>; close(): Promise<void> } {
  if (options.signingSecret.length < 32) throw new Error("SERVICE_BUS_SIGNING_SECRET_TOO_SHORT");
  const sender: ServiceBusSender = options.client.createSender(options.queueName);

  async function send<TPayload>(job: JobEnvelope<TPayload>, availableAt?: string) {
    const signature = createHmac("sha256", options.signingSecret).update(canonicalJobMessage(job)).digest("hex");
    const message: ServiceBusMessage = {
      messageId: availableAt ? scheduledJobMessageId(job) : job.jobId,
      subject: job.jobType,
      correlationId: job.tenant.correlationId,
      contentType: "application/json",
      body: {
        schemaVersion: "job-message.v1",
        envelope: job,
        integrity: { algorithm: "HMAC-SHA256", signature }
      },
      applicationProperties: {
        schemaVersion: "job-message.v1",
        jobType: job.jobType,
        tenantId: job.tenant.organizationId,
        correlationId: job.tenant.correlationId
      },
      ...(availableAt ? { scheduledEnqueueTimeUtc: new Date(availableAt) } : {})
    };
    await sender.sendMessages(message);
    return { jobId: job.jobId };
  }

  return {
    async enqueue<TPayload>(job: JobEnvelope<TPayload>) {
      return send(job);
    },

    async enqueueAt<TPayload>(job: JobEnvelope<TPayload>, availableAt: string) {
      return send(job, availableAt);
    },

    async close() {
      await sender.close();
    }
  };
}
