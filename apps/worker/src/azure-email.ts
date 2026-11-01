import {EmailClient} from '@azure/communication-email';
import {createClientPipeline} from '@azure/core-client';
import type {TokenCredential} from '@azure/core-auth';
import {createDefaultHttpClient,type HttpClient} from '@azure/core-rest-pipeline';
import type {InvitationEmailSender} from './invitation-email.js';
const validAddress=(value:string)=>value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export function createAzureEmailSender(options:{endpoint:string;senderAddress:string;credential:TokenCredential;httpClient?:HttpClient}):InvitationEmailSender{
 let endpoint:URL;
 try{endpoint=new URL(options.endpoint);}catch{throw Error('AZURE_EMAIL_CONFIGURATION_INVALID');}
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.communication.azure.com')||endpoint.username||endpoint.password||endpoint.port||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||!validAddress(options.senderAddress))throw Error('AZURE_EMAIL_CONFIGURATION_INVALID');
 // Retain Azure serialization/authentication, but never log email bodies or tokens.
 // Durable orchestration owns retries, so SDK POST retries are disabled.
 const pipeline=createClientPipeline({retryOptions:{maxRetries:0}});
 pipeline.removePolicy({name:'logPolicy'});
 pipeline.removePolicy({name:'redirectPolicy'});
 const transport=options.httpClient??createDefaultHttpClient();
 const httpClient:HttpClient={async sendRequest(request){
  if(new URL(request.url).origin!==endpoint.origin)throw Error('AZURE_EMAIL_ENDPOINT_MISMATCH');
  return transport.sendRequest(request);
 }};
 const clientOptions={pipeline,httpClient,retryOptions:{maxRetries:0}};
 const client=new EmailClient(endpoint.origin,options.credential,clientOptions);
 return {async send(message){
  let poller:Awaited<ReturnType<EmailClient['beginSend']>>|undefined;
  try{
   if(!/^[a-f0-9-]{36}$/i.test(message.operationId)||message.signal.aborted||!validAddress(message.recipient)||!message.subject||message.subject.length>200||/[\r\n]/.test(message.subject)||!message.plainText||message.plainText.length>20000||!/^[A-Za-z0-9._:-]{1,128}$/.test(message.eventId))throw Error();
   poller=await client.beginSend({senderAddress:options.senderAddress,recipients:{to:[{address:message.recipient}]},content:{subject:message.subject,plainText:message.plainText},headers:{'X-Training-Event-ID':message.eventId},disableUserEngagementTracking:true},{operationId:message.operationId,abortSignal:message.signal,updateIntervalInMs:1000});
   const result=await poller.pollUntilDone({abortSignal:message.signal});
   if(result.id!==message.operationId||result.status!=='Succeeded'||typeof result.id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(result.id))throw Error();
   return {providerMessageId:result.id};
  }catch{throw Error('AZURE_EMAIL_SEND_FAILED');}
  finally{poller?.stopPolling();}
 }};
}
