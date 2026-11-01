import { aiInputEvidence } from "./ai-input-evidence.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AiRunStorePort } from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";

export function createPostgresAiRunStore(pool: Pool): AiRunStorePort {
  return {
    async record({ tenant, request, result, promptVersion, courseVersionId }) {
      const aiRunId = `ai:${randomUUID()}`;
      await withTenantTransaction(pool, tenant, async (client) => {
        await client.query(
          `INSERT INTO ai_runs (
             ai_run_id, organization_id, course_version_id, operation, source_artifact_ids, provider,
             deployment, model, api_version, prompt_version, output_schema_version,
             status, output, citations, warnings, metrics, input_evidence, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            aiRunId,
            tenant.organizationId,
            courseVersionId ?? tenant.courseVersionId ?? null,
            request.operation,
            request.sourceArtifactIds,
            result.providerMetadata.provider,
            result.providerMetadata.deployment,
            result.providerMetadata.model,
            result.providerMetadata.apiVersion,
            promptVersion,
            request.outputSchemaVersion,
            result.status,
            result.output === undefined ? null : JSON.stringify(result.output),
            JSON.stringify(result.citations),
            JSON.stringify(result.warnings),
            JSON.stringify(result.metrics),
            JSON.stringify(aiInputEvidence(request,promptVersion))
          ]
        );
      });
      return aiRunId;
    }
  };
}
