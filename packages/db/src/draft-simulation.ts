import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import type {CourseReviewStorePort} from '@medical-device/contracts';
import {remapCourseComponents} from '@medical-device/simulation-schema';
import {withTenantTransaction} from './tenant-transaction.js';
import {validateBrowserModelManifest,validateSimulationModelActions} from '@medical-device/model-runtime';

/** Author-only API operations; tenant scope is supplied by authenticated membership resolution. */
export function draftSimulationOperations(pool:Pool):Pick<CourseReviewStorePort,'listApprovedModels'|'createSimulation'|'bindModel'|'replaceModel'|'getApprovedModelComponents'|'getApprovedModelForGeneration'>{
 const writeDraft=async ({tenant,courseVersionId,revision,modelVersionId,idempotencyKey,componentMapping}:Parameters<NonNullable<CourseReviewStorePort["replaceModel"]>>[0],mode:'simulation'|'bind'|'replace')=>{
   const modelOnly=mode!=='simulation',replace=mode==='replace';
   if(!tenant.actorId||![courseVersionId,modelVersionId,idempotencyKey].every(v=>/^[A-Za-z0-9._:-]{1,128}$/.test(v))||!Number.isSafeInteger(revision)||revision<1)throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const auditId=(replace?'model-replace:':modelOnly?'model-bind:':'simulation-create:')+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,idempotencyKey])).digest('hex');
    const signature=JSON.stringify([courseVersionId,revision,modelVersionId,...(componentMapping!==undefined?[componentMapping]:[])]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[auditId]);
    const previous=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,auditId])).rows[0];
    if(previous){if(previous.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return previous.details.result;}
    const course=(await client.query('SELECT revision,status,content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR UPDATE',[tenant.organizationId,courseVersionId])).rows[0];
    if(!course)throw Error('COURSE_VERSION_NOT_FOUND');
    if(!['DRAFT','IN_REVIEW'].includes(course.status))throw Error('COURSE_VERSION_IMMUTABLE');
    if(course.revision!==revision)throw Error('COURSE_VERSION_STALE');
    if(!modelOnly&&course.content.simulation)throw Error('SIMULATION_ALREADY_EXISTS');
    if(modelOnly&&!replace&&course.content.model)throw Error('COURSE_MODEL_ALREADY_BOUND');
    if(!replace&&course.content.model?.modelVersionId&&course.content.model.modelVersionId!==modelVersionId)throw Error('COURSE_MODEL_ALREADY_BOUND');
    if(replace&&!course.content.model)throw Error('COURSE_MODEL_NOT_BOUND');
    const model=(await client.query(`SELECT manifest,manifest_blob_key FROM model_versions WHERE organization_id=$1 AND model_version_id=$2 AND status='APPROVED' FOR SHARE`,[tenant.organizationId,modelVersionId])).rows[0];
    if(!model?.manifest_blob_key)throw Error('APPROVED_MODEL_NOT_FOUND');
    const manifest=model.manifest;
    if(!replace&&course.content.model?.manifestHash&&course.content.model.manifestHash!==manifest.sourceHash)throw Error('COURSE_MODEL_ALREADY_BOUND');
    try{validateBrowserModelManifest(manifest);}catch{throw Error('MODEL_MANIFEST_INVALID');}
    if(!/^[0-9a-f]{64}$/i.test(manifest.sourceHash??'')||!Array.isArray(manifest.components)||!manifest.components.length)throw Error('MODEL_MANIFEST_INVALID');
    const componentIds=manifest.components.map((c:{componentId:string})=>c.componentId);
    if(new Set(componentIds).size!==componentIds.length)throw Error('MODEL_MANIFEST_INVALID');
    const simulationDefinitionId=`simulation:${randomUUID()}`,stepId=`step:${randomUUID()}`,activityId=`activity:${randomUUID()}`;
    const definition={schemaVersion:'simulation-definition.v1',simulationDefinitionId,version:1,
     model:{modelVersionId,manifestHash:manifest.sourceHash,componentIds},
     components:componentIds.map((componentId:string)=>({componentId,initialState:'initial',allowedActions:['select_component','transform_component']})),
     initialState:{currentStepId:stepId,variables:{},componentStates:Object.fromEntries(componentIds.map((id:string)=>[id,'initial']))},
     steps:[{stepId,title:'Describe the first procedure step',action:{type:'select_component',componentId:componentIds[0]},nextStepIds:[],points:0}],faults:[],
     scoring:{maxScore:1,passScore:1,stepPoints:{[stepId]:0},faultPoints:{},penalties:{}},
     completion:{requiredStepIds:[stepId],requiredFaultIds:[],terminalStepIds:[stepId]},
     equivalentPath:{mode:'TEXT_KEYBOARD',instructions:[{stepId,text:''}],faultInstructions:[]}};
    let content=modelOnly?{...course.content,model:{modelVersionId,manifestHash:manifest.sourceHash,manifest}}:{...course.content,model:{modelVersionId,manifestHash:manifest.sourceHash,manifest},simulation:{simulationDefinitionId,definition},
     modules:[...(course.content.modules??[]),{moduleId:`module:${randomUUID()}`,title:'Simulation procedure',activities:[{activityId,type:'simulation',title:'Practice the procedure',simulationDefinitionId,citations:[]}]}]};
    if(replace){
     const previousModel=(await client.query('SELECT manifest FROM model_versions WHERE organization_id=$1 AND model_version_id=$2 FOR SHARE',[tenant.organizationId,course.content.model.modelVersionId])).rows[0];
     if(!previousModel||previousModel.manifest.sourceHash!==course.content.model.manifestHash)throw Error('MODEL_COMPONENT_MAPPING_REQUIRED');
     const previousIds=previousModel.manifest.components?.map((c:{componentId:string})=>c.componentId);
     if(!Array.isArray(previousIds))throw Error('MODEL_COMPONENT_MAPPING_REQUIRED');
     if(componentMapping!==undefined){
      content={...remapCourseComponents(course.content,previousIds,componentIds,componentMapping),model:content.model};
     }else{
      if(previousIds.length!==componentIds.length||new Set(previousIds).size!==previousIds.length||previousIds.some((id:string)=>!componentIds.includes(id)))throw Error('MODEL_COMPONENT_MAPPING_REQUIRED');
      for(const module of course.content.modules??[])for(const activity of module.activities??[])if(['3d_viewer','hotspot'].includes(activity.type))for(const hotspot of activity.exploration?.hotspots??[])if(hotspot.componentId&&!componentIds.includes(hotspot.componentId))throw Error('MODEL_COMPONENT_MAPPING_REQUIRED');
     }
     if(course.content.simulation){
      const oldDefinition=content.simulation.definition;
      if(!oldDefinition?.model)throw Error('MODEL_COMPONENT_MAPPING_REQUIRED');
      const nextDefinition={...oldDefinition,model:{...oldDefinition.model,modelVersionId,manifestHash:manifest.sourceHash}};
      if(validateSimulationModelActions(nextDefinition,content.model).length)throw Error('MODEL_ACTIONS_INCOMPATIBLE');
      content={...content,simulation:{...content.simulation,definition:nextDefinition}};
     }
    }
    await client.query(`UPDATE course_versions SET content=$3::jsonb,revision=revision+1,status='DRAFT',updated_at=now() WHERE organization_id=$1 AND course_version_id=$2`,[tenant.organizationId,courseVersionId,JSON.stringify(content)]);
    const result={revision:revision+1};
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'${replace?'DRAFT_MODEL_REPLACED':modelOnly?'DRAFT_MODEL_BOUND':'DRAFT_SIMULATION_CREATED'}','course_version',$4,$5::jsonb,now())`,[auditId,tenant.organizationId,tenant.actorId,courseVersionId,JSON.stringify({signature,result,nextRevision:revision+1,before:course.content,after:content,...(replace?{previousModelVersionId:course.content.model.modelVersionId,previousManifestHash:course.content.model.manifestHash,...(componentMapping!==undefined?{componentMapping}:{})}:{}),modelVersionId,manifestHash:manifest.sourceHash,...(modelOnly?{}:{simulationDefinitionId}),revision})]);
    return result;
   });
  };
 return {
  async getApprovedModelForGeneration(tenant,modelVersionId){
   if(!/^[A-Za-z0-9._:-]{1,128}$/.test(modelVersionId))throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const row=(await client.query("SELECT manifest FROM model_versions WHERE organization_id=$1 AND model_version_id=$2 AND status='APPROVED' AND manifest_blob_key IS NOT NULL",[tenant.organizationId,modelVersionId])).rows[0];
    if(!row)throw Error('APPROVED_MODEL_NOT_FOUND');
    try{validateBrowserModelManifest(row.manifest);}catch{throw Error('MODEL_MANIFEST_INVALID');}
    if(!/^[0-9a-f]{64}$/i.test(row.manifest.sourceHash??''))throw Error('MODEL_MANIFEST_INVALID');
    return {modelVersionId,manifestHash:row.manifest.sourceHash,manifest:row.manifest};
   });
  },
  async getApprovedModelComponents(tenant,modelVersionId){
   if(!/^[A-Za-z0-9._:-]{1,128}$/.test(modelVersionId))throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const row=(await client.query("SELECT manifest FROM model_versions WHERE organization_id=$1 AND model_version_id=$2 AND status='APPROVED' AND manifest_blob_key IS NOT NULL",[tenant.organizationId,modelVersionId])).rows[0];
    if(!row)throw Error('APPROVED_MODEL_NOT_FOUND');
    try{validateBrowserModelManifest(row.manifest);}catch{throw Error('MODEL_MANIFEST_INVALID');}
    return {components:row.manifest.components.map((c:{componentId:string;displayName:string})=>({componentId:c.componentId,displayName:c.displayName}))};
   });
  },
  async listApprovedModels(tenant,after){
   if(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after))throw Error('MODEL_CURSOR_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const rows=(await client.query(`SELECT model_version_id, jsonb_array_length(manifest->'components') AS component_count FROM model_versions
      WHERE organization_id=$1 AND status='APPROVED' AND manifest_blob_key IS NOT NULL AND jsonb_typeof(manifest->'components')='array'
      AND ($2::text IS NULL OR model_version_id>$2) ORDER BY model_version_id LIMIT 51`,[tenant.organizationId,after??null])).rows;
    const items=rows.slice(0,50).map(r=>({modelVersionId:r.model_version_id,componentCount:r.component_count}));
    return {items,...(rows.length>50?{nextCursor:items[49].modelVersionId}:{})};
   });
  },
  createSimulation:input=>writeDraft(input,'simulation'),
  bindModel:input=>writeDraft(input,'bind'),
  replaceModel:input=>writeDraft(input,'replace')
 };
}
