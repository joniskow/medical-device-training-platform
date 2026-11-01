type Component={componentId:string;displayName?:string};
export function renderModelMappingEditor(host:HTMLElement,previous:Component[],options:{load:()=>Promise<{components:Component[]}>;active:()=>boolean;changed:()=>void}){
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Replacement component mapping';box.append(legend);host.append(box);box.dataset.modelMapping='true';
 const guidance=document.createElement('p');guidance.textContent='For changed component IDs, map every current component to a replacement, or explicitly remove it if unused by steps, faults and hotspots. Additional components start with selection enabled and no scoring rules. Instructions and scores are preserved; review the text and new geometry before publication.';box.append(guidance);
 const load=document.createElement('button');load.type='button';load.textContent='Load replacement components';box.append(load);
 const status=document.createElement('p');status.setAttribute('role','status');box.append(status);
 const rows=document.createElement('div');box.append(rows);
 let generation=0,opened=false,ready=false,selects:Array<{from:string;select:HTMLSelectElement;removeValue:string}>=[];
 const reset=()=>{generation++;opened=false;ready=false;selects=[];rows.replaceChildren();status.textContent='';load.disabled=false;options.changed();};
 load.onclick=async()=>{
  const epoch=++generation;opened=true;ready=false;rows.replaceChildren();selects=[];load.disabled=true;options.changed();status.textContent='Loading replacement components…';
  try{
   const result=await options.load();if(epoch!==generation||!box.isConnected||!options.active())return;
   const components=result.components;
   if(!previous.length||!components.length){status.textContent='Both models need a component list.';return;}
   for(const component of previous){
    const label=document.createElement('label'),select=document.createElement('select');label.append(document.createTextNode(`${component.displayName??component.componentId} (${component.componentId}) → `),select);
    select.add(new Option('Choose replacement component',''));
    let removeValue='__remove__';while(components.some(target=>target.componentId===removeValue))removeValue+='_' ;
    select.add(new Option('Remove unused component',removeValue));
    for(const target of components)select.add(new Option(`${target.displayName??target.componentId} (${target.componentId})`,target.componentId));
    if(components.some(target=>target.componentId===component.componentId))select.value=component.componentId;
    select.onchange=()=>{options.changed();status.textContent='Review every mapping, then replace the bound model.';};rows.append(label);selects.push({from:component.componentId,select,removeValue});
   }
   ready=true;status.textContent=`Choose each mapped component once. Matching IDs are preselected. ${Math.max(0,components.length-previous.length)} or more additional components may start without scoring rules. Explicit removals are checked against authored references.`;selects[0]?.select.focus();
  }catch(error){if(epoch===generation&&box.isConnected&&options.active())status.textContent=error instanceof Error?error.message:'Component loading failed. Try again.';}
  finally{if(epoch===generation&&box.isConnected&&options.active())load.disabled=false;}
 };
 return {reset,getMapping(){
  if(!opened)return undefined;
  if(!ready)throw Error('Load and review replacement components before replacing the model.');
  const mapping=selects.map(({from,select,removeValue})=>({from,to:select.value===removeValue?null:select.value}));
  if(mapping.some(pair=>pair.to==='')||new Set(mapping.filter(pair=>pair.to!==null).map(pair=>pair.to)).size!==mapping.filter(pair=>pair.to!==null).length){status.textContent='Choose a different replacement component for every current component.';throw Error(status.textContent);}
  return mapping;
 }};
}
