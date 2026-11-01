export interface ComponentMapping {from:string;to:string|null}

/** Rebind only structural component references; authored text and scoring are never rewritten. */
export function remapCourseComponents(content:Record<string,any>,previousIds:readonly string[],nextIds:readonly string[],mapping:unknown):Record<string,any>{
 const invalid=()=>{throw Error('MODEL_COMPONENT_MAPPING_INVALID');};
 const validIds=(ids:readonly string[])=>ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&!!id.trim());
 if(!validIds(previousIds)||!validIds(nextIds)||!Array.isArray(mapping)||mapping.length!==previousIds.length)invalid();
 const pairs=new Map<string,string|null>(),targets=new Set<string>();
 for(const item of mapping as unknown[]){
  if(!item||typeof item!=='object'||Array.isArray(item))invalid();
  const row=item as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['from','to'].includes(key))||typeof row.from!=='string'||(row.to!==null&&typeof row.to!=='string')||!previousIds.includes(row.from)||(row.to!==null&&!nextIds.includes(row.to as string))||pairs.has(row.from)||(row.to!==null&&targets.has(row.to as string)))invalid();
  pairs.set(row.from as string,row.to as string|null);if(row.to!==null)targets.add(row.to as string);
 }
 const target=(id:unknown)=>{if(typeof id!=='string'||!pairs.has(id))return invalid();return pairs.get(id)!;};
 const mapped=(id:unknown)=>{const value=target(id);if(value===null)throw Error('MODEL_COMPONENT_STILL_REFERENCED');return value;};
 const result=structuredClone(content);
 if(result.simulation){
  const definition=result.simulation.definition;
  if(!definition?.model||!Array.isArray(definition.model.componentIds)||!Array.isArray(definition.components)||!definition.initialState?.componentStates)invalid();
  const additions=nextIds.filter(id=>!targets.has(id));
  definition.model.componentIds=[...definition.model.componentIds.map(target).filter((id:unknown)=>id!==null),...additions];
  definition.components=definition.components.filter((component:Record<string,unknown>)=>target(component.componentId)!==null);
  for(const component of definition.components)component.componentId=mapped(component.componentId);
  definition.initialState.componentStates=Object.fromEntries(Object.entries(definition.initialState.componentStates).filter(([id])=>target(id)!==null).map(([id,state])=>[mapped(id),state]));
  definition.components.push(...additions.map(componentId=>({componentId,initialState:'initial',allowedActions:['select_component']})));
  definition.initialState.componentStates=Object.fromEntries([...Object.entries(definition.initialState.componentStates),...additions.map(id=>[id,'initial'])]);
  const action=(value:Record<string,any>|undefined)=>{if(value?.componentId!==undefined)value.componentId=mapped(value.componentId);};
  for(const step of definition.steps??[])action(step.action);
  for(const fault of definition.faults??[]){action(fault.diagnosis);action(fault.resolution);}
 }
 for(const module of result.modules??[])for(const activity of module.activities??[])if(['3d_viewer','hotspot'].includes(activity.type))for(const hotspot of activity.exploration?.hotspots??[])hotspot.componentId=mapped(hotspot.componentId);
 return result;
}
