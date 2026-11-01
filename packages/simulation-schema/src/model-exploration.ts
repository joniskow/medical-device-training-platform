export interface ModelExploration {overview:string;hotspots:Array<{componentId:string;title:string;text:string}>}
/** Inspection content only: no actions, scores, executable text or completion rules. */
export function validateModelExploration(type:unknown,value:unknown,componentIds:readonly string[]){
 const findings:Array<{code:string;message:string}>=[];
 const fail=(code:string,message:string)=>findings.push({code,message});
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const text=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
 if(!['3d_viewer','hotspot'].includes(String(type))||!record(value)||Object.keys(value).some(k=>!['overview','hotspots'].includes(k))){fail('EXPLORATION_INVALID','Configure a model overview and component hotspots only.');return {valid:false,findings};}
 if(!text(value.overview,10000))fail('EXPLORATION_OVERVIEW_REQUIRED','Provide a model overview in at most 10000 characters.');
 if(!Array.isArray(value.hotspots)||value.hotspots.length>100||(type==='hotspot'&&value.hotspots.length===0)){fail('EXPLORATION_HOTSPOTS_INVALID','Use at most 100 hotspots; a hotspot activity requires at least one.');return {valid:false,findings};}
 const seen=new Set<string>();
 for(const item of value.hotspots){
  if(!record(item)||Object.keys(item).some(k=>!['componentId','title','text'].includes(k))||!text(item.title,200)||!text(item.text,10000)){fail('EXPLORATION_HOTSPOT_INVALID','Each hotspot needs a title and equivalent text without additional action fields.');continue;}
  if(typeof item.componentId!=='string'||componentIds.filter(id=>id===item.componentId).length!==1||seen.has(item.componentId))fail('EXPLORATION_COMPONENT_INVALID','Choose each hotspot component once from the bound model.');
  else seen.add(item.componentId);
 }
 return {valid:findings.length===0,findings};
}
