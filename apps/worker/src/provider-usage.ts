import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {TenantContext,SourceUsageReceipt,SpeechSynthesisPort,OpenMontageProviderPort,ReconstructionEngine} from '@medical-device/contracts';

export type SourceUsageRecorder=(tenant:TenantContext,receipt:SourceUsageReceipt)=>Promise<unknown>;
const context=new AsyncLocalStorage<TenantContext>();
export const withProviderUsageContext=<T>(tenant:TenantContext,action:()=>Promise<T>):Promise<T>=>context.run(tenant,action);

async function measured<T>(record:SourceUsageRecorder,operation:SourceUsageReceipt['operation'],provider:string,startedMetrics:SourceUsageReceipt['metrics'],action:()=>Promise<T>,finishedMetrics:(result:T)=>SourceUsageReceipt['metrics']):Promise<T>{
  const tenant=context.getStore();
  if(!tenant)throw Error('SOURCE_USAGE_CONTEXT_REQUIRED');
  const receiptId=randomUUID(),started=performance.now();
  const emit=(phase:SourceUsageReceipt['phase'],metrics:SourceUsageReceipt['metrics'])=>record(tenant,{receiptId,phase,operation,provider,metrics});
  await emit('STARTED',{calls:1,...startedMetrics});
  let result:T;
  try{result=await action();}catch(error){await emit('FAILED',{duration_ms:Math.round(performance.now()-started)});throw error;}
  await emit('SUCCEEDED',{calls:1,duration_ms:Math.round(performance.now()-started),...finishedMetrics(result)});
  return result;
}
export function createMeteredSpeechProvider(raw:SpeechSynthesisPort,record:SourceUsageRecorder):SpeechSynthesisPort{
  return {synthesize:request=>measured(record,'provider.speech','azure-speech',{input_characters:request.text.length},()=>raw.synthesize(request),result=>({input_characters:request.text.length,audio_ms:Math.round(result.audio.durationSeconds*1000),output_bytes:result.audio.bytes.byteLength}))};
}
export function createMeteredVideoProvider(raw:OpenMontageProviderPort,record:SourceUsageRecorder):OpenMontageProviderPort{
  return {generate:request=>measured(record,'provider.video','openmontage',{video_ms:Math.round(request.durationSeconds*1000)},()=>raw.generate(request),result=>({video_ms:Math.round(result.video.durationSeconds*1000),output_bytes:result.video.bytes.byteLength}))};
}
export function createMeteredReconstructionEngine(raw:ReconstructionEngine,record:SourceUsageRecorder):ReconstructionEngine{
  return {...raw,generate:request=>measured(record,'provider.reconstruction','reconstruction-engine',{},()=>raw.generate(request),()=>({}))};
}
