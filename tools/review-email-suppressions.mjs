import {requireActiveOperator} from './operator-account.mjs';
import {Pool} from 'pg';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {createPostgresOrganizationMembershipStore,createEmailSuppressionReview} from '../packages/db/dist/index.js';
const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error('EMAIL_SUPPRESSION_CONFIGURATION_MISSING');return value;};
const args=process.argv.slice(2),command=args.shift();
if(command==='--help'||!command){
 console.log('Usage: node tools/review-email-suppressions.mjs list [after-recipient-hash]\n       node tools/review-email-suppressions.mjs release <recipient-hash> <revision> <request-id> <reason> --confirm\nRequires an active personal profile, OPERATOR_ACCESS_TOKEN, RECOVERY_ORGANIZATION_ID, DATABASE_URL and Entra configuration. Release affects future claims only; it never resends an old invitation or removes provider suppression.');
}else{
 let pool;
 try{
  if(!['list','release'].includes(command)||(command==='list'&&args.length>1)||(command==='release'&&(args.length!==5||args[4]!=='--confirm')))throw Error('EMAIL_SUPPRESSION_REQUEST_INVALID');
  const authenticator=createEntraRequestAuthenticator({tenantId:required('ENTRA_TENANT_ID'),audience:required('ENTRA_AUDIENCE'),openIdConfigurationUrl:required('ENTRA_OPENID_CONFIGURATION_URL'),issuer:process.env.ENTRA_ISSUER?.trim()||undefined,rolesClaim:process.env.ENTRA_ROLES_CLAIM?.trim()||'roles'});
  const authorization='Bearer '+required('OPERATOR_ACCESS_TOKEN');
  const principal=await authenticator.authenticate({headers:{authorization}});
  if(!principal?.roles.includes('operator'))throw Error('EMAIL_SUPPRESSION_OPERATOR_REQUIRED');
  pool=new Pool({connectionString:required('DATABASE_URL'),max:2});
  const memberships=createPostgresOrganizationMembershipStore(pool);
  const tenant={organizationId:required('RECOVERY_ORGANIZATION_ID'),actorId:principal.subject,correlationId:command==='release'?args[2]:'suppression-review'};
  const authorize=async context=>{
   const current=await requireActiveOperator(authenticator,authorization,pool,context.actorId);
   if(!current?.roles.includes('operator')||current.subject!==context.actorId||!(await memberships.resolveActiveOrganizations(context.actorId)).includes(context.organizationId))throw Error('EMAIL_SUPPRESSION_OPERATOR_REQUIRED');
  };
  const review=createEmailSuppressionReview(pool,authorize);
  const result=command==='list'?await review.list(tenant,args[0]):await review.release(tenant,{recipientHash:args[0],revision:Number(args[1]),requestId:args[2],reason:args[3],confirmed:true});
  console.log(JSON.stringify(result));
 }catch(error){
  const code=error instanceof Error?error.message:'';
  console.error(/^(EMAIL_SUPPRESSION_[A-Z_]+|ACCOUNT_LOCKED|OPERATOR_ACCOUNT_REQUIRED|IDEMPOTENCY_KEY_REUSED)$/.test(code)?code:'EMAIL_SUPPRESSION_FAILED');process.exitCode=1;
 }finally{await pool?.end();}
}
