export interface EmailReportConfiguration {namespace:string;queueName:string;topic:string;sender:string}
export function readEmailReportConfiguration(environment:NodeJS.ProcessEnv):EmailReportConfiguration|undefined{
 const enabled=environment.EMAIL_REPORTS_ENABLED?.trim();if(!enabled||enabled==='false')return undefined;
 if(enabled!=='true')throw Error('EMAIL_REPORT_CONFIGURATION_INVALID');
 const namespace=environment.EMAIL_REPORTS_SERVICE_BUS_NAMESPACE?.trim().toLowerCase()??'',queueName=environment.EMAIL_REPORTS_QUEUE?.trim()??'',topic=environment.ACS_EMAIL_RESOURCE_ID?.trim()??'',sender=environment.ACS_EMAIL_SENDER_ADDRESS?.trim().toLowerCase()??'';
 if(!/^[a-z0-9-]+\.servicebus\.windows\.net$/.test(namespace)||namespace===environment.SERVICE_BUS_NAMESPACE?.trim().toLowerCase()||!/^[A-Za-z0-9_-]{1,200}$/.test(queueName)||!/^\/subscriptions\/[a-f0-9-]{36}\/resourcegroups\/[^/\s]+\/providers\/microsoft\.communication\/communicationservices\/[^/\s]+$/i.test(topic)||sender.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender))throw Error('EMAIL_REPORT_CONFIGURATION_INVALID');
 return {namespace,queueName,topic,sender};
}
