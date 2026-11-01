type Rule={min:number;max:number;step:number;snap?:number};
type Component={componentId:string;displayName:string;permittedTransforms?:{rotationY?:Rule;translationX?:Rule}};

export function createModelInteractionEditor(host:HTMLElement,id:string,manifest:Record<string,unknown>,api:<T>(path:string,init?:RequestInit)=>Promise<T>,saved:()=>void,active:()=>boolean,dirty:()=>void){
 const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Component interactions';group.append(legend);
 const help=document.createElement('p');help.textContent='Name each component and enable its permitted movement. Limits must include the resting position (zero). Save, preview, and review the model before approval. Approved models cannot be edited; upload a new version to change them.';group.append(help);
 group.addEventListener('input',dirty);
 const readers:Array<()=>Component>=[];
 for(const component of manifest.components as Component[]){
  const row=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=component.componentId;row.append(title);
  const nameLabel=document.createElement('label'),name=document.createElement('input');name.value=component.displayName;name.maxLength=200;nameLabel.append('Component name',name);row.append(nameLabel);
  const rules:Array<()=>[string,Rule]|undefined>=[];
  for(const [axis,label] of [['rotationY','Rotation around Y (radians)'],['translationX','Movement along X (metres)']] as const){
   const rule=component.permittedTransforms?.[axis],box=document.createElement('fieldset'),heading=document.createElement('legend');heading.textContent=label;box.append(heading);
   const enabled=document.createElement('input'),enableLabel=document.createElement('label');enabled.type='checkbox';enabled.checked=!!rule;enableLabel.append(enabled,'Enable movement');box.append(enableLabel);
   const values={} as Record<'min'|'max'|'step'|'snap',HTMLInputElement>;
   for(const [key,text] of [['min','Minimum'],['max','Maximum'],['step','Step'],['snap','Snap (optional)']] as const){
    const field=document.createElement('input'),fieldLabel=document.createElement('label');field.type='number';field.step='any';field.value=rule?.[key]?.toString()??'';field.disabled=!enabled.checked;fieldLabel.append(text,field);box.append(fieldLabel);values[key]=field;
   }
   enabled.onchange=()=>Object.values(values).forEach(field=>field.disabled=!enabled.checked);
   rules.push(()=>{
    if(!enabled.checked)return;
    if(['min','max','step'].some(key=>!values[key as 'min'].value.trim()))throw Error('Enter minimum, maximum and step for each enabled movement.');
    const next:Rule={min:Number(values.min.value),max:Number(values.max.value),step:Number(values.step.value),...(values.snap.value.trim()?{snap:Number(values.snap.value)}:{})};
    const increment=next.snap??next.step;
    if(!Object.values(next).every(Number.isFinite)||next.min>0||next.max<0||next.min>=next.max||next.step<=0||next.step>next.max-next.min||increment<=0||increment>next.max-next.min||Math.abs(-next.min/increment-Math.round(-next.min/increment))>1e-8)throw Error('Use finite limits containing zero and a positive step/snap aligned with zero.');
    return [axis,next];
   });row.append(box);
  }
  readers.push(()=>{if(!name.value.trim())throw Error('Enter a name for every component.');return {componentId:component.componentId,displayName:name.value.trim(),permittedTransforms:Object.fromEntries(rules.map(read=>read()).filter((rule):rule is [string,Rule]=>!!rule))};});group.append(row);
 }
 const save=document.createElement('button'),status=document.createElement('p');save.type='button';save.textContent='Save component interactions';status.setAttribute('role','status');group.append(save,status);host.append(group);
 save.onclick=async()=>{
  if(!active())return;
  try{
   const components=readers.map(read=>read());group.disabled=true;
   await api(`/api/v1/model-imports/${encodeURIComponent(id)}/configuration`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:manifest.interactionRevision??0,components})});
   if(active())saved();
  }catch(error){if(active()){group.disabled=false;status.textContent=error instanceof Error&&/^(Enter |Use finite)/.test(error.message)?error.message:'Could not save interactions. Check the movement limits and author permissions; reopen the model if another author changed it.';}}
 };
}
