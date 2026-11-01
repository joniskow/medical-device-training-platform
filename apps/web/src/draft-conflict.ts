const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
export function renderDraftConflict(host:HTMLElement,base:Record<string,unknown>,local:Record<string,unknown>,saved:Record<string,unknown>,baseRevision:number,savedRevision:number){
 host.replaceChildren();const heading=document.createElement('h4');heading.textContent=`Compare edits: loaded revision ${baseRevision}, latest saved revision ${savedRevision}`;heading.tabIndex=-1;host.append(heading);
 const message=document.createElement('p');message.textContent='Your unsaved edits remain in the editor. This comparison does not merge or save changes. Copy any edits you need before using Discard edits and reload saved course.';host.append(message);
 const names=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(saved)]);let count=0;
 for(const name of names){
  const original=JSON.stringify(canonical(base[name])),mine=JSON.stringify(canonical(local[name])),latest=JSON.stringify(canonical(saved[name]));
  if(mine===latest)continue;count++;
  const details=document.createElement('details'),summary=document.createElement('summary');
  const label=({title:'Course title',modules:'Modules and activities',model:'Model binding',simulation:'Simulation',policy:'Certification requirements',story:'Story',_source:'Source provenance'} as Record<string,string>)[name]??name;
  summary.textContent=`${label}: ${mine!==original&&latest!==original?'changed in both versions':mine!==original?'your local changes':'changed in saved version'}`;details.append(summary);
  for(const [caption,value] of [['Originally loaded',base[name]],['Your unsaved edits',local[name]],['Latest saved version',saved[name]]] as const){const title=document.createElement('p'),pre=document.createElement('pre');title.textContent=caption;pre.textContent=JSON.stringify(value,null,2)??'(not present)';pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';details.append(title,pre);}
  host.append(details);
 }
 if(!count){const empty=document.createElement('p');empty.textContent='Your content matches the latest saved version. Reload to adopt its revision.';host.append(empty);}
 heading.focus();
}
