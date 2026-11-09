export type Schema = Record<string, any>;
export type Choice = {value: string; label: string};
export const friendly = (value: string) => ({courseVersionId:'Course draft',assetVersionId:'Source version',modelVersionId:'3D model',releaseId:'Published course',learnerId:'Learner',revision:'Saved version',keyId:'Signing key name',validAfter:'Accept tokens issued after'} as Record<string,string>)[value] ?? value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./, letter=>letter.toUpperCase());
const item = <K extends keyof HTMLElementTagNameMap>(tag: K, text='') => {const node=document.createElement(tag);node.textContent=text;return node;};
export function resolveSchema(schema: Schema, contract: Schema): Schema {
  if (!schema?.$ref) return schema ?? {};
  if (!schema.$ref.startsWith('#/components/schemas/')) throw Error('Unsupported service form definition.');
  return {...contract.components?.schemas?.[schema.$ref.split('/').at(-1)],...Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='$ref'))};
}
export function createServiceForm(host: HTMLElement, schema: Schema, contract: Schema, options: {choices?:Record<string,Choice[]>; defaults?:Schema} = {}) {
  const build = (parent: HTMLElement, raw: Schema, name: string, required: boolean, saved: any, depth: number): (()=>any) => {
    const shape=resolveSchema(raw,contract), title=shape.title ?? friendly(name);
    if(depth>7)throw Error('This nested setting uses the full editor.');
    if(shape.oneOf || shape.anyOf){
      const variants=(shape.oneOf??shape.anyOf).filter((s:Schema)=>s.type!=='null'), select=item('select'), group=item('fieldset');
      const label=item('label',title); label.append(select);parent.append(label,group);
      for(const [index,variant]of variants.entries()){const s=resolveSchema(variant,contract);select.add(new Option(s.title??friendly(String(s.properties?.kind?.const??s.properties?.type?.const??`Option ${index+1}`)),String(index)));}
      const selected=variants.findIndex((variant:Schema)=>{const properties=resolveSchema(variant,contract).properties??{};return saved&&Object.entries(properties).some(([key,value])=>(value as Schema).const!==undefined&&saved[key]===(value as Schema).const);});if(selected>=0)select.value=String(selected);
      let read:()=>any;const render=()=>{group.replaceChildren();read=build(group,variants[Number(select.value)],name,required,saved,depth+1);};select.onchange=render;render();return()=>read();
    }
    const type=Array.isArray(shape.type)?shape.type.find((v:string)=>v!=='null'):shape.type??(shape.properties?'object':'string');
    if(type==='object'){
      const group=item('fieldset'); if(depth)group.append(item('legend',title));parent.append(group);
      const readers=new Map<string,()=>any>();
      for(const [key,child]of Object.entries(shape.properties??{})){
        const field=resolveSchema(child as Schema,contract), needed=(shape.required??[]).includes(key), value=saved?.[key]??options.defaults?.[key];
        if(!needed && value===undefined && field.default===undefined && field.const===undefined){
          const include=item('input'); include.type='checkbox';const label=item('label');label.className='check';label.append(include,document.createTextNode(`Set ${friendly(key).toLowerCase()}`));const section=item('div');section.hidden=true;group.append(label,section);
          let read:(()=>any)|undefined;include.onchange=()=>{section.hidden=!include.checked;section.replaceChildren();read=include.checked?build(section,field,key,false,undefined,depth+1):undefined;};readers.set(key,()=>include.checked?read?.():undefined);
        }else readers.set(key,build(group,field,key,needed,value,depth+1));
      }
      const extra:Array<{key:HTMLInputElement;read:()=>any;row:HTMLElement}>=[];
      if(shape.additionalProperties && typeof shape.additionalProperties==='object'){
        const add=item('button','Add setting');add.type='button';group.append(add);
        add.onclick=()=>{const row=item('fieldset'),label=item('label','Setting name'),key=item('input');key.required=true;label.append(key);row.append(label);const read=build(row,shape.additionalProperties,'Value',true,undefined,depth+1);const remove=item('button','Remove setting');remove.type='button';row.append(remove);group.insertBefore(row,add);const entry={key,read,row};extra.push(entry);remove.onclick=()=>{extra.splice(extra.indexOf(entry),1);row.remove();};};
      }
      return()=>{const result=Object.fromEntries([...readers].map(([key,read])=>[key,read()]).filter(([,value])=>value!==undefined));for(const entry of extra){const key=entry.key.value.trim();if(!key||['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(result,key))throw Error('Use unique setting names.');Object.defineProperty(result,key,{value:entry.read(),enumerable:true});}return result;};
    }
    if(type==='array'){
      const group=item('fieldset');group.append(item('legend',title));parent.append(group);const child=resolveSchema(shape.items??{},contract), values=saved??shape.default??[];
      if(child.enum){const boxes=child.enum.map((value:string)=>{const box=item('input');box.type='checkbox';box.value=value;box.checked=values.includes(value);const label=item('label');label.className='check';label.append(box,document.createTextNode(friendly(value)));group.append(label);return box;});return()=>{const result=boxes.filter((box:HTMLInputElement)=>box.checked).map((box:HTMLInputElement)=>box.value);if(result.length<(shape.minItems??0))throw Error(`Choose ${title.toLowerCase()}.`);return result;};}
      if(child.type!=='object'&&!child.properties&&!child.$ref){const label=item('label','One value per line'),input=item('textarea');input.value=values.join('\n');label.append(input);group.append(label);return()=>{const result=input.value.split('\n').map(v=>v.trim()).filter(Boolean);if(result.length<(shape.minItems??0)||result.length>(shape.maxItems??64))throw Error(`Check the number of ${title.toLowerCase()}.`);return result.map(v=>child.type==='number'||child.type==='integer'?Number(v):v);};}
      const rows:Array<{read:()=>any;row:HTMLElement}>=[],add=item('button','Add item');add.type='button';group.append(add);
      const append=(value?:any)=>{if(rows.length>=(shape.maxItems??64))return;const row=item('fieldset'),read=build(row,child,'Item',true,value,depth+1),remove=item('button','Remove item');remove.type='button';row.append(remove);group.insertBefore(row,add);const entry={read,row};rows.push(entry);remove.onclick=()=>{rows.splice(rows.indexOf(entry),1);row.remove();};};for(const value of values)append(value);while(rows.length<(shape.minItems??0))append();add.onclick=()=>append();return()=>{if(rows.length<(shape.minItems??0))throw Error(`Add ${title.toLowerCase()}.`);return rows.map(row=>row.read());};
    }
    const label=item('label',title), value=saved??shape.default??shape.const;
    let control:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
    const choices=options.choices?.[name];
    if(shape.enum || choices?.length){const select=item('select');const list=shape.enum?.map((v:any)=>({value:String(v),label:friendly(String(v))}))??choices!;if(!required)select.add(new Option('Not set',''));for(const option of list)select.add(new Option(option.label,option.value));if(value!==undefined)select.value=String(value);control=select;}
    else if(type==='boolean'){const box=item('input');box.type='checkbox';box.checked=value===true;control=box;label.className='check';}
    else if(['reason','message','description','rationale','text','narration','prompt'].includes(name)){const area=item('textarea');area.value=String(value??(name==='reason'?'Updated after reviewing the current settings.':''));area.maxLength=shape.maxLength??2000;control=area;}
    else{const input=item('input');input.type=type==='number'||type==='integer'?'number':shape.format==='email'?'email':shape.format==='date-time'?'datetime-local':'text';input.value=String(value??(name==='revision'?0:input.type==='number'?shape.minimum??0:''));if(input.type==='datetime-local'&&value){const date=new Date(value);if(Number.isFinite(date.getTime()))input.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}if(input.type==='number'){input.min=String(shape.minimum??-2147483648);input.max=String(shape.maximum??2147483647);input.step=type==='integer'?'1':'any';}if(shape.pattern)input.pattern=`.*(?:${shape.pattern}).*`;if(shape.maxLength)input.maxLength=shape.maxLength;control=input;}
    control.required=required&&type!=='boolean';if(shape.const!==undefined){control.disabled=true;}
    control.dataset.field=name;label.append(control);parent.append(label);if(shape.description)parent.append(item('small',shape.description));
    return()=>{if(shape.const!==undefined)return shape.const;if(type==='boolean')return(control as HTMLInputElement).checked;const value=control.value.trim();if(!required&&!value)return undefined;if(type==='integer'||type==='number'){const number=Number(value);if(!Number.isFinite(number)||(type==='integer'&&!Number.isInteger(number)))throw Error(`Enter a valid ${title.toLowerCase()}.`);return number;}if(shape.format==='date-time'&&value)return new Date(value).toISOString();return value;};
  };
  const read=build(host,schema,'Settings',true,options.defaults,0);return {read};
}
