import { createHash } from "node:crypto";

const id = (prefix, value) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

export function createDeterministicAssetProcessor() {
  return {
    async inspect(request) {
      const supported = ["pdf", "image", "video", "gltf", "glb"].includes(request.sourceType);
      return { supported, reasons: supported ? [] : ["UNSUPPORTED_SOURCE_TYPE"] };
    },
    async canProcess(request) {
      return (await this.inspect(request)).supported;
    },
    async process(request) {
      const artifactId = id("artifact", `${request.inputAssetVersionId}:${request.sha256}`);
      return {
        adapter: `deterministic-${request.sourceType}-processor`,
        adapterVersion: "local-1",
        inputAssetVersionId: request.inputAssetVersionId,
        outputArtifactIds: [artifactId],
        status: "READY",
        warnings: [],
        metrics: { durationMs: 1, inputBytes: 1, outputBytes: 1 },
        details: { deterministic: true }
      };
    }
  };
}

export function createDeterministicAiGateway() {
  return {
    async execute(request) {
      return {
        operation: request.operation,
        status: "DRAFT",
        output: { schemaVersion: request.outputSchemaVersion, operation: request.operation, draft: true },
        citations: request.sourceArtifactIds,
        warnings: [],
        metrics: { durationMs: 1, inputTokens: 1, outputTokens: 1 },
        providerMetadata: {
          provider: "azure-openai",
          deployment: "deterministic-local",
          model: "fixture-model",
          apiVersion: "local"
        }
      };
    }
  };
}

export function createInMemoryObjectStorage() {
  const objects = new Map();
  return {
    objects,
    async createUploadUrl({ blobKey }) { return `memory://upload/${encodeURIComponent(blobKey)}`; },
    async createDownloadUrl({ blobKey }) { return `memory://download/${encodeURIComponent(blobKey)}`; },
    async readObject({ blobKey }) {
      const object = objects.get(blobKey);
      if (!object || object.quarantined) throw new Error("OBJECT_NOT_AVAILABLE");
      return { bytes: object.bytes, contentType: object.contentType, sha256: object.sha256 };
    },
    async putObject({ blobKey, bytes, contentType = "application/octet-stream" }) {
      const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      objects.set(blobKey, {
        bytes: value,
        contentType,
        sha256: createHash("sha256").update(value).digest("hex"),
        quarantined: false
      });
    },
    async verifyChecksum({ blobKey, expectedSha256 }) {
      const object = objects.get(blobKey);
      return Boolean(object && !object.quarantined && object.sha256 === expectedSha256);
    },
    async quarantine({ blobKey, reason }) {
      const object = objects.get(blobKey);
      objects.set(blobKey, { ...object, quarantined: true, reason });
    }
  };
}

export function createInMemoryJobStore() {
  const records = new Map();
  const cloneOutcome = (outcome) => outcome ? {
    ...outcome,
    outputArtifactIds: [...outcome.outputArtifactIds],
    warnings: outcome.warnings.map((warning) => ({ ...warning })),
    metrics: { ...outcome.metrics },
    failure: outcome.failure ? { ...outcome.failure } : undefined,
    details: outcome.details ? { ...outcome.details } : undefined
  } : undefined;
  const clone = (record) => ({
    ...record,
    tenant: { ...record.tenant },
    payload: { ...record.payload },
    idempotency: { ...record.idempotency },
    outputArtifactIds: record.outputArtifactIds ? [...record.outputArtifactIds] : undefined,
    outcome: cloneOutcome(record.outcome)
  });
  const timestamp = (now) => now ?? new Date(0).toISOString();
  return {
    records,
    async get(tenant,jobId) {
      if(!tenant?.organizationId)throw Error('TENANT_CONTEXT_REQUIRED');
      const record=records.get(jobId);return record?.tenant.organizationId===tenant.organizationId?clone(record):null;
    },
    async enqueue(job) {
      const existing = records.get(job.idempotency.key);
      if (existing) {
        if (existing.idempotency.requestHash !== job.idempotency.requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
        return clone(existing);
      }
      const now = timestamp();
      const record = { ...job, state: "QUEUED", createdAt: now, updatedAt: now, availableAt: now };
      records.set(job.idempotency.key, record);
      records.set(job.jobId, record);
      return clone(record);
    },
    async claim(tenant, jobId, workerId, now, leaseSeconds = 300) {
      const record = records.get(jobId);
      if (!tenant?.organizationId) throw new Error("TENANT_CONTEXT_REQUIRED");
      if (record && record.tenant.organizationId !== tenant.organizationId) return null;
      if (!record || ["SUCCEEDED", "FAILED", "DEAD_LETTERED"].includes(record.state)) return null;
      const current = timestamp(now);
      if (record.state === "RETRY_SCHEDULED" && record.availableAt > current) return null;
      if (record.state === "RUNNING" && record.leaseExpiresAt && record.leaseExpiresAt > current) return null;
      if (record.state === "RUNNING") record.attempt += 1;
      record.state = "RUNNING";
      record.leaseOwner = workerId;
      record.leaseGeneration = (record.leaseGeneration ?? 0) + 1;
      record.leaseExpiresAt = new Date(Date.parse(current) + leaseSeconds * 1000).toISOString();
      record.updatedAt = current;
      return clone(record);
    },
    async succeed(tenant, jobId, workerId, leaseGeneration, outcome, now, completion) {
      const record = records.get(jobId);
      if (!tenant?.organizationId) throw new Error("TENANT_CONTEXT_REQUIRED");
      if (!record) throw new Error("JOB_NOT_FOUND");
      if (record.tenant.organizationId !== tenant.organizationId) return null;
      if (record.state !== "RUNNING" || record.leaseOwner !== workerId || record.leaseGeneration !== leaseGeneration) return null;
      await completion?.beforeCommit?.();
      record.state = "SUCCEEDED";
      record.outcome = cloneOutcome(outcome);
      record.outputArtifactIds = [...outcome.outputArtifactIds];
      record.leaseExpiresAt = undefined;
      record.updatedAt = timestamp(now);
      return clone(record);
    },
    async fail(tenant, jobId, workerId, leaseGeneration, failure, now, outcome, completion) {
      const record = records.get(jobId);
      if (!tenant?.organizationId) throw new Error("TENANT_CONTEXT_REQUIRED");
      if (!record) throw new Error("JOB_NOT_FOUND");
      if (record.tenant.organizationId !== tenant.organizationId) return null;
      if (record.state !== "RUNNING" || record.leaseOwner !== workerId || record.leaseGeneration !== leaseGeneration) return null;
      await completion?.beforeCommit?.();
      record.lastFailure = failure;
      if (outcome) {
        record.outcome = cloneOutcome(outcome);
        record.outputArtifactIds = [...outcome.outputArtifactIds];
      }
      record.updatedAt = timestamp(now);
      if (failure.class === "RETRYABLE" && record.attempt < record.maxAttempts) {
        record.attempt += 1;
        record.state = "RETRY_SCHEDULED";
        record.availableAt = new Date(Date.parse(record.updatedAt) + (failure.retryAfterSeconds ?? 0) * 1000).toISOString();
      } else {
        record.state = failure.class === "RETRYABLE" ? "DEAD_LETTERED" : "FAILED";
      }
      record.leaseExpiresAt = undefined;
      return clone(record);
    }
  };
}

export function createInMemoryJobDispatcher() {
  const jobs = [];
  return { jobs, async enqueue(job) { jobs.push(job); return { jobId: job.jobId }; } };
}

export function createInMemoryNotifications() {
  const notifications = [];
  return {
    notifications,
    async create(notification) {
      notifications.push(notification);
      return { notificationId: id("notification", notification.idempotencyKey) };
    }
  };
}

export function createDeterministicSimulation() {
  return {
    async applyAction({ action }) {
      const accepted = action.sequence >= 0 && Boolean(action.actionId) && Boolean(action.nonce);
      return {
        accepted,
        nextSequence: accepted ? action.sequence + 1 : action.sequence,
        scoreDelta: accepted ? 1 : 0,
        redactedState: { lastActionType: action.type },
        warnings: accepted ? [] : [{ code: "INVALID_ACTION", severity: "error", message: "Action rejected" }]
      };
    }
  };
}

export function createDeterministicPolicyEvaluator() {
  return {
    async evaluate({ evidence }) {
      const score = typeof evidence?.score === "number" ? evidence.score : 0;
      return { passed: score >= 80, score, reasons: score >= 80 ? [] : ["SCORE_BELOW_THRESHOLD"] };
    }
  };
}
