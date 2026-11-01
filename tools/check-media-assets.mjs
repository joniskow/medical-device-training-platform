import {createPostgresEnrollmentService} from '../apps/api/dist/enrollment-service.js';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresCourseReviewStore} from '../packages/db/dist/index.js';
import {createMediaAssetService} from '../apps/api/dist/media-asset-service.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const admin=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const org='media:'+randomUUID(),tenant={organizationId:org,actorId:'learner',correlationId:org},assetId=org+':asset',assetVersionId=org+':version',releaseId=org+':release',enrollmentId=org+':enrollment';
let addedStoryGrant=false;
const mediaBytes=Buffer.from([137,80,78,71]),mediaHash=createHash('sha256').update(mediaBytes).digest('hex');let corruptContent=false;
const signed=[];let failStorage=false,locked=false,candidate=false,candidateAllowed=true,author=false;
const storage={createDownloadUrl:async value=>{if(failStorage)throw Error('private internal storage error');signed.push(value);return 'https://private.test/media?token=fixture';},readObject:async()=>({bytes:corruptContent?Buffer.from('wrong'):mediaBytes})};const service=createMediaAssetService(runtime,storage);
const server=createJobStatusHttpServer({mediaAssetService:service,statusService:{get:async()=>null,retry:async()=>null},authenticator:{authenticate:async req=>req.headers.authorization?{subject:req.headers.authorization,issuer:'fixture',identityTenant:'fixture',roles:author?['author']:['learner']}:null},personalAccountStore:{access:async()=>{if(locked)throw Error('ACCOUNT_LOCKED');},observeVerification:async()=>{}},organizationContextResolver:{resolveActiveOrganizations:async()=>candidate?[]:[org]},candidateLearningAccessStore:{canAccess:async()=>candidateAllowed}});
const manifest={sourceArtifacts:[{assetVersionId,sha256:mediaHash}],content:{title:'Media fixture',modules:[{moduleId:'module',activities:[{activityId:'image',type:'image',media:{assetVersionId,altText:'Cover diagram'}}]}]}};
try{
 await applyProcessingJobMigration(admin);
 if(!(await admin.query("SELECT has_table_privilege('local_runtime','course_story_positions','SELECT') allowed")).rows[0].allowed){await admin.query('GRANT SELECT ON course_story_positions TO local_runtime');addedStoryGrant=true;}
 const draft=await createPostgresCourseReviewStore(admin).createDraft({tenant,title:'Media fixture',idempotencyKey:'draft'});
 await admin.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'image','APPROVED','author','author',now(),now())`,[assetId,org]);
 await admin.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,'image',$4,'diagram.png','image/png',1,$5,'APPROVED','author',now(),now())`,[assetVersionId,assetId,org,org+'/uploads/diagram.png',mediaHash]);
 await admin.query(`INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED',$4,$5,'reviewer','fixture','fixture',now())`,[releaseId,org,draft.courseVersionId,manifest,'b'.repeat(64)]);
 await admin.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,'learner',$3,'ACTIVE',now(),now())`,[enrollmentId,org,draft.courseVersionId]);
 const generationStore=createPostgresCourseReviewStore(runtime);
 assert.deepEqual(await generationStore.getApprovedMediaForGeneration(tenant,[assetVersionId]),[{assetVersionId,sourceType:'image',contentType:'image/png'}]);
 assert.deepEqual(await generationStore.getApprovedMediaForGeneration({...tenant,organizationId:'foreign'},[assetVersionId]),[]);
 await admin.query("UPDATE asset_versions SET state='QUARANTINED' WHERE asset_version_id=$1",[assetVersionId]);assert.deepEqual(await generationStore.getApprovedMediaForGeneration(tenant,[assetVersionId]),[]);await admin.query("UPDATE asset_versions SET state='APPROVED' WHERE asset_version_id=$1",[assetVersionId]);
 await admin.query("UPDATE assets SET status='RETIRED' WHERE asset_id=$1",[assetId]);assert.deepEqual(await generationStore.getApprovedMediaForGeneration(tenant,[assetVersionId]),[]);await admin.query("UPDATE assets SET status='APPROVED' WHERE asset_id=$1",[assetId]);
 await assert.rejects(generationStore.getApprovedMediaForGeneration(tenant,['invalid id']),/MEDIA_REQUEST_INVALID/);
 const listed=await service.listApproved(tenant);assert.equal(listed.items.length,1);assert.deepEqual(Object.keys(listed.items[0]).sort(),['assetVersionId','contentType','fileName','type']);
 assert.equal((await service.listApproved({...tenant,organizationId:'foreign'})).items.length,0);
 await assert.rejects(service.listApproved(tenant,'bad cursor'),/MEDIA_REQUEST_INVALID/);
 await admin.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at)
 SELECT $1||':'||lpad(n::text,2,'0'),$2,$3,'image',$3||'/uploads/page-'||n::text||'.png','page.png','image/png',1,$4,'APPROVED','author',now(),now() FROM generate_series(1,50) n`,[assetVersionId,assetId,org,mediaHash]);
 const firstPage=await service.listApproved(tenant);assert.equal(firstPage.items.length,50);assert(firstPage.nextCursor);const secondPage=await service.listApproved(tenant,firstPage.nextCursor);assert.equal(secondPage.items.length,1);assert.equal(secondPage.nextCursor,undefined);assert.equal(new Set([...firstPage.items,...secondPage.items].map(a=>a.assetVersionId)).size,51);
 await admin.query('DELETE FROM asset_versions WHERE organization_id=$1 AND asset_version_id<>$2',[org,assetVersionId]);
 const result=await service.get(tenant,enrollmentId,'image');assert.deepEqual(result,{url:'https://private.test/media?token=fixture',contentType:'image/png',expiresInSeconds:300,altText:'Cover diagram'});assert.deepEqual(signed[0],{blobKey:org+'/uploads/diagram.png',expiresInSeconds:300});
 const privateDescriptor=await createMediaAssetService(runtime,storage,true).get(tenant,enrollmentId,'image');assert.ok(privateDescriptor.url.startsWith('/api/v1/enrollments/'));
 const denied=async(run,pattern=/MEDIA_NOT_FOUND/)=>{const before=signed.length;await assert.rejects(run,pattern);assert.equal(signed.length,before,'Denied request issued signed URL');};
 await denied(()=>service.get({...tenant,actorId:'other'},enrollmentId,'image'));
 await denied(()=>service.get({...tenant,organizationId:'other'},enrollmentId,'image'));
 await denied(()=>service.get(tenant,enrollmentId,'unknown'));
 for(const [column,value,restore] of [['sha256','c'.repeat(64),mediaHash],['state','REJECTED','APPROVED'],['blob_key','foreign/uploads/file.png',org+'/uploads/diagram.png'],['content_type','image/svg+xml','image/png']]){
  await admin.query(`UPDATE asset_versions SET ${column}=$2 WHERE asset_version_id=$1`,[assetVersionId,value]);await denied(()=>service.get(tenant,enrollmentId,'image'));await admin.query(`UPDATE asset_versions SET ${column}=$2 WHERE asset_version_id=$1`,[assetVersionId,restore]);
 }
 for(const [table,key,value,restore] of [['enrollments','enrollment_id','SUSPENDED','ACTIVE'],['release_manifests','release_id','RETIRED','PUBLISHED']]){
  const target=table==='enrollments'?enrollmentId:releaseId;await admin.query(`UPDATE ${table} SET status=$2 WHERE ${key}=$1`,[target,value]);await denied(()=>service.get(tenant,enrollmentId,'image'));await admin.query(`UPDATE ${table} SET status=$2 WHERE ${key}=$1`,[target,restore]);
 }
 const setManifest=value=>admin.query('UPDATE release_manifests SET manifest=$2 WHERE release_id=$1',[releaseId,value]);
 await setManifest({...manifest,sourceArtifacts:[]});await denied(()=>service.get(tenant,enrollmentId,'image'));
 const story=structuredClone(manifest);story.content.story={schemaVersion:'course-story.v1',mission:'Test',startNodeId:'intro',nodes:[{nodeId:'intro',title:'Briefing',purpose:'Read',prerequisites:[],choices:[{choiceId:'begin',label:'Begin',consequence:'View',nextNodeId:'media',conditions:[]}]},{nodeId:'media',title:'Image',purpose:'View',activityId:'image',prerequisites:[],choices:[],outcome:{kind:'success',message:'Done'}}]};
 await setManifest(story);await denied(()=>service.get(tenant,enrollmentId,'image'),/STORY_ACTIVITY_UNAVAILABLE/);await setManifest(manifest);
 const video=structuredClone(manifest);video.content.modules[0].activities[0]={activityId:'image',type:'video',media:{assetVersionId,transcript:'First identify the cover.'}};
 await admin.query("UPDATE asset_versions SET source_type='video',content_type='video/mp4' WHERE asset_version_id=$1",[assetVersionId]);await setManifest(video);
 const videoResult=await service.get(tenant,enrollmentId,'image');assert.equal(videoResult.transcript,'First identify the cover.');assert.equal(videoResult.altText,undefined);assert.equal(videoResult.contentType,'video/mp4');
 await admin.query("UPDATE asset_versions SET source_type='image',content_type='image/png' WHERE asset_version_id=$1",[assetVersionId]);await setManifest(manifest);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/v1/enrollments/${enrollmentId}/activities/image/media`,headers={authorization:'learner','x-organization-id':org};
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,authorization:'other'}})).status,404);
 const listUrl=`http://127.0.0.1:${server.address().port}/api/v1/approved-media`;
 assert.equal((await fetch(listUrl,{headers})).status,403);author=true;
 const authorList=await fetch(listUrl,{headers});assert.equal(authorList.status,200);assert.equal((await authorList.json()).items.length,1);
 assert.equal((await fetch(listUrl+'?after=x&after=y',{headers})).status,422);assert.equal((await fetch(listUrl+'?url=forged',{headers})).status,422);assert.equal((await fetch(listUrl,{headers,method:'POST'})).status,405);author=false;
 const privateContent=await fetch(url+'?content=1',{headers});assert.equal(privateContent.status,200);assert.equal(privateContent.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await privateContent.arrayBuffer()),mediaBytes);
 assert.equal((await fetch(url+'?content=1')).status,401);assert.equal((await fetch(url+'?content=1',{headers:{...headers,authorization:'other'}})).status,404);
 corruptContent=true;assert.equal((await fetch(url+'?content=1',{headers})).status,503);corruptContent=false;
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),result);
 assert.equal((await fetch(url+'?assetVersionId=forged',{headers})).status,422);assert.equal((await fetch(url,{headers,method:'POST'})).status,405);
 locked=true;assert.equal((await fetch(url,{headers})).status,403);locked=false;
 candidate=true;assert.equal((await fetch(url,{headers})).status,200);candidateAllowed=false;assert.equal((await fetch(url,{headers})).status,403);candidateAllowed=true;
 failStorage=true;const failure=await fetch(url,{headers});assert.equal(failure.status,503);assert(!(await failure.text()).includes('private internal'));
 assert.equal((await admin.query('SELECT count(*)::int n FROM progress_events WHERE organization_id=$1',[org])).rows[0].n,0);
 const enrollments=createPostgresEnrollmentService(runtime),signedBeforeReview=signed.length;
 const acknowledgements=await Promise.all([enrollments.acknowledge(tenant,enrollmentId,'image'),enrollments.acknowledge(tenant,enrollmentId,'image')]);assert.deepEqual(acknowledgements[0],acknowledgements[1]);
 assert.equal(signed.length,signedBeforeReview,'Acknowledgement signed a URL');assert.equal((await admin.query('SELECT count(*)::int n FROM progress_events WHERE organization_id=$1',[org])).rows[0].n,1);
 const projected=await enrollments.get(tenant,enrollmentId);assert.equal(projected.progress[0].status,'ACKNOWLEDGED');assert.equal(projected.content.modules[0].activities[0].media,undefined,'Enrollment leaked private media binding');
 assert.equal((await admin.query('SELECT count(*)::int n FROM credentials WHERE organization_id=$1',[org])).rows[0].n,0,'Media-only acknowledgement issued a credential');
 await admin.query("UPDATE asset_versions SET state='REJECTED' WHERE asset_version_id=$1",[assetVersionId]);await assert.rejects(enrollments.acknowledge(tenant,enrollmentId,'image'),/MEDIA_NOT_FOUND/);
 console.log('Private media passed: restricted-role binding/hash/type/tenant checks, lifecycle and story denial without signing, HTTP account/candidate authorization, no-store, safe failures, no automatic learning evidence, explicit idempotent acknowledgement and no media-only credential.');
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
 for(const table of ['progress_events','enrollments','release_manifests','course_versions','courses','asset_versions','assets','audit_events'])await admin.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
 if(addedStoryGrant)await admin.query('REVOKE SELECT ON course_story_positions FROM local_runtime');
 await runtime.end();await admin.end();
}
