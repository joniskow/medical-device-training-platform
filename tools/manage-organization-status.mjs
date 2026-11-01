import {requireActiveOperator} from './operator-account.mjs';
import {Pool} from 'pg';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {createOrganizationLifecycleStore} from '../packages/db/dist/index.js';
const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error('ORGANIZATION_LIFECYCLE_CONFIGURATION_MISSING');return value;};
const args=process.argv.slice(2),command=args.shift();
if(command==='--help'||!command){
 console.log('Usage: node tools/manage-organization-status.mjs inspect\n       node tools/manage-organization-status.mjs set <ACTIVE|SUSPENDED> <revision> <request-id> <reason> --confirm\nRequires an active personal profile, OPERATOR_ACCESS_TOKEN, RECOVERY_ORGANIZATION_ID, DATABASE_URL and Entra configuration. Suspension blocks new private organization requests; it preserves memberships and historical evidence and does not revoke credentials or recall in-flight work.');
}else{
 let pool;
 try{
  if(!['inspect','set'].includes(command)||(command==='inspect'&&args.length)||(command==='set'&&(args.length!==5||args[4]!=='--confirm')))throw Error('ORGANIZATION_LIFECYCLE_INVALID');
  const authenticator=createEntraRequestAuthenticator({tenantId:required('ENTRA_TENANT_ID'),audience:required('ENTRA_AUDIENCE'),openIdConfigurationUrl:required('ENTRA_OPENID_CONFIGURATION_URL'),issuer:process.env.ENTRA_ISSUER?.trim()||undefined,rolesClaim:process.env.ENTRA_ROLES_CLAIM?.trim()||'roles'});
  const authorization='Bearer '+required('OPERATOR_ACCESS_TOKEN');
  const principal=await authenticator.authenticate({headers:{authorization}});
  if(!principal?.roles.includes('operator'))throw Error('ORGANIZATION_LIFECYCLE_OPERATOR_REQUIRED');
  pool=new Pool({connectionString:required('DATABASE_URL'),max:2});
  const tenant={organizationId:required('RECOVERY_ORGANIZATION_ID'),actorId:principal.subject,correlationId:command==='set'?args[2]:'organization-inspection'};
  const authorize=async context=>{
   const current=await requireActiveOperator(authenticator,authorization,pool,context.actorId);
   if(!current?.roles.includes('operator')||current.subject!==context.actorId)throw Error('ORGANIZATION_LIFECYCLE_OPERATOR_REQUIRED');
  };
  const store=createOrganizationLifecycleStore(pool,authorize);
  const result=command==='inspect'?await store.get(tenant):await store.setStatus(tenant,{status:args[0],revision:Number(args[1]),idempotencyKey:args[2],reason:args[3],confirmed:true});
  console.log(JSON.stringify(result));
 }catch(error){
  const code=error instanceof Error?error.message:'';
  console.error(/^(ORGANIZATION_LIFECYCLE_[A-Z_]+|ACCOUNT_LOCKED|OPERATOR_ACCOUNT_REQUIRED|IDEMPOTENCY_KEY_REUSED)$/.test(code)?code:'ORGANIZATION_LIFECYCLE_FAILED');process.exitCode=1;
 }finally{await pool?.end();}
}
