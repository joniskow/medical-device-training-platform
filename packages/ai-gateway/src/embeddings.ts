import {createHash,randomUUID} from 'node:crypto';
import {validateEmbedding,type SourceEmbeddingProvider,type TenantContext,type SourceUsageReceipt} from '@medical-device/contracts';

export function createAzureEmbeddingProvider(env:Readonly<Record<string,string|undefined>>,options?:{fetch?:typeof fetch;onUsage?:(tenant:TenantContext,receipt:SourceUsageReceipt)=>Promise<unknown>;admit?:<T>(tenant:TenantContext,action:()=>Promise<T>)=>Promise<T>}):SourceEmbeddingProvider|undefined{
 if(env.RETRIEVAL_MODE===undefined||env.RETRIEVAL_MODE==='lexical')return undefined;
 if(env.RETRIEVAL_MODE!=='hybrid')throw Error('RETRIEVAL_CONFIGURATION_INVALID');
 const required=(name:string)=>{const value=env[name]?.trim();if(!value)throw Error('EMBEDDING_CONFIGURATION_REQUIRED:'+name);return value;};
 const endpoint=new URL(required('AZURE_EMBEDDING_ENDPOINT'));
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.openai.azure.com')||endpoint.port||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('EMBEDDING_ENDPOINT_INVALID');
 const deployment=required('AZURE_EMBEDDING_DEPLOYMENT'),model=required('AZURE_EMBEDDING_MODEL'),key=required('AZURE_EMBEDDING_API_KEY');
 if(!/^[A-Za-z0-9._-]{1,128}$/.test(deployment)||!/^text-embedding-3-(small|large)$/.test(model))throw Error('EMBEDDING_CONFIGURATION_INVALID');
 const configurationId='azure-embedding:'+createHash('sha256').update(JSON.stringify([endpoint.origin,deployment,model,'v1',1536])).digest('hex');
 return {configurationId,dimensions:1536,async embed(tenant,texts){
  if(!texts.length||texts.length>16||texts.some(text=>!text.trim()||Buffer.byteLength(text,'utf8')>6000))throw Error('EMBEDDING_INPUT_INVALID');
  const execute=async()=>{
   const receiptId=randomUUID(),started=performance.now();
   const record=(phase:SourceUsageReceipt['phase'],metrics:SourceUsageReceipt['metrics'])=>options?.onUsage?.(tenant,{receiptId,operation:'provider.embeddings',provider:'azure-openai-embeddings',phase,metrics});
   await record('STARTED',{calls:1,input_characters:texts.reduce((count,text)=>count+text.length,0)});
   let completed=false;
   try{
   const response=await (options?.fetch??fetch)(new URL('/openai/v1/embeddings',endpoint),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'api-key':key,'content-type':'application/json'},body:JSON.stringify({model:deployment,input:texts,dimensions:1536,encoding_format:'float'})});
   if(!response.ok)throw Error('EMBEDDING_PROVIDER_UNAVAILABLE');
   if(Number(response.headers.get('content-length')??0)>2*1024*1024)throw Error('EMBEDDING_RESPONSE_TOO_LARGE');
   const reader=response.body?.getReader();if(!reader)throw Error('EMBEDDING_RESPONSE_INVALID');
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2*1024*1024)throw Error('EMBEDDING_RESPONSE_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel();}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {data?:Array<{index:number;embedding:number[]}>;usage?:{prompt_tokens?:number}};
   if(!Array.isArray(value.data)||value.data.length!==texts.length)throw Error('EMBEDDING_RESPONSE_INVALID');
   const result:Array<readonly number[]>=new Array(texts.length);
   for(const item of value.data){if(!Number.isInteger(item.index)||item.index<0||item.index>=texts.length||result[item.index]||!Array.isArray(item.embedding))throw Error('EMBEDDING_RESPONSE_INVALID');validateEmbedding(item.embedding);result[item.index]=item.embedding;}
   completed=true;
   await record('SUCCEEDED',{calls:1,input_characters:texts.reduce((count,text)=>count+text.length,0),duration_ms:Math.round(performance.now()-started),...(Number.isSafeInteger(value.usage?.prompt_tokens)&&value.usage!.prompt_tokens!>=0?{input_tokens:value.usage!.prompt_tokens!}:{})});
   return result;
   }catch(error){if(!completed)await record('FAILED',{duration_ms:Math.round(performance.now()-started)});throw error;}
  };
  return options?.admit?options.admit(tenant,execute):execute();
 }};
}
