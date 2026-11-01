import {validateModelExploration} from '@medical-device/simulation-schema';
type Data=Record<string,any>;
export function renderModelExplorationEditor(parent:HTMLElement,activity:Data,components:Data[],onChange:()=>void){
 const root=document.createElement('fieldset');root.dataset.explorationEditor='true';parent.append(root);
 const content=activity.exploration??={overview:'',hotspots:[]};
 let status:HTMLElement;
 const validate=()=>{const result=validateModelExploration(activity.type,content,components.map(c=>c.componentId));status.textContent=result.valid?'Inspection content is valid.':result.findings.map(f=>f.message).join(' ');};
 const changed=()=>{validate();onChange();};
 const field=(host:HTMLElement,labelText:string,value:string,update:(value:string)=>void,multi=false)=>{const label=document.createElement('label');label.textContent=labelText;const input=document.createElement(multi?'textarea':'input');input.value=value??'';input.oninput=()=>{update(input.value);changed();};label.append(input);host.append(label);};
 const button=(host:HTMLElement,label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;host.append(b);return b;};
 function render(){
  root.replaceChildren();const legend=document.createElement('legend');legend.textContent='Model inspection content';root.append(legend);
  status=document.createElement('p');status.setAttribute('role','status');root.append(status);
  if(!content||typeof content!=='object'||!Array.isArray(content.hotspots)||content.hotspots.some((h:any)=>!h||typeof h!=='object')){status.textContent='Restore a valid model exploration draft before editing.';return;}
  const note=document.createElement('p');note.textContent='Inspection does not award a simulation score. The overview and hotspot text provide the equivalent reading path.';root.append(note);
  field(root,'Model overview',content.overview,v=>{content.overview=v;},true);
  content.hotspots.forEach((hotspot:Data,index:number)=>{
   const group=document.createElement('fieldset');group.dataset.hotspotIndex=String(index);root.append(group);
   const heading=document.createElement('legend');heading.textContent=`Hotspot ${index+1}`;group.append(heading);
   const label=document.createElement('label');label.textContent='Model component';const select=document.createElement('select');select.add(new Option('Choose a component',''));
   for(const c of components)select.add(new Option(c.displayName||c.componentId,c.componentId));
   if(hotspot.componentId&&!components.some(c=>c.componentId===hotspot.componentId))select.add(new Option('Unavailable component: '+hotspot.componentId,hotspot.componentId));
   select.value=hotspot.componentId??'';select.onchange=()=>{hotspot.componentId=select.value;changed();};label.append(select);group.append(label);
   field(group,'Hotspot title',hotspot.title,v=>{hotspot.title=v;});field(group,'Hotspot explanation',hotspot.text,v=>{hotspot.text=v;},true);
   button(group,'Remove hotspot',()=>{if(!window.confirm('Remove this hotspot from the draft?'))return;content.hotspots.splice(index,1);onChange();render();root.querySelector<HTMLElement>('textarea')?.focus();});
  });
  const add=button(root,'Add component hotspot',()=>{content.hotspots.push({componentId:'',title:'',text:''});onChange();render();root.querySelector<HTMLElement>(`[data-hotspot-index="${content.hotspots.length-1}"] select`)?.focus();});add.disabled=content.hotspots.length>=100;
  validate();
 }
 render();
}
