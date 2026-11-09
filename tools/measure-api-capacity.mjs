import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const base=new URL(process.env.CAPACITY_API_URL??'http://127.0.0.1:8080');
if(base.username||base.password||base.search||base.hash)throw Error('CAPACITY_URL_INVALID');
if(!['127.0.0.1','localhost'].includes(base.hostname) && (base.protocol!=='https:'||process.env.CAPACITY_APPROVED_HOST!==base.hostname))throw Error('REMOTE_CAPACITY_REQUIRES_EXACT_APPROVED_HTTPS_HOST');
const integer=(key,fallback,max)=>{const raw=process.env[key]??String(fallback);if(!/^[1-9]\d*$/.test(raw)||Number(raw)>max)throw Error(`CAPACITY_INVALID:${key}`);return Number(raw);};
const concurrency=integer('CAPACITY_CONCURRENCY',4,20), requests=integer('CAPACITY_REQUESTS',100,1000);
const path=process.env.CAPACITY_PATH??'/readyz';
if(!/^\/[a-zA-Z0-9/_-]{1,150}$/.test(path))throw Error('CAPACITY_PATH_INVALID');
const p95Target=integer('CAPACITY_P95_TARGET_MS',2000,120000);
const startedAt=new Date().toISOString();
const results=[];let next=0;
await Promise.all(Array.from({length:concurrency},async()=>{
  while(next++<requests){
    const started=performance.now();
    try{
      const response=await fetch(new URL(path,base),{method:'GET',headers:{'x-correlation-id':randomUUID(),...(process.env.CAPACITY_BEARER_TOKEN?{authorization:`Bearer ${process.env.CAPACITY_BEARER_TOKEN}`}:{})},signal:AbortSignal.timeout(10000),redirect:'error'});
      await response.arrayBuffer();
      results.push({status:response.status,durationMs:Math.round(performance.now()-started)});
    }catch{results.push({status:0,durationMs:Math.round(performance.now()-started)});}
  }
}));
const durations=results.map(item=>item.durationMs).sort((a,b)=>a-b);
const report={schemaVersion:'api-capacity.v1',startedAt,finishedAt:new Date().toISOString(),concurrency,requests,path,p95Ms:durations[Math.ceil(durations.length*.95)-1],statusCounts:results.reduce((all,item)=>({...all,[item.status]:(all[item.status]??0)+1}),{}),targetP95Ms:p95Target};
report.passed=results.every(item=>item.status>=200&&item.status<300)&&report.p95Ms<=p95Target;
await writeFile(process.env.CAPACITY_OUTPUT??`output/api-capacity-${Date.now()}.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
if(!report.passed)process.exitCode=1;
