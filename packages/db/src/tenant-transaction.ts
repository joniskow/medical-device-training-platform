import type { Pool, PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import {AsyncLocalStorage} from 'node:async_hooks';

const transactionContext=new AsyncLocalStorage<{pool:Pool;organizationId:string;client:PoolClient;active:boolean}>();
/** Storage decorators may participate in their caller's transaction without a second connection/deadlock. */
export function currentTenantTransactionClient(pool:Pool,organizationId:string):PoolClient|undefined{
  const context=transactionContext.getStore();return context?.active&&context.pool===pool&&context.organizationId===organizationId?context.client:undefined;
}

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
  action: (client: PoolClient) => Promise<T>,
  options?:{isolation:'repeatable read'|'serializable'}
): Promise<T> {
  const organizationId=requireOrganizationId(tenant);
  const client = await pool.connect();
  const context={pool,organizationId,client,active:true};
  try {
    if(options&&options.isolation!=='repeatable read'&&options.isolation!=='serializable')throw Error('TRANSACTION_ISOLATION_INVALID');
    await client.query(options?.isolation==='repeatable read'?'BEGIN ISOLATION LEVEL REPEATABLE READ':options?.isolation==='serializable'?'BEGIN ISOLATION LEVEL SERIALIZABLE':'BEGIN');
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await transactionContext.run(context,()=>action(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    context.active=false;
    client.release();
  }
}
