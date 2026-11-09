import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const require=createRequire(import.meta.url),https=require('node:https'),dns=require('node:dns/promises');
const originalRequest=https.request,originalLookup=dns.lookup;
let addresses=[{address:'8.8.8.8',family:4}],status=200,payload=Buffer.from('ok'),requested=0,pin;
dns.lookup=async()=>addresses;
https.request=(url,options,callback)=>{
 requested++;options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);pin={address,family};});
 const req=new EventEmitter();
 req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
 req.end=()=>queueMicrotask(()=>{
  const response=new PassThrough();response.statusCode=status;response.headers={};
  response.on('close',()=>req.emit('close'));callback(response);if(!response.destroyed)response.end(payload);
 });return req;
};syncBuiltinESMExports();
const {boundedHttpsRequest}=await import('../apps/worker/dist/provider-egress.js');
const input={url:'https://provider.example/video',origins:new Set(['https://provider.example']),maxBytes:8,timeoutMs:1000};
try{
 assert.equal((await boundedHttpsRequest(input)).bytes.toString(),'ok');assert.deepEqual(pin,{address:'8.8.8.8',family:4});
 payload=Buffer.alloc(9);await assert.rejects(boundedHttpsRequest(input),/RESPONSE_TOO_LARGE/);
 status=302;await assert.rejects(boundedHttpsRequest(input),/HTTP_302/);
 const before=requested;addresses.push({address:'169.254.169.254',family:4});await assert.rejects(boundedHttpsRequest(input),/DESTINATION_DENIED/);assert.equal(requested,before);
 console.log('HTTPS adapter pinning, mixed-private DNS denial, redirect denial and streamed overflow checks passed.');
}finally{https.request=originalRequest;dns.lookup=originalLookup;syncBuiltinESMExports();}
