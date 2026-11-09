const identifier={type:'string',minLength:1,maxLength:300};
export const assetRightsOpenApiPath={
 '/api/v1/media-review/{targetId}/rights':{post:{
  operationId:'attestContentUsageRights',summary:'Record signed-in content author usage permission; does not approve source media or models',tags:['Technical integration'],
  parameters:[{name:'X-Organization-Id',in:'header',required:true,schema:identifier},{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:200}},{name:'targetId',in:'path',required:true,schema:identifier}],
  requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['sourceHash','ownerName','useScope','confirmed','targetKind'],properties:{sourceHash:{type:'string',pattern:'^[a-f0-9]{64}$'},ownerName:{type:'string',minLength:1,maxLength:240},useScope:{type:'string',minLength:1,maxLength:1000},confirmed:{type:'boolean',const:true},targetKind:{type:'string',enum:['asset','model']}}}}}},
  responses:{'200':{description:'Rights attestation saved or idempotently replayed. Withdrawn/expired rights cannot be restored.',content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['attestationId','assetVersionId','status'],properties:{attestationId:identifier,assetVersionId:identifier,status:{type:'string',const:'ACTIVE'}}}}}},default:{description:'401 sign-in required, 403 content role required, 404 unavailable or changed source, 409 changed replay intent, 422 invalid or unconfirmed request.',content:{'application/json':{schema:{$ref:'#/components/schemas/ApiError'}}}}}
 }}
} as const;
