import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const origin=new URL(process.argv[2]??'https://mdt-personal-api.bluebeach-5048303a.centralus.azurecontainerapps.io');
assert.equal(origin.protocol,'https:');
assert.equal(origin.username+origin.password+origin.search+origin.hash,'');
assert.equal(origin.pathname,'/');
const paths=['/healthz','/developer/starter','/developer/developer-starter.js','/developer/api','/developer/guide','/api/v1/openapi.json','/developer/client.tgz','/developer/training-viewer.js','/developer/training-viewer.d.ts','/developer/starter-source','/developer/nxstage-review.json','/api/v1/auth/config'];
const results=await Promise.allSettled(paths.map(async path=>{
 const response=await fetch(new URL(path,origin),{redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,path);
 assert.equal(response.headers.get('cache-control'),'no-store',path);
 const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>0,path);
 const text=bytes.toString('utf8');
 if(path==='/api/v1/openapi.json'){
  const contract=JSON.parse(text);assert.match(contract.openapi,/^3\.1\./);
  assert.ok(contract.paths['/api/v1/model-sessions/{sessionId}/debrief']);
  assert.equal(contract.components.schemas.Account.properties.emailVerified.type,'boolean');
 }
 if(path==='/developer/guide')assert.ok(!text.includes('Start `infra/local`'));
 if(path==='/developer/starter'){
  assert.ok(text.includes('/developer/developer-starter.js'));
  assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
 }
 if(path==='/developer/client.tgz')assert.equal(bytes.subarray(0,2).toString('hex'),'1f8b');
 if(path==='/developer/training-viewer.js'){
  assert.equal(response.headers.get('content-encoding'),'gzip');
  assert.ok(Number(response.headers.get('content-length'))<2000000,'Viewer transfer exceeds 2 MB');
 }
 if(path==='/developer/nxstage-review.json')assert.ok(text.includes('REVIEW_REQUIRED'));
 if(path==='/api/v1/auth/config'){
  const config=JSON.parse(text);assert.equal(new URL(config.applicationOrigin).protocol,'https:');
  assert.ok(!text.includes('localhost'));assert.ok(config.clientId&&config.apiScope);
 }
 return {path,bytes:bytes.length,transferBytes:Number(response.headers.get('content-length'))||bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}));
for(const result of results)if(result.status==='rejected')throw result.reason;
const checks=results.map(result=>result.value);
const root=await fetch(origin,{redirect:'manual',signal:AbortSignal.timeout(30000)});
assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/signin');
for(const path of ['/api/v1/account','/api/v1/model-sessions/test/debrief']){
 const response=await fetch(new URL(path,origin),{redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,401,path);
}
console.log(JSON.stringify({origin:origin.origin,passed:true,realSignInVerified:false,checks},null,2));
