import {createPublicCourseCatalogService} from '../apps/api/dist/public-course-catalog.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresOrganizationMembershipStore,createPostgresCourseReviewStore,createCourseOfferingStore,createCourseCatalogStore} from '../packages/db/dist/index.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const tables=[],grants=[],ids=[],actor='offering:'+randomUUID(),fn='public.manage_course_offering(text,text,text,jsonb,integer,text,text,text)';
let server;
try{
 await applyProcessingJobMigration(pool);
 for(const table of ['organizations','role_assignments'])if(!(await pool.query("SELECT has_table_privilege('local_runtime',$1,'SELECT') allowed",[table])).rows[0].allowed){await pool.query(`GRANT SELECT ON ${table} TO local_runtime`);tables.push(table);}
 for(const signature of [fn,'public.read_course_catalog(uuid,uuid)','public.create_training_organization(text,text,text,text)'])if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[signature])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${signature} TO local_runtime`);grants.push(signature);}
 const membership=createPostgresOrganizationMembershipStore(runtime),store=createCourseOfferingStore(runtime),catalog=createCourseCatalogStore(runtime);
 for(const key of ['first','other'])ids.push((await membership.createOrganization(actor,key,key,'test')).organizationId);
 const tenant={organizationId:ids[0],actorId:actor,correlationId:'test'};
 const draft=await createPostgresCourseReviewStore(pool).createDraft({tenant,title:'Course',idempotencyKey:'draft'}),release='release:'+randomUUID();
 const manifest={revision:7,content:{title:'Published title',privateAssessment:{correctAnswer:'never-project'},policy:{schemaVersion:'certification-policy.v1',version:2,requiredActivityIds:['quiz'],requiredModuleIds:['required-module'],passScore:.85,maxAttempts:3,cooldownSeconds:60,attemptTtlSeconds:600,repeatedFailureReviewAfter:2,expirationDays:365,resultSelection:'latest'},modules:[{moduleId:'required-module',activities:[{activityId:'read',title:'Read instructions',type:'text',text:'never-project'},{activityId:'sim',title:'Operate device',type:'simulation'}]},{moduleId:'other',activities:[{activityId:'quiz',title:'<img src=x> Check knowledge',type:'multiple_choice',assessment:{passScore:.9,questions:[{correctAnswer:'never-project'}]}},{activityId:'optional',title:'never-project',type:'text'}]}],simulation:{definition:{scoring:{passScore:.8,secret:'never-project'}}}}};
 await pool.query(`INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED',$4,$5,$6,'publish','hash',now())`,[release,ids[0],draft.courseVersionId,manifest,'a'.repeat(64),actor]);
 assert.deepEqual(await store.get(tenant,release),{releaseId:release,title:'Published title',releaseStatus:'PUBLISHED',mode:'PRIVATE',revision:0,details:{},publicId:null});
 const input={mode:'UNLISTED',audience:'Independent candidates',productScope:'Synthetic device',prerequisites:'No prior certification',issuerStatement:'Issuer product training',intendedUse:'Not licensure or regulatory approval',accessibilityPath:'Keyboard and text controls',estimatedMinutes:45,revision:0,reason:'Candidate offering',idempotencyKey:'first'};
 const [one,two]=await Promise.all([store.update(tenant,release,input),store.update(tenant,release,input)]);assert.deepEqual(one,two);assert.equal(one.revision,1);
 const detailBefore=await catalog.get(one.publicId);assert.equal(detailBefore.publishedRevision,7);assert.deepEqual(detailBefore.certification,{version:2,passScore:.85,maxAttempts:3,cooldownSeconds:60,attemptTtlSeconds:600,repeatedFailureReviewAfter:2,expirationDays:365,resultSelection:'latest',requiredActivities:[{title:'Read instructions',kind:'content',passScore:null},{title:'Operate device',kind:'simulation',passScore:.8},{title:'<img src=x> Check knowledge',kind:'assessment',passScore:.9}]});assert.ok(!JSON.stringify(detailBefore).includes('never-project'));
 assert.equal((await pool.query('SELECT public.catalog_certification_summary($1::jsonb) value',[{...manifest.content,policy:{...manifest.content.policy,passScore:{private:'never-project'}}}])).rows[0].value,null);
 assert.equal((await catalog.get(one.publicId)).title,'Published title');assert.ok(!(await catalog.list()).items.some(item=>item.publicId===one.publicId),'Unlisted course was searchable');assert.equal(one.details.costDesignation,'free-in-MVP');assert.ok(!JSON.stringify(one).includes('never-project'));
 await assert.rejects(store.update(tenant,release,{...input,audience:'Different'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(store.update(tenant,release,{...input,idempotencyKey:'stale'}),/COURSE_OFFERING_CHANGED/);
 for(const extra of [{mode:'INVALID'},{estimatedMinutes:0},{estimatedMinutes:1.1},{audience:''},{issuerStatement:null}])await assert.rejects(store.update(tenant,release,{...input,...extra}),/COURSE_OFFERING_INVALID/);
 await assert.rejects(store.get({...tenant,organizationId:ids[1]},release),/NOT_FOUND/);await assert.rejects(store.get({...tenant,actorId:'nonmember'},release),/ADMIN_REQUIRED/);
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createCourseOfferingStore(broken).update(tenant,release,{...input,mode:'PUBLIC',revision:1,idempotencyKey:'rollback'}),/Injected commit/);assert.equal((await store.get(tenant,release)).revision,1);
 await store.update(tenant,release,{...input,mode:'PRIVATE',revision:1,idempotencyKey:'private'});assert.equal((await store.update(tenant,release,input)).mode,'PRIVATE','Old replay re-exposed the course');
 assert.equal(await catalog.get(one.publicId),null,'Private course retained direct access');
 assert.deepEqual((await pool.query('SELECT manifest FROM release_manifests WHERE release_id=$1',[release])).rows[0].manifest,manifest);
 assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_OFFERING_UPDATED'",[ids[0]])).rows[0].n,2);
 await assert.rejects(runtime.query('SELECT * FROM course_offerings'),/permission denied/);await assert.rejects(runtime.query('UPDATE course_offerings SET revision=revision WHERE false'),/permission denied/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='manage_course_offering' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
 const opened=await store.update(tenant,release,{...input,mode:'PUBLIC',revision:2,idempotencyKey:'open'});
 assert.notEqual(opened.publicId,one.publicId);assert.equal(await catalog.get(one.publicId),null);
 const published=(await catalog.list()).items.find(item=>item.publicId===opened.publicId);assert.ok(published);
 assert.deepEqual(Object.keys(published).sort(),['publicId','title','issuerName','revision','audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath','estimatedMinutes','costDesignation'].sort());
 const publicIds=new Set([opened.publicId]);
 for(let i=0;i<51;i++){
  const draftPage=await createPostgresCourseReviewStore(pool).createDraft({tenant,title:'Page '+i,idempotencyKey:'page:'+i}),releasePage='release:'+randomUUID();
  await pool.query(`INSERT INTO release_manifests(release_id,organization_id,course_version_id,status,manifest,release_hash,published_by,idempotency_key,request_hash,created_at) VALUES($1,$2,$3,'PUBLISHED',$4,$5,$6,$7,'hash',now())`,[releasePage,ids[0],draftPage.courseVersionId,manifest,i.toString(16).padStart(64,'0'),actor,'publish:'+i]);
  publicIds.add((await store.update(tenant,releasePage,{...input,mode:'PUBLIC',revision:0,idempotencyKey:'page:'+i})).publicId);
 }
 let pageCursor,seen=[];do{const page=await catalog.list(pageCursor);assert.ok(page.items.length<=50);seen.push(...page.items.map(item=>item.publicId));pageCursor=page.nextCursor??undefined;}while(pageCursor);
 assert.equal(new Set(seen).size,seen.length);for(const id of publicIds)assert.ok(seen.includes(id),'Pagination skipped an available course');
 assert.ok(!JSON.stringify(published).includes('never-project'));await assert.rejects(runtime.query('SELECT * FROM course_catalog_routes'),/permission denied/);
 await assert.rejects(catalog.list('invalid'),/CURSOR_INVALID/);assert.equal(await catalog.get('invalid'),null);
 await pool.query("UPDATE organizations SET status='SUSPENDED' WHERE organization_id=$1",[ids[0]]);assert.equal(await catalog.get(opened.publicId),null);assert.ok(!(await catalog.list()).items.some(item=>item.publicId===opened.publicId));
 await pool.query("UPDATE organizations SET status='ACTIVE' WHERE organization_id=$1",[ids[0]]);
 const c=await runtime.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[ids[1]]);await c.query('SELECT public.read_course_catalog($1::uuid,NULL)',[opened.publicId]);assert.equal((await c.query("SELECT current_setting('app.organization_id') value")).rows[0].value,ids[1]);await c.query('ROLLBACK');}finally{c.release();}
 const limited=createPublicCourseCatalogService(pool,2),address='catalog-test:'+randomUUID();await limited.read(address);const detail=await limited.read(address,opened.publicId);assert.equal(detail.enrollmentNotice.version,'candidate-notice.v2');assert.ok(detail.enrollmentNotice.text.includes('Credential sharing and discoverability are separate choices.'));await assert.rejects(limited.read(address),/RATE_LIMITED/);
 await pool.query("UPDATE release_manifests SET status='RETIRED' WHERE release_id=$1",[release]);await assert.rejects(store.update(tenant,release,{...input,mode:'PUBLIC',revision:3,idempotencyKey:'retired'}),/RELEASE_UNAVAILABLE/);
 await store.update(tenant,release,{...input,mode:'PRIVATE',revision:3,idempotencyKey:'close'});
 assert.equal(await catalog.get(opened.publicId),null);
 server=createJobStatusHttpServer({publicCourseCatalogService:createPublicCourseCatalogService(pool),courseOfferingStore:store,statusService:{get:async()=>null,retry:async()=>null},organizationContextResolver:membership,authenticator:{authenticate:async req=>req.headers.authorization?{subject:actor,roles:['organization_admin']}:null}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/v1/releases/${encodeURIComponent(release)}/offering`,headers={authorization:'test','content-type':'application/json','x-organization-id':ids[0],'idempotency-key':'http'};
 const browse=await fetch(new URL('/api/v1/catalog',url));assert.equal(browse.status,200);assert.equal(browse.headers.get('cache-control'),'no-store');assert.equal((await fetch(new URL('/api/v1/catalog/'+opened.publicId,url))).status,404);
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers})).status,200);
 const {idempotencyKey,...fields}=input;const body={...fields,mode:'PRIVATE',revision:4,confirmed:true};
 for(const extra of [{confirmed:false},{actorId:'spoof'},{organizationId:ids[1]},{costDesignation:'paid'}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,...extra})})).status,422);
 assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
 await pool.query('DELETE FROM role_assignments WHERE organization_id=$1',[ids[0]]);assert.equal((await fetch(url,{headers})).status,403);
 console.log('Course offering checks passed: private default, explicit disclosures, release binding, scoped authorization, concurrent/idempotent revisions, rollback, no re-exposure, retirement, private projection strict HTTP input, catalog allowlist, unlisted exclusion, link rotation, current-state filtering, context restoration and rate limiting.');
}finally{
 if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}
 try{for(const table of ['course_offerings','release_manifests','audit_events','course_versions','courses','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=ANY($1::text[])`,[ids]);}
 finally{for(const table of tables)await pool.query(`REVOKE SELECT ON ${table} FROM local_runtime`);for(const signature of grants)await pool.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM local_runtime`);await runtime.end();await pool.end();}
}
