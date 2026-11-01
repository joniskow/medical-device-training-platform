import {requireActiveOperator} from './operator-account.mjs';
// Administrative tool: reads an already-authenticated operator token from the environment.
// No token, recipient address, provider diagnostics, or raw broker body is printed.
import {createRequire} from 'node:module';
import {Pool} from 'pg';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {createPostgresOrganizationMembershipStore,createEmailDeliveryReportStore,createEmailReportRecoveryAudit} from '../packages/db/dist/index.js';
import {readEmailReportConfiguration} from '../apps/worker/dist/email-report-configuration.js';
import {createEmailReportRecovery} from '../apps/worker/dist/email-report-recovery.js';
const require=createRequire(new URL('../apps/worker/package.json',import.meta.url));
const {ServiceBusClient}=require('@azure/service-bus'),{DefaultAzureCredential}=require('@azure/identity');
const required=name=>{const value=process.env[name]?.trim();if(!value)throw Error('EMAIL_RECOVERY_CONFIGURATION_MISSING');return value;};
const args=process.argv.slice(2),command=args.shift();
if(command==='--help'||!command){
 console.log('Usage: node tools/recover-email-reports.mjs list [after-sequence]\n       node tools/recover-email-reports.mjs replay <sequence> <snapshot> <request-id> <reason> [max-scan]\nRequires an active personal profile, OPERATOR_ACCESS_TOKEN, RECOVERY_ORGANIZATION_ID, DATABASE_URL, DATABASE_OUTBOX_URL, Entra configuration and enabled EMAIL_REPORTS_* configuration. Azure identity needs Data Receiver on the report queue. No messages are republished.');
}else{
 let runtime,routing,bus,receiver;
 try{
  if(!['list','replay'].includes(command)||(command==='list'&&args.length>1)||(command==='replay'&&(args.length<4||args.length>5)))throw Error('EMAIL_RECOVERY_REQUEST_INVALID');
  const configuration=readEmailReportConfiguration(process.env);if(!configuration)throw Error('EMAIL_RECOVERY_CONFIGURATION_MISSING');
  const authenticator=createEntraRequestAuthenticator({tenantId:required('ENTRA_TENANT_ID'),audience:required('ENTRA_AUDIENCE'),openIdConfigurationUrl:required('ENTRA_OPENID_CONFIGURATION_URL'),issuer:process.env.ENTRA_ISSUER?.trim()||undefined,rolesClaim:process.env.ENTRA_ROLES_CLAIM?.trim()||'roles'});
  const authorization='Bearer '+required('OPERATOR_ACCESS_TOKEN');
  const principal=await authenticator.authenticate({headers:{authorization}});if(!principal?.roles.includes('operator'))throw Error('EMAIL_RECOVERY_OPERATOR_REQUIRED');
  runtime=new Pool({connectionString:required('DATABASE_URL'),max:2});routing=new Pool({connectionString:required('DATABASE_OUTBOX_URL'),max:1});
  const memberships=createPostgresOrganizationMembershipStore(runtime),tenant={organizationId:required('RECOVERY_ORGANIZATION_ID'),actorId:principal.subject,correlationId:command==='replay'?args[2]:'email-report-inspection'};
  const authorize=async context=>{const current=await requireActiveOperator(authenticator,authorization,runtime,context.actorId);if(!current?.roles.includes('operator')||current.subject!==context.actorId||!(await memberships.resolveActiveOrganizations(context.actorId)).includes(context.organizationId))throw Error('EMAIL_RECOVERY_OPERATOR_REQUIRED');};
  await authorize(tenant);
  bus=new ServiceBusClient(configuration.namespace,new DefaultAzureCredential());
  receiver=bus.createReceiver(configuration.queueName,{subQueueType:'deadLetter',receiveMode:'peekLock',maxAutoLockRenewalDurationInMs:300000});
  const reports=createEmailDeliveryReportStore(runtime);
  const recovery=createEmailReportRecovery({receiver,expected:{topic:configuration.topic,sender:configuration.sender},authorize,resolveOrganization:async id=>(await routing.query('SELECT organization_id FROM email_delivery_attempts WHERE operation_id=$1',[id])).rows[0]?.organization_id??null,apply:(context,report)=>reports.apply(context,report),audit:createEmailReportRecoveryAudit(runtime)});
  const result=command==='list'?await recovery.list(tenant,args[0]):await recovery.replay(tenant,{sequenceNumber:args[0],snapshot:args[1],requestId:args[2],reason:args[3],maxScan:args[4]===undefined?undefined:Number(args[4])});
  console.log(JSON.stringify(result));
 }catch(error){
  const code=error instanceof Error?error.message:'';
  console.error(/^(EMAIL_RECOVERY_[A-Z_]+|ACCOUNT_LOCKED|OPERATOR_ACCOUNT_REQUIRED|IDEMPOTENCY_KEY_REUSED|EMAIL_REPORT_(INVALID|UNMATCHED|CONFLICT))$/.test(code)?code:'EMAIL_RECOVERY_FAILED');process.exitCode=1;
 }finally{await Promise.allSettled([receiver?.close(),bus?.close(),runtime?.end(),routing?.end()]);}
}
