import type { Pool, PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";

function requireOrganizationId(tenant: TenantContext): string {
  const organizationId = tenant?.organizationId?.trim();
  if (!organizationId || organizationId.length > 128) throw new Error("TENANT_CONTEXT_REQUIRED");
  return organizationId;
}

/**
 * Every tenant-scoped transaction sets the database context locally. `SET LOCAL`
 * semantics ensure a pooled connection cannot retain another organization's scope.
 */
export async function withTenantTransaction<T>(
  pool: Pool,
  tenant: TenantContext,
  action: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [requireOrganizationId(tenant)]);
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
