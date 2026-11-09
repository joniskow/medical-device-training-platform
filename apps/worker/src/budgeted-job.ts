import {createHmac} from 'node:crypto';
import type {JobRecord, JobStorePort, TenantContext} from '@medical-device/contracts';
import {withOperationalAdmission, type createOperationsStore} from '@medical-device/db';
import {withProviderUsageContext,type SourceUsageRecorder} from './provider-usage.js';

export interface BudgetedJobInput {tenant:TenantContext;jobId:string;workerId:string;}

/** Consumer invokes this before claim/provider work. Existing job lease generation remains
 * the authority for final writes; the budget lease independently fences shared admission. */
export function createBudgetedJobHandler(input: {
  store:ReturnType<typeof createOperationsStore>;
  jobStore:JobStorePort;
  secret:string;
  estimateCents:number|((job:JobRecord<unknown>)=>number);
  handler:(input:BudgetedJobInput & {signal:AbortSignal})=>Promise<JobRecord<unknown>|null>;
  sink?:(line:string)=>void;
  recordUsage?:SourceUsageRecorder;
}) {
  if(input.secret.length<32)throw Error('OPERATIONAL_KEY_SECRET_REQUIRED');
  const emit=(event:string,job:JobRecord<unknown>,durationMs?:number,jobState?:string,code?:string)=>{
    const correlationHash=createHmac('sha256',input.secret).update(job.tenant.correlationId).digest('hex');
    const jobType=/^[a-zA-Z0-9_.-]{1,80}$/.test(job.jobType)?job.jobType:'unknown';
    const candidateType=job.payload&&typeof job.payload==='object'&&'sourceType' in job.payload?String(job.payload.sourceType):'other';
    const sourceType=['pdf','image','video','gltf','glb'].includes(candidateType)?candidateType:'other';
    try{(input.sink??console.log)(JSON.stringify({event,service:'worker',entryPoint:'queue',correlationHash,jobType,sourceType,...(code&&/^ADMISSION_[A-Z_]{1,40}$/.test(code)?{code}:{}),...(jobState&&['QUEUED','RUNNING','RETRY_SCHEDULED','SUCCEEDED','FAILED','DEAD_LETTERED'].includes(jobState)?{jobState}:{}),...(durationMs===undefined?{}:{durationMs:Math.max(0,Math.min(86400000,durationMs))})}));}catch{/* Logging cannot invalidate a successful fenced job outcome. */}
  };
  return async(request:BudgetedJobInput):Promise<JobRecord<unknown>|null>=>{
    const job=await input.jobStore.get<unknown>(request.tenant,request.jobId);
    if(!job)return null;
    if(['SUCCEEDED','FAILED','DEAD_LETTERED'].includes(job.state))return job;
    if(job.state==='RUNNING' && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt)>Date.now())throw Error('ADMISSION_BUSY');
    if(Date.parse(job.availableAt)>Date.now())throw Error('ADMISSION_NOT_AVAILABLE');
    const estimate=typeof input.estimateCents==='function'?input.estimateCents(job):input.estimateCents;
    if(!Number.isSafeInteger(estimate)||estimate<1||estimate>50000)throw Error('JOB_COST_RESERVATION_INVALID');
    // updatedAt distinguishes an explicit operator retry which resets attempt to one.
    // Never use a random key: identical signed queue redeliveries share this reservation.
    const key='job:'+createHmac('sha256',input.secret).update(JSON.stringify([job.tenant.organizationId,job.jobId,job.attempt,job.leaseGeneration??0,job.updatedAt])).digest('hex');
    const started=performance.now();
    return withOperationalAdmission({
      store:input.store,key,estimateCents:estimate,
      onWarning:()=>emit('budget_threshold',job),
      action:async signal=>{
        signal.throwIfAborted();
        const usageId=key;
        if(input.recordUsage)await input.recordUsage(job.tenant,{receiptId:usageId,operation:'processing.job',provider:'worker',phase:'STARTED',metrics:{calls:1}});
        try {
          const result=await withProviderUsageContext(job.tenant,()=>input.handler({...request,signal}));
          signal.throwIfAborted();
          if(input.recordUsage)await input.recordUsage(job.tenant,{receiptId:usageId,operation:'processing.job',provider:'worker',phase:result?.state==='SUCCEEDED'?'SUCCEEDED':'FAILED',metrics:{calls:1,duration_ms:Math.round(performance.now()-started),...(result?.outcome?.metrics.inputBytes===undefined?{}:{input_bytes:result.outcome.metrics.inputBytes}),...(result?.outcome?.metrics.outputBytes===undefined?{}:{output_bytes:result.outcome.metrics.outputBytes})}});
          emit(result?.state==='SUCCEEDED'?'job_finished':'job_failed',job,Math.round(performance.now()-started),result?.state);
          return result;
        }catch(error){
          // The same failed receipt may already have been committed; a storage failure after
          // provider success is an unknown outcome, so do not overwrite a prior final receipt.
          if(input.recordUsage)await input.recordUsage(job.tenant,{receiptId:usageId+':failure',operation:'processing.job',provider:'worker',phase:'FAILED',metrics:{duration_ms:Math.round(performance.now()-started)}});
          emit('job_failed',job,Math.round(performance.now()-started));throw error;
        }
      }
    }).catch(error=>{
      if(error instanceof Error&&/^ADMISSION_[A-Z_]{1,40}$/.test(error.message))emit('job_admission_denied',job,undefined,undefined,error.message);
      throw error;
    });
  };
}
