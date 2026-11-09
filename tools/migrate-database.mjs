import {pathToFileURL} from 'node:url';
import {access} from 'node:fs/promises';

/** Validate before opening a privileged connection. No URLs or credential values enter errors. */
export function readMigrationConfiguration(env) {
  const required=key=>{const value=env[key]?.trim();if(!value)throw Error(`MIGRATION_CONFIGURATION_REQUIRED:${key}`);return value;};
  const host=env.POSTGRES_HOST?.trim();
  const database=env.POSTGRES_DATABASE?.trim()??'medical_device';
  if(database!=='medical_device'||required('MIGRATION_CONFIRM_DATABASE')!==database)throw Error('MIGRATION_DATABASE_CONFIRMATION_INVALID');
  const runtimePassword=required('POSTGRES_RUNTIME_PASSWORD'),outboxPublisherPassword=required('POSTGRES_OUTBOX_PASSWORD');
  const build=(login,password)=>`postgresql://${encodeURIComponent(login)}:${encodeURIComponent(password)}@${host}:5432/${database}?sslmode=require`;
  const adminDatabaseUrl=env.ADMIN_DATABASE_URL?.trim()??(host?build(env.POSTGRES_ADMIN_LOGIN?.trim()??'mdtadmin',required('POSTGRES_ADMIN_PASSWORD')):required('ADMIN_DATABASE_URL'));
  const runtimeDatabaseUrl=env.DATABASE_URL?.trim()??(host?build(env.POSTGRES_RUNTIME_LOGIN?.trim()??'medical_device_runtime',runtimePassword):required('DATABASE_URL'));
  try {
    const admin=new URL(adminDatabaseUrl),runtime=new URL(runtimeDatabaseUrl);
    if(![admin,runtime].every(url=>['postgresql:','postgres:'].includes(url.protocol)&&url.username&&url.password&&url.pathname===`/${database}`)||admin.hostname!==runtime.hostname||admin.port!==runtime.port||decodeURIComponent(admin.username)===decodeURIComponent(runtime.username)||decodeURIComponent(runtime.username)!=='medical_device_runtime')throw Error();
    if(!['localhost','127.0.0.1'].includes(admin.hostname)&&(!admin.searchParams.get('sslmode')||admin.searchParams.get('sslmode')==='disable'))throw Error();
    if(decodeURIComponent(runtime.password)!==runtimePassword)throw Error();
  }catch{throw Error('MIGRATION_DATABASE_CONFIGURATION_INVALID');}
  return {adminDatabaseUrl,runtimeDatabaseUrl,runtimePassword,outboxPublisherPassword};
}

export async function migrateDatabase(env=process.env) {
  const configuration=readMigrationConfiguration(env);
  // Worker image places this script in /app/tools and the compiled module in /app/dist.
  let moduleUrl=new URL('../dist/postgres-bootstrap.js',import.meta.url);
  try{await access(moduleUrl);}catch{moduleUrl=new URL('../apps/worker/dist/postgres-bootstrap.js',import.meta.url);}
  const module=await import(moduleUrl.href);
  await module.bootstrapPostgres(configuration);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await migrateDatabase();console.log(JSON.stringify({event:'database_migration_completed'}));}
  catch(error){const code=error instanceof Error&&/^MIGRATION_[A-Z_:]+$/.test(error.message)?error.message:'DATABASE_MIGRATION_FAILED';console.error(JSON.stringify({event:'database_migration_failed',code}));process.exitCode=1;}
}
