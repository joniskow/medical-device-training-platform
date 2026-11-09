import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createMediaReviewService} from '../apps/api/dist/media-review-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';

const admin=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device',connectionTimeoutMillis:5000});
const runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device',connectionTimeoutMillis:5000});
const org='admin-rights-test:'+randomUUID(),asset=org+':asset',version=org+':version',hash='a'.repeat(64);
const service=createMediaReviewService(runtime,{readObject:async()=>{throw Error('No storage access is needed to attest source rights.');}});
const server=createJobStatusHttpServer({mediaReviewService:service,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async request=>request.headers.authorization?{subject:'signed-'+request.headers.authorization.slice(7),roles:[]}:null},organizationContextResolver:{resolveActiveOrganizations:async()=>[org,org+':foreign'],resolveOrganizationRoles:async subject=>[subject==='signed-author'?'author':'learner']}});
try{
 await admin.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'image','READY_FOR_REVIEW','author','author',now(),now())`,[asset,org]);
 await admin.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'image',$4,'engineering.png','image/png',1,$5,'READY_FOR_REVIEW','author',now(),now())`,[version,asset,org,org+'/engineering.png',hash]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`,url=base+'/api/v1/media-review/'+encodeURIComponent(version)+'/rights';
 const body={sourceHash:hash,targetKind:'asset',ownerName:'Engineering fixture owner',useScope:'Restricted local test',confirmed:true};
 const post=(input=body,role='author',key='rights:test',organization=org)=>fetch(url,{method:'POST',headers:{...(role?{authorization:'Bearer '+role}:{}),'content-type':'application/json','idempotency-key':key,'x-organization-id':organization},body:JSON.stringify(input)});
 assert.equal((await post(body,null)).status,401);assert.equal((await post(body,'learner')).status,403);
 assert.equal((await post({...body,confirmed:false})).status,422);assert.equal((await post({...body,actorId:'forged'})).status,422);
 assert.equal((await post({...body,sourceHash:'b'.repeat(64)})).status,404);assert.equal((await post(body,'author','foreign',org+':foreign')).status,404);
 const saved=await post();assert.equal(saved.status,200,await saved.clone().text());const first=await saved.json();
 assert.deepEqual(await(await post()).json(),first);
 assert.equal((await post({...body,ownerName:'Changed owner'})).status,409);
 const rows=(await admin.query('SELECT * FROM asset_rights_attestations WHERE organization_id=$1',[org])).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].created_by,'signed-author');assert.equal(rows[0].derivative_allowed,true);
 assert.equal((await admin.query("SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1 AND event_type='ASSET_RIGHTS_ATTESTED'",[org])).rows[0].count,1);
 assert.equal((await admin.query('SELECT state FROM asset_versions WHERE asset_version_id=$1',[version])).rows[0].state,'READY_FOR_REVIEW','Rights must not approve the source');
 await admin.query("UPDATE asset_rights_attestations SET status='WITHDRAWN' WHERE organization_id=$1",[org]);
 assert.equal((await post(body,'author','new-key')).status,404);
 const schema=await(await fetch(base+'/api/v1/openapi.json')).json();assert(schema.paths['/api/v1/media-review/{targetId}/rights'].post);
 console.log('PASS: actual HTTP authentication/role gates, restricted PostgreSQL role and tenant RLS, source-hash binding, explicit confirmation, idempotent rights/audit writes, changed-intent conflict, no automatic source approval, withdrawal enforcement and OpenAPI coverage.');
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await admin.query('DELETE FROM audit_events WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM asset_rights_attestations WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM asset_versions WHERE organization_id=$1',[org]);
 await admin.query('DELETE FROM assets WHERE organization_id=$1',[org]);
 await Promise.all([admin.end(),runtime.end()]);
}
