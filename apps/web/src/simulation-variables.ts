import type {SimulationDefinition} from '@medical-device/simulation-schema';
type Value=string|number|boolean;
function valueControl(host:HTMLElement,label:string,value:Value,update:(value:Value)=>void){
 const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));
 const input=document.createElement('input');input.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text';input.step='any';input.value=String(value);input.checked=value===true;
 input.oninput=()=>update(typeof value==='boolean'?input.checked:typeof value==='number'?(input.value.trim()?Number(input.value):NaN):input.value);wrapper.append(input);host.append(wrapper);return input;
}
export function renderVariables(host:HTMLElement,d:SimulationDefinition,changed:()=>void,rebuild:()=>void){
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Scenario variables';box.append(legend);host.append(box);
 const message=document.createElement('p');message.setAttribute('role','status');box.append(message);
 for(const [name,value] of Object.entries(d.initialState.variables)){
  const row=document.createElement('div');box.append(row);valueControl(row,`Initial value: ${name}`,value,v=>{d.initialState.variables[name]=v;changed();});
  const remove=document.createElement('button');remove.type='button';remove.textContent=`Remove variable: ${name}`;row.append(remove);
  remove.onclick=()=>{if(d.steps.some(s=>s.preconditions?.some(p=>p.variable===name)||Object.hasOwn(s.setVariables??{},name))||d.faults.some(f=>Object.hasOwn(f.setVariables??{},name))){message.textContent='Remove this variable from preconditions and effects first.';return;}
   if(!confirm(`Remove variable ${name}?`))return;delete d.initialState.variables[name];rebuild();};
 }
 const nameLabel=document.createElement('label'),name=document.createElement('input');nameLabel.append(document.createTextNode('New variable name'),name);box.append(nameLabel);
 const typeLabel=document.createElement('label'),type=document.createElement('select');typeLabel.append(document.createTextNode('New variable type'),type);for(const v of ['boolean','number','string'])type.add(new Option(v,v));box.append(typeLabel);
 const add=document.createElement('button');add.type='button';add.textContent='Add scenario variable';box.append(add);add.onclick=()=>{
  const key=name.value.trim();if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(key)||['constructor','prototype','__proto__'].includes(key)||Object.hasOwn(d.initialState.variables,key)){message.textContent='Use a unique variable name beginning with a letter.';return;}
  d.initialState.variables[key]=type.value==='boolean'?false:type.value==='number'?0:'';rebuild();
 };
}
export function renderVariableRules(host:HTMLElement,d:SimulationDefinition,target:{preconditions?:Array<{variable:string;equals:Value}>;setVariables?:Record<string,Value>},conditions:boolean,changed:()=>void){
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=conditions?'Preconditions and effects':'Effects after fault resolution';box.append(legend);host.append(box);
 if(!Object.keys(d.initialState.variables).length){const p=document.createElement('p');p.textContent='Add a scenario variable to configure conditions and effects.';box.append(p);}
 for(const [name,initial] of Object.entries(d.initialState.variables))for(const condition of conditions?[true,false]:[false]){
  const row=document.createElement('div'),label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';
  enabled.checked=condition?Boolean(target.preconditions?.some(p=>p.variable===name)):Object.hasOwn(target.setVariables??{},name);
  label.append(enabled,document.createTextNode(`${condition?'Require':'Set'} variable: ${name}`));row.append(label);box.append(row);
  let value=condition?(target.preconditions?.find(p=>p.variable===name)?.equals??initial):(target.setVariables?.[name]??initial);
  const apply=()=>{if(condition){target.preconditions=(target.preconditions??[]).filter(p=>p.variable!==name);if(enabled.checked)target.preconditions.push({variable:name,equals:value});}else{target.setVariables??={};if(enabled.checked)target.setVariables[name]=value;else delete target.setVariables[name];}changed();};
  const input=valueControl(row,`${condition?'Required':'Assigned'} value: ${name}`,value,v=>{value=v;apply();});input.disabled=!enabled.checked;enabled.onchange=()=>{input.disabled=!enabled.checked;apply();};
 }
}
