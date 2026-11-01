export type ApprovedMedia={assetVersionId:string;fileName:string;type:'image'|'video';contentType:string};
/** Only the explicit selected version is added to the draft; no private URL is requested. */
export function renderMediaPicker(parent:HTMLElement,options:{type?:'image'|'video';active:()=>boolean;load:(after?:string)=>Promise<{items:ApprovedMedia[];nextCursor?:string}>;select:(asset:ApprovedMedia)=>void}){
 const box=document.createElement('fieldset');box.dataset.mediaPicker='true';const legend=document.createElement('legend');legend.textContent=options.type?'Replace media binding':'Add image or video activity';box.append(legend);
 const label=document.createElement('label');label.textContent='Approved media';const select=document.createElement('select');select.add(new Option('Load and choose an approved asset',''));label.append(select);box.append(label);
 const load=document.createElement('button'),add=document.createElement('button');load.type=add.type='button';load.textContent='Load approved media';add.textContent=options.type?'Replace selected media':'Add selected media';add.disabled=true;
 const status=document.createElement('p');status.setAttribute('role','status');box.append(load,add,status);parent.append(box);
 let cursor:string|undefined,busy=false;const assets=new Map<string,ApprovedMedia>();
 const active=()=>box.isConnected&&options.active();
 select.onchange=()=>{add.disabled=!assets.has(select.value);};
 load.onclick=async()=>{
  if(busy)return;busy=true;load.disabled=true;
  try{
   const page=await options.load(cursor);if(!active())return;
   if(!cursor){assets.clear();select.replaceChildren(new Option('Choose an approved asset',''));add.disabled=true;}
   for(const item of page.items){if(options.type&&options.type!==item.type)continue;if(!assets.has(item.assetVersionId))select.add(new Option(`${item.fileName} (${item.type})`,item.assetVersionId));assets.set(item.assetVersionId,item);}
   cursor=page.nextCursor;load.textContent=cursor?'Load more approved media':'Refresh approved media';status.textContent=assets.size?'Choose a version, then review its description or transcript.':'No matching approved media is available.';
  }catch(error){if(active())status.textContent=error instanceof Error?error.message:'Media could not be loaded. Retry.';}
  finally{if(active()){busy=false;load.disabled=false;}}
 };
 add.onclick=()=>{
  const item=assets.get(select.value);if(!active()||!item)return;
  if(options.type&&!window.confirm('Replace the media asset version? Review its description or transcript before publication.'))return;
  options.select(item);
 };
}
