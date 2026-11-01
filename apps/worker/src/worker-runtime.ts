import type { JobDispatcherPort, JobOutboxPort } from "@medical-device/contracts";
import { publishOneOutboxMessage } from "./outbox-publisher.js";

export interface BackgroundProcessingRuntimeOptions {
  outbox: JobOutboxPort;
  dispatcher: JobDispatcherPort;
  consumer: { close(): Promise<void> };
  workerId: string;
  publishIntervalMs?: number;
  onError?: (error: unknown) => Promise<void> | void;
  maintenance?:()=>Promise<void>;
}

export function createBackgroundProcessingRuntime(options: BackgroundProcessingRuntimeOptions): {
  start(): Promise<void>;
  close(): Promise<void>;
} {
  const intervalMs = options.publishIntervalMs ?? 1_000;
  let timer: NodeJS.Timeout | undefined;
  let publishing = false;
  let started = false;
  let closed = false;
  let inFlight: Promise<void> | undefined;

  const publishOnce = async (): Promise<void> => {
    if (closed || publishing) return;
    publishing = true;
    inFlight = (async () => {
      try {
        await publishOneOutboxMessage({
          outbox: options.outbox,
          dispatcher: options.dispatcher,
          workerId: options.workerId
        });
      } catch (error) {
        await options.onError?.(error);
      } finally {
        try {
          try { await options.maintenance?.(); } catch(error) { await options.onError?.(error); }
        } finally { publishing = false; inFlight = undefined; }
      }
    })();
    await inFlight;
  };

  return {
    async start() {
      if (closed) throw new Error("WORKER_RUNTIME_CLOSED");
      if (started) return;
      started = true;
      await publishOnce();
      timer = setInterval(() => void publishOnce(), intervalMs);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      if (inFlight) await inFlight;
      await options.consumer.close();
      if ("close" in options.dispatcher && typeof options.dispatcher.close === "function") {
        await options.dispatcher.close();
      }
    }
  };
}
