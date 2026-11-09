import type { Pool, PoolClient } from "pg";
import type { AssetLifecyclePort } from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";

/** The caller owns the tenant transaction and any required processing-job row lock. */
export async function transitionPostgresAsset(client: PoolClient, {assetVersionId,state,reason}: Omit<Parameters<AssetLifecyclePort['transition']>[0], 'tenant'|'jobLease'>): Promise<boolean> {
  const result = await client.query(
    `UPDATE asset_versions
     SET state = $2, reason = COALESCE($3, reason), updated_at = CURRENT_TIMESTAMP
     WHERE asset_version_id = $1
       AND (
         (state = $2)
         OR ($2 = 'PROCESSING' AND state IN ('READY_FOR_SCAN', 'READY_FOR_PROCESSING', 'PROCESSING_FAILED', 'SCAN_FAILED'))
         OR ($2 = 'QUARANTINED' AND state IN ('READY_FOR_SCAN', 'PROCESSING', 'PROCESSING_FAILED', 'SCAN_FAILED'))
         OR ($2 = 'SCAN_FAILED' AND state IN ('READY_FOR_SCAN', 'PROCESSING'))
         OR ($2 = 'PROCESSING_FAILED' AND state = 'PROCESSING')
         OR ($2 = 'READY_FOR_REVIEW' AND state = 'PROCESSING')
         OR ($2 = 'APPROVED' AND state = 'READY_FOR_REVIEW')
         OR ($2 = 'REJECTED' AND state = 'READY_FOR_REVIEW')
       )`,
    [assetVersionId, state, reason ?? null]
  );
  return result.rowCount === 1;
}

export function createPostgresAssetLifecycleStore(pool: Pool): AssetLifecyclePort {
  return {
    async transition({ tenant, assetVersionId, state, reason, jobLease }) {
      return withTenantTransaction(pool, tenant, async (client) => {
        if (jobLease) {
          // Serialize against reclamation/cancellation before touching the asset.
          const current = await client.query(`SELECT 1 FROM processing_jobs
            WHERE job_id=$1 AND state='RUNNING' AND lease_owner=$2 AND lease_generation=$3
              AND payload->>'inputAssetVersionId'=$4 FOR UPDATE`,
          [jobLease.jobId,jobLease.workerId,jobLease.leaseGeneration,assetVersionId]);
          if (!current.rowCount) return false;
        }
        return transitionPostgresAsset(client,{assetVersionId,state,reason});
      });
    }
  };
}
