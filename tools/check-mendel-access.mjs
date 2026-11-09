// Run as a one-shot private Azure job. Never emit database credentials or tokens.
import {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {createPostgresOrganizationMembershipStore,withTenantTransaction} from '@medical-device/db';
const subject='2c1b634b-a73d-43df-94f1-1abdef911947';
const actor=process.env.ACCESS_REQUEST_ACTOR;
if(!actor)throw Error('ACCESS_REQUEST_ACTOR_REQUIRED');
const pool=new Pool({connectionString:`postgresql://${encodeURIComponent(process.env.POSTGRES_ADMIN_LOGIN)}:${encodeURIComponent(process.env.POSTGRES_ADMIN_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}?sslmode=verify-full`,max:1,connectionTimeoutMillis:10000});
try{
 const memberships=createPostgresOrganizationMembershipStore(pool);
 const ownerContexts=await memberships.listOrganizationContexts(actor);
 const grantOrg=process.env.ACCESS_GRANT_ORGANIZATION;
 if(grantOrg){
  if(!ownerContexts.some(org=>org.organizationId===grantOrg))throw Error('ACCESS_OWNER_ORGANIZATION_REQUIRED');
  await withTenantTransaction(pool,{organizationId:grantOrg,actorId:actor,correlationId:'requested-mendel-access'},async client=>{
   const before=(await client.query('SELECT membership_id,status FROM organization_memberships WHERE organization_id=$1 AND subject=$2 FOR UPDATE',[grantOrg,subject])).rows[0];
   await client.query(`INSERT INTO organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',now(),now()) ON CONFLICT(subject,organization_id) DO UPDATE SET status='ACTIVE',updated_at=now()`,['membership:'+subject+':'+grantOrg,subject,grantOrg]);
   const prior=(await client.query("SELECT role FROM role_assignments WHERE organization_id=$1 AND subject=$2 AND scope_type='organization' AND (scope_id IS NULL OR scope_id=$1)",[grantOrg,subject])).rows.map(row=>row.role);
   const added=['author','learner'].filter(role=>!prior.includes(role));
   for(const role of added)await client.query(`INSERT INTO role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at) VALUES($1,$2,$3,$4,'organization',$2,now(),now()) ON CONFLICT(role_assignment_id) DO NOTHING`,['role:'+createHash('sha256').update(JSON.stringify([grantOrg,subject,role])).digest('hex'),grantOrg,subject,role]);
   if(added.length||before?.status!=='ACTIVE')await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'REQUESTED_MEMBER_ACCESS_GRANTED','membership',$4,$5::jsonb,now())`,['access:'+randomUUID(),grantOrg,actor,subject,JSON.stringify({reason:'Owner explicitly requested application access for Mendel Bergstein.',addedRoles:added,previousStatus:before?.status??'ABSENT'})]);
  });
 }
 const contexts=await memberships.listOrganizationContexts(subject);
 const access=[];for(const org of contexts)access.push({...org,roles:await memberships.resolveOrganizationRoles(subject,org.organizationId)});
 console.log(JSON.stringify({check:'mendel-access',subject,ownerContexts,access,changed:Boolean(grantOrg)}));
}catch(error){console.error(JSON.stringify({check:'mendel-access',status:'FAIL',code:/^[A-Z_]+$/.test(error.message)?error.message:'ACCESS_CHECK_FAILED'}));process.exitCode=1;}finally{await pool.end();}
