export function renderSourceReview(host:HTMLElement,options:{subject?:'media';active:()=>boolean;save:(input:{decision:'APPROVE'|'REJECT';rationale:string;confirmed:true},key:string)=>Promise<{state:string}>;refresh:()=>Promise<void>}){
  host.replaceChildren();
  const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=options.subject==='media'?'Review uploaded media':'Review source document';group.append(legend);
  const note=document.createElement('p');note.textContent=options.subject==='media'?'Inspect the media before approving it for course use. This decision is recorded with your account.':'Review the source passages before approving this document for publication. This decision is recorded with your account.';group.append(note);
  const label=document.createElement('label'),rationale=document.createElement('textarea');label.append('Source review rationale',rationale);rationale.maxLength=4000;group.append(label);
  const confirmLabel=document.createElement('label'),confirmed=document.createElement('input');confirmed.type='checkbox';confirmed.style.width='24px';confirmed.style.flex='0 0 24px';confirmLabel.style.display='flex';confirmLabel.style.alignItems='center';confirmLabel.style.gap='8px';confirmLabel.append(confirmed,'I have reviewed this source and confirm this decision.');group.append(confirmLabel);
  const status=document.createElement('p');status.setAttribute('role','status');
  let pending:{body:string;key:string}|undefined;
  for(const [decision,title] of [['APPROVE','Approve source'],['REJECT','Reject source']] as const){
    const button=document.createElement('button');button.type='button';button.textContent=title;
    button.onclick=async()=>{
      if(!options.active())return;
      if(!confirmed.checked||!rationale.value.trim()){status.textContent='Add a rationale and confirm that you reviewed the source.';return;}
      const input={decision,rationale:rationale.value.trim(),confirmed:true as const},body=JSON.stringify(input);
      if(pending?.body!==body)pending={body,key:`source-review:${crypto.randomUUID()}`};
      group.disabled=true;
      try{const result=await options.save(input,pending!.key);if(!options.active())return;status.textContent=`Source ${result.state.toLowerCase()}. Decision recorded.`;await options.refresh();}
      catch{if(options.active()){status.textContent='The decision could not be saved. Check reviewer permissions or refresh the source, then retry.';group.disabled=false;}}
    };group.append(button);
  }
  host.append(group,status);
}
