import { createHmac, randomUUID } from 'node:crypto';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { createOperationsStore } from '@medical-device/db';

type OperationsStore = ReturnType<typeof createOperationsStore>;
export type OperationalEvent = {event: 'api_request'|'api_admission_denied'|'readiness_failed'|'budget_threshold'|'job_finished'|'job_failed'; correlationId?: string;correlationHash?:string; entryPoint?: 'http'|'queue'|'operator'; status?: number; durationMs?: number; code?: string; jobType?: string; route?: string;routeGroup?:string;dbWaiting?:number;dbTotal?:number;dbIdle?:number};

/** Allowlist serialization: never pass requests, exceptions, URLs, subjects or provider payloads. */
export function emitOperationalEvent(event: OperationalEvent, sink: (line: string) => void = console.log): void {
  const safe: Record<string, string|number> = {event:event.event, service: 'api', entryPoint:event.entryPoint ?? 'http'};
  for (const key of ['correlationHash','code','jobType','route','routeGroup'] as const) {
    const value=event[key];
    if (value && /^[a-zA-Z0-9_:/.-]{1,128}$/.test(value)) safe[key]=value;
  }
  for (const key of ['status','durationMs','dbWaiting','dbTotal','dbIdle'] as const) {
    const value=event[key];
    if(Number.isSafeInteger(value)&&value!>=0&&value!<=(key==='status'?599:key==='durationMs'?86400000:100000))safe[key]=value!;
  }
  try{sink(JSON.stringify(safe));}catch{/* Telemetry outages must not alter an already completed HTTP response. */}
}

export function operationalRouteGroup(pathname:string):string{
  if(/\/publish$/.test(pathname))return 'publication';
  if(/credential/.test(pathname))return 'credentials';
  if(/verif/.test(pathname))return 'verification';
  if(/discover|inquir/.test(pathname))return 'discovery-inquiry';
  if(/account|auth|invitation|organization-context/.test(pathname))return 'identity';
  if(/upload|media|model|reconstruct|generat/.test(pathname))return 'content';
  if(/enroll|assessment|simulation|learning/.test(pathname))return 'learning';
  return 'other';
}

export function opaqueOperationalKey(secret: string, category: string, value: string): string {
  return `${category}:${createHmac('sha256',secret).update(value).digest('hex')}`;
}

function respond(response: ServerResponse, status: number, code: string) {
  if(response.headersSent || response.writableEnded) return;
  response.writeHead(status, {'content-type':'application/json','cache-control':'no-store',...(status===429?{'retry-after':'60'}:{})});
  response.end(JSON.stringify({error:{code,message:'The request cannot be processed. Retry later.'}}));
}

/** Install before listen(). Application handlers retain authority; edge limits apply even to
 * unknown routes and public endpoints. Proxy headers are deliberately not trusted. */
export function installOperationalHttp(server: Server, options: {store: OperationsStore; pool: Pool; secret: string; dependencyProbe: () => Promise<void>; maxBodyBytes?:number; timeoutMs?:number; sink?: (line:string)=>void}) {
  if(options.secret.length<32) throw new Error('OPERATIONAL_KEY_SECRET_REQUIRED');
  const handlers=server.listeners('request');
  server.removeAllListeners('request');
  const maxBytes=options.maxBodyBytes ?? 65536;
  const timeoutMs=options.timeoutMs ?? 30000;
  server.requestTimeout=timeoutMs;
  server.headersTimeout=Math.min(10000,timeoutMs);
  server.keepAliveTimeout=5000;
  server.maxHeadersCount=64;
  let draining=false;
  let readiness: {expires:number;promise:Promise<boolean>}|undefined;
  server.on('request', (request:IncomingMessage,response:ServerResponse) => {
    const started=performance.now();
    const supplied=request.headers['x-correlation-id'];
    const correlationId=typeof supplied==='string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(supplied)?supplied:`corr:${randomUUID()}`;
    request.headers['x-correlation-id']=correlationId;
    response.setHeader('x-correlation-id',correlationId);
    const pathname=(request.url??'/').split('?')[0];
    // Bounded dimension, never the path or query containing credential IDs/email addresses.
    const route=pathname==='/healthz'||pathname==='/readyz'?pathname:pathname.startsWith('/api/v1/')?'/api/v1/:resource':'/:resource';
    const emit=(event: OperationalEvent)=>emitOperationalEvent({...event,correlationHash:createHmac('sha256',options.secret).update(correlationId).digest('hex'),route,routeGroup:operationalRouteGroup(pathname)},options.sink);
    const timer=setTimeout(()=>{respond(response,504,'REQUEST_TIMEOUT');},timeoutMs);
    timer.unref();
    response.once('close',()=>clearTimeout(timer));
    response.once('finish',()=>emit({event:'api_request',status:response.statusCode,durationMs:Math.round(performance.now()-started),dbWaiting:options.pool.waitingCount,dbTotal:options.pool.totalCount,dbIdle:options.pool.idleCount}));
    void (async()=>{
      if(pathname==='/healthz' && request.method==='GET'){response.writeHead(200,{'content-type':'application/json'});response.end('{"status":"alive"}');return;}
      if(draining){respond(response,503,'SERVICE_DRAINING');return;}
      if(pathname==='/readyz' && request.method==='GET'){
        try {
          if(!readiness || readiness.expires<Date.now()) {
            readiness={expires:Date.now()+5000,promise:(async()=>{
              let readinessTimer:NodeJS.Timeout|undefined;
              try{return await Promise.race([(async()=>{if(!await options.store.ready())return false;await options.dependencyProbe();return true;})(),new Promise<boolean>(resolve=>{readinessTimer=setTimeout(()=>resolve(false),2000);})]);}
              catch{return false;}finally{if(readinessTimer)clearTimeout(readinessTimer);}
            })()};
          }
          if(!await readiness.promise)throw Error('NOT_READY');
          response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end('{"status":"ready"}');
        }catch{emit({event:'readiness_failed',code:'DEPENDENCY_UNAVAILABLE'});respond(response,503,'NOT_READY');}
        return;
      }
      const bodyLimit=request.method==='PUT' && /^\/api\/v1\/upload-sessions\/[^/]{1,256}\/content$/.test(pathname)?128*1024*1024:maxBytes;
      const length=request.headers['content-length'];
      if(length && (!/^\d+$/.test(length)||Number(length)>bodyLimit)){respond(response,413,'REQUEST_TOO_LARGE');request.resume();return;}
      let bytes=0;
      request.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>bodyLimit){respond(response,413,'REQUEST_TOO_LARGE');request.destroy();}});
      // Pause while admission executes; attaching a data listener otherwise consumes bytes before
      // the application's body reader is installed.
      request.pause();
      const sensitive=/verif|inquir|discover|upload|generat|auth|invitation/.test(pathname);
      const address=request.socket.remoteAddress??'unknown';
      const globalAllowed=await options.store.takeRate('http:global',6000);
      const addressAllowed=await options.store.takeRate(opaqueOperationalKey(options.secret,sensitive?'http:sensitive':'http:address',address),sensitive?30:120);
      if(!globalAllowed||!addressAllowed){emit({event:'api_admission_denied',code:'RATE_LIMITED'});respond(response,429,'RATE_LIMITED');request.resume();return;}
      if(response.writableEnded)return;
      for(const handler of handlers)handler.call(server,request,response);
      request.resume();
    })().catch(()=>{emit({event:'api_admission_denied',code:'ADMISSION_UNAVAILABLE'});respond(response,503,'ADMISSION_UNAVAILABLE');request.resume();});
  });
  return {drain(){draining=true;},async close(){draining=true;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
