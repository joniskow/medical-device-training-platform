export {};
const publicId=new URL(location.href).searchParams.get('credential')??'';
const status=document.querySelector<HTMLElement>('#status')!,record=document.querySelector<HTMLElement>('#record')!,retry=document.querySelector<HTMLButtonElement>('#retry')!;
function add(tag:string,value:string){const node=document.createElement(tag);node.textContent=value;record.append(node);return node;}
async function verify(){
  retry.disabled=true;record.hidden=true;record.replaceChildren();status.textContent='Checking the record…';
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(publicId)){status.textContent='This verification link is not valid.';return;}
    const response=await fetch(`/api/v1/verify/${publicId}`,{cache:'no-store',credentials:'omit'});
    const data=await response.json();
    if(!response.ok){status.textContent=response.status===404?'This verification record is not available.':response.status===429?'Too many requests. Please wait a minute before checking again.':'Verification is temporarily unavailable. Please try again.';return;}
    add('h2',data.courseTitle);add('p',`Issued by ${data.issuerName}`);add('p',data.status).className='state';
    add('p',`Issued ${new Date(data.issuedAt).toLocaleDateString()}. ${data.expiresAt?`Expires ${new Date(data.expiresAt).toLocaleDateString()}.`:'No expiration date.'}`);
    add('p',`Checked ${new Date(data.verifiedAt).toLocaleString()}.`);add('p',data.intendedUse);
    record.hidden=false;status.textContent=data.status==='ACTIVE'?'The issuer’s record is currently active.':'This credential is not currently active.';
  }catch{status.textContent='Unable to check the record. Please try again when connected.';}finally{retry.disabled=false;}
}
retry.onclick=()=>void verify();void verify();
