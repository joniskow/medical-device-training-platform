import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {Pool} from 'pg';

// Match production table privileges with a disposable, non-login role. Never
// broaden the configured runtime user's permissions to make a test pass.
const connectionString=process.env.DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device';
const admin=new Pool({connectionString});
const role=`session_check_${randomUUID().replaceAll('-','')}`;
const bootstrap=await readFile(new URL('../apps/worker/src/postgres-bootstrap.ts',import.meta.url),'utf8');
const tableBlock=bootstrap.match(/const runtimeTables = \[([\s\S]*?)\]\.join/)[1];
const tables=[...tableBlock.matchAll(/"([a-z_]+)"/g)].map(match=>match[1]);
assert.ok(tables.includes('simulation_sessions')&&tables.includes('audit_events'));
let created=false;
try{
 await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);created=true;
 await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
 await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${tables.join(',')} TO ${role}`);
 await admin.query(`GRANT SELECT,INSERT,UPDATE ON course_story_positions TO ${role}`);
 await admin.query(`GRANT SELECT,INSERT ON course_story_choices TO ${role}`);
 await admin.query(`GRANT EXECUTE ON FUNCTION public.has_verified_account(text),public.default_credential_sharing(text,text) TO ${role}`);
 const runtime=new URL(connectionString);runtime.searchParams.set('options',`-c role=${role}`);
 for(const mode of ['--debrief','--nxstage-familiarization']){
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['tools/check-e4-postgres-session.mjs',mode,'--runtime-role'],{stdio:'inherit',windowsHide:true,env:{...process.env,RUNTIME_DATABASE_URL:runtime.href}});
   child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Runtime session check failed (${mode}, ${code})`)));
  });
 }
 console.log('Model-session runtime checks passed with production table grants and a non-superuser, non-bypass-RLS role.');
}finally{
 if(created){
  await admin.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await admin.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`);
  await admin.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
  await admin.query(`DROP ROLE ${role}`);
 }
 await admin.end();
}
