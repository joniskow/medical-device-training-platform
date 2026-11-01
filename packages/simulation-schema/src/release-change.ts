export const changeClasses=['cosmetic','instructional','assessment','simulation','certification_policy','product_revision'] as const;
export const requalificationDecisions=['keep_valid','future_learners_only','update_modules','full_retake','supersede_on_completion'] as const;
export interface ReleaseChange {
  schemaVersion:'release-change.v1';classes:string[];releaseNotes:string;effectiveAt:string;
  decision:typeof requalificationDecisions[number];rationale:string;learnerMessage:string;updateModuleIds:string[];
}
export function validReleaseChange(value:unknown,modules:ReadonlyArray<Record<string,any>>):value is ReleaseChange {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,any>;
  if(v.schemaVersion!=='release-change.v1'||Object.keys(v).some(key=>!['schemaVersion','classes','releaseNotes','effectiveAt','decision','rationale','learnerMessage','updateModuleIds'].includes(key)))return false;
  if(!Array.isArray(v.classes)||!v.classes.length||new Set(v.classes).size!==v.classes.length||v.classes.some((item:any)=>!changeClasses.includes(item)))return false;
  if(!requalificationDecisions.includes(v.decision)||['releaseNotes','rationale','learnerMessage'].some(key=>typeof v[key]!=='string'||!v[key].trim()||v[key].length>4000))return false;
  if(typeof v.effectiveAt!=='string'||!Number.isFinite(Date.parse(v.effectiveAt))||new Date(v.effectiveAt).toISOString()!==v.effectiveAt)return false;
  if(!Array.isArray(v.updateModuleIds)||new Set(v.updateModuleIds).size!==v.updateModuleIds.length||v.updateModuleIds.some((id:unknown)=>typeof id!=='string'||!modules.some(m=>m.moduleId===id)))return false;
  if(v.decision!=='update_modules')return v.updateModuleIds.length===0;
  const selected=modules.filter(m=>v.updateModuleIds.includes(m.moduleId));
  return selected.length>0&&selected.some(m=>(m.activities??[]).some((a:Record<string,any>)=>['multiple_choice','multi_select','ordered_step','simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(a.type)));
}
