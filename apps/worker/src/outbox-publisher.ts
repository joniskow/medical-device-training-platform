import type { JobDispatcherPort, JobOutboxPort } from "@medical-device/contracts";

export type OutboxPublishResult =
  | { status: "EMPTY" }
  | { status: "PUBLISHED"; outboxId: string; jobId: string }
  | { status: "FAILED"; outboxId: string; jobId: string };

export async function publishOneOutboxMessage(input: {
  outbox: JobOutboxPort;
  dispatcher: JobDispatcherPort;
  workerId: string;
  now?: string;
  leaseSeconds?: number;
}): Promise<OutboxPublishResult> {
  const item = await input.outbox.claim(input.workerId, input.now, input.leaseSeconds);
  if (!item) return { status: "EMPTY" };

  try {
    await input.dispatcher.enqueue(item.message);
    const published = await input.outbox.markPublished(item.outboxId, input.workerId, input.now);
    if (!published) return { status: "FAILED", outboxId: item.outboxId, jobId: item.jobId };
    return { status: "PUBLISHED", outboxId: item.outboxId, jobId: item.jobId };
  } catch (error) {
    await input.outbox.markFailed(item.outboxId, input.workerId, {
      class: "RETRYABLE",
      code: "OUTBOX_PUBLISH_FAILED",
      message: error instanceof Error ? error.message : "The job could not be published",
      retryAfterSeconds: 30
    }, input.now);
    return { status: "FAILED", outboxId: item.outboxId, jobId: item.jobId };
  }
}
