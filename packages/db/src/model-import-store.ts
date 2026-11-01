import {validateBrowserModelManifest} from '@medical-device/model-runtime';
import type {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {attestReconstructionPreparation} from './reconstruction-store.js';

export function createModelImportStore(pool:Pool,options?:{writeManifest:(key:string,manifest:Record<string,unknown>)=>Promise<void>}){
 return {
 async reconstructionLineage(tenant:TenantContext,manifest:Record<string,unknown>){return withTenantTransaction(pool,tenant,client=>attestReconstructionPreparation(client,tenant,manifest.preparation));},
 async configure(tenant:TenantContext,id:string,input:{expectedRevision:number;components:unknown}){
  if(!tenant.actorId||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Array.isArray(input.components)||!options)throw Error('MODEL_CONFIGURATION_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   const row=(await client.query(`SELECT m.manifest,m.status,v.state,a.status AS parent_status FROM model_versions m JOIN asset_versions v ON v.asset_version_id=m.asset_version_id AND v.organization_id=m.organization_id JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id WHERE m.organization_id=$1 AND m.model_version_id=$2 FOR UPDATE OF m,v,a`,[tenant.organizationId,id])).rows[0];
   if(!row||['QUARANTINED','REJECTED','RETIRED','SUSPENDED'].includes(row.parent_status))throw Error('MODEL_UNAVAILABLE');
   if(row.status!=='REVIEW_REQUIRED'||row.state!=='READY_FOR_REVIEW'||(row.manifest.interactionRevision??0)!==input.expectedRevision)throw Error('MODEL_REVIEW_CONFLICT');
   const edits=input.components as Array<Record<string,unknown>>,existing=row.manifest.components as Array<Record<string,unknown>>;
   if(edits.length!==existing.length||new Set(edits.map(c=>c?.componentId)).size!==existing.length)throw Error('MODEL_CONFIGURATION_INVALID');
   const components=existing.map(component=>{
    const edit=edits.find(c=>c?.componentId===component.componentId);
    if(!edit||Object.keys(edit).some(k=>!['componentId','displayName','permittedTransforms'].includes(k))||typeof edit.displayName!=='string'||!edit.displayName.trim()||edit.displayName.length>200)throw Error('MODEL_CONFIGURATION_INVALID');
    const transforms=edit.permittedTransforms;
    if(!transforms||typeof transforms!=='object'||Array.isArray(transforms)||Object.keys(transforms).some(k=>!['rotationY','translationX'].includes(k)))throw Error('MODEL_CONFIGURATION_INVALID');
    for(const rule of Object.values(transforms)){
     if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).some(k=>!['min','max','step','snap'].includes(k))||!Number.isFinite(rule.min)||!Number.isFinite(rule.max)||rule.min>0||rule.max<0||rule.min>=rule.max||!Number.isFinite(rule.step)||rule.step<=0||rule.step>rule.max-rule.min||rule.snap!==undefined&&(!Number.isFinite(rule.snap)||rule.snap<=0||rule.snap>rule.max-rule.min))throw Error('MODEL_CONFIGURATION_INVALID');
     const increment=rule.snap??rule.step;if(Math.abs((0-rule.min)/increment-Math.round((0-rule.min)/increment))>1e-8)throw Error('MODEL_CONFIGURATION_INVALID');
    }
    return {...component,componentId:component.componentId,displayName:edit.displayName.trim(),permittedTransforms:transforms,interactionCapabilities:['select',...('rotationY' in transforms?['rotate']:[]),...('translationX' in transforms?['translate']:[])]};
   });
   const manifest={...row.manifest,components,interactionRevision:input.expectedRevision+1};
   try{validateBrowserModelManifest({...manifest,modelVersionId:id,releaseBindingId:"configuration:"+id});}catch{throw Error('MODEL_CONFIGURATION_INVALID');}
   const key=`${tenant.organizationId}/models/configured/${randomUUID()}.json`;
   await options.writeManifest(key,manifest);
   await client.query('UPDATE model_versions SET manifest=$3::jsonb,manifest_blob_key=$4,updated_at=now() WHERE organization_id=$1 AND model_version_id=$2',[tenant.organizationId,id,JSON.stringify(manifest),key]);
   for(const component of components)await client.query('UPDATE model_components SET metadata=$4::jsonb,updated_at=now() WHERE organization_id=$1 AND model_version_id=$2 AND component_key=$3',[tenant.organizationId,id,component.componentId,JSON.stringify(component)]);
   await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'MODEL_INTERACTIONS_CONFIGURED','model_version',$4,$5::jsonb,now())`,['audit:'+randomUUID(),tenant.organizationId,tenant.actorId,id,JSON.stringify({revision:manifest.interactionRevision,components})]);
   return {manifest};
  });
 },
 async list(tenant:TenantContext,after=''){
  return withTenantTransaction(pool,tenant,async client=>{
   const rows=(await client.query(`SELECT m.model_version_id AS "modelVersionId",v.file_name AS "fileName",m.status FROM model_versions m JOIN asset_versions v ON v.asset_version_id=m.asset_version_id AND v.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.model_version_id>$2 AND m.status IN ('REVIEW_REQUIRED','APPROVED') ORDER BY m.model_version_id LIMIT 21`,[tenant.organizationId,after])).rows;
   return {items:rows.slice(0,20),...(rows.length>20?{nextCursor:rows[19].modelVersionId}:{})};
  });
 },
 async get(tenant:TenantContext,id:string){
  return withTenantTransaction(pool,tenant,async client=>{
   const row=(await client.query(`SELECT m.model_version_id AS "modelVersionId",m.status,m.manifest,m.blob_key AS "blobKey",v.sha256,v.file_name AS "fileName" FROM model_versions m JOIN asset_versions v ON v.asset_version_id=m.asset_version_id AND v.organization_id=m.organization_id JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id WHERE m.organization_id=$1 AND m.model_version_id=$2 AND m.status IN ('REVIEW_REQUIRED','APPROVED') AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')`,[tenant.organizationId,id])).rows[0];
   return row??null;
  });
 },
 async review(tenant:TenantContext,id:string,input:{sourceHash:string;expectedRevision:number;decision:'APPROVE'|'REJECT';rationale:string;idempotencyKey:string}){
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!tenant.actorId||!/^[a-f0-9]{64}$/.test(input.sourceHash)||!['APPROVE','REJECT'].includes(input.decision)||!input.rationale.trim()||input.rationale.length>4000||!input.idempotencyKey||input.idempotencyKey.length>200)throw Error('MODEL_REVIEW_INVALID');
  return withTenantTransaction(pool,tenant,async client=>{
   const row=(await client.query(`SELECT m.status,m.asset_version_id,m.manifest,m.created_by,v.sha256,v.state,a.status AS parent_status FROM model_versions m JOIN asset_versions v ON v.asset_version_id=m.asset_version_id AND v.organization_id=m.organization_id JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id WHERE m.organization_id=$1 AND m.model_version_id=$2 FOR UPDATE OF m,v,a`,[tenant.organizationId,id])).rows[0];
   if(!row||['QUARANTINED','REJECTED','RETIRED','SUSPENDED'].includes(row.parent_status))throw Error('MODEL_UNAVAILABLE');
   const requestHash=createHash('sha256').update(JSON.stringify([tenant.actorId,id,input.sourceHash,input.expectedRevision,input.decision,input.rationale.trim()])).digest('hex');
   const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='MODEL_REVIEW_DECISION' AND details->>'idempotencyKey'=$3`,[tenant.organizationId,id,input.idempotencyKey])).rows[0];
   if(prior){if(prior.details.requestHash!==requestHash)throw Error('MODEL_REVIEW_CONFLICT');return {status:prior.details.status};}
   if(input.decision==='APPROVE'&&row.created_by===tenant.actorId)throw Error('MODEL_INDEPENDENT_REVIEW_REQUIRED');
   if(input.decision==='APPROVE'){
    await attestReconstructionPreparation(client,tenant,row.manifest.preparation);
    const editor=(await client.query(`SELECT actor_id FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='MODEL_INTERACTIONS_CONFIGURED' ORDER BY created_at DESC,audit_event_id DESC LIMIT 1`,[tenant.organizationId,id])).rows[0];
    if(editor?.actor_id===tenant.actorId)throw Error('MODEL_INDEPENDENT_REVIEW_REQUIRED');
   }
   if((row.manifest.interactionRevision??0)!==input.expectedRevision||row.status!=='REVIEW_REQUIRED'||!['READY_FOR_REVIEW','APPROVED'].includes(row.state)||row.sha256!==input.sourceHash||row.manifest.sourceHash!==input.sourceHash)throw Error('MODEL_REVIEW_CONFLICT');
   if(input.decision==='APPROVE'&&row.manifest.normalizationStatus!=='CANONICAL')throw Error('MODEL_NORMALIZATION_REQUIRED');
   const status=input.decision==='APPROVE'?'APPROVED':'REJECTED';
   await client.query('UPDATE model_versions SET status=$3,updated_at=now() WHERE organization_id=$1 AND model_version_id=$2',[tenant.organizationId,id,status]);
   await client.query('UPDATE asset_versions SET state=$3,reason=$4,updated_at=now() WHERE organization_id=$1 AND asset_version_id=$2',[tenant.organizationId,row.asset_version_id,status,input.rationale.trim()]);
   await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'MODEL_REVIEW_DECISION','model_version',$4,$5::jsonb,now())`,['audit:'+randomUUID(),tenant.organizationId,tenant.actorId,id,JSON.stringify({...input,rationale:input.rationale.trim(),requestHash,status})]);
   return {status};
  });
 },
 async save(tenant:TenantContext,input:{assetVersionId:string;modelVersionId:string;blobKey:string;manifestBlobKey:string;manifest:Record<string,unknown>;components:Array<{componentId:string}>}){
  return withTenantTransaction(pool,tenant,async client=>{
   const lineage=await attestReconstructionPreparation(client,tenant,input.manifest.preparation);
   if(lineage)input.manifest.reconstructionLineage=lineage;else delete input.manifest.reconstructionLineage;
   const asset=await client.query(`SELECT sha256,state FROM asset_versions WHERE organization_id=$1 AND asset_version_id=$2 FOR UPDATE`,[tenant.organizationId,input.assetVersionId]);
   if(!asset.rows[0]||asset.rows[0].sha256!==input.manifest.sourceHash||!['PROCESSING','READY_FOR_REVIEW','APPROVED'].includes(asset.rows[0].state))throw Error('MODEL_IMPORT_SOURCE_INVALID');
   const existing=await client.query(`SELECT asset_version_id,manifest FROM model_versions WHERE organization_id=$1 AND model_version_id=$2`,[tenant.organizationId,input.modelVersionId]);
   if(existing.rows[0]){
    if(existing.rows[0].asset_version_id!==input.assetVersionId||existing.rows[0].manifest.sourceHash!==input.manifest.sourceHash)throw Error('MODEL_IMPORT_CONFLICT');
    return;
   }
   await client.query(`INSERT INTO model_versions(model_version_id,organization_id,asset_version_id,blob_key,manifest_blob_key,manifest,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,'REVIEW_REQUIRED',$7,now(),now())`,[input.modelVersionId,tenant.organizationId,input.assetVersionId,input.blobKey,input.manifestBlobKey,JSON.stringify(input.manifest),tenant.actorId??'worker']);
   for(const component of input.components)await client.query(`INSERT INTO model_components(model_component_id,organization_id,model_version_id,component_key,metadata,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,now(),now())`,[input.modelVersionId+':'+component.componentId,tenant.organizationId,input.modelVersionId,component.componentId,JSON.stringify(component)]);
  });
 }};
}
