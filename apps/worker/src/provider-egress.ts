import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';

/** Conservative public-address policy; IPv4-mapped IPv6 and transition networks are denied. */
export function isPublicAddress(address:string):boolean {
  if(isIP(address)===4){
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
  }
  if(isIP(address)!==6)return false;
  const normalized=address.toLowerCase();
  // Public global-unicast only, excluding documentation/transition allocations.
  return /^[23]/.test(normalized)&&!normalized.startsWith('2001:')&&!normalized.startsWith('2002:')&&!normalized.startsWith('3fff:');
}
export function approvedUrl(value:string,origins:ReadonlySet<string>):URL {
  let url:URL;
  try{url=new URL(value);}catch{throw Error('PROVIDER_URL_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!origins.has(url.origin))throw Error('PROVIDER_DESTINATION_DENIED');
  if(isIP(url.hostname.replace(/^\[|\]$/g,''))&&!isPublicAddress(url.hostname.replace(/^\[|\]$/g,'')))throw Error('PROVIDER_DESTINATION_DENIED');
  return url;
}
export function approvedOrigin(value:string):string {
  const parsed=new URL(value);
  approvedUrl(value,new Set([parsed.origin]));
  return parsed.origin;
}
/** Resolve once, reject every unsafe answer, then pin the socket to a checked address. */
export async function boundedHttpsRequest(input:{url:string;origins:ReadonlySet<string>;headers?:Record<string,string>;method?:'GET'|'POST';body?:string;maxBytes:number;timeoutMs:number}):Promise<{bytes:Buffer;contentType:string}> {
  const url=approvedUrl(input.url,input.origins);
  if(!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1)throw Error('PROVIDER_LIMIT_INVALID');
  const deadline=Date.now()+input.timeoutMs;
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  let addresses;
  try{addresses=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('PROVIDER_TIMEOUT')),input.timeoutMs);})]);}finally{clearTimeout(dnsTimer);}
  if(!addresses.length||addresses.some(({address})=>!isPublicAddress(address)))throw Error('PROVIDER_DESTINATION_DENIED');
  const pinned=addresses[0];
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:input.method??'GET',headers:input.headers,agent:false,family:pinned.family,lookup:(_hostname,_options,callback)=>callback(null,pinned.address,pinned.family)},response=>{
      if(!response.statusCode||response.statusCode<200||response.statusCode>=300){response.destroy();reject(Error(`PROVIDER_HTTP_${response.statusCode??0}`));return;}
      const length=Number(response.headers['content-length']??0);
      if(!Number.isFinite(length)||length>input.maxBytes){response.destroy();reject(Error('PROVIDER_RESPONSE_TOO_LARGE'));return;}
      let size=0;const chunks:Buffer[]=[];
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>input.maxBytes){response.destroy(Error('PROVIDER_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>resolve({bytes:Buffer.concat(chunks),contentType:String(response.headers['content-type']??'')}));
    });
    const timer=setTimeout(()=>req.destroy(Error('PROVIDER_TIMEOUT')),Math.max(1,deadline-Date.now()));
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);
    req.end(input.body);
  });
}
