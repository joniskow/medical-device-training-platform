import {technicalOpenApiPaths} from './technical-openapi.js';
const uuid={type:'string',format:'uuid'};
const text={type:'string'};
const date={type:'string',format:'date-time'};
const object=(properties:Record<string,object>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const array=(items:object)=>({type:'array',items});
const json=(schema:object)=>({'application/json':{schema}});
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const parameter=(name:string,location='path',required=true,schema:object=uuid)=>({name,in:location,required,schema});
const idempotency=parameter('Idempotency-Key','header',true,{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$'});
const organization=parameter('X-Organization-Id','header',true,text);
const error={description:'400 invalid input, 401 invalid/expired token, 403 unmapped/revoked/wrong app/scope/route, 404 unavailable resource, 409 revision/idempotency conflict, 429 admission, 503 dependency unavailable.',content:json(ref('ApiError'))};
const operation=(operationId:string,scope:string,response:object,parameters:object[]=[],body?:object,status='200')=>({operationId,tags:['Organization machine integrations'],description:'Entra OAuth2 client-credentials token with idtyp=app; application role AND active tenant integration scope required on every call. No personal-account or email-verification authority. All returned resource IDs are integration-scoped UUID references.',security:[{integrationBearer:[]}],'x-required-integration-scope':scope,parameters:[parameter('integrationId'),...parameters],...(body?{requestBody:{required:true,content:json(body)}}:{}),responses:{[status]:{description:'Success',content:json(response)},default:error}});
const scopes={type:'array',minItems:1,maxItems:5,uniqueItems:true,items:{type:'string',enum:['reports:read','exports:read','exports:write','webhooks:read','webhooks:write']}};
const config=object({issuer:{type:'string',format:'uri',pattern:'^https://',maxLength:512},identityTenant:uuid,clientId:uuid,servicePrincipalId:uuid,scopes,enabled:{type:'boolean'},revision:{type:'integer',minimum:0},validAfter:date},['issuer','identityTenant','clientId','servicePrincipalId','scopes','enabled','revision']);
const saved=object({integrationId:uuid,scopes,status:{type:'string',enum:['ACTIVE','REVOKED']},revision:{type:'integer',minimum:1},validAfter:date});
const exportResult=object({exportId:uuid,state:{type:'string',enum:['PENDING','CLAIMED','SUCCEEDED','FAILED','EXPIRED']},expiresAt:date});
const webhookOperation=technicalOpenApiPaths['/api/v1/webhooks'].post;
export const machineIntegrationOpenApiSecuritySchemes={integrationBearer:{type:'http',scheme:'bearer',bearerFormat:'JWT',description:'Entra access token obtained via OAuth2 client_credentials with resource/.default. Configure explicit app-only idtyp optional claim and approved Training.* application roles; certificates/private keys remain with Entra/customer credential infrastructure.'}};
export const machineIntegrationOpenApiSchemas={MachineIntegrationConfiguration:config,MachineIntegrationConfigurationResult:saved};
export const machineIntegrationOpenApiPaths={
 '/api/v1/integration-clients':{
  get:{operationId:'listMachineIntegrationClients',tags:['Organization machine integrations'],description:'Human organization administrator only. Machine tokens cannot manage client bindings.',parameters:[organization],responses:{'200':{description:'Bounded integrations without client credentials',content:json(object({items:array({...saved,additionalProperties:true})}))},default:error}},
  post:{operationId:'createMachineIntegrationClient',tags:['Organization machine integrations'],description:'Human organization administrator provisions an explicit issuer/tenant/client/service-principal mapping and least-privilege scopes. Credentials remain in Entra. Revision zero; retain Idempotency-Key on retry.',parameters:[organization,idempotency],requestBody:{required:true,content:json(config)},responses:{'201':{description:'Provisioned integration',content:json(saved)},default:error}}},
 '/api/v1/integration-clients/{integrationId}':{put:{operationId:'updateMachineIntegrationClient',tags:['Organization machine integrations'],description:'Human organization administrator changes scope, revokes, or advances validAfter token cutoff after external certificate/key rotation. Cutoff cannot be moved backwards. Disabling/removing webhook write scope disables bound subscriptions.',parameters:[organization,parameter('integrationId'),idempotency],requestBody:{required:true,content:json(config)},responses:{'200':{description:'Updated integration',content:json(saved)},default:error}}},
 '/api/v1/integration/{integrationId}/reports/summary':{get:operation('getIntegrationSummary','reports:read',ref('TechnicalReport'))},
 '/api/v1/integration/{integrationId}/reports/credentials':{get:operation('listIntegrationCredentials','reports:read',object({items:array({...object({credentialId:uuid,courseVersionId:uuid,releaseId:{type:['string','null'],format:'uuid'},releaseHash:{type:['string','null']},policyVersion:{type:['integer','null']},status:text,title:{type:['string','null']},issuedAt:date,expiresAt:{type:['string','null'],format:'date-time'}}),additionalProperties:true}),nextCursor:{type:['string','null'],format:'uuid'}}),[parameter('after','query',false)])},
 '/api/v1/integration/{integrationId}/reports/usage':{get:operation('listIntegrationUsage','reports:read',object({items:array(object({usageEventId:uuid,meterKey:text,quantity:text,createdAt:date})),nextCursor:{type:['string','null'],format:'uuid'}}),[parameter('after','query',false)])},
 '/api/v1/integration/{integrationId}/exports':{post:operation('createIntegrationExport','exports:write',exportResult,[idempotency],object({kind:{type:'string',enum:['summary','credential-register'],default:'summary'}},[]),'202')},
 '/api/v1/integration/{integrationId}/exports/{exportId}':{get:operation('getIntegrationExport','exports:read',exportResult,[parameter('exportId')])},
 '/api/v1/integration/{integrationId}/exports/{exportId}/content':{get:operation('readIntegrationExport','exports:read',ref('ProtectedExportContent'),[parameter('exportId')])},
 '/api/v1/integration/{integrationId}/webhooks':{
  get:operation('listIntegrationWebhooks','webhooks:read',object({items:array({...object({subscriptionId:uuid,endpoint:text,keyId:text,eventTypes:array(text),enabled:{type:'boolean'},revision:{type:'integer'}}),additionalProperties:false})})),
  post:{...operation('createIntegrationWebhook','webhooks:write',webhookOperation.responses['200'].content['application/json'].schema,[idempotency]),requestBody:webhookOperation.requestBody}},
 '/api/v1/integration/{integrationId}/webhooks/{subscriptionId}':{put:{...operation('updateIntegrationWebhook','webhooks:write',webhookOperation.responses['200'].content['application/json'].schema,[parameter('subscriptionId'),idempotency]),requestBody:webhookOperation.requestBody}}
};
