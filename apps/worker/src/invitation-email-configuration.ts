import type {TokenCredential} from '@azure/core-auth';
import {readInvitationConfiguration} from '@medical-device/db';
import {createAzureEmailSender} from './azure-email.js';
export function createWorkerInvitationEmailOptions(environment:NodeJS.ProcessEnv,credential:TokenCredential){
 const enabled=environment.INVITATION_EMAIL_ENABLED?.trim();
 if(!enabled||enabled==='false')return undefined;
 if(enabled!=='true')throw Error('INVITATION_EMAIL_CONFIGURATION_INVALID');
 try{
  const configuration=readInvitationConfiguration(environment);
  if(!configuration.keys.size)throw Error();
  const applicationOrigin=environment.APPLICATION_ORIGIN?.trim()??'';
  const origin=new URL(applicationOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error();
  const sender=createAzureEmailSender({endpoint:environment.ACS_EMAIL_ENDPOINT?.trim()??'',senderAddress:environment.ACS_EMAIL_SENDER_ADDRESS?.trim()??'',credential});
  const globalPerMinute=Number(environment.INVITATION_EMAIL_GLOBAL_PER_MINUTE),organizationPerMinute=Number(environment.INVITATION_EMAIL_ORGANIZATION_PER_MINUTE);
  if(!Number.isInteger(globalPerMinute)||globalPerMinute<1||globalPerMinute>1000000||!Number.isInteger(organizationPerMinute)||organizationPerMinute<1||organizationPerMinute>globalPerMinute)throw Error();
  const rateLimit={scope:new URL(environment.ACS_EMAIL_ENDPOINT!.trim()).origin,globalPerMinute,organizationPerMinute};
  return {sender,keys:configuration.keys,applicationOrigin,rateLimit};
 }catch{throw Error('INVITATION_EMAIL_CONFIGURATION_INVALID');}
}
