import { createHash } from "node:crypto";
import type { AssetProcessorPort } from "@medical-device/contracts";

const supportedSourceTypes = new Set(["pdf", "image", "video", "gltf", "glb"]);
const rehearsalFailureMode = process.env.WORKER_REHEARSAL_FAILURE_MODE?.trim();
const rehearsalFailureEnabled = process.env.WORKER_REHEARSAL_FAILURE_ENABLED === "true";

function throwRehearsalFailure(): never {
  throw new Error("REHEARSAL_RETRYABLE_INSPECTION_FAILURE");
}

export function createAssetProcessor(): AssetProcessorPort {
  return {
    async inspect(request) {
      if (rehearsalFailureEnabled && rehearsalFailureMode === "retryable-inspect") {
        throwRehearsalFailure();
      }
      const supported = supportedSourceTypes.has(request.sourceType);
      return {
        supported,
        reasons: supported ? [] : ["UNSUPPORTED_SOURCE_TYPE"]
      };
    },
    async canProcess(request) {
      return supportedSourceTypes.has(request.sourceType);
    },
    async process(request) {
      const artifactId = `artifact_${createHash("sha256")
        .update(`${request.inputAssetVersionId}:${request.sha256}`)
        .digest("hex")
        .slice(0, 16)}`;
      return {
        adapter: `pilot-${request.sourceType}-processor`,
        adapterVersion: "pilot-1",
        inputAssetVersionId: request.inputAssetVersionId,
        outputArtifactIds: [artifactId],
        status: "REVIEW_REQUIRED",
        warnings: [{
          code: "PILOT_PROCESSOR_REVIEW_REQUIRED",
          severity: "warning",
          message: "The source was validated and queued successfully; content extraction and AI conversion still require human review in this pilot slice."
        }],
        metrics: { durationMs: 1, inputBytes: 0, outputBytes: 0 },
        details: {
          processingMode: "validated-source-smoke",
          sourceType: request.sourceType
        }
      };
    }
  };
}
