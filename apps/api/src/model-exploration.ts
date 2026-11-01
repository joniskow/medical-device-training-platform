import type {PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {validateModelExploration,type ModelExploration} from '@medical-device/simulation-schema';
import {validateBrowserModelManifest} from '@medical-device/model-runtime';
/** Validate inspection references against immutable release metadata, not editable course metadata. */
export async function resolvePublishedExploration(client:PoolClient,tenant:TenantContext,releaseId:string,content:Record<string,any>,activity:Record<string,any>){
 const model=content.model;
 if(!model||typeof model.modelVersionId!=='string'||!['3d_viewer','hotspot'].includes(activity.type))throw Error('EXPLORATION_NOT_FOUND');
 const rows=await client.query(`SELECT release_binding_id,manifest_hash,manifest FROM release_model_bindings
  WHERE organization_id=$1 AND release_id=$2 AND model_version_id=$3`,[tenant.organizationId,releaseId,model.modelVersionId]);
 if(rows.rows.length!==1)throw Error('EXPLORATION_NOT_FOUND');
 const binding=rows.rows[0];let manifest;
 try{manifest=validateBrowserModelManifest(binding.manifest);}catch{throw Error('EXPLORATION_NOT_FOUND');}
 const expected=`releasebind:${releaseId}:${model.modelVersionId}`;
 if(binding.release_binding_id!==expected||manifest.releaseBindingId!==expected||manifest.modelVersionId!==model.modelVersionId||manifest.sourceHash!==binding.manifest_hash||binding.manifest_hash!==model.manifestHash)throw Error('EXPLORATION_NOT_FOUND');
 if(!validateModelExploration(activity.type,activity.exploration,manifest.components.map(c=>c.componentId)).valid)throw Error('EXPLORATION_NOT_FOUND');
 const source=activity.exploration as ModelExploration;
 return {releaseId,modelVersionId:model.modelVersionId,exploration:{overview:source.overview,hotspots:source.hotspots.map(h=>({componentId:h.componentId,title:h.title,text:h.text}))}};
}
