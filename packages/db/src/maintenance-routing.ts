import type {Pool} from 'pg';

export const LIFECYCLE_ROUTING_OWNER='medical_device_lifecycle_router';
const identifier=(value:string)=>{if(!/^[a-z_][a-z0-9_]{0,62}$/.test(value))throw Error('MAINTENANCE_IDENTIFIER_INVALID');return '"'+value+'"';};
/** Explicit owner-only policies work with FORCE RLS even on managed PostgreSQL.
 * The NOLOGIN owner is never granted to application/dispatcher roles. Only its
 * fixed, bounded SECURITY DEFINER functions expose routing metadata.
 */
export function lifecycleRoutingPolicyStatements(schema='public',ownerRole=LIFECYCLE_ROUTING_OWNER):string[]{
 const ns=identifier(schema),role=identifier(ownerRole),statements:string[]=[];
 for(const table of ['customer_webhook_deliveries','protected_exports','outbox_events','retention_schedules','retention_blob_resources','retention_blob_write_receipts','organization_memberships']){
  const target=ns+'.'+identifier(table);
  statements.push(`GRANT SELECT ON ${target} TO ${role}`,`DROP POLICY IF EXISTS lifecycle_router_metadata_read ON ${target}`,`CREATE POLICY lifecycle_router_metadata_read ON ${target} FOR SELECT TO ${role} USING(true)`);
 }
 statements.push(`GRANT UPDATE(last_retention_check) ON ${ns}.retention_blob_resources TO ${role}`,`DROP POLICY IF EXISTS lifecycle_router_check_update ON ${ns}.retention_blob_resources`,`CREATE POLICY lifecycle_router_check_update ON ${ns}.retention_blob_resources FOR UPDATE TO ${role} USING(true) WITH CHECK(true)`);
 // These reads/writes remain subject to the unchanged tenant policies. Routing
 // functions establish the exact organization before accessing domain evidence.
 statements.push(`GRANT SELECT ON ${ns}.retention_resource_policies,${ns}.lifecycle_holds,${ns}.model_versions,${ns}.asset_versions,${ns}.processing_jobs,${ns}.customer_webhook_subscriptions TO ${role}`,
  `GRANT INSERT ON ${ns}.notifications,${ns}.audit_events,${ns}.outbox_events,${ns}.customer_webhook_deliveries TO ${role}`,
  `GRANT SELECT ON ${ns}.discovery_profiles TO ${role}`,`GRANT SELECT,UPDATE ON ${ns}.discovery_inquiries TO ${role}`,
  `GRANT EXECUTE ON FUNCTION ${ns}.discovery_profile_eligible(text,boolean),${ns}.retention_source_held(text,text) TO ${role}`);
 return statements;
}

/** Run as the migration administrator after all lifecycle tables/functions exist.
 * CREATEROLE is required, as for the existing runtime/dispatcher bootstrap.
 */
export async function configureLifecycleMaintenanceRouting(pool:Pool,options:{schema?:string;ownerRole?:string}={}){
 const schema=options.schema??'public',owner=options.ownerRole??LIFECYCLE_ROUTING_OWNER,ns=identifier(schema),role=identifier(owner),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const found=(await client.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname=$1',[owner])).rows[0];
  if(!found)await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`);
  else if(Object.values(found).some(Boolean))throw Error('MAINTENANCE_OWNER_ROLE_UNSAFE');
  const migrationRole=String((await client.query('SELECT quote_ident(current_user) AS name')).rows[0].name);
  await client.query(`GRANT ${role} TO ${migrationRole}`);
  // Prevent an accidental role-membership grant from turning a restricted
  // application/dispatcher into a cross-tenant SQL reader.
  for(const applicationRole of ['medical_device_runtime','medical_device_outbox_publisher','local_runtime']){
   if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[applicationRole])).rowCount){if((await client.query('SELECT pg_has_role($1,$2,\'MEMBER\') AS member',[applicationRole,owner])).rows[0].member)throw Error('MAINTENANCE_OWNER_MEMBERSHIP_UNSAFE');await client.query(`REVOKE ALL ON FUNCTION ${ns}.retention_source_held(text,text) FROM ${identifier(applicationRole)}`);}
  }
  await client.query(`GRANT USAGE,CREATE ON SCHEMA ${ns} TO ${role}`);
  for(const statement of lifecycleRoutingPolicyStatements(schema,owner))await client.query(statement);
  for(const fn of ['due_lifecycle_deliveries()','due_retention_organizations()','due_retention_resource_organizations()','advance_inquiry_lifecycle()','emit_learner_profile_webhook()','retention_source_held(text,text)']){
   await client.query(`REVOKE ALL ON FUNCTION ${ns}.${fn} FROM PUBLIC`);
   await client.query(`ALTER FUNCTION ${ns}.${fn} OWNER TO ${role}`);
  }
  await client.query(`REVOKE CREATE ON SCHEMA ${ns} FROM ${role}`);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
