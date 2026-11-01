import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { AssetProcessorPort, KnowledgeStorePort, PrivateObjectStoragePort, DocumentChunk } from "@medical-device/contracts";

function extract(bytes: Uint8Array, assetId: string, python: string): Promise<{error?:string;pageCount:number;chunks:DocumentChunk[];emptyPages:number[];ocrPages?:Array<{page:number;meanConfidence:number;language:string}>;warnings?:Array<{page:number;code:string}>}> {
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[fileURLToPath(new URL('./extract-pdf.py',import.meta.url)),assetId],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const output:Buffer[]=[];let size=0,settled=false;
  const timer=setTimeout(()=>{child.kill();finish(new Error('PDF_EXTRACTOR_TIMEOUT'));},90000);
  function finish(error?:Error){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else{try{resolve(JSON.parse(Buffer.concat(output).toString('utf8')));}catch{reject(new Error('PDF_EXTRACTOR_RESPONSE_INVALID'));}}}
  child.on('error',()=>finish(new Error('PDF_EXTRACTOR_UNAVAILABLE')));
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16*1024*1024){child.kill();finish(new Error('PDF_EXTRACTOR_OUTPUT_LIMIT'));}else output.push(chunk);});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('close',code=>finish(code===0?undefined:new Error('PDF_EXTRACTOR_PROCESS_FAILED')));
  child.stdin.end(bytes);
 });
}
export function createPdfAssetProcessor(input:{storage:PrivateObjectStoragePort;knowledge:KnowledgeStorePort;fallback:AssetProcessorPort;python?:string}):AssetProcessorPort {
 return {
  inspect:request=>request.sourceType==='pdf'?Promise.resolve({supported:request.contentType==='application/pdf'&&(request.sizeBytes??0)<=32*1024*1024,reasons:request.contentType==='application/pdf'?[]:['PDF_CONTENT_TYPE_INVALID']}):input.fallback.inspect(request),
  canProcess:request=>request.sourceType==='pdf'?Promise.resolve(true):input.fallback.canProcess(request),
  async process(request,job){
   if(request.sourceType!=='pdf')return input.fallback.process(request,job);
   const start=Date.now();
   const fail=(code:string)=>({adapter:'pdf-text-extraction',adapterVersion:'2',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[],status:'FAILED' as const,warnings:[],metrics:{durationMs:Date.now()-start},failure:{class:'VALIDATION' as const,code,message:'PDF extraction could not produce usable text: '+code}});
   if(!request.blobKey.startsWith(job.tenant.organizationId+'/'))return fail('BLOB_TENANT_MISMATCH');
   const object=await input.storage.readObject({blobKey:request.blobKey,maxBytes:32*1024*1024});
   if(createHash('sha256').update(object.bytes).digest('hex')!==request.sha256)return fail('CHECKSUM_MISMATCH');
   const document=await extract(object.bytes,request.inputAssetVersionId,input.python??process.env.PDF_PYTHON??'python3');
   if(document.error)return fail(document.error);
   if(!document.chunks.length)return fail(document.warnings?.find(w=>w.code.startsWith('PDF_OCR_'))?.code??'PDF_NO_READABLE_TEXT');
   const artifactId='document:'+request.inputAssetVersionId+':'+request.sha256;
   const blobKey=job.tenant.organizationId+'/derived/documents/'+encodeURIComponent(request.inputAssetVersionId)+'/'+request.sha256+'.json';
   const output=Buffer.from(JSON.stringify({schemaVersion:'document-extraction.v1',inputAssetVersionId:request.inputAssetVersionId,sourceSha256:request.sha256,...document}));
   await input.storage.putObject({blobKey,bytes:output,contentType:'application/json'});
   await input.knowledge.replaceForAssetVersion(job.tenant,request.inputAssetVersionId,document.chunks.map(chunk=>({...chunk,citation:{...chunk.citation},organizationId:job.tenant.organizationId,assetVersionId:request.inputAssetVersionId})));
   return {adapter:'pdf-text-extraction',adapterVersion:'2',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[artifactId],status:'REVIEW_REQUIRED',warnings:[...document.emptyPages.map(page=>({code:'PAGE_TEXT_MISSING',severity:'warning' as const,message:`Page ${page} has no extracted text. Review the original page before using this source.`})),...(document.warnings??[]).map(w=>({code:w.code,severity:'warning' as const,message:`Page ${w.page}: ${w.code.replaceAll('_',' ').toLowerCase()}. OCR text must be checked against the original page.`}))],metrics:{durationMs:Date.now()-start,inputBytes:object.bytes.length,outputBytes:output.length},details:{pageCount:document.pageCount,chunkCount:document.chunks.length,ocrPageCount:document.ocrPages?.length??0,extractionBlobKey:blobKey}};
  }
 };
}
