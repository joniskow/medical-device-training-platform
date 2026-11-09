import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {configureLifecycleMaintenanceRouting,LIFECYCLE_ROUTING_OWNER} from '../packages/db/dist/maintenance-routing.js';
import {RETENTION_GOVERNANCE_MIGRATION_SQL} from '../packages/db/dist/retention-governance.js';
import {LIFECYCLE_NOTIFICATION_MIGRATION_SQL} from '../packages/db/dist/lifecycle-notifications.js';

const pool=new Pool({connectionString:process.env.DATABASE_ADMIN_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const prefix='maintenance:'+randomUUID(),org=prefix+':org',requester=prefix+':requester',heldOrg=prefix+':held',caller='maintenance_caller_'+randomUUID().replaceAll('-','');
const client=await pool.connect();let roleCreated=false;
try{
 await pool.query(LIFECYCLE_NOTIFICATION_MIGRATION_SQL);await pool.query(RETENTION_GOVERNANCE_MIGRATION_SQL);
 await configureLifecycleMaintenanceRouting(pool);
 const owner=(await pool.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=$1',[LIFECYCLE_ROUTING_OWNER])).rows[0];assert.ok(Object.values(owner).every(value=>value===false));
 for(const fn of ['due_lifecycle_deliveries','due_retention_organizations','due_retention_resource_organizations','advance_inquiry_lifecycle'])assert.equal((await pool.query('SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=$1',[fn])).rows[0].owner,LIFECYCLE_ROUTING_OWNER);
 await pool.query(`CREATE ROLE ${caller} NOLOGIN NOSUPERUSER NOBYPASSRLS`);roleCreated=true;
 await pool.query(`GRANT USAGE ON SCHEMA public TO ${caller}`);
 for(const fn of ['due_lifecycle_deliveries()','due_retention_organizations()','due_retention_resource_organizations()','advance_inquiry_lifecycle()'])await pool.query(`GRANT EXECUTE ON FUNCTION public.${fn} TO ${caller}`);
 assert.equal((await pool.query('SELECT pg_has_role($1,$2,\'MEMBER\') AS member',[caller,LIFECYCLE_ROUTING_OWNER])).rows[0].member,false);
 await pool.query("INSERT INTO protected_exports(export_id,organization_id,requester_id,request_key,state,blob_key,expires_at) VALUES($1,$2,'fixture',$1,'PENDING',$3,now()+interval '1 hour'),($4,$2,'fixture',$4,'SUCCEEDED',$5,now()-interval '1 day')",[prefix+':export',org,org+'/exports/pending.json',prefix+':expired',org+'/exports/expired.json']);
 await pool.query("INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,'protected.export.create',$1,'{}','PENDING','1000-01-01',now(),now())",[prefix+':export',org]);
 await pool.query("INSERT INTO retention_resource_policies(organization_id,policy_id,resource_kind,minimum_age_seconds,reason,approved_by) VALUES($1,'fixture','UNCLASSIFIED',0,'fixture','fixture')",[org]);
 await pool.query("INSERT INTO retention_blob_resources(resource_id,organization_id,blob_key,resource_kind,state,policy_id,purge_after,created_at) VALUES($1,$2,$3,'UNCLASSIFIED','TOMBSTONED','fixture',now()-interval '1 day',now()-interval '2 days')",[prefix+':resource',org,org+'/private.bin']);
 await pool.query("INSERT INTO courses(course_id,organization_id,name,status,created_by,created_at,updated_at) VALUES($1,$2,'Maintenance fixture','ACTIVE','fixture',now(),now())",[prefix+':course',org]);
 await pool.query("INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$1,$2,1,'{}','DRAFT','fixture',now(),now())",[prefix+':course',org]);
 await pool.query("INSERT INTO credentials(credential_id,organization_id,learner_id,course_version_id,public_id,status,issued_at,created_at,updated_at,evidence) VALUES($1,$2,'private-learner',$3,$1,'ACTIVE',now(),now(),now(),'{}')",[prefix+':credential',org,prefix+':course']);
 await pool.query("INSERT INTO discovery_profiles(profile_id,user_id,organization_id,credential_id,alias,coarse_area,enabled) VALUES($1,'private-learner',$2,$3,'Private fixture','private-area',true)",[prefix+':profile',org,prefix+':credential']);
 await pool.query("INSERT INTO discovery_inquiries(inquiry_id,organization_id,requester_id,profile_id,message,request_key,signature,status,expires_at) VALUES($1,$2,'private-requester',$3,'Private message',$1,'fixture','PENDING',now()-interval '1 day')",[prefix+':inquiry',requester,prefix+':profile']);
 await pool.query("INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,'pdf','ACTIVE','fixture','fixture',now(),now())",[prefix+':source',heldOrg]);await pool.query("INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$1,$2,'pdf',$2||'/source.pdf','source.pdf','application/pdf',1,repeat('a',64),'RETIRED','fixture',now(),now())",[prefix+':source',heldOrg]);await pool.query("INSERT INTO retention_schedules(organization_id,asset_version_id,purge_after,reason,actor_id) VALUES($1,$2,now()-interval '1 day','fixture','fixture')",[heldOrg,prefix+':source']);
 await client.query(`SET ROLE ${caller}`);
 for(const table of ['protected_exports','retention_blob_resources','outbox_events','discovery_profiles','discovery_inquiries'])await assert.rejects(client.query('SELECT * FROM '+table),/permission denied/);
 await assert.rejects(client.query('SELECT public.retention_source_held($1,$2)',[heldOrg,prefix+':source']),/permission denied for function retention_source_held/,'Execute-only dispatcher cannot probe arbitrary tenant holds');
 await client.query('BEGIN');await client.query("SELECT set_config('app.organization_id','unrelated-org',true),set_config('app.user_id','unrelated-user',true)");
 assert.ok((await client.query('SELECT * FROM due_lifecycle_deliveries()')).rows.some(row=>row.work_id===prefix+':export'));
 assert.ok((await client.query('SELECT * FROM due_retention_organizations()')).rows.some(row=>row.organization_id===org));
 assert.ok((await client.query('SELECT * FROM due_retention_organizations()')).rows.some(row=>row.organization_id===heldOrg));await pool.query("INSERT INTO lifecycle_holds(organization_id,asset_version_id,reason,actor_id) VALUES($1,$2,'Fixture legal hold','fixture')",[heldOrg,prefix+':source']);assert.equal((await client.query('SELECT * FROM due_retention_organizations()')).rows.some(row=>row.organization_id===heldOrg),false,'Held source must not route under a different tenant context');
 assert.ok((await client.query('SELECT * FROM due_retention_resource_organizations()')).rows.some(row=>row.organization_id===org));
 assert.ok((await client.query('SELECT advance_inquiry_lifecycle() AS changed')).rows[0].changed>=1);
 assert.deepEqual((await client.query("SELECT current_setting('app.organization_id') AS org,current_setting('app.user_id') AS actor")).rows[0],{org:'unrelated-org',actor:'unrelated-user'});
 await client.query('COMMIT');await client.query('RESET ROLE');
 assert.equal((await pool.query('SELECT status FROM discovery_inquiries WHERE inquiry_id=$1',[prefix+':inquiry'])).rows[0].status,'EXPIRED');
 assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE organization_id=$1 AND notification_type='INQUIRY_LIFECYCLE'",[org])).rows[0].n,1);
 console.log('Maintenance routing passed with NOLOGIN NOSUPERUSER NOBYPASSRLS function owner, FORCE RLS metadata tables, execute-only caller, no owner membership/direct table access, expiry notifications and restored tenant context.');
}finally{
 await client.query('ROLLBACK').catch(()=>{});await client.query('RESET ROLE').catch(()=>{});client.release();
 try{
  await pool.query('DELETE FROM discovery_inquiries WHERE inquiry_id=$1',[prefix+':inquiry']);await pool.query('DELETE FROM discovery_profiles WHERE profile_id=$1',[prefix+':profile']);
  for(const table of ['notifications','outbox_events','audit_events','retention_schedules','lifecycle_holds','asset_versions','assets','retention_blob_resources','retention_resource_policies','protected_exports','credentials','course_versions','courses'])await pool.query('DELETE FROM '+table+' WHERE organization_id=ANY($1::text[])',[[org,requester,heldOrg]]);
  if(roleCreated){await pool.query(`DROP OWNED BY ${caller}`);await pool.query(`DROP ROLE ${caller}`);}
 }finally{await pool.end();}
}
