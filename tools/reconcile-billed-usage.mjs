import {readFile,stat} from 'node:fs/promises';
import {Pool} from 'pg';
import {reconcileProviderBilledUsage} from '../packages/db/dist/billed-usage-reconciliation.js';

try{
  const file=process.argv[2];
  if(!file||process.argv.length!==3||!process.env.OPERATIONS_ADMIN_DATABASE_URL)throw Error('BILLED_RECONCILIATION_CONFIGURATION_REQUIRED');
  const target=new URL(process.env.OPERATIONS_ADMIN_DATABASE_URL);
  if(process.env.OPERATIONS_CONFIRM_DATABASE!==target.pathname.slice(1))throw Error('BILLED_RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED');
  if((await stat(file)).size>65536)throw Error('BILLED_RECONCILIATION_INPUT_TOO_LARGE');
  let entries;try{entries=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('BILLED_RECONCILIATION_INPUT_INVALID');}
  if(!Array.isArray(entries)||entries.length<1||entries.length>100||entries.some(entry=>!entry||typeof entry!=='object'||Object.keys(entry).some(key=>!['organizationId','sourceUsageEventId','invoiceLineId','microUsd'].includes(key))))throw Error('BILLED_RECONCILIATION_INPUT_INVALID');
  const pool=new Pool({connectionString:process.env.OPERATIONS_ADMIN_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});
  try{for(const entry of entries)await reconcileProviderBilledUsage(pool,entry);}
  finally{await pool.end();}
  console.log(JSON.stringify({event:'provider_billed_usage_reconciled',entries:entries.length}));
}catch(error){
  const message=error instanceof Error?error.message:'';
  console.error(JSON.stringify({event:'provider_billed_usage_reconciliation_failed',code:/^BILLED_RECONCILIATION_[A-Z_]+$/.test(message)||message==='IDEMPOTENCY_KEY_REUSED'?message:'BILLED_RECONCILIATION_FAILED'}));
  process.exitCode=1;
}
