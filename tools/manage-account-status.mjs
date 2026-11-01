import {Pool} from 'pg';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {createAccountSecurityStore} from '../packages/db/dist/index.js';
import {requireActiveOperator} from './operator-account.mjs';
const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error('ACCOUNT_SECURITY_CONFIGURATION_MISSING');return value;};
const args=process.argv.slice(2),command=args.shift();
if(command==='--help'||!command){
 console.log('Usage: node tools/manage-account-status.mjs inspect <user-id>\n       node tools/manage-account-status.mjs set <user-id> <ACTIVE|LOCKED> <revision> <request-id> <reason> --confirm\nRequires OPERATOR_ACCESS_TOKEN, DATABASE_URL and Entra configuration. Operator must have an active personal profile. Self-status changes are forbidden. Locking blocks new private API/operator access; credentials and memberships are retained.');
}else{
 let pool;
 try{
  if(!['inspect','set'].includes(command)||(command==='inspect'&&args.length!==1)||(command==='set'&&(args.length!==6||args[5]!=='--confirm')))throw Error('ACCOUNT_SECURITY_INVALID');
  const authenticator=createEntraRequestAuthenticator({tenantId:required('ENTRA_TENANT_ID'),audience:required('ENTRA_AUDIENCE'),openIdConfigurationUrl:required('ENTRA_OPENID_CONFIGURATION_URL'),issuer:process.env.ENTRA_ISSUER?.trim()||undefined,rolesClaim:process.env.ENTRA_ROLES_CLAIM?.trim()||'roles'});
  const authorization='Bearer '+required('OPERATOR_ACCESS_TOKEN');
  pool=new Pool({connectionString:required('DATABASE_URL'),max:2});
  const store=createAccountSecurityStore(pool,async()=>(await requireActiveOperator(authenticator,authorization,pool)).subject);
  const result=command==='inspect'?await store.inspect(args[0]):await store.setStatus(args[0],{status:args[1],revision:Number(args[2]),idempotencyKey:args[3],reason:args[4],confirmed:true});
  console.log(JSON.stringify(result));
 }catch(error){const code=error instanceof Error?error.message:'';console.error(/^(ACCOUNT_SECURITY_[A-Z_]+|ACCOUNT_LOCKED|OPERATOR_ACCOUNT_REQUIRED|IDEMPOTENCY_KEY_REUSED)$/.test(code)?code:'ACCOUNT_SECURITY_FAILED');process.exitCode=1;}
 finally{await pool?.end();}
}
