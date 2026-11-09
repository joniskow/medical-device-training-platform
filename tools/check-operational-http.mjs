import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {installOperationalHttp,emitOperationalEvent} from '../apps/api/dist/operations-runtime.js';

const events=[];
let readyCalls=0, dependencyCalls=0, available=true, admission=true;
const buckets=new Map();
const store={async ready(){readyCalls++;return available;},async takeRate(key,max){if(!admission)throw Error('db_secret_should_not_be_logged');const n=(buckets.get(key)??0)+1;buckets.set(key,n);return n<=max;}};
const makeServer=async()=>{
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.end(Buffer.concat(chunks));
  });
  const runtime=installOperationalHttp(server,{store,pool:{},secret:'operational-test-secret-at-least-32-bytes',dependencyProbe:async()=>{dependencyCalls++;},sink:line=>events.push(JSON.parse(line))}); // gitleaks:allow -- synthetic local test secret only
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,runtime,url:`http://127.0.0.1:${server.address().port}`};
};
const a=await makeServer(), b=await makeServer();
try {
  assert.equal((await fetch(a.url+'/healthz')).status,200);
  await Promise.all(Array.from({length:20},()=>fetch(a.url+'/readyz')));
  assert.equal(readyCalls,1);assert.equal(dependencyCalls,1,'concurrent readiness probes must coalesce');
  const text='exact streamed body';
  assert.equal(await(await fetch(a.url+'/api/v1/test',{method:'POST',body:text})).text(),text,'middleware cannot consume body before application');
  assert.equal((await fetch(a.url+'/api/v1/test',{method:'POST',body:'x'.repeat(65537)})).status,413);
  const upload=await fetch(a.url+'/api/v1/upload-sessions/123/content',{method:'PUT',body:'x'.repeat(70000)});
  assert.equal(upload.status,200);assert.equal((await upload.text()).length,70000,'binary upload path needs independent larger bound');
  buckets.clear();
  const results=await Promise.all(Array.from({length:32},(_,i)=>fetch((i%2?a:b).url+'/api/v1/discovery')));
  assert.equal(results.filter(result=>result.status===200).length,30,'shared rate buckets span replicas');
  assert.equal(results.filter(result=>result.status===429).length,2);
  admission=false;
  assert.equal((await fetch(a.url+'/api/v1/test')).status,503,'limiter outage must fail closed');
  a.runtime.drain();
  assert.equal((await fetch(a.url+'/readyz')).status,503);
  assert.equal((await fetch(a.url+'/healthz')).status,200);
  emitOperationalEvent({event:'api_request',correlationId:'private@email.invalid',route:'/secret?token=xyz',status:503},line=>events.push(JSON.parse(line)));
  assert.ok(events.some(event=>event.event==='api_admission_denied'));
  assert.ok(!JSON.stringify(events).includes('db_secret'));
  assert.ok(!JSON.stringify(events).includes('private@email'));
  assert.ok(!JSON.stringify(events).includes('token=xyz'));
  console.log('Operational HTTP passed: streamed bodies, upload bounds, shared admission, fail-closed outage, readiness cache, drain and safe telemetry.');
}finally{await Promise.all([a.runtime.close(),b.runtime.close()]);}
