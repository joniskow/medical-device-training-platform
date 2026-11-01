import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAzureEmailSender} from '../apps/worker/dist/azure-email.js';
import {createWorkerInvitationEmailOptions} from '../apps/worker/dist/invitation-email-configuration.js';
const require=createRequire(new URL('../apps/worker/package.json',import.meta.url));
const {createHttpHeaders}=require('@azure/core-rest-pipeline');
const sdkRequire=createRequire(require.resolve('@azure/communication-email'));
const {AzureLogger,setLogLevel,getLogLevel}=sdkRequire('@azure/logger');
const priorLog=AzureLogger.log,priorLevel=getLogLevel(),logs=[];AzureLogger.log=(...args)=>logs.push(args.join(' '));setLogLevel('verbose');
const endpoint='https://fixture.communication.azure.com',id='b1e80e20-1682-40bf-aaf1-383085737fad',secret='INVITATION_SECRET_MUST_NOT_APPEAR',authSecret='BEARER_SECRET_MUST_NOT_APPEAR';
const credential={async getToken(scope){assert.ok(String(scope).includes('communication.azure.com'));return {token:authSecret,expiresOnTimestamp:Date.now()+3600000};}};
const input={operationId:id,recipient:'recipient@example.test',subject:'Invitation',plainText:'https://training.example.test/invitations#token='+secret,eventId:'deliver:invitation:test',signal:new AbortController().signal};
const response=(request,status,body,headers={})=>({request,status,headers:createHttpHeaders(headers),bodyAsText:JSON.stringify(body)});
let requests=[],mode='success';
const transport={async sendRequest(request){
 requests.push(request);assert.equal(new URL(request.url).origin,endpoint);
 assert.equal(request.headers.get('authorization'),'Bearer '+authSecret);
 if(mode==='throw')throw Error(secret);
 if(mode==='throttle')return response(request,429,{error:{code:'TooManyRequests',message:secret}});
 if(mode==='abort'){await new Promise((resolve,reject)=>{request.abortSignal.addEventListener('abort',()=>reject(Error(secret)));});}
 if(request.method==='POST'){assert.equal(request.headers.get('operation-id'),input.operationId);return response(request,202,{id,status:'Running'},{'operation-location':(mode==='foreign'?'https://attacker.example.test':endpoint)+'/emails/operations/'+id+'?api-version=2025-09-01','retry-after':'0'});}
 return response(request,200,{id,status:mode==='failed'?'Failed':'Succeeded',...(mode==='failed'?{error:{code:'Failure',message:secret}}:{})});
}};
try{
 const sender=createAzureEmailSender({endpoint,senderAddress:'training@example.test',credential,httpClient:transport});
 assert.deepEqual(await sender.send(input),{providerMessageId:id});
 assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.ok(requests.some(r=>r.method==='GET'));
 const payload=JSON.parse(requests.find(r=>r.method==='POST').body);
 assert.equal(payload.senderAddress,'training@example.test');assert.deepEqual(payload.recipients,{to:[{address:'recipient@example.test'}]});assert.deepEqual(payload.content,{subject:'Invitation',plainText:input.plainText});assert.equal(payload.userEngagementTrackingDisabled,true);assert.equal(payload.headers['X-Training-Event-ID'],input.eventId);assert.equal(payload.attachments,undefined);
 for(mode of ['failed','throw','throttle','foreign']){
  requests=[];await assert.rejects(sender.send(input),/^Error: AZURE_EMAIL_SEND_FAILED$/);
  assert.equal(requests.filter(r=>r.method==='POST').length,1,'SDK retried the send operation');
  if(mode==='foreign')assert.equal(requests.length,1,'Followed foreign operation URL');
 }
 mode='abort';requests=[];const controller=new AbortController();const sending=sender.send({...input,signal:controller.signal});const timer=setTimeout(()=>controller.abort(),10);
 try{await assert.rejects(sending,/AZURE_EMAIL_SEND_FAILED/);}finally{clearTimeout(timer);}
 requests=[];controller.abort();await assert.rejects(sender.send({...input,signal:controller.signal}),/AZURE_EMAIL_SEND_FAILED/);assert.equal(requests.length,0);
 for(const recipient of ['bad\r\nBcc:other@example.test','not-an-email'])await assert.rejects(sender.send({...input,recipient}),/AZURE_EMAIL_SEND_FAILED/);
 for(const badEndpoint of ['http://fixture.communication.azure.com','https://attacker.example.test','https://user:secret@fixture.communication.azure.com','https://fixture.communication.azure.com/path','https://fixture.communication.azure.com/?secret=1'])assert.throws(()=>createAzureEmailSender({endpoint:badEndpoint,senderAddress:'training@example.test',credential,httpClient:transport}),/CONFIGURATION_INVALID/);
 assert.ok(!logs.join('\n').includes(secret),'SDK exposed invitation token in logging');assert.ok(!logs.join('\n').includes(authSecret),'SDK exposed authorization token in logging');
 assert.equal(createWorkerInvitationEmailOptions({},credential),undefined);
 assert.equal(createWorkerInvitationEmailOptions({INVITATION_EMAIL_ENABLED:'false'},credential),undefined);
 assert.throws(()=>createWorkerInvitationEmailOptions({INVITATION_EMAIL_ENABLED:'yes'},credential),/CONFIGURATION_INVALID/);
 const environment={INVITATION_EMAIL_GLOBAL_PER_MINUTE:'20',INVITATION_EMAIL_ORGANIZATION_PER_MINUTE:'5',INVITATION_EMAIL_ENABLED:'true',INVITATION_ACTIVE_KEY_ID:'current',INVITATION_TOKEN_KEYS_JSON:JSON.stringify({current:'ab'.repeat(32)}),ACS_EMAIL_ENDPOINT:endpoint,ACS_EMAIL_SENDER_ADDRESS:'training@example.test',APPLICATION_ORIGIN:'https://training.example.test'};
 assert.ok(createWorkerInvitationEmailOptions(environment,credential).sender);
 for(const name of ['INVITATION_TOKEN_KEYS_JSON','ACS_EMAIL_ENDPOINT','ACS_EMAIL_SENDER_ADDRESS','APPLICATION_ORIGIN','INVITATION_EMAIL_GLOBAL_PER_MINUTE','INVITATION_EMAIL_ORGANIZATION_PER_MINUTE'])assert.throws(()=>createWorkerInvitationEmailOptions({...environment,[name]:''},credential),/^Error: INVITATION_EMAIL_CONFIGURATION_INVALID$/);
 console.log('Azure email adapter passed: real SDK serialization/authentication/polling, tracking disabled, cancellation, safe errors, no POST retry, foreign-host rejection, secret-safe verbose logs and explicit worker configuration. No network email was sent.');
}finally{AzureLogger.log=priorLog;setLogLevel(priorLevel);}
