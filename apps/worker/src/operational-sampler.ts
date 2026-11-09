import {createHmac} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {ServiceBusReceiver} from '@azure/service-bus';
import Long from 'long';

/** No content, tenant IDs, message bodies, raw correlations or exception strings leave this sampler. */
export function createOperationalQueueSampler(options:{outboxPool:Pool;applicationPool:Pool;receiver:Pick<ServiceBusReceiver,'peekMessages'>;secret:string;sink?:(line:string)=>void;now?:()=>number}){
  if(options.secret.length<32)throw Error('OPERATIONAL_KEY_SECRET_REQUIRED');
  let nextAt=0,inFlight=false;
  const now=options.now??Date.now,sink=options.sink??console.log;
  const emit=(event:Record<string,string|number|boolean|null>)=>{try{sink(JSON.stringify({service:'worker',entryPoint:'maintenance',...event}));}catch{/* Do not fail worker maintenance when the log transport fails. */}};
  return async()=>{
    if(inFlight||now()<nextAt)return;
    inFlight=true;nextAt=now()+60000;
    try{
      let client:PoolClient|undefined;
      try{
        client=await options.outboxPool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout='2000ms'");
        const result=await client.query(`SELECT state,available_at FROM processing_job_outbox WHERE state IN ('PENDING','CLAIMED','FAILED') ORDER BY available_at LIMIT 10001`);
        await client.query('COMMIT');
        const sampled=result.rows.slice(0,10000);
        const due=sampled.filter(row=>row.state!=='FAILED'&&Date.parse(row.available_at)<=now());
        emit({event:'queue_snapshot',outboxPendingSampled:due.length,outboxFailedSampled:sampled.filter(row=>row.state==='FAILED').length,outboxOldestAgeSeconds:due.length?Math.max(0,Math.floor((now()-Date.parse(due[0].available_at))/1000)):0,truncated:result.rows.length>10000});
      }catch{if(client)await client.query('ROLLBACK').catch(()=>{});emit({event:'operational_snapshot_failed',domain:'outbox'});}
      finally{try{client?.release();}catch{emit({event:'operational_snapshot_failed',domain:'outbox-release'});}}
      try{
        const messages=await options.receiver.peekMessages(32,{fromSequenceNumber:Long.ZERO,abortSignal:AbortSignal.timeout(2000)});
        const eligible=messages.filter(message=>message.state==='active'&&(!message.expiresAtUtc||message.expiresAtUtc.getTime()>now())&&(!message.scheduledEnqueueTimeUtc||message.scheduledEnqueueTimeUtc.getTime()<=now())&&message.enqueuedTimeUtc&&Number.isFinite(message.enqueuedTimeUtc.getTime())&&message.enqueuedTimeUtc.getTime()<=now());
        const oldest=eligible.map(message=>({message,eligibleAt:Math.max(message.enqueuedTimeUtc!.getTime(),message.scheduledEnqueueTimeUtc?.getTime()??0)})).sort((a,b)=>a.eligibleAt-b.eligibleAt)[0];
        const message=oldest?.message;
        const enqueue=oldest?.eligibleAt;
        const correlation=typeof message?.correlationId==='string'?message.correlationId:undefined;
        emit({event:'broker_age_snapshot',oldestObservedActiveAgeSeconds:enqueue===undefined?null:Math.max(0,Math.floor((now()-enqueue)/1000)),hasEligibleActiveMessage:Boolean(message),observation:message?'ACTIVE_FOUND':'NO_ELIGIBLE_IN_SAMPLE',sampledMessages:messages.length,truncated:messages.length>=32,...(correlation?{oldestCorrelationHash:createHmac('sha256',options.secret).update(correlation).digest('hex')}:{})});
      }catch{emit({event:'operational_snapshot_failed',domain:'broker'});}
      emit({event:'db_pool_snapshot',total:options.applicationPool.totalCount,idle:options.applicationPool.idleCount,waiting:options.applicationPool.waitingCount});
    }finally{inFlight=false;}
  };
}
