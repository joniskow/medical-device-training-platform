import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresKnowledgeStore} from '../packages/db/dist/index.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const admin=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='review:'+randomUUID(),asset=org+':asset',version=org+':version',hash='a'.repeat(64);
const store=createPostgresKnowledgeStore(runtime),tenant={organizationId:org,actorId:'reviewer',correlationId:'review'};
const server=createJobStatusHttpServer({knowledgeStore:store,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async request=>request.headers.authorization?{subject:'reviewer',roles:[request.headers.authorization.slice(7)]}:null},organizationContextResolver:{resolveActiveOrganizations:async()=>[org]}});
try{
 await admin.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'pdf','READY_FOR_REVIEW','author','author',now(),now())`,[asset,org]);
 await admin.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'pdf',$4,'manual.pdf','application/pdf',1,$5,'READY_FOR_REVIEW','author',now(),now())`,[version,asset,org,org+'/manual.pdf',hash]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/v1/knowledge-sources/${encodeURIComponent(version)}`;
 const input={sourceHash:hash,decision:'APPROVE',rationale:'Reviewed the synthetic source.',confirmed:true};
 const post=(body,role='reviewer',key='review-key')=>fetch(url,{method:'POST',headers:{authorization:'Bearer '+role,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
 assert.equal((await post(input,'author')).status,403);
 assert.equal((await post({...input,confirmed:false})).status,422);
 assert.equal((await post({...input,sourceHash:'b'.repeat(64)})).status,409);
 await assert.rejects(store.reviewSource({...tenant,organizationId:'foreign'},version,{...input,idempotencyKey:'foreign'}),/SOURCE_UNAVAILABLE/);
 const responses=await Promise.all([post(input),post(input)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert.equal((await admin.query('SELECT state FROM asset_versions WHERE asset_version_id=$1',[version])).rows[0].state,'APPROVED');
 assert.equal((await admin.query('SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1',[org])).rows[0].count,1);
 assert.equal((await post({...input,rationale:'changed'})).status,409);
 assert.equal((await post({...input,decision:'REJECT'},'reviewer','new-key')).status,409);
 await admin.query("UPDATE asset_versions SET state='READY_FOR_REVIEW' WHERE asset_version_id=$1",[version]);
 assert.equal((await post({...input,decision:'REJECT'},'reviewer','reject-key')).status,200);
 assert.equal((await admin.query('SELECT state FROM asset_versions WHERE asset_version_id=$1',[version])).rows[0].state,'REJECTED');
 console.log('Source review passed: restricted database role + HTTP, reviewer gate, confirmation, hash conflict, tenant isolation, concurrent replay, immutable decision and rejection.');
}finally{
 if(server.listening)await new Promise(resolve=>server.close(resolve));
 await admin.query('DELETE FROM audit_events WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM asset_versions WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM assets WHERE organization_id=$1',[org]);
 await runtime.end();await admin.end();
}
