import {projectMachineIntegrationValue} from '@medical-device/db';
import type {IncomingMessage} from 'node:http';
import type {TenantContext} from '@medical-device/contracts';
import type {createMachineIntegrationStore,createTechnicalReportingStore,createProtectedExportStore,createCustomerWebhookStore,IntegrationScope,MachineIdentity} from '@medical-device/db';

type IntegrationStore=ReturnType<typeof createMachineIntegrationStore>;
export interface MachineIntegrationContext {
 request:IncomingMessage;url:URL;principal:{subject:string;issuer?:string;identityTenant?:string;machineIdentity?:MachineIdentity};tenant?:TenantContext;
 reply(status:number,body:unknown):void;readBody():Promise<unknown>;idempotencyKey():string|null;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('INTEGRATION_INPUT_INVALID');return value as Record<string,unknown>;}
const text=(value:unknown)=>{if(typeof value!=='string')throw Error('INTEGRATION_INPUT_INVALID');return value;};
const number=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('INTEGRATION_INPUT_INVALID');return value;};
const strings=(value:unknown)=>{if(!Array.isArray(value)||value.length>10||value.some(item=>typeof item!=='string'))throw Error('INTEGRATION_INPUT_INVALID');return value as string[];};
function query(url:URL,allowed:readonly string[]){if([...url.searchParams.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>url.searchParams.getAll(key).length>1))throw Error('INTEGRATION_INPUT_INVALID');}
/** Every returned resource identifier is a random, integration-scoped external reference. */
export const projectIntegrationResult=projectMachineIntegrationValue;
export function createMachineIntegrationHttp(options:{store:IntegrationStore;reports:ReturnType<typeof createTechnicalReportingStore>;exports:ReturnType<typeof createProtectedExportStore>;webhooks:ReturnType<typeof createCustomerWebhookStore>;webhookKeyIds?:ReadonlySet<string>;webhookSigningSecret?:(tenant:TenantContext,subscriptionId:string,keyId:string)=>string}){
 const management=(path:string)=>path==='/api/v1/integration-clients'||/^\/api\/v1\/integration-clients\/[0-9a-f-]{36}$/.test(path);
 const fail=(context:MachineIntegrationContext,error:unknown)=>{const code=error instanceof Error?error.message:'';const known=['INTEGRATION_INPUT_INVALID','INTEGRATION_REVISION_CONFLICT','INTEGRATION_ROTATION_CUTOFF_INVALID','INTEGRATION_NOT_AVAILABLE','INTEGRATION_SCOPE_DENIED','LIFECYCLE_ADMIN_REQUIRED','EXPORT_RATE_LIMITED','EXPORT_UNAVAILABLE','EXPORT_NOT_FOUND','WEBHOOK_INVALID','WEBHOOK_REVISION_CONFLICT','WEBHOOK_LIMIT','WEBHOOK_ENDPOINT_INVALID','WEBHOOK_NOT_FOUND','WEBHOOK_KEY_UNAVAILABLE','IDEMPOTENCY_KEY_REUSED'];const safe=known.includes(code)?code:'INTEGRATION_UNAVAILABLE';context.reply(/DENIED|REQUIRED/.test(safe)?403:/CONFLICT|ROTATION|IDEMPOTENCY/.test(safe)?409:/RATE_LIMITED|LIMIT$/.test(safe)?429:/NOT_FOUND/.test(safe)?404:safe==='INTEGRATION_UNAVAILABLE'?503:400,{error:safe});};
 return {
  matches:(path:string)=>management(path)||path.startsWith('/api/v1/integration/'),
  async handleManagement(context:MachineIntegrationContext):Promise<boolean>{
   if(!management(context.url.pathname))return false;
   try{
    if(context.principal.machineIdentity||!context.tenant)throw Error('INTEGRATION_SCOPE_DENIED');query(context.url,[]);
    if(context.request.method==='GET'&&context.url.pathname==='/api/v1/integration-clients'){context.reply(200,await options.store.list(context.tenant));return true;}
    if(!(context.request.method==='POST'&&context.url.pathname==='/api/v1/integration-clients'||context.request.method==='PUT'&&context.url.pathname!=='/api/v1/integration-clients')){context.reply(405,{error:'METHOD_NOT_ALLOWED'});return true;}
    const body=object(await context.readBody(),['issuer','identityTenant','clientId','servicePrincipalId','scopes','enabled','revision','validAfter']);
    if(typeof body.enabled!=='boolean')throw Error('INTEGRATION_INPUT_INVALID');
    const integrationId=context.url.pathname.split('/')[4];
    const requestKey=context.idempotencyKey();if(!requestKey)throw Error('INTEGRATION_INPUT_INVALID');
    context.reply(integrationId?200:201,await options.store.save(context.tenant,{idempotencyKey:requestKey,...(integrationId?{integrationId}:{}),issuer:text(body.issuer),identityTenant:text(body.identityTenant),clientId:text(body.clientId),servicePrincipalId:text(body.servicePrincipalId),scopes:strings(body.scopes),enabled:body.enabled,revision:number(body.revision),...(body.validAfter!==undefined?{validAfter:text(body.validAfter)}:{})}));
   }catch(error){fail(context,error);}return true;
  },
  /** Call for every machine principal before ANY human or general API dispatch. */
  async handleMachine(context:MachineIntegrationContext):Promise<void>{
   try{
    const match=/^\/api\/v1\/integration\/([0-9a-f-]{36})(\/.*)$/.exec(context.url.pathname);
    if(!match||!uuid.test(match[1])||!context.principal.machineIdentity||!context.principal.issuer||!context.principal.identityTenant||context.request.headers['x-organization-id']!==undefined)throw Error('INTEGRATION_SCOPE_DENIED');
    const integrationId=match[1],path=match[2],method=context.request.method??'GET';let scope:IntegrationScope;
    if(method==='GET'&&/^\/reports\/(summary|credentials|usage)$/.test(path))scope='reports:read';
    else if(method==='POST'&&path==='/exports')scope='exports:write';
    else if(method==='GET'&&/^\/exports\/[0-9a-f-]{36}(\/content)?$/.test(path))scope='exports:read';
    else if(method==='GET'&&path==='/webhooks')scope='webhooks:read';
    else if(method==='POST'&&path==='/webhooks'||method==='PUT'&&/^\/webhooks\/[0-9a-f-]{36}$/.test(path))scope='webhooks:write';
    else throw Error('INTEGRATION_SCOPE_DENIED');
    const tenant=await options.store.authorize({integrationId,issuer:context.principal.issuer,identityTenant:context.principal.identityTenant,machine:context.principal.machineIdentity,scope,correlationId:String(context.request.headers['x-correlation-id']??'machine-integration').slice(0,128)});
    if(!tenant)throw Error('INTEGRATION_SCOPE_DENIED');
    const key=()=>{const value=context.idempotencyKey();if(!value)throw Error('INTEGRATION_INPUT_INVALID');return value;};
    let result:unknown;let status=200;
    if(path==='/reports/summary'){query(context.url,[]);result=await options.reports.summary(tenant);}
    else if(path==='/reports/credentials'||path==='/reports/usage'){
     query(context.url,['after']);const kind=path.endsWith('credentials')?'credentialId':'usageEventId';
     const after=context.url.searchParams.get('after');const cursor=after?await options.store.internal(tenant,integrationId,kind,after):undefined;if(after&&!cursor)throw Error('INTEGRATION_INPUT_INVALID');
     const page=path.endsWith('credentials')?await options.reports.credentials(tenant,cursor??undefined):await options.reports.usage(tenant,cursor??undefined);
     result={...page,nextCursor:page.nextCursor?await options.store.reference(tenant,integrationId,kind,page.nextCursor):null};
     // nextCursor has already been translated to the same reference kind as item identifiers.
     const projected=await projectIntegrationResult(options.store,tenant,integrationId,{items:page.items});context.reply(200,{...(projected as object),nextCursor:(result as {nextCursor:unknown}).nextCursor});return;
    }else if(path==='/exports'){
     query(context.url,[]);const body=object(await context.readBody(),['kind']);if(body.kind!==undefined&&body.kind!=='summary'&&body.kind!=='credential-register')throw Error('INTEGRATION_INPUT_INVALID');
     result=await options.exports.request(tenant,key(),body.kind as 'summary'|'credential-register'|undefined,'json');status=202;
    }else if(path.startsWith('/exports/')){
     query(context.url,[]);const internal=await options.store.internal(tenant,integrationId,'exportId',path.split('/')[2]);if(!internal)throw Error('INTEGRATION_SCOPE_DENIED');
     if(path.endsWith('/content')){const content=await options.exports.content(tenant,internal);if(!content.contentType.startsWith('application/json'))throw Error('INTEGRATION_SCOPE_DENIED');result=JSON.parse(Buffer.from(content.bytes).toString('utf8'));}
     else result=await options.exports.get(tenant,internal);
    }else if(path==='/webhooks'&&method==='GET'){
     query(context.url,[]);const owned=await options.store.references(tenant,integrationId,'subscriptionId');const listed=await options.webhooks.list(tenant);result={items:listed.items.filter(row=>owned.has(row.subscriptionId))};
    }else{
     query(context.url,[]);const body=object(await context.readBody(),['endpoint','keyId','eventTypes','enabled','revision']);
     if(typeof body.enabled!=='boolean'||!options.webhookKeyIds?.has(text(body.keyId)))throw Error('WEBHOOK_KEY_UNAVAILABLE');
     let subscriptionId:string|undefined;
     if(method==='PUT'){subscriptionId=await options.store.internal(tenant,integrationId,'subscriptionId',path.split('/')[2])??undefined;if(!subscriptionId)throw Error('INTEGRATION_SCOPE_DENIED');}
     const saved=await options.webhooks.save(tenant,{integrationId,...(subscriptionId?{subscriptionId}:{}),endpoint:text(body.endpoint),keyId:text(body.keyId),eventTypes:strings(body.eventTypes),enabled:body.enabled,revision:number(body.revision),idempotencyKey:key()});
     const {signingSecretRequired,...projection}=saved;result={...projection,...(signingSecretRequired&&options.webhookSigningSecret?{signingSecret:options.webhookSigningSecret(tenant,saved.subscriptionId,text(body.keyId))}:{})};
    }
    context.reply(status,await projectIntegrationResult(options.store,tenant,integrationId,result));
   }catch(error){fail(context,error);}
  }
 };
}
