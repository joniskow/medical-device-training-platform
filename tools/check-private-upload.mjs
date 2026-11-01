import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createAzureBlobStorage} from '../packages/storage/dist/index.js';
import {createUploadSessionService} from '../apps/api/dist/upload-session-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';

const storage=createAzureBlobStorage({connectionString:'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;',containerName:'private-upload-check',allowHttp:true});
await storage.ensureContainers();
const sessions=new Map();
const store={
 create:async input=>{const row={...input,organizationId:input.tenant.organizationId,uploadSessionId:randomUUID(),status:'ACTIVE'};sessions.set(row.uploadSessionId,row);return row;},
 get:async(tenant,id)=>{const row=sessions.get(id);return row?.organizationId===tenant.organizationId?row:null;},
 cancel:async()=>false
};
const service=createUploadSessionService({storage,store,privateUpload:true});
const server=createJobStatusHttpServer({uploadSessionService:service,
 authenticator:{authenticate:async request=>request.headers.authorization?{subject:request.headers.authorization.slice(7),roles:request.headers.authorization==='Bearer learner'?['learner']:['author']}:null},
 organizationContextResolver:{resolveActiveOrganizations:async()=>['org_upload']},statusService:{get:async()=>null,retry:async()=>null}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const tenant={organizationId:'org_upload',actorId:'author',correlationId:'test'};
const bytes=Buffer.alloc(5*1024*1024+17,42);
const make=()=>service.create(tenant,{sourceType:'pdf',fileName:'manual.pdf',contentType:'application/pdf',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),actorId:'author'});
const put=(session,body=bytes,actor='author',contentType='application/pdf')=>fetch(origin+session.uploadUrl,{method:'PUT',headers:{authorization:`Bearer ${actor}`,'content-type':contentType},body});
try{
 const created=await make();
 assert.ok(created.uploadUrl.startsWith('/api/v1/'));
 assert.equal((await put(created)).status,200);
 assert.deepEqual(Buffer.from((await storage.readObject({blobKey:created.session.blobKey})).bytes),bytes);
 for(const [body,actor,type,status] of [[bytes,'other','application/pdf',404],[bytes,'learner','application/pdf',403],[bytes,'author','text/plain',422],[bytes.subarray(1),'author','application/pdf',422],[Buffer.alloc(bytes.length,43),'author','application/pdf',422],[Buffer.concat([bytes,Buffer.from('x')]),'author','application/pdf',422]]){
  const bad=await make();assert.equal((await put(bad,body,actor,type)).status,status);
  await assert.rejects(storage.getObjectProperties({blobKey:bad.session.blobKey}));
 }
 const expired=await make();expired.session.expiresAt=new Date(0).toISOString();assert.equal((await put(expired)).status,404);
 const completed=await make();completed.session.status='COMPLETED';assert.equal((await put(completed)).status,404);
 // A producer failure after a staged block must not replace existing committed data.
 await assert.rejects(storage.putObjectStream({blobKey:created.session.blobKey,contentType:'application/pdf',chunks:(async function*(){yield Buffer.alloc(5*1024*1024,7);throw Error('interrupted');})()}));
 assert.deepEqual(Buffer.from((await storage.readObject({blobKey:created.session.blobKey})).bytes),bytes);
 console.log('Private upload passed: real HTTP + Blob emulator, multi-block bytes, author/owner/expiry checks, size/hash rejection, and failed-stream non-commit.');
}finally{await new Promise(resolve=>server.close(resolve));}
